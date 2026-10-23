import test from 'ava';

import { collectAsync } from './helpers/helper.js';

test('comment', async (t) => {
    const { error, lines } = await collectAsync('comment', { skipComments: true });
    t.false(error, 'no err');
    t.snapshot(lines);
    t.is(lines.length, 1, '1 row');
});

test('custom comment', async (t) => {
    const { error, lines } = await collectAsync('option-comment', { skipComments: '~' });
    t.false(error, 'no err');
    t.snapshot(lines);
    t.is(lines.length, 1, '1 row');
});
