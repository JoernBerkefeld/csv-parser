import { Transform, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import test from 'ava';
import execa from 'execa';

import csv from '../index.js';

const cliPath = fileURLToPath(new URL('../bin/csv-parser', import.meta.url));

test('ESM default factory returns independent Transform streams', (t) => {
    const first = csv();
    const second = csv();
    t.true(first instanceof Transform);
    t.true(second instanceof Transform);
    t.not(first, second);
    // eslint-disable-next-line unicorn/no-null -- Public defaults intentionally retain inherited null sentinels.
    t.is(first.options.headers, null);
    // eslint-disable-next-line unicorn/no-null -- Public defaults intentionally retain inherited null sentinels.
    t.is(first.options.skipLines, null);
    // eslint-disable-next-line unicorn/no-null -- Preserve the inherited buffer sentinel exposed by the stream instance.
    t.is(first._prev, null);
    t.is(typeof first._transform, 'function');
    t.is(typeof first._flush, 'function');
});

test('ESM factory preserves explicit headers and async iteration', async (t) => {
    const rows = [];
    const parser = Readable.from(['demo,\n', 'second,value\n']).pipe(csv(['label', 'value']));
    for await (const row of parser) {
        rows.push(row);
    }
    t.deepEqual(rows, [
        { label: 'demo', value: '' },
        { label: 'second', value: 'value' },
    ]);
});

test('ESM factory preserves TSV options and mappings', async (t) => {
    const rows = [];
    const parser = Readable.from(['NAME\tVALUE\n', 'sample\t"two\tparts"\n']).pipe(
        csv({
            separator: '\t',
            mapHeaders: ({ header }) => header.toLowerCase(),
            mapValues: ({ value }) => value.toUpperCase(),
        }),
    );
    for await (const row of parser) {
        rows.push(row);
    }
    t.deepEqual(rows, [{ name: 'SAMPLE', value: 'TWO\tPARTS' }]);
});

test('ESM CLI reports the scoped major version', async (t) => {
    const { stdout } = await execa(process.execPath, [cliPath, '--version']);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    t.is(stdout, manifest.version);
});

for (const separator of [',', '\t']) {
    test(`ESM CLI reads synthetic stdin with separator ${JSON.stringify(separator)}`, async (t) => {
        const { stdout } = await execa(process.execPath, [cliPath, '--separator', separator], {
            input: `label${separator}value\ndemo${separator}42\n`,
        });
        t.deepEqual(JSON.parse(stdout), { label: 'demo', value: '42' });
    });
}
