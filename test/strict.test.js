import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'ava';

import csv from '../index.js';
import { collectAsync } from './helpers/helper.js';

test('strict', async (t) => {
    const { error, lines } = await collectAsync('strict', { strict: true });
    t.is(error.name, 'RangeError', 'err name');
    t.is(error.message, 'Row length does not match headers', 'strict row length');
    t.snapshot(lines[0], 'first row');
    t.snapshot(lines[1], 'second row');
    t.is(lines.length, 2, '2 rows before error');
});

for (const separator of [',', '\t']) {
    for (const headers of [undefined, ['a', 'b']]) {
        for (const invalid of ['short', `too${separator}many${separator}cells`]) {
            test(`strict errors terminate listeners: ${JSON.stringify({ separator, headers, invalid })}`, async (t) => {
                const mapped = [];
                const parser = csv({
                    separator,
                    headers,
                    strict: true,
                    mapValues: ({ value }) => {
                        mapped.push(value);
                        return value;
                    },
                });
                const rows = [];
                const errors = [];
                parser.on('data', (row) => {
                    rows.push(row);
                });
                parser.on('error', (error) => {
                    errors.push(error);
                });
                const closed = new Promise((resolve) => parser.once('close', resolve));
                const prefix = headers ? '' : `a${separator}b\n`;
                parser.write(`${prefix}good${separator}row\n${invalid}\nlater${separator}same\n`);
                parser.write(`later${separator}chunk\n`);
                parser.end(`later${separator}final`);
                await closed;
                t.is(errors.length, 1);
                t.true(errors[0] instanceof RangeError);
                t.is(errors[0].message, 'Row length does not match headers');
                t.deepEqual(rows, [{ a: 'good', b: 'row' }]);
                t.deepEqual(mapped, ['good', 'row', ...invalid.split(separator)]);
                t.true(parser.destroyed);
            });
        }
    }
}

for (const ending of ['\n', '']) {
    test(`strict pipeline rejects once including EOF: ${JSON.stringify(ending)}`, async (t) => {
        const parser = csv({ strict: true });
        const errors = [];
        const rows = [];
        parser.on('error', (error) => {
            errors.push(error);
        });
        const error = await t.throwsAsync(
            pipeline(
                Readable.from(['a,b\ngood,row\n', `short${ending}`]),
                parser,
                new Writable({
                    objectMode: true,
                    write(row, encoding, callback) {
                        rows.push(row);
                        callback();
                    },
                }),
            ),
            { instanceOf: RangeError, message: 'Row length does not match headers' },
        );
        t.deepEqual(errors, [error]);
        t.deepEqual(rows, [{ a: 'good', b: 'row' }]);
        t.true(parser.destroyed);
    });

    test(`strict async iteration rejects once including EOF: ${JSON.stringify(ending)}`, async (t) => {
        const mapped = [];
        const parser = csv({
            strict: true,
            mapValues: ({ value }) => {
                mapped.push(value);
                return value;
            },
        });
        const errors = [];
        const rows = [];
        parser.on('error', (error) => {
            errors.push(error);
        });
        const reading = (async () => {
            for await (const row of parser) rows.push(row);
        })();
        parser.write('a,b\ngood,row\n');
        // Let the iterator observe the valid record before submitting the failure.
        await new Promise((resolve) => setImmediate(resolve));
        parser.end(`short${ending}${ending ? 'later,row\n' : ''}`);
        const error = await t.throwsAsync(reading, { instanceOf: RangeError });
        t.deepEqual(errors, [error]);
        t.deepEqual(rows, [{ a: 'good', b: 'row' }]);
        t.deepEqual(mapped, ['good', 'row', 'short']);
        t.true(parser.destroyed);
    });
}

for (const options of [{ strict: false }, { strict: true, headers: false }]) {
    test(`width mismatch stays permissive: ${JSON.stringify(options)}`, async (t) => {
        const parser = csv(options);
        const rows = [];
        parser.on('data', (row) => {
            rows.push(row);
        });
        const ended = once(parser, 'end');
        parser.end('a,b\nshort\ntoo,many,cells\nlater,row');
        await ended;
        t.deepEqual(
            rows,
            options.headers === false
                ? [
                      { 0: 'a', 1: 'b' },
                      { 0: 'short' },
                      { 0: 'too', 1: 'many', 2: 'cells' },
                      { 0: 'later', 1: 'row' },
                  ]
                : [{ a: 'short' }, { a: 'too', b: 'many', _2: 'cells' }, { a: 'later', b: 'row' }],
        );
    });
}
