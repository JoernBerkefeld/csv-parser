import test from 'ava';
import csv from '../index.js';

import { collect } from './helpers/helper.js';

test.cb('simple csv with byte offset', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines[0], 'first row');
        t.is(lines.length, 1, '1 row');
        t.end();
    };

    collect('basic', { outputByteOffset: true }, verify);
});

test.cb('large dataset with byte offset', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines[0], 'first row');
        t.snapshot(lines[1], 'second row');
        t.is(lines.length, 7268, '7268 rows');
        t.end();
    };

    collect('large-dataset', { outputByteOffset: true }, verify);
});

test.cb('multibyte character set with byte offset', (t) => {
    const headers = Buffer.from('a\n');
    const cell1 = Buffer.from('this ʤ is multibyte1\n');
    const cell2 = Buffer.from('this ʤ is multibyte2\n');
    t.true(Buffer.isBuffer(cell1));
    t.deepEqual([...Buffer.from('ʤ')], [0xca, 0xa4], 'native conversion preserves UTF-8 bytes');
    const expected1 = 'this ʤ is multibyte1';
    const expected2 = 'this ʤ is multibyte2';
    const parser = csv({ outputByteOffset: true });

    parser.write(headers);
    parser.write(cell1);
    parser.write(cell2);
    parser.end();

    const lines = [];
    parser.on('data', (data) => {
        lines.push(data);
    });
    parser.on('end', () => {
        t.is(lines.length, 2, '2 rows');
        t.is(lines[0].row.a, expected1, 'multibyte character is preserved');
        t.is(lines[0].byteOffset, 2, 'byte offset is correct');
        t.is(lines[1].row.a, expected2, 'multibyte character is preserved');
        t.is(lines[1].byteOffset, 24, 'byte offset is correct');
        t.end();
    });
});
