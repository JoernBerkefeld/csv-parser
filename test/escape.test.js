import test from 'ava';

import { collectAsync } from './helpers/helper.js';

test('headers: false, numeric column names', async (t) => {
    const { error, lines } = await collectAsync('basic', { headers: false });
    t.false(error, 'no err');
    t.snapshot(lines, 'lines');
    t.is(lines.length, 2, '2 rows');
});
