import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import test from 'ava';
import csv from '../index.js';

/**
 * Parse synthetic data with whole-chunk or isBytewise delivery.
 * @param {string} text - Synthetic input.
 * @param {object} options - Parser settings.
 * @param {boolean} [isBytewise] - Split all bytes.
 * @returns {Promise<Array>} Parsed rows.
 */
async function parse(text, options, isBytewise = false) {
    const bytes = Buffer.from(text);
    return Array.fromAsync(
        Readable.from(isBytewise ? Array.from(bytes, (byte) => Buffer.from([byte])) : [bytes]).pipe(
            csv(options),
        ),
    );
}

for (const separator of [',', '\t']) {
    for (const isBytewise of [false, true]) {
        test(`safe padding and physical widths ${JSON.stringify([separator, isBytewise])}`, async (t) => {
            const text = `a${separator}b${separator}${separator}\r\nx${separator}y${separator}""${separator}\r\nz${separator}q${separator}${separator}`;
            const calls = [];
            t.deepEqual(
                await parse(
                    text,
                    {
                        separator,
                        sanitizeRightPadding: true,
                        strict: true,
                        mapValues: ({ header, index, value }) => {
                            calls.push([header, index]);
                            return value;
                        },
                    },
                    isBytewise,
                ),
                [
                    { a: 'x', b: 'y' },
                    { a: 'z', b: 'q' },
                ],
            );
            t.deepEqual(calls.slice(0, 4), [
                ['a', 0],
                ['b', 1],
                ['', 2],
                ['', 3],
            ]);
            for (const suffix of [separator, `${separator}${separator}${separator}`]) {
                await t.throwsAsync(
                    parse(
                        `a${separator}${separator}\nx${suffix}`,
                        {
                            separator,
                            sanitizeRightPadding: true,
                            strict: true,
                        },
                        isBytewise,
                    ),
                    { message: 'Row length does not match headers' },
                );
            }
        });
        test(`padding rejection precedes mappings ${JSON.stringify([separator, isBytewise])}`, async (t) => {
            let calls = 0;
            await t.throwsAsync(
                parse(
                    `a${separator}\nx${separator}\ny${separator}" "`,
                    {
                        separator,
                        sanitizeRightPadding: true,
                        mapValues: () => {
                            calls++;
                            return '';
                        },
                    },
                    isBytewise,
                ),
                { message: /record 3, column 2, byte offset/ },
            );
            t.is(calls, 2);
        });
    }
}

test('header safety retains interior, named, mapped and positional columns', async (t) => {
    t.deepEqual(await parse('a,,b,\nx,,y,', { sanitizeRightPadding: true }), [
        { a: 'x', '': '', b: 'y' },
    ]);
    t.deepEqual(
        await parse('a,b\nx,kept', {
            sanitizeRightPadding: true,
            mapHeaders: ({ header }) => (header === 'b' ? '' : header),
        }),
        [{ a: 'x', '': 'kept' }],
    );
    t.deepEqual(
        await parse('a,b\nx,kept', {
            sanitizeRightPadding: true,
            // eslint-disable-next-line unicorn/no-null -- Exercise the public column-removal sentinel.
            mapHeaders: ({ header }) => (header === 'b' ? null : header),
        }),
        [{ a: 'x' }],
    );
    t.deepEqual(
        await parse('a,\nx,kept', {
            sanitizeRightPadding: true,
            mapHeaders: ({ header }) => (header === '' ? 'named' : header),
        }),
        [{ a: 'x', named: 'kept' }],
    );
    const headers = Object.freeze(['a', '', '']);
    t.deepEqual(await parse('x,,', { headers, sanitizeRightPadding: true, strict: true }), [
        { a: 'x' },
    ]);
    t.deepEqual(headers, ['a', '', '']);
    t.deepEqual(await parse('x,,', { headers: false, sanitizeRightPadding: true }), [
        { 0: 'x', 1: '', 2: '' },
    ]);
    await t.throwsAsync(parse('a,a,,\nx,y,,', { sanitizeRightPadding: true }), {
        message: 'Duplicate header: a',
    });
    await t.throwsAsync(parse('a,,\nx,,', {}), { message: 'Duplicate header: ' });
});

test('raw custom quoting and offsets survive right projection', async (t) => {
    const input = "\u{FEFF}a;;\r\n'var x = !'demo!';';;\r\n";
    t.deepEqual(
        await parse(
            input,
            {
                bom: true,
                separator: ';',
                quote: "'",
                escape: '!',
                raw: true,
                strict: true,
                strictQuotes: true,
                sanitizeRightPadding: true,
                outputByteOffset: true,
            },
            true,
        ),
        [{ byteOffset: 8, row: { a: Buffer.from("var x = 'demo';") } }],
    );
});

test('right projection keeps slow-consumer buffering bounded across long empty runs', async (t) => {
    const parser = csv({ sanitizeRightPadding: true, strict: true });
    parser.end('a,,\n' + 'value,,\n'.repeat(2000) + ',,\n'.repeat(20_000));
    let count = 0;
    let peak = 0;
    for await (const row of parser) {
        t.deepEqual(row, { a: 'value' });
        count++;
        peak = Math.max(peak, parser.readableLength);
        if (count % 100 === 0) await setImmediate();
    }
    t.is(count, 2000);
    t.true(peak <= 16);
    t.is(parser.fragments.length, 0);
    t.is(parser.pendingScan, undefined);
    await t.throwsAsync(
        parse('a,\nx,\n,,,,,', {
            sanitizeRightPadding: true,
            maxRowBytes: 4,
        }),
        { message: 'Row exceeds the maximum size' },
    );
});

test('default skipping uses source cells, not mapped values, and validates widths', async (t) => {
    for (const skipEmptyLines of [undefined, true]) {
        t.deepEqual(await parse(',,\n""\na,b\n,\n"",""\n" ",\nx,y', { skipEmptyLines }), [
            { a: ' ', b: '' },
            { a: 'x', b: 'y' },
        ]);
        t.deepEqual(await parse('a,b\nx,y\n,', { skipEmptyLines, mapValues: () => '' }), [
            { a: '', b: '' },
        ]);
        for (const line of [',,', '""']) {
            await t.throwsAsync(parse(`a,b\n${line}`, { skipEmptyLines, strict: true }), {
                message: 'Row length does not match headers',
            });
        }
    }
    for (const key of ['skipEmptyLines', 'sanitizeRightPadding']) {
        // eslint-disable-next-line unicorn/no-null -- Null is an invalid public option input under test.
        for (const value of [null, 0, 'true'])
            t.throws(() => csv({ [key]: value }), { message: `${key} must be a boolean` });
    }
});
