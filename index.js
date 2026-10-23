import { Transform } from 'node:stream';

const [cr] = Buffer.from('\r');
const [nl] = Buffer.from('\n');
const defaults = {
    escape: '"',
    // eslint-disable-next-line unicorn/no-null -- Preserve the public default options value.
    headers: null,
    mapHeaders: ({ header }) => header,
    mapValues: ({ value }) => value,
    newline: '\n',
    quote: '"',
    raw: false,
    separator: ',',
    skipComments: false,
    // eslint-disable-next-line unicorn/no-null -- Preserve the public default options value.
    skipLines: null,
    maxRowBytes: Number.MAX_SAFE_INTEGER,
    strict: false,
    outputByteOffset: false,
};

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Reject unsafe or non-string mapped headers.
 * @param {unknown} header - Mapped header value.
 * @returns {string|null} Safe header or the column-skipping sentinel.
 */
function sanitizeHeader(header) {
    // eslint-disable-next-line unicorn/no-null -- Null is the established mapHeaders column-skipping sentinel.
    return typeof header !== 'string' || DANGEROUS_KEYS.has(header) ? null : header;
}

/**
 * Find duplicate retained row-property keys before parsing data.
 * @param {Array} headers - Explicit or mapped headers.
 * @returns {Error|undefined} Duplicate-header error, if any.
 */
function duplicateHeaderError(headers) {
    const seen = new Set();
    for (const header of headers) {
        if (header === null || header === undefined) continue;
        const key = String(header);
        if (seen.has(key)) return new Error(`Duplicate header: ${key}`);
        seen.add(key);
    }
}

class CsvParser extends Transform {
    constructor(options_ = {}) {
        super({ objectMode: true, highWaterMark: 16 });

        if (Array.isArray(options_)) options_ = { headers: options_ };

        const options = Object.assign({}, defaults, options_);

        if (Array.isArray(options.headers)) {
            const error = duplicateHeaderError(options.headers);
            if (error) throw error;
        }

        options.customNewline = options.newline !== defaults.newline;

        for (const key of ['newline', 'quote', 'separator']) {
            if (options[key] !== undefined) {
                options[key] = Buffer.from(options[key])[0];
            }
        }

        // if escape is not defined on the passed options, use the end value of quote
        options.escape = (options_ || {}).escape ? Buffer.from(options.escape)[0] : options.quote;

        this.state = {
            empty: options.raw ? Buffer.alloc(0) : '',
            escaped: false,
            first: true,
            lineNumber: 0,
            previousEnd: 0,
            rowLength: 0,
            quoted: false,
            fieldStart: true,
            malformedQuoted: false,
            pendingQuote: false,
            pendingCr: false,
        };

        // eslint-disable-next-line unicorn/no-null -- Preserve the inherited stream's observable buffer sentinel.
        this._prev = null;

        if (options.headers === false) {
            // enforce, as the column length check will fail if headers:false
            options.strict = false;
        }

        if (options.headers || options.headers === false) {
            this.state.first = false;
        }

        this.options = options;
        this.headers = options.headers;
        this.bytesRead = 0;
    }

    parseCell(buffer, start, end) {
        const { escape, quote } = this.options;
        // Unquoted cells retain literal quote and escape bytes verbatim.
        if (buffer[start] !== quote) return this.parseValue(buffer, start, end);

        // remove quotes from quoted cells
        if (buffer[end - 1] === quote) {
            start++;
            end--;
        }

        let y = start;

        for (let index = start; index < end; index++) {
            // check for escape characters and skip them
            if (buffer[index] === escape && index + 1 < end && buffer[index + 1] === quote) {
                index++;
            }

            if (y !== index) {
                buffer[y] = buffer[index];
            }
            y++;
        }

        return this.parseValue(buffer, start, y);
    }

    parseLine(buffer, start, end) {
        const {
            customNewline,
            escape,
            mapHeaders,
            mapValues,
            quote,
            separator,
            skipComments,
            skipLines,
        } = this.options;

        end--; // trim newline
        if (!customNewline && buffer.length > 0 && buffer[end - 1] === cr) {
            end--;
        }

        const comma = separator;
        const cells = [];
        let isQuoted = false;
        let offset = start;

        if (skipComments) {
            const char = typeof skipComments === 'string' ? skipComments : '#';
            if (buffer[start] === Buffer.from(char)[0]) {
                return;
            }
        }

        const mapValue = (value) => {
            if (this.state.first) {
                return value;
            }

            const index = cells.length;
            const header = this.headers[index];

            return mapValues({ header, index, value });
        };

        for (let index = start; index < end; index++) {
            const isStartingQuote = !isQuoted && index === offset && buffer[index] === quote;
            const isEndingQuote =
                isQuoted &&
                buffer[index] === quote &&
                index + 1 <= end &&
                buffer[index + 1] === comma;
            if (isStartingQuote || isEndingQuote) {
                isQuoted = !isQuoted;
                continue;
            }
            const isEscape =
                isQuoted &&
                buffer[index] === escape &&
                index + 1 < end &&
                buffer[index + 1] === quote;
            if (isEscape) {
                index++;
                continue;
            }

            if (isQuoted || buffer[index] !== comma) continue;
            let value = this.parseCell(buffer, offset, index);
            value = mapValue(value);
            cells.push(value);
            offset = index + 1;
        }

        if (offset < end) {
            let value = this.parseCell(buffer, offset, end);
            value = mapValue(value);
            cells.push(value);
        }

        if (buffer[end - 1] === comma) {
            cells.push(mapValue(this.state.empty));
        }

        const skip = skipLines && skipLines > this.state.lineNumber;
        this.state.lineNumber++;

        if (!skip && this.state.first) {
            this.state.first = false;
            this.headers = cells.map((header, index) => {
                const mapped = mapHeaders({
                    header: this.options.raw ? header.toString('utf8') : header,
                    index,
                });

                return sanitizeHeader(mapped);
            });

            const error = duplicateHeaderError(this.headers);
            if (error) return error;

            this.emit('headers', this.headers);
            return;
        }

        if (!skip && this.options.strict && cells.length !== this.headers.length) {
            const error = new RangeError('Row length does not match headers');
            this.emit('error', error);
        } else {
            if (!skip) {
                const byteOffset = this.bytesRead - buffer.length + start;
                this.writeRow(cells, byteOffset);
            }
        }
    }

