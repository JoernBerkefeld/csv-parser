import { Readable, Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import test from 'ava';

import csv from '../index.js';

for (const separator of [',', '\t']) {
    for (const mode of ['explicit', 'inferred', 'mapped']) {
        test(`overflow collision terminates listeners (${JSON.stringify(separator)}, ${mode})`, async (t) => {
            const mapped = [];
            const parser = csv({
                separator,
                headers: mode === 'explicit' ? ['_1'] : undefined,
                mapHeaders: ({ header }) => (mode === 'mapped' ? '_1' : header),
                mapValues: (entry) => {
                    mapped.push(entry);
                    return entry.value;
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
            const completion = finished(parser);
            const prefix = mode === 'explicit' ? '' : `${mode === 'mapped' ? 'source' : '_1'}\n`;
            parser.write(`${prefix}good\na${separator}b\nlater${separator}same\n`);
            parser.write(`later${separator}chunk\n`);
            parser.end(`later${separator}final`);
            const error = await t.throwsAsync(completion, { message: 'Duplicate row key: _1' });
            t.deepEqual(errors, [error]);
            t.deepEqual(rows, [{ _1: 'good' }]);
            t.deepEqual(mapped, [
                { header: '_1', index: 0, value: 'good' },
                { header: '_1', index: 0, value: 'a' },
                { header: undefined, index: 1, value: 'b' },
            ]);
            t.true(parser.destroyed);
        });
    }

    test(`overflow collisions cover fragmented raw rows and skipped headers (${JSON.stringify(separator)})`, async (t) => {
        // eslint-disable-next-line unicorn/no-null -- Include a skipped column in collision detection.
        const skipped = null;
        for (const headers of [
            ['_2', skipped],
            [undefined, '_0'],
            ['__proto__', '_2'],
        ]) {
            for (const raw of [false, true]) {
                for (const ending of ['\n', '']) {
                    const parser = csv({ headers, separator, raw, outputByteOffset: true });
                    const rows = [];
                    const errors = [];
                    parser.on('data', (row) => {
                        rows.push(row);
                    });
                    parser.on('error', (error) => {
                        errors.push(error);
                    });
                    const completion = finished(parser);
                    const input =
                        headers[0] === undefined
                            ? `a${separator}b${ending}`
                            : `a${separator}b${separator}c${ending}`;
                    for (const byte of Buffer.from(input)) parser.write(Buffer.from([byte]));
                    parser.end();
                    const error = await t.throwsAsync(completion, {
                        message: `Duplicate row key: ${headers[0] === undefined ? '_0' : '_2'}`,
                    });
                    t.deepEqual(errors, [error]);
                    t.deepEqual(rows, []);
                    t.true(parser.destroyed);
                }
            }
        }
    });

    test(`overflow validates only actual retained keys (${JSON.stringify(separator)})`, async (t) => {
        const cases = [
            { headers: ['_2', 'named'], values: ['a'], expected: { _2: 'a' } },
            { headers: ['_3'], values: ['a', 'b', 'c'], expected: { _3: 'a', _1: 'b', _2: 'c' } },
            { headers: false, values: ['a', 'b'], expected: { 0: 'a', 1: 'b' } },
            {
                headers: ['toString', 'hasOwnProperty', 'constructor', 'prototype', '__proto__'],
                values: ['a', 'b', 'c', 'd', 'e', 'f'],
                expected: {
                    toString: 'a',
                    hasOwnProperty: 'b',
                    constructor: 'c',
                    prototype: 'd',
                    ['__proto__']: 'e',
                    _5: 'f',
                },
            },
        ];
        for (const { headers, values, expected } of cases) {
            const parser = csv({ headers, separator });
            parser.end(values.join(separator));
            const rows = await Array.fromAsync(parser);
            t.deepEqual(rows, [expected]);
            t.is(Object.getPrototypeOf(rows[0]), Object.prototype);
        }
        const parser = csv({
            separator,
            mapHeaders: ({ header }) => {
                // eslint-disable-next-line unicorn/no-null -- Exercise the public skipped-header sentinel.
                return header === 'drop' ? null : header;
            },
        });
        parser.end(`drop${separator}toString\nskipped${separator}kept${separator}extra`);
        t.deepEqual(await Array.fromAsync(parser), [{ toString: 'kept', _2: 'extra' }]);
    });
}

for (const ending of ['\n', '']) {
    test(`overflow pipeline rejects once including EOF (${JSON.stringify(ending)})`, async (t) => {
        const parser = csv({ headers: ['_2', undefined] });
        const rows = [];
        const errors = [];
        parser.on('error', (error) => {
            errors.push(error);
        });
        const error = await t.throwsAsync(
            pipeline(
                Readable.from(['good,row\n', `a,b,c${ending}${ending ? 'later,row\n' : ''}`]),
                parser,
                new Writable({
                    objectMode: true,
                    write(row, encoding, callback) {
                        rows.push(row);
                        callback();
                    },
                }),
            ),
            { message: 'Duplicate row key: _2' },
        );
        t.deepEqual(errors, [error]);
        t.deepEqual(rows, [{ _2: 'good', _1: 'row' }]);
        t.true(parser.destroyed);
    });

    test(`overflow async iteration rejects once including EOF (${JSON.stringify(ending)})`, async (t) => {
        const mapped = [];
        const parser = csv({
            headers: ['_1'],
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
        parser.write('good\n');
        await new Promise((resolve) => setImmediate(resolve));
        parser.end(`a,b${ending}${ending ? 'later,row\n' : ''}`);
        const error = await t.throwsAsync(reading, { message: 'Duplicate row key: _1' });
        t.deepEqual(errors, [error]);
        t.deepEqual(rows, [{ _1: 'good' }]);
        t.deepEqual(mapped, ['good', 'a', 'b']);
        t.true(parser.destroyed);
    });
}
