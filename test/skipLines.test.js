import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('skip lines', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.is(lines.length, 1, '1 row');
        t.is(JSON.stringify(lines[0]), JSON.stringify({ yes: 'ok', yup: 'ok', yeah: 'ok!' }));
        t.end();
    };

    collect('bad-data', { skipLines: 2 }, verify);
});

test.cb('skip lines with headers', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.is(lines.length, 2, '2 rows');
        t.is(JSON.stringify(lines[0]), JSON.stringify({ s: 'yes', p: 'yup', h: 'yeah' }));
        t.is(JSON.stringify(lines[1]), JSON.stringify({ s: 'ok', p: 'ok', h: 'ok!' }));
        t.end();
    };

    collect('bad-data', { headers: ['s', 'p', 'h'], skipLines: 2 }, verify);
});
