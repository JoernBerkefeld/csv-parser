import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const temporaryDirectories = {
    TEMP: process.env.TEMP,
    NODE: os.tmpdir(),
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
};
for (const [name, value] of Object.entries(temporaryDirectories)) {
    if (!value && (name === 'TMP' || name === 'TMPDIR')) continue;
    if (
        !value ||
        !path.isAbsolute(value) ||
        path
            .resolve(value)
            .replace(/[\\/]+$/, '')
            .toLowerCase() !== String.raw`f:\temp`
    ) {
        throw new Error(`Unsafe temporary directory: ${name}=${value}`);
    }
}

// Fresh V8 inputs per run; no recursive cleanup of pre-existing directories.
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'csv-parser-coverage-'));
const result = spawnSync(
    process.execPath,
    [
        'node_modules/c8/bin/c8.js',
        '--clean=false',
        `--temp-directory=${temporaryDirectory}`,
        '--all',
        '--extension=.js',
        '--extension=csv-parser',
        '--include=index.js',
        '--include=bin/csv-parser',
        '--reporter=text',
        '--reporter=lcov',
        process.execPath,
        'node_modules/ava/entrypoints/cli.js',
    ],
    { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
