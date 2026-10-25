import { createReadStream } from 'node:fs';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const [cr] = Buffer.from('\r');
const [nl] = Buffer.from('\n');
const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
const defaults = {
    bom: false,
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
    skipEmptyLines: false,
    // eslint-disable-next-line unicorn/no-null -- Preserve the public default options value.
    skipLines: null,
    maxRowBytes: Number.MAX_SAFE_INTEGER,
    strict: false,
    strictQuotes: false,
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
            afterQuote: false,
            comment: false,
            pendingComment: false,
        };

        // eslint-disable-next-line unicorn/no-null -- Preserve the inherited stream's observable buffer sentinel.
        this._prev = null;
        this.fragments = [];
        this.fragmentBytes = 0;
        this.recordOffset = 0;

        if (options.headers === false) {
            // enforce, as the column length check will fail if headers:false
            options.strict = false;
        }

        if (options.headers || options.headers === false) {
            this.state.first = false;
        }

        this.options = options;
        this.headers = options.headers;
        this.commentMarker = options.skipComments
            ? Buffer.from(typeof options.skipComments === 'string' ? options.skipComments : '#')
            : Buffer.alloc(0);
        this.bytesRead = 0;
        this.bomPending = options.bom ? Buffer.alloc(0) : undefined;
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

    parseLine(buffer, start, end, byteOffset = this.recordOffset) {
        const { customNewline, escape, mapHeaders, mapValues, quote, separator, skipLines } =
            this.options;

        end--; // trim newline
        if (!customNewline && buffer.length > 0 && buffer[end - 1] === cr) {
            end--;
        }

        if (this.state.comment) return;

        // Inspect original bytes before parseCell can unescape quoted values in place.
        if (this.options.skipEmptyLines) {
            const record = buffer.subarray(start, end);
            if (
                !record.includes(separator) &&
                !record.includes(quote) &&
                /^[^\S\u{FEFF}]*$/u.test(record.toString('utf8'))
            ) {
                return;
            }
        }

        const skip = skipLines && skipLines > this.state.lineNumber;
        this.state.lineNumber++;
        if (skip) return;

        const comma = separator;
        const cells = [];
        let isQuoted = false;
        let offset = start;

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

        if (this.state.first) {
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

        return this.options.strict && cells.length !== this.headers.length
            ? new RangeError('Row length does not match headers')
            : this.writeRow(cells, byteOffset);
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
            const key = header === undefined ? `_${index}` : String(header);
            if (Object.hasOwn(row, key)) return new Error(`Duplicate row key: ${key}`);
            if (key === '__proto__') {
                Object.defineProperty(row, key, {
                    value: cell,
                    writable: true,
                    enumerable: true,
                    configurable: true,
                });
            } else {
                row[key] = cell;
            }
        }

        this.push(this.options.outputByteOffset ? { row, byteOffset } : row);
    }

    // eslint-disable-next-line unicorn/prefer-private-class-fields -- Node Transform invokes this public stream override by name.
    _flush(callback) {
        if (this.bomPending?.length) {
            const pending = this.bomPending;
            this.bomPending = undefined;
            return this.scan(pending, (error) => {
                if (error) return callback(error);
                this._flush(callback);
            });
        }
        if (this.state.pendingComment) {
            return this.scan(
                Buffer.alloc(0),
                (error) => {
                    if (error) return callback(error);
                    this._flush(callback);
                },
                true,
            );
        }
        if (this.state.pendingCr && this._prev) {
            this.fragments.push(this._prev);
            this.fragmentBytes += this._prev.length;
            // eslint-disable-next-line unicorn/no-null -- Preserve the inherited stream's observable buffer sentinel.
            this._prev = null;
        }
        if (this.options.strictQuotes) {
            if (this.state.quoted && !this.state.pendingQuote) {
                return callback(new Error('Unterminated quoted field'));
            }
            if (this.state.afterQuote && this.state.pendingCr && !this.state.first) {
                return callback(new Error('Invalid character after closing quote'));
            }
        }
        // A pending custom escape at EOF remains literal data in permissive mode.
        if (!this.fragmentBytes) return callback();
        const buffer =
            this.fragments.length === 1
                ? this.fragments[0]
                : Buffer.concat(this.fragments, this.fragmentBytes);
        const error = this.parseLine(buffer, 0, buffer.length + 1);
        callback(error);
    }

    // eslint-disable-next-line unicorn/prefer-private-class-fields -- Node Transform invokes this public stream override by name.
    _transform(data, enc, callback) {
        if (typeof data === 'string') {
            data = Buffer.from(data);
        }

        // Count incoming physical bytes once, including an optional stripped BOM.
        this.bytesRead += data.byteLength;
        if (this.bomPending !== undefined) {
            if (this.bomPending.length > 0) data = Buffer.concat([this.bomPending, data]);
            let index = 0;
            while (index < Math.min(data.length, utf8Bom.length) && data[index] === utf8Bom[index])
                index++;
            if (index === data.length && index < utf8Bom.length) {
                // Retain only the undecided prefix (at most two bytes).
                this.bomPending = Buffer.from(data);
                return callback();
            }
            this.bomPending = undefined;
            if (index === utf8Bom.length) {
                data = data.subarray(utf8Bom.length);
                this.recordOffset += utf8Bom.length;
            }
        }
        this.scan(data, callback);
    }

    /**
     * Scan effective CSV bytes, including a replayed incomplete BOM prefix.
     * @param {Buffer} data - Bytes not yet seen by the CSV state machine.
     * @param {(error?: Error) => void} callback - Transform completion callback.
     * @param {boolean} [isFinal] - Resolve an incomplete comment prefix at EOF.
     * @returns {void} Completes through the callback.
     */
    scan(data, callback, isFinal = false) {
        const { escape, quote } = this.options;
        let buffer = data;
        if (this._prev) {
            // Replay only enough bytes to decide the marker or CR, not the whole chunk.
            const needed = this.state.pendingComment
                ? this.commentMarker.length - this._prev.length
                : 1;
            buffer = Buffer.concat([this._prev, data.subarray(0, needed)]);
            // eslint-disable-next-line unicorn/no-null -- Preserve the inherited stream's observable buffer sentinel.
            this._prev = null;
            this.state.pendingComment = false;
            if (this.state.pendingCr) {
                this.state.rowLength--;
                this.state.pendingCr = false;
            }
            if (data.length > needed) {
                return this.scan(
                    buffer,
                    (error) => {
                        if (error) return callback(error);
                        this.scan(data.subarray(needed), callback, isFinal);
                    },
                    isFinal,
                );
            }
        }
        this.state.previousEnd = 0;
        const bufferLength = buffer.length;
        let retainedEnd = bufferLength;

        for (let index = 0; index < bufferLength; index++) {
            const chr = buffer[index];
            // eslint-disable-next-line unicorn/no-null -- Keep the inherited EOF lookahead sentinel for custom option comparisons.
            const nextChr = index + 1 < bufferLength ? buffer[index + 1] : null;

            // Decide the complete record-start marker before interpreting any CSV quotes.
            if (
                index === this.state.previousEnd &&
                this.fragmentBytes === 0 &&
                this.commentMarker.length > 0
            ) {
                const available = Math.min(this.commentMarker.length, bufferLength - index);
                const matches = buffer
                    .subarray(index, index + available)
                    .equals(this.commentMarker.subarray(0, available));
                if (!isFinal && matches && available < this.commentMarker.length) {
                    if (available > this.options.maxRowBytes) {
                        return callback(new Error('Row exceeds the maximum size'));
                    }
                    this.state.pendingComment = true;
                    retainedEnd = index;
                    this._prev = buffer.subarray(index);
                    break;
                }
                this.state.comment = matches && available === this.commentMarker.length;
            }

            this.state.rowLength++;
            if (this.state.rowLength > this.options.maxRowBytes) {
                return callback(new Error('Row exceeds the maximum size'));
            }

            if (!this.state.comment) {
                // Resolve a possible doubled quote using the next byte, even across chunks.
                if (this.state.pendingQuote) {
                    this.state.pendingQuote = false;
                    if (chr === quote && escape === quote) continue;
                    this.state.quoted = false;
                    this.state.afterQuote = this.options.strictQuotes;
                    if (![cr, this.options.separator, this.options.newline].includes(chr)) {
                        this.state.malformedQuoted = true;
                    }
                }
                if (this.state.escaped) {
                    this.state.escaped = false;
                    if (chr === quote) continue;
                }

                if (this.state.afterQuote) {
                    if (chr === cr && !this.options.customNewline && this.options.newline === nl) {
                        if (index + 1 === bufferLength) {
                            this.state.pendingCr = true;
                            retainedEnd = index;
                            this._prev = buffer.subarray(index);
                            break;
                        }
                        if (nextChr !== nl && !this.state.first) {
                            return callback(new Error('Invalid character after closing quote'));
                        }
                    } else if (chr !== this.options.separator && chr !== this.options.newline) {
                        return callback(new Error('Invalid character after closing quote'));
                    }
                    if (chr === this.options.separator) this.state.afterQuote = false;
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
            }

            if (this.state.first && !this.options.customNewline) {
                if (chr === nl) {
                    this.options.newline = nl;
                } else if (chr === cr) {
                    if (index + 1 === bufferLength) {
                        // Header CR needs one more byte to distinguish CRLF from CR.
                        this.state.pendingCr = true;
                        retainedEnd = index;
                        this._prev = buffer.subarray(index);
                        break;
                    }
                    if (nextChr !== nl) this.options.newline = cr;
                }
            }

            if (chr !== this.options.newline) {
                continue;
            }

            const end = index + 1;
            const length = end - this.state.previousEnd;
            let error;
            if (this.fragmentBytes > 0) {
                this.fragments.push(buffer.subarray(this.state.previousEnd, end));
                const record = Buffer.concat(this.fragments, this.fragmentBytes + length);
                error = this.parseLine(record, 0, record.length);
                this.fragments = [];
                this.fragmentBytes = 0;
            } else {
                error = this.parseLine(buffer, this.state.previousEnd, end);
            }
            if (error) return callback(error);
            this.recordOffset += this.state.rowLength;
            this.state.previousEnd = end;
            this.state.rowLength = 0;
            this.state.fieldStart = true;
            this.state.malformedQuoted = false;
            this.state.afterQuote = false;
            this.state.comment = false;
        }

        if (retainedEnd > this.state.previousEnd) {
            const fragment = buffer.subarray(this.state.previousEnd, retainedEnd);
            this.fragments.push(fragment);
            this.fragmentBytes += fragment.length;
        }
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

/**
 * Stream a whole file through the parser without retaining its data rows.
 * @param {unknown} filePath - Filesystem path to validate; must be a string.
 * @param {object|ReadonlyArray<string>} [optionsOrHeaders] - Factory-compatible parser settings.
 * @returns {Promise<{headers: (string|null)[]|false|null, recordCount: number}>} Effective headers and data count.
 */
export async function validateFile(filePath, optionsOrHeaders) {
    const streams = [];
    try {
        if (typeof filePath !== 'string') throw new TypeError('filePath must be a string');
        const options = Array.isArray(optionsOrHeaders)
            ? { headers: [...optionsOrHeaders] }
            : { ...optionsOrHeaders };
        if (Array.isArray(options.headers)) options.headers = [...options.headers];
        const parser = csvParser(options);
        streams.push(parser);

        // Callback exceptions must enter the pipeline, including a final row in _flush.
        for (const method of ['_transform', '_flush']) {
            const original = parser[method];
            parser[method] = (...arguments_) => {
                try {
                    original.apply(parser, arguments_);
                } catch (error) {
                    arguments_.at(-1)(
                        error instanceof Error ? error : new Error(String(error), { cause: error }),
                    );
                }
            };
        }

        let recordCount = 0;
        const sink = new Writable({
            objectMode: true,
            write(row, encoding, callback) {
                recordCount++;
                callback();
            },
        });
        streams.push(sink);
        const source = createReadStream(filePath);
        streams.push(source);
        await pipeline(source, parser, sink);
        return {
            headers: Array.isArray(parser.headers)
                ? [...parser.headers]
                : parser.headers === false
                  ? false
                  : defaults.headers,
            recordCount,
        };
    } catch (error_) {
        for (const stream of streams) stream.destroy();
        const error = new Error(
            `Unable to validate ${String(filePath)}: ${error_?.message ?? error_}`,
            {
                cause: error_,
            },
        );
        if (error_?.code !== undefined) error.code = error_.code;
        throw error;
    }
}
