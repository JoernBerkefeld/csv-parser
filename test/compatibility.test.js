import { Readable } from 'node:stream';
import test from 'ava';
import csv from '../index.js';

/**
 * Collect independently generated chunks without sharing mutable parser buffers.
 * @param {Buffer[]} chunks - Input byte chunks.
 * @param {object} [options] - Parser options.
 * @returns {Promise<object[]>} Exact parsed records.
 */
async function parse(chunks, options) {
    const stream = Readable.from(chunks.map((chunk) => Buffer.from(chunk))).pipe(csv(options));
    return Array.fromAsync(stream);
}

/**
 * Exercise whole input, every two-part split, and individual UTF-8 bytes.
 * @param {string} text - Synthetic input.
 * @returns {Buffer[][]} Chunk layouts.
 */
function layouts(text) {
    const buffer = Buffer.from(text);
    return [
        [buffer],
        ...Array.from({ length: buffer.length - 1 }, (_, index) => [
            buffer.subarray(0, index + 1),
            buffer.subarray(index + 1),
        ]),
        Array.from(buffer, (byte) => Buffer.from([byte])),
    ];
}

for (const separator of [',', '\t']) {
    const label = separator === ',' ? 'CSV' : 'TSV';
    test(`${label}: literal unquoted quotes preserve every field and record at every split`, async (t) => {
        const values = [
            'Δelta',
            'var label = "demo";',
            'plain""text',
            String.raw`tail\"value`,
            'unmatched"',
            '',
        ];
        const headers = ['id', 'co"de', 'doubled', 'slash', 'odd', 'empty'];
        const next = ['next', 'done', '', 'end', 'ok', ''];
        const text = [headers, values, next].map((row) => row.join(separator)).join('\n');
        const expected = [values, next].map((row) =>
            Object.fromEntries(headers.map((header, index) => [header, row[index]])),
        );
        for (const chunks of layouts(text)) {
            t.deepEqual(await parse(chunks, { separator }), expected);
            t.deepEqual(await parse(chunks, { separator, strictQuotes: true }), expected);
        }
    });

    test(`${label}: terminal custom escape preserves the baseline malformed quoted EOF row`, async (t) => {
        // Characterized against 09fa542: retain the opening quote and final backslash.
        const text = 'a' + separator + 'b\n"open\\';
        for (const chunks of layouts(text)) {
            t.deepEqual(await parse(chunks, { separator, escape: '\\' }), [{ a: '"open\\' }]);
        }
    });

    test(`${label}: 87-column synthetic records retain all exact values`, async (t) => {
        const headers = Array.from({ length: 87 }, (_, index) => `column${index}`);
        const values = headers.map((_, index) =>
            index === 9 ? 'var label = "demo";' : `value-${index}`,
        );
        const next = headers.map((_, index) => `next-${index}`);
        const text = [headers, values, next].map((row) => row.join(separator)).join('\n');
        const expected = [values, next].map((row) =>
            Object.fromEntries(headers.map((header, index) => [header, row[index]])),
        );
        const buffer = Buffer.from(text);
        for (const size of [buffer.length, 1, 7, 64]) {
            const chunks = [];
            for (let offset = 0; offset < buffer.length; offset += size)
                chunks.push(buffer.subarray(offset, offset + size));
            t.deepEqual(await parse(chunks, { separator, strict: true }), expected);
        }
    });

    test(`${label}: valid quoted cells, empties and custom escapes remain chunk invariant`, async (t) => {
        for (const [quote, escape] of [
            ['"', '"'],
            ["'", "'"],
            ["'", '\\'],
        ]) {
            const encode = (value) => quote + value.replaceAll(quote, () => escape + quote) + quote;
            const values = ['', `one${separator}two`, `line1\nΔ${quote}line2`, '', ''];
            const text =
                values.map((value) => encode(value)).join(separator) +
                '\n' +
                values.map((value) => encode(value)).join(separator);
            for (const chunks of layouts(text)) {
                t.deepEqual(
                    await parse(chunks, {
                        separator,
                        quote,
                        escape,
                        headers: ['a', 'b', 'c', 'd', 'e'],
                    }),
                    [
                        Object.fromEntries(
                            ['a', 'b', 'c', 'd', 'e'].map((key, index) => [key, values[index]]),
                        ),
                        Object.fromEntries(
                            ['a', 'b', 'c', 'd', 'e'].map((key, index) => [key, values[index]]),
                        ),
                    ],
                );
            }
        }
    });

    test(`${label}: literal values preserve options and original byte offsets`, async (t) => {
        const values = ['Δ"elta', 'plain""text', ''];
        const line = values.join(separator);
        const headers = ['a', 'b', 'c'];
        const row = Object.fromEntries(headers.map((key, index) => [key, values[index]]));
        const chunkLayouts = layouts(line + '\n' + line);
        for (const chunks of chunkLayouts) {
            t.deepEqual(await parse(chunks, { separator, headers }), [row, row]);
            t.deepEqual(await parse(chunks, { separator, headers: false }), [
                { 0: values[0], 1: values[1], 2: '' },
                { 0: values[0], 1: values[1], 2: '' },
            ]);
            t.deepEqual(await parse(chunks, { separator, headers, outputByteOffset: true }), [
                { row, byteOffset: 0 },
                { row, byteOffset: Buffer.byteLength(line + '\n') },
            ]);
            const raw = await parse(chunks, { separator, headers, raw: true, strict: true });
            t.deepEqual(
                raw,
                [row, row].map(() =>
                    Object.fromEntries(
                        headers.map((key, index) => [key, Buffer.from(values[index])]),
                    ),
                ),
            );
        }
        const headerLine = 'A' + separator + 'DROP' + separator + 'C\n';
        t.deepEqual(
            await parse([Buffer.from(headerLine + line)], {
                separator,
                // eslint-disable-next-line unicorn/no-null -- Null is the public column-skipping sentinel under test.
                mapHeaders: ({ header }) => (header === 'DROP' ? null : header.toLowerCase()),
                mapValues: ({ header, index, value }) => `${header}:${index}:${value}`,
            }),
            [{ a: 'a:0:Δ"elta', c: 'c:2:' }],
        );
        t.deepEqual(await parse([Buffer.from(line)], { separator, headers: ['a'] }), [
            { a: values[0], _1: values[1], _2: '' },
        ]);
        t.deepEqual(
            await parse([Buffer.from(line)], { separator, headers: [...headers, 'missing'] }),
            [row],
        );
        await t.throwsAsync(
            parse([Buffer.from(line)], { separator, headers: ['a'], strict: true }),
            { message: 'Row length does not match headers' },
        );
        await t.throwsAsync(parse([Buffer.from(line)], { separator, headers, maxRowBytes: 3 }), {
            message: 'Row exceeds the maximum size',
        });
        t.deepEqual(
            await parse([Buffer.from('ignored\n#comment\n' + headerLine + line)], {
                separator,
                skipLines: 1,
                skipComments: true,
            }),
            [{ A: values[0], DROP: values[1], C: '' }],
        );
        // Literal quotes and inferred CRLF must compose at every byte boundary.
        const crlfInput = headerLine.replace('\n', '\r\n') + line + '\r\n';
        for (const chunks of layouts(crlfInput)) {
            t.deepEqual(await parse(chunks, { separator }), [
                { A: values[0], DROP: values[1], C: '' },
            ]);
        }
    });
}

test('malformed field-start quote and trailing-data behavior remains characterized', async (t) => {
    const cases = [
        ['a,b\n"open,x', [{ a: '"open,x' }]],
        ['a,b\n"a"tail,b\nnext,end', [{ a: '"a"tail,b' }, { a: 'next', b: 'end' }]],
        ['a,b\n"a""\n', [{ a: '"a"\n' }]],
        ['a,b\n"a\\', [{ a: '"a\\' }]],
    ];
    for (const [text, expected] of cases) {
        t.deepEqual(await parse([Buffer.from(text)]), expected);
        t.deepEqual(await parse([Buffer.from(text)], { strictQuotes: false }), expected);
    }
});
