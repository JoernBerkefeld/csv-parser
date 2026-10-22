import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('backtick separator (#105)', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines, 'lines');
        t.is(lines.length, 2, '2 rows');
        t.end();
    };

    collect('backtick', { separator: '`' }, verify);
});

test.cb('strict + skipLines (#136)', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines, 'lines');
        t.is(lines.length, 3, '4 rows');
        t.end();
    };

    collect('strict+skipLines', { strict: true, skipLines: 1 }, verify);
});
