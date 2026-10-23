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
