import { fileURLToPath } from 'node:url';
import test from 'ava';
import { execa } from 'execa';

const binPath = fileURLToPath(new URL('../bin/csv-parser', import.meta.url));

test('CLI skipEmptyLines is opt-in and preserves quoted blanks and delimiters', async (t) => {
    const input = 'a,b\n\n \t \n"",\n,\n1,2\n';
    const skipped = await execa(process.execPath, [binPath, '--skipEmptyLines'], { input });
    t.deepEqual(
        skipped.stdout.split('\n').map((row) => JSON.parse(row)),
        [
            { a: '', b: '' },
            { a: '', b: '' },
            { a: '1', b: '2' },
        ],
    );
    const defaults = await execa(process.execPath, [binPath], { input: 'a\n\nx\n' });
    t.deepEqual(
        defaults.stdout.split('\n').map((row) => JSON.parse(row)),
        [{}, { a: 'x' }],
    );
});

test('CLI parser failures report one concise error and exit unsuccessfully', async (t) => {
    const result = await execa(process.execPath, [binPath], {
        input: 'a,a\nx,y\n',
        reject: false,
        timeout: 5000,
    });
    t.is(result.exitCode, 1);
    t.is(result.stdout, '');
    t.is(result.stderr, 'Duplicate header: a');
});

test('CLI output failures terminate without an unhandled stack', async (t) => {
    const directory = fileURLToPath(new URL('fixtures/', import.meta.url));
    const result = await execa(process.execPath, [binPath, '--output', directory], {
        input: 'a\nx\n',
        reject: false,
        timeout: 5000,
    });
    t.is(result.exitCode, 1);
    t.regex(result.stderr, /EISDIR/);
    t.notRegex(result.stderr, /Unhandled|node:events|at file:/);
});

test('CLI strict flag validates widths without consuming the filename', async (t) => {
    const filename = fileURLToPath(new URL('fixtures/basic.csv', import.meta.url));
    for (const arguments_ of [
        ['--strict', filename],
        [filename, '--strict'],
    ]) {
        const result = await execa(process.execPath, [binPath, ...arguments_]);
        t.deepEqual(JSON.parse(result.stdout), { a: '1', b: '2', c: '3' });
    }
    for (const ending of ['\n', '']) {
        const result = await execa(process.execPath, [binPath, '--strict'], {
            input: `a,b\nshort${ending}`,
            reject: false,
            timeout: 5000,
        });
        t.is(result.exitCode, 1);
        t.is(result.stdout, '');
        t.is(result.stderr, 'Row length does not match headers');
    }
    const permissive = await execa(process.execPath, [binPath], { input: 'a,b\nshort\n' });
    t.deepEqual(JSON.parse(permissive.stdout), { a: 'short' });
});

test('CLI help advertises skipEmptyLines', async (t) => {
    const result = await execa(process.execPath, [binPath, '--help'], { reject: false });
    t.regex(result.stderr, /--skipEmptyLines\s+Skip empty and whitespace-only unquoted records/);
});
