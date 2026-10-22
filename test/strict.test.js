import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('strict', (t) => {
    const verify = (error, lines) => {
        t.is(error.name, 'RangeError', 'err name');
        t.is(error.message, 'Row length does not match headers', 'strict row length');
        t.snapshot(lines[0], 'first row');
        t.snapshot(lines[1], 'second row');
        t.is(lines.length, 2, '2 rows before error');
        t.end();
    };

    collect('strict', { strict: true }, verify);
});
