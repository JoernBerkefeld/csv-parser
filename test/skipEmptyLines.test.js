import { Readable } from 'node:stream';
import test from 'ava';
import csv from '../index.js';

/**
 * Collect fresh chunks so in-place quoted-cell decoding cannot affect later runs.
 * @param {Buffer[]} chunks - Synthetic input layout.
 * @param {object} [options] - Parser settings.
 * @returns {Promise<object>} Rows and effective headers.
 */
async function parse(chunks, options) {
    const parser = csv(options);
    const rows = await Array.fromAsync(
        Readable.from(chunks.map((chunk) => Buffer.from(chunk))).pipe(parser),
    );
    return { rows, headers: parser.headers };
}

/**
 * Exercise every two-chunk split and bytewise delivery, including UTF-8 splits.
 * @param {string} text - Synthetic record content.
 * @returns {Buffer[][]} Input layouts.
 */
function layouts(text) {
    const buffer = Buffer.from(text);
    return [
        [buffer],
        ...Array.from({ length: buffer.length + 1 }, (_, index) => [
            buffer.subarray(0, index),
            Buffer.alloc(0),
            buffer.subarray(index),
        ]),
        Array.from(buffer, (byte) => Buffer.from([byte])),
    ];
}

for (const separator of [',', '\t']) {
    for (const ending of ['\n', '\r\n', '\r', '|']) {
        test(`skipEmptyLines precedes headers/skips/maps: ${JSON.stringify([separator, ending])}`, async (t) => {
            const newline = ending === '|' ? { newline: '|' } : {};
            const text = `${ending} \u{A0}${ending}discard${ending}${ending}A${separator}B${ending} \u{2003}${ending}x${separator}y${ending} \u{3000}`;
            for (const chunks of layouts(text)) {
                const mappedHeaders = [];
                const mappedValues = [];
                const result = await parse(chunks, {
                    ...newline,
                    separator,
                    skipEmptyLines: true,
                    skipLines: 1,
                    strict: true,
                    mapHeaders: ({ header }) => {
                        mappedHeaders.push(header);
                        return header.toLowerCase();
                    },
                    mapValues: ({ value }) => {
                        mappedValues.push(value);
                        return value.toUpperCase();
                    },
                });
                t.deepEqual(result, { headers: ['a', 'b'], rows: [{ a: 'X', b: 'Y' }] });
                t.deepEqual(mappedHeaders, ['A', 'B']);
                t.deepEqual(mappedValues, ['x', 'y']);
            }
        });
    }

    test(`syntax takes precedence over whitespace: ${JSON.stringify(separator)}`, async (t) => {
        const text = `\n \u{A0}\n${separator}\n""${separator}" \t"\n"\n \n"${separator}"a""b"\n`;
        for (const chunks of layouts(text)) {
            for (const raw of [false, true]) {
                const value = (text) => (raw ? Buffer.from(text) : text);
                const result = await parse(chunks, {
                    separator,
                    headers: ['a', 'b'],
                    skipEmptyLines: true,
                    strict: true,
                    strictQuotes: true,
                    raw,
                });
                t.deepEqual(result.rows, [
                    { a: value(''), b: value('') },
                    { a: value(''), b: value(' \t') },
                    { a: value('\n \n'), b: value('a"b') },
                ]);
            }
        }
    });
}

test('default and explicit false preserve blank records and strict failures', async (t) => {
    for (const chunks of layouts('a\n\n \n')) {
        for (const options of [{}, { skipEmptyLines: false }]) {
            t.deepEqual(await parse(chunks, options), {
                headers: ['a'],
                rows: [{}, { a: ' ' }],
            });
            await t.throwsAsync(parse(chunks, { ...options, strict: true }), {
                message: 'Row length does not match headers',
            });
        }
        t.deepEqual(await parse(chunks, { skipEmptyLines: true, strict: true }), {
            headers: ['a'],
            rows: [],
        });
    }
});

