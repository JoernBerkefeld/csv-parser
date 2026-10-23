import test from 'ava';

import { collectAsync } from './helpers/helper.js';

test('maxRowBytes', async (t) => {
    const { error, lines } = await collectAsync('option-maxRowBytes', { maxRowBytes: 200 });
    t.is(error.message, 'Row exceeds the maximum size', 'strict row size');
    t.is(lines.length, 4576, '4576 rows before error');
});
