import { Readable } from 'node:stream';
import test from 'ava';
import csv from '../index.js';

const bom = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Collect fresh synthetic chunks and expose physical accounting.
 * @param {Buffer[]} chunks - Input layout.
 * @param {object} [options] - Parser options.
 * @returns {Promise<object>} Rows, effective headers and byte count.
 */
async function parse(chunks, options) {
    const parser = csv(options);
    const rows = await Array.fromAsync(
        Readable.from(chunks.map((chunk) => Buffer.from(chunk))).pipe(parser),
    );
    return { rows, headers: parser.headers, bytesRead: parser.bytesRead };
}

/**
 * Cover every split, bytewise delivery, and empty chunks during prefix detection.
 * @param {Buffer} buffer - Synthetic bytes.
 * @returns {Buffer[][]} Independent input layouts.
 */
function layouts(buffer) {
    return [
        [buffer],
        ...Array.from({ length: Math.max(0, buffer.length - 1) }, (_, index) => [
            buffer.subarray(0, index + 1),
            Buffer.alloc(0),
            buffer.subarray(index + 1),
        ]),
        Array.from(buffer, (byte) => Buffer.from([byte])),
    ];
}

for (const separator of [',', '\t']) {
    test(`BOM precedes quoted complex headers and multiline values: ${JSON.stringify(separator)}`, async (t) => {
        const first = `first${separator}line\n"label"`;
        const text = `"first${separator}line\n""label"""${separator}tail\r\n"one${separator}two\nΔ"${separator}var label = "demo";\r\nlast${separator}`;
        const input = Buffer.concat([bom, Buffer.from(text)]);
        for (const chunks of layouts(input)) {
            const result = await parse(chunks, { bom: true, separator, strictQuotes: true });
            t.deepEqual(result.rows, [
                { [first]: `one${separator}two\nΔ`, tail: 'var label = "demo";' },
                { [first]: 'last', tail: '' },
            ]);
            t.deepEqual(result.headers, [first, 'tail']);
            t.is(result.bytesRead, input.length);
        }
    });

    test(`BOM supports custom quotes, escape, newline and mappings: ${JSON.stringify(separator)}`, async (t) => {
        const input = Buffer.from(
            `\u{FEFF}'a${separator}b'${separator}DROP|'one\\'two'${separator}x|`,
        );
        for (const chunks of layouts(input)) {
            const calls = [];
            const result = await parse(chunks, {
                bom: true,
                separator,
                quote: "'",
                escape: '\\',
                newline: '|',
                strictQuotes: true,
                mapHeaders: ({ header, index }) => {
                    calls.push([header, index]);
                    // eslint-disable-next-line unicorn/no-null -- Exercise the public column-skipping sentinel.
                    return index === 1 ? null : header.toUpperCase();
                },
                mapValues: ({ header, index, value }) => `${header}:${index}:${value}`,
            });
            t.deepEqual(calls, [
                [`a${separator}b`, 0],
                ['DROP', 1],
            ]);
            t.deepEqual(result.rows, [{ [`A${separator}B`]: `A${separator}B:0:one'two` }]);
        }
    });
}

test('BOM strips exactly one leading prefix and preserves interior data and explicit headers', async (t) => {
    const input = Buffer.from('\u{FEFF}\u{FEFF}first,mid\u{FEFF}dle\nnext,end');
    for (const chunks of layouts(input)) {
        for (const raw of [false, true]) {
            const headers = ['\u{FEFF}kept', 'other'];
            const result = await parse(chunks, { bom: true, headers, raw });
            const value = (text) => (raw ? Buffer.from(text) : text);
            t.deepEqual(result.headers, headers);
            t.deepEqual(result.rows, [
                { [headers[0]]: value('\u{FEFF}first'), other: value('mid\u{FEFF}dle') },
                { [headers[0]]: value('next'), other: value('end') },
            ]);
        }
    }
    for (const headers of [false, undefined]) {
        const result = await parse([Buffer.from('\u{FEFF}a,b\nx,y')], { bom: true, headers });
        t.deepEqual(
            result.rows,
            headers === false
                ? [
                      { 0: 'a', 1: 'b' },
                      { 0: 'x', 1: 'y' },
                  ]
                : [{ a: 'x', b: 'y' }],
        );
    }
    const truthyHeaders = await parse([Buffer.from('\u{FEFF}a,b\nx,y')], {
        bom: true,
        headers: true,
    });
    t.deepEqual(truthyHeaders.rows, [
        { _0: 'a', _1: 'b' },
        { _0: 'x', _1: 'y' },
    ]);
    const raw = await parse([Buffer.from('\u{FEFF}"a,b",c\n"x,y",z')], { bom: true, raw: true });
    t.deepEqual(raw.headers, ['a,b', 'c']);
    t.deepEqual(raw.rows, [{ 'a,b': Buffer.from('x,y'), c: Buffer.from('z') }]);
});

