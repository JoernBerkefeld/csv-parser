import test from 'ava';
import { finished } from 'node:stream/promises';

import csv from '../index.js';

import { collect } from './helpers/helper.js';

test.cb('custom escape character', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines[0], 'first row');
        t.snapshot(lines[1], 'second row');
        t.snapshot(lines[2], 'third row');
        t.is(lines.length, 3, '3 rows');
        t.end();
    };

    collect('option-escape', { escape: '\\' }, verify);
});

test.cb('headers: false', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines);
        t.end();
    };

    collect('no-headers', { headers: false }, verify);
});

test.cb('headers option', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines);
        t.end();
    };

    collect('headers', { headers: ['a', 'b', 'c'] }, verify);
});

for (const separator of [',', '\t']) {
    test(`explicit special headers retain own values and ordinary prototypes (${JSON.stringify(separator)})`, async (t) => {
        const headers = [
            '__proto__',
            'normal',
            'constructor',
            'prototype',
            'toString',
            'hasOwnProperty',
        ];
        const values = ['Δelta', 'kept', 'ctor', 'proto', 'string', 'own'];
        const input = Buffer.from(values.join(separator));
        const globalProperties = Object.getOwnPropertyDescriptors(Object.prototype);
        for (const raw of [false, true]) {
            for (const chunks of [[input], [...input].map((byte) => Buffer.from([byte]))]) {
                for (const outputByteOffset of [false, true]) {
                    const parser = csv({ headers, separator, raw, outputByteOffset });
                    for (const chunk of chunks) parser.write(chunk);
                    parser.end();
                    const rows = await Array.fromAsync(parser);
                    t.is(rows.length, 1);
                    const row = outputByteOffset ? rows[0].row : rows[0];
                    if (outputByteOffset) t.is(rows[0].byteOffset, 0);
                    t.is(Object.getPrototypeOf(row), Object.prototype);
                    t.deepEqual(Object.keys(row), headers);
                    for (const [index, header] of headers.entries()) {
                        t.true(Object.hasOwn(row, header));
                        t.deepEqual(row[header], raw ? Buffer.from(values[index]) : values[index]);
                    }
                    t.deepEqual(Object.getOwnPropertyDescriptor(row, '__proto__'), {
                        value: raw ? Buffer.from(values[0]) : values[0],
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    });
                }
            }
        }
        const shorthand = csv(['__proto__', 'normal']);
        shorthand.end('value,kept');
        const [row] = await Array.fromAsync(shorthand);
        t.is(Object.getPrototypeOf(row), Object.prototype);
        t.true(Object.hasOwn(row, '__proto__'));
        t.is(row.__proto__, 'value');
        t.is(row.normal, 'kept');
        t.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), globalProperties);
        t.throws(() => csv(['__proto__', '__proto__']), { message: 'Duplicate header: __proto__' });
    });

    test(`inferred sanitization retains legitimate inherited names (${JSON.stringify(separator)})`, async (t) => {
        const parser = csv({ separator });
        parser.end(
            `__proto__${separator}constructor${separator}prototype${separator}toString${separator}hasOwnProperty\nunsafe${separator}unsafe${separator}unsafe${separator}text${separator}own`,
        );
        const [row] = await Array.fromAsync(parser);
        t.is(Object.getPrototypeOf(row), Object.prototype);
        t.deepEqual(row, { toString: 'text', hasOwnProperty: 'own' });
        t.false(Object.hasOwn(row, '__proto__'));
    });

    test(`raw inferred headers are strings with Buffer values (${JSON.stringify(separator)})`, async (t) => {
        const input = Buffer.from(`"naïve"${separator}empty\r\nΔelta${separator}`);
        for (const chunks of [[input], [...input].map((byte) => Buffer.from([byte]))]) {
            const parser = csv({ raw: true, separator });
            const observedHeaders = [];
            parser.on('headers', (headers) => {
                observedHeaders.push(headers);
            });
            for (const chunk of chunks) parser.write(chunk);
            parser.end();
            t.deepEqual(await Array.fromAsync(parser), [
                { naïve: Buffer.from('Δelta'), empty: Buffer.alloc(0) },
            ]);
            t.deepEqual(observedHeaders, [['naïve', 'empty']]);
        }

        const parser = csv({ raw: true, separator });
        const observedHeaders = [];
        parser.on('headers', (headers) => {
            observedHeaders.push(headers);
        });
        parser.end(`naïve${separator}empty`);
        t.deepEqual(await Array.fromAsync(parser), []);
        t.deepEqual(observedHeaders, [['naïve', 'empty']]);
    });

    test(`raw inferred duplicate headers remain terminal (${JSON.stringify(separator)})`, async (t) => {
        for (const input of [
            `name${separator}name\none${separator}two\nthree${separator}four`,
            `name${separator}name`,
            `${separator}\nleft${separator}right`,
        ]) {
            const parser = csv({ raw: true, separator });
            const rows = [];
            const errors = [];
            const headers = [];
            parser.on('data', (row) => {
                rows.push(row);
            });
            parser.on('error', (error) => {
                errors.push(error);
            });
            parser.on('headers', (value) => {
                headers.push(value);
            });
            const completion = finished(parser);
            for (const byte of Buffer.from(input)) parser.write(Buffer.from([byte]));
            parser.end();
            await t.throwsAsync(completion, { instanceOf: Error });
            t.deepEqual(rows, []);
            t.deepEqual(headers, []);
            t.is(errors.length, 1);
            t.true(parser.destroyed);
        }
    });

    test(`explicit duplicate headers fail before parsing (${JSON.stringify(separator)})`, (t) => {
        for (const headers of [
            ['name', 'name'],
            ['', ''],
        ]) {
            for (const options of [headers, { headers, separator }]) {
                const error = t.throws(() => csv(options), { instanceOf: Error });
                t.regex(error.message, /Duplicate header/);
            }
        }
    });

    test(`inferred duplicates terminate every chunk layout (${JSON.stringify(separator)})`, async (t) => {
        const input = `name${separator}name\none${separator}two\nthree${separator}four`;
        for (const chunks of [
            [input],
            [...input],
            ['name', `${separator}name\n`, `one${separator}two\n`],
        ]) {
            const parser = csv({ separator });
            const rows = [];
            const errors = [];
            const headers = [];
            parser.on('data', (row) => {
                rows.push(row);
            });
            parser.on('error', (error) => {
                errors.push(error);
            });
            parser.on('headers', (value) => {
                headers.push(value);
            });
            const completion = finished(parser);
            for (const chunk of chunks) parser.write(chunk);
            parser.write(`later${separator}write\n`);
            parser.end(`final${separator}record`);
            await t.throwsAsync(completion, { message: 'Duplicate header: name' });
            t.deepEqual(rows, []);
            t.deepEqual(headers, []);
            t.is(errors.length, 1);
            t.true(parser.destroyed);
        }
    });

    test(`duplicate headers at EOF and empty names fail (${JSON.stringify(separator)})`, async (t) => {
        for (const input of [`name${separator}name`, `${separator}\nleft${separator}right`]) {
            const parser = csv({ separator });
            const rows = [];
            parser.on('data', (row) => {
                rows.push(row);
            });
            const completion = finished(parser);
            parser.end(input);
            await t.throwsAsync(completion, { instanceOf: Error });
            t.deepEqual(rows, []);
        }
    });

    test(`headers false retains repeated values (${JSON.stringify(separator)})`, async (t) => {
        const parser = csv({ headers: false, separator });
        parser.end(`name${separator}name\nleft${separator}right`);
        const rows = await Array.fromAsync(parser);
        t.deepEqual(rows, [
            { 0: 'name', 1: 'name' },
            { 0: 'left', 1: 'right' },
        ]);
    });
}
