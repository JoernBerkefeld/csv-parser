import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('NodeNext compiler stays on the TypeScript line supported by lint tooling', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(manifest.devDependencies.typescript, '~5.9.3');
    assert.equal(ts.versionMajorMinor, '5.9');
});

test('checkout policy preserves byte-sensitive inherited fixtures and snapshots', () => {
    const attributes = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8');
    assert.match(attributes, /^\* text=auto eol=lf$/m);
    assert.match(attributes, /^test\/fixtures\/\*\* -text$/m);
    assert.match(attributes, /^test\/snapshots\/\*\* -text$/m);
    assert.equal(attributes.includes('\r'), false);
});
import { ESLint } from 'eslint';
import { checkLockfile } from './check-lockfile-registry-only.mjs';

test('registry guard permits registry dependencies and rejects local resolutions', () => {
    assert.deepEqual(
        checkLockfile({
            packages: {
                '': { name: 'example' },
                dep: { resolved: 'https://registry.npmjs.org/dep.tgz' },
            },
        }),
        [],
    );
    for (const resolved of [
        '../dep',
        './dep',
        'dep',
        String.raw`F:\dep`,
        'file:../dep',
        // eslint-disable-next-line unicorn/prefer-https -- The registry guard must reject insecure HTTP resolutions.
        'http://registry.npmjs.org/dep.tgz',
    ]) {
        assert.equal(checkLockfile({ packages: { dep: { resolved } } }).length, 1);
    }
    assert.equal(checkLockfile({ packages: { dep: { link: true } } }).length, 1);
    for (const spec of ['file:../dep', 'link:../dep', 'workspace:*']) {
        assert.equal(
            checkLockfile({ packages: { '': { dependencies: { dep: spec } } } }).length,
            1,
        );
    }
    assert.equal(checkLockfile({ dependencies: { dep: { version: 'file:../dep' } } }).length, 1);
});

test('coverage uses native V8 instrumentation for the ESM parser and CLI', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const coverage = readFileSync(new URL('coverage.mjs', import.meta.url), 'utf8');
    assert.match(manifest.scripts.coverage, /^node scripts\/coverage\.mjs/);
    assert.ok(manifest.devDependencies.c8);
    assert.equal(Object.hasOwn(manifest.devDependencies, 'nyc'), false);
    assert.match(coverage, /--include=index\.js/);
    assert.match(coverage, /--include=bin\/csv-parser/);
    assert.match(coverage, /mkdtempSync/);
    assert.match(coverage, /--clean=false/);
});

test('ESLint retains public stream overrides and inherited snapshot test names', async () => {
    const eslint = new ESLint();
    const config = await eslint.calculateConfigForFile('test/mapHeaders.test.js');
    assert.equal(config.rules['unicorn/filename-case'][1].cases.camelCase, true);
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /\n {4}_flush\(callback\)/);
    assert.match(source, /\n {4}_transform\(data, enc, callback\)/);
    assert.equal(source.includes('#flush'), false);
    assert.equal(source.includes('#transform'), false);
});

test('ESLint autofix preserves starred multiline JSDoc', async () => {
    const eslint = new ESLint({ fix: true });
    const config = await eslint.calculateConfigForFile('scripts/example.mjs');
    assert.equal(config.rules['unicorn/no-asterisk-prefix-in-documentation-comments'][0], 0);
    const source =
        '/**\n * Describe the sample.\n *\n * @returns {number} Sample value.\n */\nexport function sample() { return 1; }\n';
    const [result] = await eslint.lintText(source, { filePath: 'scripts/example.mjs' });
    assert.match(result.output || source, /\n \* Describe the sample\./);
    assert.match(result.output || source, /\n \* @returns/);
});