test('undecided BOM holds at most two bytes outside the untouched CSV state', async (t) => {
    const parser = csv({ bom: true, headers: false });
    const pending = Array.fromAsync(parser);
    for (const byte of [0xef, 0xbb]) {
        parser.write(Buffer.from([byte]));
        t.true(parser.bomPending.length <= 2);
        t.is(parser.state.rowLength, 0);
        t.is(parser.state.previousEnd, 0);
        t.falsy(parser._prev);
    }
    t.is(parser.bytesRead, 2);
    parser.end(Buffer.from([0xbf]));
    t.deepEqual(await pending, []);
    t.is(parser.bytesRead, 3);
    t.is(parser.bomPending, undefined);
});

test('BOM disabled and omitted retain the existing literal prefix behavior', async (t) => {
    const input = Buffer.from('\u{FEFF}a,b\nx,y');
    for (const chunks of layouts(input)) {
        for (const options of [{}, { bom: false }]) {
            const result = await parse(chunks, options);
            t.deepEqual(result.rows, [{ '\u{FEFF}a': 'x', b: 'y' }]);
        }
    }
});

test('non-BOM and incomplete prefixes replay exactly once including EOF', async (t) => {
    const inputs = [
        Buffer.from('a,b\nx,y'),
        Buffer.from([0xef]),
        Buffer.from([0xef, 0xbb]),
        Buffer.from([0xef, 0x61, 0x0a, 0x62]),
        Buffer.from([0xef, 0xbb, 0x61, 0x0a, 0x62]),
    ];
    for (const input of inputs) {
        for (const chunks of layouts(input)) {
            const options = { headers: false, raw: true, outputByteOffset: true };
            const baseline = await parse(chunks, options);
            t.deepEqual(await parse(chunks, { ...options, bom: true }), baseline);
        }
    }
    for (const input of [Buffer.alloc(0), bom]) {
        for (const chunks of layouts(input)) {
            for (const headers of [undefined, false, ['a']]) {
                const result = await parse(chunks, {
                    bom: true,
                    headers,
                    strictQuotes: true,
                    maxRowBytes: 0,
                });
                t.deepEqual(result.rows, []);
                t.is(result.bytesRead, input.length);
            }
        }
    }
});

test('physical offsets include stripped bytes for every header mode and later rows', async (t) => {
    for (const headers of [undefined, false, ['a', 'b']]) {
        const text = headers === undefined ? 'a,b\r\nx,y\r\nz,w' : 'x,y\r\nz,w';
        const input = Buffer.concat([bom, Buffer.from(text)]);
        for (const chunks of layouts(input)) {
            const result = await parse(chunks, { bom: true, headers, outputByteOffset: true });
            const row = (left, right) =>
                headers === false ? { 0: left, 1: right } : { a: left, b: right };
            const offset = headers === undefined ? 8 : 3;
            t.deepEqual(result.rows, [
                { row: row('x', 'y'), byteOffset: offset },
                { row: row('z', 'w'), byteOffset: offset + 5 },
            ]);
            t.is(result.bytesRead, input.length);
        }
    }
});

test('row byte limits exclude only stripped BOM bytes and still count terminators', async (t) => {
    for (const ending of ['\n', '\r\n', '']) {
        const input = Buffer.concat([bom, Buffer.from('x' + ending)]);
        const limit = 1 + ending.length;
        for (const chunks of layouts(input)) {
            const options = { bom: true, headers: ['a'], maxRowBytes: limit };
            const result = await parse(chunks, options);
            t.deepEqual(result.rows, [{ a: 'x' }]);
            await t.throwsAsync(parse(chunks, { ...options, maxRowBytes: limit - 1 }), {
                message: 'Row exceeds the maximum size',
            });
        }
    }
    await t.throwsAsync(
        parse([Buffer.from([0xef]), Buffer.from([0xbb])], {
            bom: true,
            headers: false,
            maxRowBytes: 1,
        }),
        { message: 'Row exceeds the maximum size' },
    );
    await t.throwsAsync(
        parse([Buffer.from([0xef])], {
            bom: true,
            headers: false,
            quote: '＂',
            strictQuotes: true,
        }),
        { message: 'Unterminated quoted field' },
    );
    const repeated = Buffer.concat([bom, bom, Buffer.from('x')]);
    await t.throwsAsync(
        parse([repeated], {
            bom: true,
            headers: false,
            maxRowBytes: 3,
        }),
        { message: 'Row exceeds the maximum size' },
    );
});
