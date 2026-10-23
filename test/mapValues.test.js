import test from 'ava';

import csv from '../index.js';

for (const separator of [',', '\t']) {
    for (const headers of [['amount', 'count'], false]) {
        test(`skipLines bypasses rejecting numeric mapper (${JSON.stringify(separator)}, ${JSON.stringify(headers)})`, async (t) => {
            for (const chunked of [false, true]) {
                const calls = [];
                const parser = csv({
                    headers,
                    separator,
                    skipLines: 1,
                    mapValues: (entry) => {
                        calls.push(entry);
                        if (!/^\d+$/.test(entry.value)) throw new Error('Not numeric');
                        return Number(entry.value);
                    },
                });
                const input = Buffer.from(
                    `amount${separator}count\n12${separator}34\n56${separator}78`,
                );
                try {
                    if (chunked) {
                        for (const byte of input) parser.write(Buffer.from([byte]));
                        parser.end();
                    } else {
                        parser.end(input);
                    }
                } catch (error) {
                    t.fail(`Skipped header reached mapper: ${error.message}`);
                    return;
                }
                t.deepEqual(
                    await Array.fromAsync(parser),
                    headers === false
                        ? [
                              { 0: 12, 1: 34 },
                              { 0: 56, 1: 78 },
                          ]
                        : [
                              { amount: 12, count: 34 },
                              { amount: 56, count: 78 },
                          ],
                );
                t.deepEqual(
                    calls,
                    ['12', '34', '56', '78'].map((value, index) => ({
                        header: headers === false ? undefined : headers[index % 2],
                        index: index % 2,
                        value,
                    })),
                );
            }
        });
    }
}

for (const separator of [',', '\t']) {
    test(`object-mapped explicit special headers cannot replace row prototypes (${JSON.stringify(separator)})`, async (t) => {
        const globalProperties = Object.getOwnPropertyDescriptors(Object.prototype);
        const mapped = { marker: 'synthetic mapped value' };
        for (const outputByteOffset of [false, true]) {
            const calls = [];
            const parser = csv({
                headers: ['__proto__', 'normal'],
                separator,
                outputByteOffset,
                mapValues: (entry) => {
                    calls.push(entry);
                    return entry.index === 0 ? mapped : entry.value;
                },
            });
            const input = `first${separator}kept\nsecond${separator}next`;
            for (const byte of Buffer.from(input)) parser.write(Buffer.from([byte]));
            parser.end();
            const rows = await Array.fromAsync(parser);
            t.is(rows.length, 2);
            for (const [index, result] of rows.entries()) {
                const row = outputByteOffset ? result.row : result;
                t.is(Object.getPrototypeOf(row), Object.prototype);
                t.deepEqual(Object.keys(row), ['__proto__', 'normal']);
                t.true(Object.hasOwn(row, '__proto__'));
                t.is(row.__proto__, mapped);
                t.is(row.normal, index === 0 ? 'kept' : 'next');
                t.false(Object.hasOwn(row, 'marker'));
                t.is(row.marker, undefined);
                if (outputByteOffset) {
                    t.is(
                        result.byteOffset,
                        index === 0 ? 0 : Buffer.byteLength(`first${separator}kept\n`),
                    );
                }
            }
            t.deepEqual(calls, [
                { header: '__proto__', index: 0, value: 'first' },
                { header: 'normal', index: 1, value: 'kept' },
                { header: '__proto__', index: 0, value: 'second' },
                { header: 'normal', index: 1, value: 'next' },
            ]);
        }
        const parser = csv({ headers: false, separator, mapValues: () => mapped });
        parser.end(`first${separator}second`);
        const [row] = await Array.fromAsync(parser);
        t.is(Object.getPrototypeOf(row), Object.prototype);
        t.deepEqual(row, { 0: mapped, 1: mapped });
        t.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), globalProperties);
    });
}

import { collectAsync } from './helpers/helper.js';

test('map values', async (t) => {
    const headers = [];
    const indexes = [];
    const mapValues = ({ header, index, value }) => {
        headers.push(header);
        indexes.push(index);
        return Math.trunc(Number(value));
    };

    const { error, lines } = await collectAsync('basic', { mapValues });
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.is(lines.length, 1, '1 row');
    t.snapshot(headers, 'headers');
    t.snapshot(indexes, 'indexes');
});

const mapEmptyValue = ({ value }) => {
    // eslint-disable-next-line unicorn/no-null -- Preserve the existing regression that explicitly maps empty strings to null.
    return value === '' ? null : value;
};

test('map last empty value', async (t) => {
    const mapValues = mapEmptyValue;

    const { error, lines } = await collectAsync('empty-columns', {
        mapValues,
        headers: ['date', 'name', 'location'],
    });
    t.false(error, 'no err');
    t.is(lines.length, 2, '2 rows');
    // eslint-disable-next-line unicorn/no-null -- Assert the callback's intentional null result, not undefined.
    t.is(lines[0].name, null, 'name is mapped');
    // eslint-disable-next-line unicorn/no-null -- Assert the callback's intentional null result, not undefined.
    t.is(lines[0].location, null, 'last value mapped');
});
