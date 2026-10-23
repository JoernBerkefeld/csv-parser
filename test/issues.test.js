import test from 'ava';

import { collectAsync } from './helpers/helper.js';

test('backtick separator (#105)', async (t) => {
    const { error, lines } = await collectAsync('backtick', { separator: '`' });
    t.false(error, 'no err');
    t.snapshot(lines, 'lines');
    t.is(lines.length, 2, '2 rows');
});

test('strict + skipLines (#136)', async (t) => {
    const { error, lines } = await collectAsync('strict+skipLines', { strict: true, skipLines: 1 });
    t.false(error, 'no err');
    t.snapshot(lines, 'lines');
    t.is(lines.length, 3, '4 rows');
});
