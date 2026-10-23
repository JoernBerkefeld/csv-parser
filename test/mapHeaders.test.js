import test from 'ava';
import { finished } from 'node:stream/promises';

import csv from '../index.js';

import { collect } from './helpers/helper.js';

test.cb('rename columns', (t) => {
    const headers = { a: 'x', b: 'y', c: 'z' };
    const mapHeaders = ({ header }) => {
        return headers[header];
    };
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines[0], 'first row');
        t.is(lines.length, 1, '1 row');
        t.end();
    };

    collect('basic', { mapHeaders }, verify);
});

const skipHeaders = ({ header }) => {
    // eslint-disable-next-line unicorn/no-null -- This regression asserts the documented null column-skipping contract.
    return ['a', 'c'].includes(header) ? null : header;
};

for (const separator of [',', '\t']) {
    test(`mapped duplicate headers fail after normalization (${JSON.stringify(separator)})`, async (t) => {
        const parser = csv({
            separator,
            mapHeaders: ({ header }) =>
                header
                    .replace(/^\u{FEFF}/u, '')
                    .trim()
                    .toLowerCase(),
        });
        const rows = [];
        parser.on('data', (row) => {
            rows.push(row);
        });
        const completion = finished(parser);
        for (const byte of Buffer.from(`\u{FEFF} Name ${separator}NAME\none${separator}two\n`)) {
            parser.write(Buffer.from([byte]));
        }
        parser.end(`three${separator}four`);
        await t.throwsAsync(completion, { message: 'Duplicate header: name' });
        t.deepEqual(rows, []);
    });

    test(`removed headers are excluded from duplicates (${JSON.stringify(separator)})`, async (t) => {
        const parser = csv({
            separator,
            mapHeaders: ({ header }) => {
                // eslint-disable-next-line unicorn/no-null -- Exercise repeated removed columns without treating them as duplicate keys.
                return header === 'drop' ? null : header.trim().toLowerCase();
            },
        });
        const rows = [];
        const observedHeaders = [];
        parser.on('headers', (headers) => {
            observedHeaders.push(headers);
        });
        const input = ['drop', ' Name ', 'drop', '__proto__', 'constructor', 'VALUE'].join(
            separator,
        );
        parser.end(`${input}\n${['x', 'Ada', 'y', 'z', 'q', ''].join(separator)}`);
        for await (const row of parser) rows.push(row);
        t.deepEqual(rows, [{ name: 'Ada', value: '' }]);
        t.is(observedHeaders.length, 1);
        t.is(observedHeaders[0].filter((header) => header === null).length, 4);
    });
}

test.cb('skip columns a and c', (t) => {
    const mapHeaders = skipHeaders;

    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines[0], 'first row');
        t.is(lines.length, 1, '1 row');
        t.end();
    };

    collect('basic', { mapHeaders }, verify);
});
