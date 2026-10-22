import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

const publishWorkflow = readFileSync(
    new URL('../.github/workflows/npm-publish.yml', import.meta.url),
    'utf8',
);
const publishSource = publishWorkflow
    .split('            - name: Publish exact version or skip if already published\n', 2)[1]
    .split("                  node <<'NODE'\n", 2)[1]
    .split('\n                  NODE', 1)[0];

/**
 * Execute the workflow's actual publishing block with no network or subprocess access.
 * @param {string} version - Manifest version under test.
 * @param {object[]} responses - Ordered mock npm subprocess results.
 * @returns {object} Observed npm calls and any workflow error.
 */
function simulatePublish(version, responses) {
    const calls = [];
    const exited = new Error('Workflow exited successfully');
    let error;
    try {
        runInNewContext(publishSource, {
            require: (specifier) => {
                if (specifier === 'node:assert/strict') return assert;
                if (specifier === './package.json') {
                    return { name: '@joern.berkefeld/csv-parser', version };
                }
                assert.equal(specifier, 'node:child_process');
                return {
                    spawnSync: (command, arguments_) => {
                        assert.equal(command, 'npm');
                        calls.push(arguments_);
                        assert.ok(responses.length > 0, 'Unexpected npm invocation');
                        return { stdout: '', stderr: '', ...responses.shift() };
                    },
                };
            },
            console: { log: () => {} },
            process: {
                stdout: { write: () => {} },
                stderr: { write: () => {} },
                exit: (code) => {
                    assert.equal(code, 0);
                    throw exited;
                },
            },
        });
    } catch (error_) {
        if (error_ !== exited) error = error_;
    }
    assert.equal(responses.length, 0, 'Expected npm invocation was not made');
    return { calls, error };
}

const missingVersion = () => ({
    status: 1,
    stdout: JSON.stringify({ error: { code: 'E404' } }),
});
const visibleVersion = (version) => ({ status: 0, stdout: JSON.stringify(version) });

test('npm publish normalization retains the CLI without metadata autocorrections', async () => {
    assert.ok(process.env.npm_execpath, 'Run tooling tests through npm test');
    const npmRequire = createRequire(process.env.npm_execpath);
    const PackageJson = npmRequire('@npmcli/package-json');
    const root = new URL('../', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const changes = [];
    const package_ = await PackageJson.fix(fileURLToPath(root), { changes });
    assert.deepEqual(changes, []);
    await package_.prepare();
    assert.equal(package_.content.name, '@joern.berkefeld/csv-parser');
    assert.deepEqual(package_.content.bin, { 'csv-parser': 'bin/csv-parser' });
    assert.deepEqual(package_.content.repository, {
        type: 'git',
        url: 'git+https://github.com/JoernBerkefeld/csv-parser.git',
    });
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    assert.equal(lock.name, package_.content.name);
    assert.equal(lock.packages[''].name, package_.content.name);
    assert.deepEqual(lock.packages[''].bin, package_.content.bin);
});

test('CI and release verification cover exact supported Node boundaries', () => {
    const codeWorkflow = readFileSync(
        new URL('../.github/workflows/code-test.yml', import.meta.url),
        'utf8',
    );
    for (const workflow of [codeWorkflow, publishWorkflow]) {
        assert.match(workflow, /^\s+node: \['22\.22\.2', '24\.15\.0'\]$/m);
        assert.match(workflow, /fail-fast: false/);
        assert.match(workflow, /npm ci --no-workspaces/);
        assert.match(workflow, /npm run lint --no-workspaces/);
        assert.match(workflow, /npm test --no-workspaces/);
        assert.doesNotMatch(workflow, /Node 10|node: \[22, 24\]/);
    }
    assert.match(publishWorkflow, /needs: test/);
    assert.match(publishWorkflow, /node-version: '24\.15\.0'/);
    assert.match(publishWorkflow, /npm install --global npm@11\.5\.1/);
    assert.match(publishWorkflow, /id-token: write/);
    assert.doesNotMatch(publishWorkflow, /secrets\.|NODE_AUTH_TOKEN/);
});

test('hosted bootstrap skips visible 4.0.0 but never publishes a missing 4.0.0', () => {
    const existing = simulatePublish('4.0.0', [visibleVersion('4.0.0')]);
    assert.equal(existing.error, undefined);
    assert.equal(existing.calls.length, 1);
    const missing = simulatePublish('4.0.0', [missingVersion()]);
    assert.match(missing.error.message, /4\.0\.0.*manually by the user/);
    assert.equal(missing.calls.length, 1);
});

test('registry lookup fails closed for authentication, network and invalid responses', () => {
    for (const response of [
        { status: 1, stdout: JSON.stringify({ error: { code: 'E401' } }) },
        { status: 1, stderr: JSON.stringify({ error: { code: 'E403' } }) },
        { status: 1, stdout: JSON.stringify({ error: { code: 'ENOTFOUND' } }) },
        { status: 1, stderr: 'E404 in non-JSON diagnostics' },
        { status: 0, stdout: 'not JSON' },
        visibleVersion('4.0.2'),
        { signal: 'SIGTERM' },
        { error: new Error('spawn failed') },
    ]) {
        const result = simulatePublish('4.0.1', [response]);
        assert.ok(result.error);
        assert.equal(result.calls.length, 1);
    }
});

test('later missing versions publish publicly with provenance and an explicit registry', () => {
    const result = simulatePublish('4.0.1', [missingVersion(), { status: 0 }]);
    assert.equal(result.error, undefined);
    assert.deepEqual(
        result.calls.map((arguments_) => [...arguments_]),
        [
            [
                'view',
                '@joern.berkefeld/csv-parser@4.0.1',
                'version',
                '--json',
                '--registry=https://registry.npmjs.org/',
                '--prefer-online',
            ],
            [
                'publish',
                '--json',
                '--no-workspaces',
                '--access',
                'public',
                '--provenance',
                '--registry=https://registry.npmjs.org/',
            ],
        ],
    );
});

test('publish conflicts skip only after the exact version is confirmed', () => {
    for (const error of [
        { code: 'EPUBLISHCONFLICT' },
        { code: 'E403', summary: 'Cannot publish over the previously published versions' },
    ]) {
        const conflict = { status: 1, stderr: JSON.stringify({ error }) };
        const confirmed = simulatePublish('4.0.1', [
            missingVersion(),
            conflict,
            visibleVersion('4.0.1'),
        ]);
        assert.equal(confirmed.error, undefined);
        assert.equal(confirmed.calls.length, 3);
        const absent = simulatePublish('4.0.1', [missingVersion(), conflict, missingVersion()]);
        assert.match(absent.error.message, /no verified existing-version conflict/);
        const failed = simulatePublish('4.0.1', [
            missingVersion(),
            conflict,
            {
                status: 1,
                stdout: JSON.stringify({ error: { code: 'E401' } }),
            },
        ]);
        assert.match(failed.error.message, /registry lookup failed/);
    }
    for (const code of ['E403', 'E401', 'ENOTFOUND']) {
        const result = simulatePublish('4.0.1', [
            missingVersion(),
            {
                status: 1,
                stdout: JSON.stringify({ error: { code } }),
            },
        ]);
        assert.match(result.error.message, /no verified existing-version conflict/);
        assert.equal(result.calls.length, 2);
    }
});

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
