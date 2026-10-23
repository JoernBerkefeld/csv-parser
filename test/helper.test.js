import test from 'ava';

import { collect, collectAsync } from './helpers/helper.js';

test('async collector retains successful fixture rows', async (t) => {
    const { error, lines } = await collectAsync('basic');
    t.false(error);
    t.deepEqual(lines, [{ a: '1', b: '2', c: '3' }]);
});

test('async collector rejects missing fixture source errors', async (t) => {
    await t.throwsAsync(collectAsync('missing-helper-input'), { code: 'ENOENT' });
});

test('callback collector returns the parser and retains partial error rows', async (t) => {
    let parser;
    await new Promise((resolve) => {
        parser = collect('strict', { strict: true }, (error, lines) => {
            t.is(error.name, 'RangeError');
            t.is(error.message, 'Row length does not match headers');
            t.deepEqual(lines, [
                { a: '1', b: '2', c: '3' },
                { a: '4', b: '5', c: '6' },
            ]);
            t.is(typeof parser.pipe, 'function');
            resolve();
        });
    });
});

test('callback collector supports omitted options', async (t) => {
    await new Promise((resolve) => {
        collect('basic', (error, lines) => {
            t.false(error);
            t.deepEqual(lines, [{ a: '1', b: '2', c: '3' }]);
            resolve();
        });
    });
});

test('callback collector reports missing fixture source errors', async (t) => {
    await new Promise((resolve) => {
        collect('missing-helper-input', (error, lines) => {
            t.is(error.code, 'ENOENT');
            t.deepEqual(lines, []);
            resolve();
        });
    });
});
