import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('strict: false - more columns', (t) => {
    const verify = (error, lines) => {
        const headersFirstLine = Object.keys(lines[0]);
        const headersBrokenLine = Object.keys(lines[1]);
        const headersLastLine = Object.keys(lines[2]);
        t.false(error, 'no err');
        t.deepEqual(headersFirstLine, headersLastLine);
        t.deepEqual(headersBrokenLine, ['a', 'b', 'c', '_3']);
        t.snapshot(lines[0], 'first row');
        t.snapshot(lines[1], 'broken row');
        t.snapshot(lines[2], 'last row');
        t.is(lines.length, 3, '3 rows');
        t.is(headersBrokenLine.length, 4, '4 columns');
        t.end();
    };

    collect('strict-false-more-columns', { strict: false }, verify);
});

test.cb('strict: false - less columns', (t) => {
    const verify = (error, lines) => {
        const headersFirstLine = Object.keys(lines[0]);
        const headersBrokenLine = Object.keys(lines[1]);
        const headersLastLine = Object.keys(lines[2]);
        t.false(error, 'no err');
        t.deepEqual(headersFirstLine, headersLastLine);
        t.deepEqual(headersBrokenLine, ['a', 'b']);
        t.snapshot(lines[0], 'first row');
        t.snapshot(lines[1], 'broken row');
        t.snapshot(lines[2], 'last row');
        t.is(lines.length, 3, '3 rows');
        t.is(headersBrokenLine.length, 2, '2 columns');
        t.end();
    };

    collect('strict-false-less-columns', { strict: false }, verify);
});
