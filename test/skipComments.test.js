import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('comment', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines);
        t.is(lines.length, 1, '1 row');
        t.end();
    };

    collect('comment', { skipComments: true }, verify);
});

test.cb('custom comment', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines);
        t.is(lines.length, 1, '1 row');
        t.end();
    };

    collect('option-comment', { skipComments: '~' }, verify);
});