    parseValue(buffer, start, end) {
        return this.options.raw ? buffer.slice(start, end) : buffer.toString('utf8', start, end);
    }

    writeRow(cells, byteOffset) {
        const headers = this.headers === false ? cells.map((value, index) => index) : this.headers;

        const row = {};
        for (const [index, cell] of cells.entries()) {
            const header = headers[index];
            if (header === null) continue; // skip columns
            if (header === undefined) {
                row[`_${index}`] = cell;
            } else {
                row[header] = cell;
            }
        }

        this.push(this.options.outputByteOffset ? { row, byteOffset } : row);
    }

    // eslint-disable-next-line unicorn/prefer-private-class-fields -- Node Transform invokes this public stream override by name.
    _flush(callback) {
        // A pending custom escape at EOF is literal data, not a reason to discard the row.
        if (!this._prev) return callback();
        const error = this.parseLine(this._prev, this.state.previousEnd, this._prev.length + 1); // plus since online -1s
        callback(error);
    }

    // eslint-disable-next-line unicorn/prefer-private-class-fields -- Node Transform invokes this public stream override by name.
    _transform(data, enc, callback) {
        if (typeof data === 'string') {
            data = Buffer.from(data);
        }

        const { escape, quote } = this.options;
        let start = 0;
        let buffer = data;
        this.bytesRead += data.byteLength;

        if (this._prev) {
            start = this._prev.length;
            if (this.state.pendingCr) {
                // Revisit only the undecided CR; its byte was already counted.
                start--;
                this.state.rowLength--;
                this.state.pendingCr = false;
            }
            buffer = Buffer.concat([this._prev, data]);
            // eslint-disable-next-line unicorn/no-null -- Preserve the inherited stream's observable buffer sentinel.
            this._prev = null;
        }

        const bufferLength = buffer.length;

        for (let index = start; index < bufferLength; index++) {
            const chr = buffer[index];
            // eslint-disable-next-line unicorn/no-null -- Keep the inherited EOF lookahead sentinel for custom option comparisons.
            const nextChr = index + 1 < bufferLength ? buffer[index + 1] : null;

            this.state.rowLength++;
            if (this.state.rowLength > this.options.maxRowBytes) {
                return callback(new Error('Row exceeds the maximum size'));
            }

            // Resolve a possible doubled quote using the next byte, even across chunks.
            if (this.state.pendingQuote) {
                this.state.pendingQuote = false;
                if (chr === quote && escape === quote) continue;
                this.state.quoted = false;
                if (chr !== cr && chr !== this.options.separator && chr !== this.options.newline) {
                    this.state.malformedQuoted = true;
                }
            }
            if (this.state.escaped) {
                this.state.escaped = false;
                if (chr === quote) continue;
            }

            if (this.state.quoted) {
                if (chr === quote) {
                    this.state.pendingQuote = true;
                } else if (chr === escape) {
                    this.state.escaped = true;
                }
                continue;
            }

            // Only field starts introduce quoting; retain inherited transitions after
            // malformed trailing data in an originally quoted field until row end.
            if (chr === quote && (this.state.fieldStart || this.state.malformedQuoted)) {
                this.state.quoted = true;
                this.state.fieldStart = false;
                continue;
            }
            this.state.fieldStart = chr === this.options.separator;

            if (this.state.first && !this.options.customNewline) {
                if (chr === nl) {
                    this.options.newline = nl;
                } else if (chr === cr) {
                    if (index + 1 === bufferLength) {
                        // Header CR needs one more byte to distinguish CRLF from CR.
                        this.state.pendingCr = true;
                        break;
                    }
                    if (nextChr !== nl) this.options.newline = cr;
                }
            }

            if (chr !== this.options.newline) {
                continue;
            }

            const error = this.parseLine(buffer, this.state.previousEnd, index + 1);
            if (error) return callback(error);
            this.state.previousEnd = index + 1;
            this.state.rowLength = 0;
            this.state.fieldStart = true;
            this.state.malformedQuoted = false;
        }

        if (this.state.previousEnd === bufferLength) {
            this.state.previousEnd = 0;
            return callback();
        }

        if (bufferLength - this.state.previousEnd < data.length) {
            this._prev = data;
            this.state.previousEnd -= bufferLength - data.length;
            return callback();
        }

        this._prev = buffer;
        callback();
    }
}

/**
 * Create an independent streaming CSV parser.
 * @param {object|string[]} [options] - Parser options or explicit headers.
 * @returns {Transform} Object-mode parser stream.
 */
export default function csvParser(options) {
    return new CsvParser(options);
}
