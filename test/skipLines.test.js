import test from 'ava';

import { collectAsync } from './helpers/helper.js';
import csv from '../index.js';

for (const separator of [',', '\t']) {
    test(`skipLines preserves comments, records and inferred headers (${JSON.stringify(separator)})`, async (t) => {
        for (const headers of [undefined, ['amount', 'count'], false]) {
            for (const chunked of [false, true]) {
                const calls = [];
                const headerCalls = [];
                const parser = csv({
                    separator,
                    ...(headers !== undefined && { headers }),
                    skipLines: 2,
                    skipComments: true,
                    strict: true,
                    mapHeaders: (entry) => {
                        headerCalls.push(entry);
                        return entry.header.toLowerCase();
                    },
                    mapValues: (entry) => {
                        calls.push(entry);
                        return Number(entry.value);
                    },
                });
                const preamble = `# ignored\n"discard\nthis"${separator}text\n# ignored too\ndiscarded\n`;
                const header = headers === undefined ? `AMOUNT${separator}COUNT\n` : '';
                const input = Buffer.from(`${preamble}${header}12${separator}34`);
                if (chunked) {
                    for (const byte of input) parser.write(Buffer.from([byte]));
                    parser.end();
                } else {
                    parser.end(input);
                }
                t.deepEqual(await Array.fromAsync(parser), [
                    headers === false ? { 0: 12, 1: 34 } : { amount: 12, count: 34 },
                ]);
                t.deepEqual(calls, [
                    { header: headers === false ? undefined : 'amount', index: 0, value: '12' },
                    { header: headers === false ? undefined : 'count', index: 1, value: '34' },
                ]);
                t.deepEqual(
                    headerCalls,
                    headers === undefined
                        ? [
                              { header: 'AMOUNT', index: 0 },
                              { header: 'COUNT', index: 1 },
                          ]
                        : [],
                );
            }
        }
    });

    test(`skipLines bypasses EOF callbacks but enforces record sizes (${JSON.stringify(separator)})`, async (t) => {
        for (const headers of [undefined, ['amount'], false]) {
            for (const chunked of [false, true]) {
                const input = Buffer.from(`"discard\nthis"${separator}text`);
                const calls = [];
                const parser = csv({
                    ...(headers !== undefined && { headers }),
                    separator,
                    skipLines: 1,
                    maxRowBytes: input.length,
                    mapValues: (entry) => {
                        calls.push(entry);
                        return entry.value;
                    },
                });
                if (chunked) {
                    for (const byte of input) parser.write(Buffer.from([byte]));
                    parser.end();
                } else {
                    parser.end(input);
                }
                t.deepEqual(await Array.fromAsync(parser), []);
                t.deepEqual(calls, []);
                const oversized = csv({
                    ...(headers !== undefined && { headers }),
                    separator,
                    skipLines: 1,
                    maxRowBytes: input.length - 1,
                    mapValues: (entry) => {
                        calls.push(entry);
                        return entry.value;
                    },
                });
                const failed = t.throwsAsync(async () => Array.fromAsync(oversized), {
                    message: 'Row exceeds the maximum size',
                });
                if (chunked) {
                    for (const byte of input) oversized.write(Buffer.from([byte]));
                    oversized.end();
                } else {
                    oversized.end(input);
                }
                await failed;
                t.deepEqual(calls, []);
            }
        }
    });
}

test('skip lines', async (t) => {
    const { error, lines } = await collectAsync('bad-data', { skipLines: 2 });
    t.false(error, 'no err');
    t.is(lines.length, 1, '1 row');
    t.is(JSON.stringify(lines[0]), JSON.stringify({ yes: 'ok', yup: 'ok', yeah: 'ok!' }));
});

test('skip lines with headers', async (t) => {
    const { error, lines } = await collectAsync('bad-data', {
        headers: ['s', 'p', 'h'],
        skipLines: 2,
    });
    t.false(error, 'no err');
    t.is(lines.length, 2, '2 rows');
    t.is(JSON.stringify(lines[0]), JSON.stringify({ s: 'yes', p: 'yup', h: 'yeah' }));
    t.is(JSON.stringify(lines[1]), JSON.stringify({ s: 'ok', p: 'ok', h: 'ok!' }));
});
