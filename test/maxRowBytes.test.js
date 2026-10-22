import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('maxRowBytes', (t) => {
    const verify = (error, lines) => {
        t.is(error.message, 'Row exceeds the maximum size', 'strict row size');
        t.is(lines.length, 4576, '4576 rows before error');
        t.end();
    };

    collect('option-maxRowBytes', { maxRowBytes: 200 }, verify);
});
