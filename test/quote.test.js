import { Readable } from 'node:stream';
import test from 'ava';
import csv from '../index.js';

import { collectAsync } from './helpers/helper.js';

test('custom quote character', async (t) => {
    const { error, lines } = await collectAsync('option-quote', { quote: "'" });
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.snapshot(lines[1], 'second row');
    t.is(lines.length, 2, '2 rows');
});

test('custom quote and escape character', async (t) => {
    const { error, lines } = await collectAsync('option-quote-escape', {
        quote: "'",
        escape: '\\',
    });
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.snapshot(lines[1], 'second row');
    t.snapshot(lines[2], 'third row');
    t.is(lines.length, 3, '3 rows');
});

test('quote many', async (t) => {
    const { error, lines } = await collectAsync('option-quote-many', { quote: "'" });
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.snapshot(lines[1], 'second row');
    t.snapshot(lines[2], 'third row');
    t.is(lines.length, 3, '3 rows');
});

/**
 * Parse copied chunks at a selected byte boundary.
 * @param {string} text - Synthetic input.
 * @param {object} options - Parser options.
 * @param {number} split - Byte split position, or zero for individual bytes.
 * @returns {Promise<object[]>} Parsed rows.
 */
async function parseStrict(text, options, split) {
    const input = Buffer.from(text);
    const chunks = split
        ? [input.subarray(0, split), input.subarray(split)]
        : Array.from(input, (byte) => Buffer.from([byte]));
    return Array.fromAsync(Readable.from(chunks).pipe(csv({ strictQuotes: true, ...options })));
}

for (const separator of [',', '\t']) {
    for (const [quote, escape] of [
        ['"', '"'],
        ["'", "'"],
        ["'", '\\'],
    ]) {
        test(`strict quotes: ${JSON.stringify({ separator, quote, escape })} boundaries`, async (t) => {
            const options = { separator, quote, escape, headers: ['a', 'b'] };
            for (const ending of ['\n', '\r\n', '|']) {
                const configured = ending === '|' ? { ...options, newline: '|' } : options;
                const value = `line\nΔ${quote}end`;
                const cell = quote + value.replaceAll(quote, () => escape + quote) + quote;
                for (const suffix of ['', ending]) {
                    const text = `${cell}${separator}${quote}${quote}${ending}plain${separator}${cell}${suffix}`;
                    for (let split = 0; split <= Buffer.byteLength(text); split++) {
                        t.deepEqual(await parseStrict(text, configured, split), [
                            { a: value, b: '' },
                            { a: 'plain', b: value },
                        ]);
                    }
                }
            }
            for (const tail of [
                quote + 'open',
                quote + 'open' + escape + (escape === quote ? quote : ''),
                quote + 'closed' + quote + 'x',
                quote + 'closed' + quote + '\rX',
                quote + 'closed' + quote + '\r',
            ]) {
                const text = 'ok' + separator + 'before\n' + tail;
                for (let split = 0; split <= Buffer.byteLength(text); split++) {
                    await t.throwsAsync(parseStrict(text, options, split), {
                        message: /Unterminated quoted field|Invalid character after closing quote/,
                    });
                }
            }
            await t.throwsAsync(
                parseStrict(quote + 'closed' + quote + '\r\n', { ...options, newline: '|' }, 0),
                {
                    message: 'Invalid character after closing quote',
                },
            );
        });
    }
}

test('pending doubled-quote resolution preserves allowed and invalid follower bytes', async (t) => {
    for (const separator of [',', '\t']) {
        for (const newline of ['\n', '|']) {
            const options = { headers: ['a', 'b'], separator, newline };
            t.deepEqual(await parseStrict(`"value"${separator}tail${newline}`, options, 0), [
                { a: 'value', b: 'tail' },
            ]);
            t.deepEqual(await parseStrict(`"value"${newline}`, options, 0), [{ a: 'value' }]);
            await t.throwsAsync(parseStrict(`"value"x${newline}`, options, 0), {
                message: 'Invalid character after closing quote',
            });
        }
    }
    t.deepEqual(await parseStrict('"value"\r\n', { headers: ['a'] }, 0), [{ a: 'value' }]);
});

test('strict quote failures terminate once without later rows or flush output', async (t) => {
    for (const ending of ['"bad"x\nlate\n', '"open']) {
        const parser = csv({ headers: ['a'], strictQuotes: true });
        const rows = [];
        const errors = [];
        parser.on('data', (row) => {
            rows.push(row);
        });
        parser.on('error', (error) => {
            errors.push(error);
        });
        const closed = new Promise((resolve) => parser.on('close', resolve));
        parser.write('early\n' + ending);
        parser.write('subsequent\n', () => {});
        parser.end();
        await closed;
        t.is(errors.length, 1);
        t.deepEqual(rows, [{ a: 'early' }]);
        t.true(parser.destroyed);
    }
});

test('strict quotes preserve inferred endings and skipped records at every boundary', async (t) => {
    for (const ending of ['\n', '\r\n', '\r', '|']) {
        const text = ['skip', '#comment', '"a","b"', '"Δ","last"'].join(ending) + ending;
        const options = {
            skipLines: 1,
            skipComments: true,
            ...(ending === '|' && { newline: '|' }),
        };
        for (let split = 0; split <= Buffer.byteLength(text); split++) {
            t.deepEqual(await parseStrict(text, options, split), [{ a: 'Δ', b: 'last' }]);
        }
    }
});

test('strict quote checking and column width checking are independent', async (t) => {
    t.deepEqual(await parseStrict('a,b\n"value"', {}, 0), [{ a: 'value' }]);
    t.deepEqual(await parseStrict('"value"', { headers: false, strict: true }, 0), [
        { 0: 'value' },
    ]);
    await t.throwsAsync(parseStrict('a,b\n"value"', { strict: true }, 0), {
        message: 'Row length does not match headers',
    });
    await t.throwsAsync(parseStrict('"open', { headers: false, strict: true }, 0), {
        message: 'Unterminated quoted field',
    });
});
