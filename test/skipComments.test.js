import { Readable } from 'node:stream';
import test from 'ava';
import csv from '../index.js';

import { collectAsync } from './helpers/helper.js';

/**
 * Parse fresh synthetic buffers at every split and one byte at a time.
 * @param {string} text - Synthetic input.
 * @returns {Buffer[][]} Chunk layouts.
 */
function layouts(text) {
    const input = Buffer.from(text);
    return [
        [input],
        ...Array.from({ length: input.length - 1 }, (_, index) => [
            input.subarray(0, index + 1),
            Buffer.alloc(0),
            input.subarray(index + 1),
        ]),
        Array.from(input, (byte) => Buffer.from([byte])),
    ];
}

/**
 * Collect small synthetic parser output.
 * @param {Buffer[]} chunks - Input chunks.
 * @param {object} options - Parser settings.
 * @returns {Promise<object[]>} Exact emitted rows.
 */
async function parse(chunks, options) {
    return Array.fromAsync(
        Readable.from(chunks.map((chunk) => Buffer.from(chunk))).pipe(csv(options)),
    );
}

for (const ending of ['\n', '\r', '\r\n', '|']) {
    for (const marker of ['#', '//', '💬', '"!']) {
        test(`comments ignore quotes before CSV scanning: ${JSON.stringify({ ending, marker })}`, async (t) => {
            const text = `${marker},"unterminated${ending}h${ending}v${ending}${marker}"tail`;
            for (const chunks of layouts(text)) {
                t.deepEqual(
                    await parse(chunks, {
                        skipComments: marker === '#' ? true : marker,
                        strictQuotes: true,
                        ...(ending === '|' && { newline: ending }),
                    }),
                    [{ h: 'v' }],
                );
            }
        });
    }
}

for (const separator of [',', '\t']) {
    test(`full markers preserve mismatches and quoted multiline data: ${JSON.stringify(separator)}`, async (t) => {
        const text = `a${separator}b\n/x${separator}one\n/"${separator}two\n"start\n//inside"${separator}three\n//,"ignored\nlast${separator}four`;
        for (const chunks of layouts(text)) {
            t.deepEqual(await parse(chunks, { skipComments: '//', separator }), [
                { a: '/x', b: 'one' },
                { a: '/"', b: 'two' },
                { a: 'start\n//inside', b: 'three' },
                { a: 'last', b: 'four' },
            ]);
        }
    });
}

test('incomplete marker at EOF is ordinary CSV, including quote validation', async (t) => {
    for (const text of ['/', '💬', '"']) {
        const marker = text === '/' ? '//' : text === '💬' ? '💬!' : '"!';
        for (const chunks of layouts(text)) {
            t.deepEqual(await parse(chunks, { headers: ['h'], skipComments: marker }), [
                { h: text === '"' ? '' : text },
            ]);
            if (text === '"') {
                await t.throwsAsync(
                    parse(chunks, { headers: ['h'], skipComments: marker, strictQuotes: true }),
                    {
                        message: 'Unterminated quoted field',
                    },
                );
            }
        }
    }
});

test('comments preserve BOM offsets, skipLines and mapping boundaries', async (t) => {
    const prefix = '\u{FEFF}//,"ignored\r\npreamble\r\n//note\r\n';
    for (const headers of [undefined, ['h'], false]) {
        const text = prefix + (headers === undefined ? 'h\r\n' : '') + 'v\r\n//tail';
        for (const chunks of layouts(text)) {
            const calls = [];
            const options = {
                bom: true,
                skipComments: '//',
                skipLines: 1,
                headers,
                outputByteOffset: true,
                mapHeaders: ({ header }) => header.toUpperCase(),
                mapValues: ({ value }) => {
                    calls.push(value);
                    return value.toUpperCase();
                },
            };
            t.deepEqual(await parse(chunks, options), [
                {
                    row: { [headers === undefined ? 'H' : headers === false ? '0' : 'h']: 'V' },
                    byteOffset: Buffer.byteLength(prefix + (headers === undefined ? 'h\r\n' : '')),
                },
            ]);
            t.deepEqual(calls, ['v']);
        }
    }
});

test('maxRowBytes includes comment bytes, endings and incomplete prefixes', async (t) => {
    for (const text of ['//,"ignored\n', '//,"ignored\r\n', '//,"ignored', '💬']) {
        for (const chunks of layouts(text)) {
            const options = {
                headers: false,
                skipComments: text === '💬' ? '💬!' : '//',
                maxRowBytes: Buffer.byteLength(text),
            };
            t.deepEqual(await parse(chunks, options), text === '💬' ? [{ 0: '💬' }] : []);
            await t.throwsAsync(
                parse(chunks, { ...options, maxRowBytes: options.maxRowBytes - 1 }),
                {
                    message: 'Row exceeds the maximum size',
                },
            );
        }
    }
});

test('empty markers, whitespace prefixes and nonleading BOM remain data', async (t) => {
    for (const [text, marker, expected] of [
        ['#value\n', '', '#value'],
        [' //value\n', '//', ' //value'],
        ['\u{FEFF}//value\n', '//', '\u{FEFF}//value'],
        ['💭value\n', '💬', '💭value'],
        ['"value"\n', '"!', 'value'],
    ]) {
        for (const chunks of layouts(text)) {
            t.deepEqual(
                await parse(chunks, { skipComments: marker, headers: ['h'], strictQuotes: true }),
                [{ h: expected }],
            );
        }
    }
});

test('comment', async (t) => {
    const { error, lines } = await collectAsync('comment', { skipComments: true });
    t.false(error, 'no err');
    t.snapshot(lines);
    t.is(lines.length, 1, '1 row');
});

test('custom comment', async (t) => {
    const { error, lines } = await collectAsync('option-comment', { skipComments: '~' });
    t.false(error, 'no err');
    t.snapshot(lines);
    t.is(lines.length, 1, '1 row');
});
