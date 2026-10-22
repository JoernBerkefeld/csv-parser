import test from 'ava';

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
