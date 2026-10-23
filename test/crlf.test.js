import { Readable } from 'node:stream';
import test from 'ava';
import csv from '../index.js';

/**
 * Parse fresh byte copies at every boundary, including individual bytes.
 * @param {string} text - Synthetic records.
 * @param {object} options - Parser options.
 * @returns {Promise<object[][]>} Parsed layouts.
 */
async function variants(text, options) {
    const input = Buffer.from(text);
    const layouts = [
        [input],
        ...Array.from({ length: input.length - 1 }, (_, index) => [
            input.subarray(0, index + 1),
            input.subarray(index + 1),
        ]),
        Array.from(input, (byte) => Buffer.from([byte])),
    ];
    const results = [];
    for (const chunks of layouts) {
        const parser = csv(options);
        const headers = [];
        parser.on('headers', (value) => {
            headers.push(value);
        });
        const rows = await Array.fromAsync(
            Readable.from(chunks.map((chunk) => Buffer.from(chunk))).pipe(parser),
        );
        results.push({ rows, headers });
    }
    return results;
}

for (const separator of [',', '\t']) {
    test(`split CRLF exact Unicode values, headers and offsets: ${JSON.stringify(separator)}`, async (t) => {
        for (const newline of [undefined, '\n']) {
            const results = await variants('name\r\nΔelta\r\nend', {
                separator,
                ...(newline !== undefined && { newline }),
                outputByteOffset: true,
            });
            for (const result of results) {
                t.deepEqual(result, {
                    headers: [['name']],
                    rows: [
                        { row: { name: 'Δelta' }, byteOffset: 6 },
                        { row: { name: 'end' }, byteOffset: 14 },
                    ],
                });
            }
        }
    });

    test(`combined quotes and CRLF options at every split: ${JSON.stringify(separator)}`, async (t) => {
        for (const [quote, escape] of [
            ['"', '"'],
            ["'", '\\'],
        ]) {
            const values = ['Δ"literal', `one${separator}two\r\nline${quote}end`, ''];
            const encode = (value) => quote + value.replaceAll(quote, () => escape + quote) + quote;
            const line = [values[0], encode(values[1]), ''].join(separator);
            const header = ['a', 'b', 'c'].join(separator) + '\r\n';
            const row = { a: values[0], b: values[1], c: '' };
            for (const headers of [undefined, ['a', 'b', 'c'], false]) {
                const text = (headers === undefined ? header : '') + line + '\r\n' + line;
                for (const raw of [false, true]) {
                    const results = await variants(text, {
                        separator,
                        quote,
                        escape,
                        headers,
                        raw,
                        strict: true,
                        mapHeaders: ({ header: name }) => name.toString(),
                    });
                    for (const result of results) {
                        const expected =
                            headers === false ? { 0: values[0], 1: values[1], 2: '' } : row;
                        const converted = raw
                            ? Object.fromEntries(
                                  Object.entries(expected).map(([key, value]) => [
                                      key,
                                      Buffer.from(value),
                                  ]),
                              )
                            : expected;
                        t.deepEqual(result.rows, [converted, converted]);
                    }
                }
            }
            const mapped = await variants('skip\r\n#comment\r\n' + header + line, {
                separator,
                quote,
                escape,
                skipLines: 1,
                skipComments: true,
                mapHeaders: ({ header: name }) => name.toUpperCase(),
                mapValues: ({ value }) => '[' + value + ']',
            });
            for (const result of mapped)
                t.deepEqual(result.rows, [
                    { A: '[' + values[0] + ']', B: '[' + values[1] + ']', C: '[]' },
                ]);
            await t.throwsAsync(
                variants(header + line, { separator, quote, escape, maxRowBytes: 8 }),
                { message: 'Row exceeds the maximum size' },
            );
            await t.throwsAsync(variants(header + 'short', { separator, strict: true }), {
                message: 'Row length does not match headers',
            });
        }
    });
}

test('deferred header CR counts once for maxRowBytes and EOF', async (t) => {
    const results = await variants('name\r\nΔelta\r\nend', { maxRowBytes: 8 });
    for (const result of results) t.deepEqual(result.rows, [{ name: 'Δelta' }, { name: 'end' }]);
    await t.throwsAsync(variants('name\r\nΔelta\r\nend', { maxRowBytes: 7 }), {
        message: 'Row exceeds the maximum size',
    });
    const terminal = await variants('name\r', { maxRowBytes: 5 });
    for (const result of terminal) t.deepEqual(result.headers, [['name']]);
});

test('single-character newline and terminal CR/EOF contracts remain unchanged', async (t) => {
    for (const [text, options, rows] of [
        ['name\rΔelta\rend', {}, [{ name: 'Δelta' }, { name: 'end' }]],
        ['name\r', {}, []],
        ['name\rΔelta\r', {}, [{ name: 'Δelta' }]],
        ['name\nΔelta\nend', {}, [{ name: 'Δelta' }, { name: 'end' }]],
        ['name;Δelta;end', { newline: ';' }, [{ name: 'Δelta' }, { name: 'end' }]],
        ['name\rΔelta\rend', { newline: '\r' }, [{ name: 'Δelta' }, { name: 'end' }]],
        ['name\r\nΔelta\r\nend', { newline: '\r\n' }, [{ name: '\nΔelta' }, { name: '\nend' }]],
    ]) {
        const results = await variants(text, options);
        for (const result of results) t.deepEqual(result.rows, rows);
    }
});