test('explicit and positional headers skip blanks before skipLines and mappings', async (t) => {
    for (const headers of [['a'], false]) {
        for (const chunks of layouts('\n \nignored\n\nx\n \n')) {
            const calls = [];
            const result = await parse(chunks, {
                headers,
                skipLines: 1,
                skipEmptyLines: true,
                mapHeaders: () => {
                    t.fail('explicit headers must not be mapped');
                },
                mapValues: ({ value }) => {
                    calls.push(value);
                    return value;
                },
            });
            t.deepEqual(result.rows, [headers === false ? { 0: 'x' } : { a: 'x' }]);
            t.deepEqual(calls, ['x']);
        }
    }
});

test('BOM is data unless the one leading BOM is stripped, including raw mode', async (t) => {
    for (const [text, bom, expected] of [
        ['\u{FEFF} \n', false, ['\u{FEFF} ']],
        ['\u{FEFF} \n', true, []],
        ['\u{FEFF}\u{FEFF} \n', true, ['\u{FEFF} ']],
        [' \u{FEFF} \n', true, [' \u{FEFF} ']],
        ['\n\u{FEFF}\n', true, ['\u{FEFF}']],
    ]) {
        for (const chunks of layouts(text)) {
            for (const raw of [false, true]) {
                const result = await parse(chunks, {
                    bom,
                    raw,
                    headers: ['a'],
                    skipEmptyLines: true,
                });
                t.deepEqual(
                    result.rows,
                    expected.map((value) => ({ a: raw ? Buffer.from(value) : value })),
                );
            }
        }
    }
});

test('all JavaScript whitespace except BOM is ignored, without inventing EOF rows', async (t) => {
    const whitespace =
        '\t\v\f\r \u{A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}';
    for (const text of ['', '\n', whitespace, `${whitespace}\n`, '\n \n']) {
        for (const chunks of layouts(text)) {
            for (const headers of [undefined, ['a'], false]) {
                const result = await parse(chunks, { headers, skipEmptyLines: true });
                t.deepEqual(result.rows, []);
                if (headers === undefined) t.is(result.headers, undefined);
            }
        }
    }
    for (const chunks of layouts(" |''|' \t'|'\n '|")) {
        const result = await parse(chunks, {
            headers: ['a'],
            skipEmptyLines: true,
            newline: '|',
            quote: "'",
        });
        t.deepEqual(result.rows, [{ a: '' }, { a: ' \t' }, { a: '\n ' }]);
    }
});

test('ignored records retain physical byte offsets and comment/skip ordering', async (t) => {
    const text = '\u{FEFF}\r\n#"comment\r\n \u{2003}\r\ndiscard\r\n\r\na\r\n \r\nx\r\n\r\ny';
    const xOffset = Buffer.byteLength(text.slice(0, text.indexOf('x')));
    const yOffset = Buffer.byteLength(text.slice(0, text.indexOf('y')));
    for (const chunks of layouts(text)) {
        const result = await parse(chunks, {
            bom: true,
            skipComments: true,
            skipEmptyLines: true,
            skipLines: 1,
            outputByteOffset: true,
        });
        t.deepEqual(result.rows, [
            { row: { a: 'x' }, byteOffset: xOffset },
            { row: { a: 'y' }, byteOffset: yOffset },
        ]);
    }
});

test('maxRowBytes still rejects ignored whitespace at terminators and EOF', async (t) => {
    for (const ending of ['\n', '\r\n', '|', '']) {
        const text = ` \u{2003}${ending}`;
        for (const chunks of layouts(text)) {
            const options = {
                headers: ['a'],
                skipEmptyLines: true,
                ...(ending === '|' && { newline: '|' }),
            };
            const result = await parse(chunks, {
                ...options,
                maxRowBytes: Buffer.byteLength(text),
            });
            t.deepEqual(result.rows, []);
            await t.throwsAsync(
                parse(chunks, { ...options, maxRowBytes: Buffer.byteLength(text) - 1 }),
                { message: 'Row exceeds the maximum size' },
            );
        }
    }
});
