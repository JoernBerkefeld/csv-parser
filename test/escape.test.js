import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('headers: false, numeric column names', (t) => {
    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines, 'lines');
        t.is(lines.length, 2, '2 rows');
        t.end();
    };

    collect('basic', { headers: false }, verify);
});
