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

test('CLI help advertises skipEmptyLines', async (t) => {
    const result = await execa(process.execPath, [binPath, '--help'], { reject: false });
    t.regex(result.stderr, /--skipEmptyLines\s+Skip empty and whitespace-only unquoted records/);
});
