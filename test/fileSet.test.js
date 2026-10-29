import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'ava';
import { validateFiles, replayFiles, validateFile } from '../index.js';
import { validateTemporaryDirectories } from './helpers/temporary-directories.js';

const state = {};
test.before(async () => {
    validateTemporaryDirectories(process.platform, {
        TEMP: process.env.TEMP,
        NODE: os.tmpdir(),
        TMP: process.env.TMP,
        TMPDIR: process.env.TMPDIR,
    });
    state.root = await mkdtemp(path.join(os.tmpdir(), 'csv-files-'));
    await writeFile(path.join(state.root, 'owner'), randomUUID());
});

/**
 * Create isolated synthetic physical files, retained without recursive cleanup.
 * @param {string[]} texts - File contents.
 * @returns {Promise<string[]>} Ordered paths.
 */
async function files(texts) {
    return Promise.all(
        texts.map(async (text) => {
            const file = path.join(state.root, `${randomUUID()}.csv`);
            await writeFile(file, text);
            return file;
        }),
    );
}

for (const separator of [',', '\t']) {
    for (const skipEmptyLines of [undefined, true, false]) {
        test(`file-set projection, boundary and independent BOM: ${JSON.stringify(separator)} ${skipEmptyLines}`, async (t) => {
            const paths = await files([
                `\u{FEFF}A${separator}B${separator}\r\nx${separator}y${separator}\r\n${separator}${separator}\r\n`,
                `\u{FEFF}"two\nparts"${separator}"var label = ""demo"";"${separator}\n${separator}${separator}\n`,
                '\u{FEFF}\n \n',
            ]);
            const validation = await validateFiles(paths, {
                bom: true,
                separator,
                strict: true,
                strictQuotes: true,
                skipEmptyLines,
                sanitizeRightPadding: true,
                sanitizeBottom: true,
                mapHeaders: ({ header }) => header.toLowerCase(),
            });
            t.deepEqual(validation.headers, ['a', 'b']);
            t.deepEqual(validation.physicalHeaders, ['A', 'B', '']);
            t.deepEqual(validation.mappedPhysicalHeaders, ['a', 'b', '']);
            t.is(validation.retainedWidth, 2);
            t.is(validation.recordCount, skipEmptyLines === false ? 3 : 2);
            t.deepEqual(validation.finalRecord, { fileIndex: 1, recordNumber: 1 });
            t.deepEqual(validation.cleanup, {
                removedColumns: 1,
                removedRecords: skipEmptyLines === false ? 3 : 0,
                skippedRecords: skipEmptyLines === false ? 0 : 4,
            });
            const rows = await Array.fromAsync(replayFiles(validation));
            t.deepEqual(rows, [
                { a: 'x', b: 'y' },
                ...(skipEmptyLines === false ? [{ a: '', b: '' }] : []),
                { a: 'two\nparts', b: 'var label = "demo";' },
            ]);
            for (const value of [
                validation,
                validation.files,
                validation.headers,
                validation.physicalHeaders,
                validation.mappedPhysicalHeaders,
                validation.finalRecord,
                validation.cleanup,
            ])
                t.true(Object.isFrozen(value));
        });
    }
}

for (const separator of [',', '\t']) {
    for (const preamble of ['""', separator.repeat(2)]) {
        for (const skipEmptyLines of [undefined, true, false]) {
            test(`file-set strict explicit-header preamble precedes empty width: ${JSON.stringify([separator, preamble, skipEmptyLines])}`, async (t) => {
                const paths = await files([`${preamble}\np${separator}q\nx${separator}y\n`]);
                const options = {
                    separator,
                    headers: ['a', 'b'],
                    strict: true,
                    ...(skipEmptyLines !== undefined && { skipEmptyLines }),
                };
                const result = await validateFiles(paths, { ...options, skipLines: 1 });
                t.deepEqual(result.headers, ['a', 'b']);
                t.deepEqual(result.physicalHeaders, ['a', 'b']);
                t.is(result.recordCount, skipEmptyLines === false ? 2 : 1);
                t.is(result.cleanup.skippedRecords, skipEmptyLines === false ? 0 : 1);
                t.deepEqual(result.finalRecord, { fileIndex: 0, recordNumber: 3 });
                t.deepEqual(await Array.fromAsync(replayFiles(result)), [
                    ...(skipEmptyLines === false ? [{ a: 'p', b: 'q' }] : []),
                    { a: 'x', b: 'y' },
                ]);
                await t.throwsAsync(validateFiles(paths, options), {
                    message: /Row length does not match headers/,
                });
            });
        }
    }
}

test('file-set trailing strict blank error is discarded; interior error remains fatal', async (t) => {
    const options = { strict: true, skipEmptyLines: false, sanitizeBottom: true };
    const trailing = await files(['a,b\nx,y\n\n \n', '', '\n']);
    const result = await validateFiles(trailing, options);
    t.is(result.recordCount, 1);
    t.is(result.cleanup.removedRecords, 3);
    t.deepEqual(await Array.fromAsync(replayFiles(result)), [{ a: 'x', b: 'y' }]);
    await t.throwsAsync(validateFiles(await files(['a,b\nx,y\n\n', 'z,w']), options), {
        message: /Row length.*record 3/,
    });
    await t.throwsAsync(validateFile(trailing[0], { strict: true, skipEmptyLines: false }), {
        message: /Row length/,
    });
});

for (const ending of [',\n', '""\n', '"open', '"closed"x,y', ',,\n']) {
    test(`file-set does not discard malformed trailing records: ${JSON.stringify(ending)}`, async (t) => {
        const paths = await files(['a,b\nx,y\n', ending]);
        if (ending === ',\n') {
            const result = await validateFiles(paths, {
                strict: true,
                strictQuotes: true,
                skipEmptyLines: false,
                sanitizeBottom: true,
            });
            t.is(result.cleanup.removedRecords, 1);
        } else {
            await t.throwsAsync(
                validateFiles(paths, {
                    strict: true,
                    strictQuotes: true,
                    skipEmptyLines: false,
                    sanitizeBottom: true,
                }),
            );
        }
    });
}

test('file-set validates every physical EOF, including after a prior removable suffix', async (t) => {
    await t.throwsAsync(
        validateFiles(await files(['a\nx\n', '"open', 'close"\n']), {
            strictQuotes: true,
            sanitizeBottom: true,
        }),
        { message: /Unterminated/ },
    );
    await t.throwsAsync(
        validateFiles(await files(['a,\nx,\n', ',\n', 'y,hidden']), {
            sanitizeRightPadding: true,
            sanitizeBottom: true,
            mapValues: () => '',
        }),
        { message: /Nonempty right-padding.*record 1, column 2/ },
    );
});

test('file-set raw projection preserves mapping indexes and physical byte offsets', async (t) => {
    const paths = await files(['\u{FEFF}A,DROP,\r\nx,y,\r\n', '\u{FEFF}z,w,']);
    const calls = [];
    const result = await validateFiles(paths, {
        bom: true,
        raw: true,
        strict: true,
        sanitizeRightPadding: true,
        outputByteOffset: true,
        // eslint-disable-next-line unicorn/no-null -- Test the public column-skipping sentinel.
        mapHeaders: ({ header }) => (header === 'DROP' ? null : header.toLowerCase()),
        mapValues: ({ header, index, value }) => {
            calls.push([header, index, value.toString()]);
            return value;
        },
    });
    const preflightCalls = calls.splice(0);
    t.deepEqual(await Array.fromAsync(replayFiles(result)), [
        { row: { a: Buffer.from('x') }, byteOffset: 12 },
        { row: { a: Buffer.from('z') }, byteOffset: 3 },
    ]);
    t.deepEqual(calls, preflightCalls);
    t.is(result.recordCount, 2);
});

test('file-set explicit and positional headers, empty inputs and delayed schema discovery', async (t) => {
    for (const headers of [['a', 'b'], false]) {
        const result = await validateFiles(await files(['x,y\n', 'z,w']), {
            headers,
            sanitizeBottom: true,
        });
        t.is(result.recordCount, 2);
        t.deepEqual(
            await Array.fromAsync(replayFiles(result)),
            headers === false
                ? [
                      { 0: 'x', 1: 'y' },
                      { 0: 'z', 1: 'w' },
                  ]
                : [
                      { a: 'x', b: 'y' },
                      { a: 'z', b: 'w' },
                  ],
        );
    }
    const delayed = await validateFiles(await files(['\n', 'a,b\nx,y\n', 'z,w']), {
        sanitizeBottom: true,
        skipEmptyLines: false,
    });
    t.deepEqual(await Array.fromAsync(replayFiles(delayed)), [
        { a: 'x', b: 'y' },
        { a: 'z', b: 'w' },
    ]);
    for (const texts of [
        ['', '\n'],
        ['a,b\n', ',\n'],
    ]) {
        const result = await validateFiles(await files(texts), { sanitizeBottom: true });
        t.is(result.recordCount, 0);
        t.is(result.finalRecord, undefined);
        t.deepEqual(await Array.fromAsync(replayFiles(result)), []);
    }
    const empty = await validateFiles(await files([',\n', '\n']), {
        sanitizeBottom: true,
        skipEmptyLines: false,
    });
    // eslint-disable-next-line unicorn/no-null -- Undiscovered schemas retain the public null sentinel.
    t.is(empty.headers, null);
});

test('file-set custom quoting/newlines and quoted whitespace remain data', async (t) => {
    const result = await validateFiles(await files(["a;b|x;y|' ';''|'';''|", "'';''|"]), {
        separator: ';',
        newline: '|',
        quote: "'",
        strictQuotes: true,
        strict: true,
        skipEmptyLines: false,
        sanitizeBottom: true,
    });
    t.deepEqual(await Array.fromAsync(replayFiles(result)), [
        { a: 'x', b: 'y' },
        { a: ' ', b: '' },
    ]);
    t.is(result.cleanup.removedRecords, 2);
    t.is(result.recordCount, 2);
});

test('file-set large suffix uses counters and slow replay remains cancellable', async (t) => {
    const result = await validateFiles(await files(['a,b\nx,y\n' + ',\n'.repeat(100_000)]), {
        strict: true,
        sanitizeBottom: true,
        skipEmptyLines: false,
    });
    t.is(result.recordCount, 1);
    t.is(result.cleanup.removedRecords, 100_000);
    let count = 0;
    for await (const row of replayFiles(result)) {
        await new Promise((resolve) => setImmediate(resolve));
        t.deepEqual(row, { a: 'x', b: 'y' });
        count++;
        break;
    }
    t.is(count, 1);
    await t.throwsAsync(validateFiles(await files(['a\nlong']), { maxRowBytes: 3 }), {
        message: /maximum size/,
    });
});

test('file-set reuses inferred CR newlines and supports single-file convenience', async (t) => {
    const result = await validateFiles(await files(['a,b\rx,y\r', 'z,w\r,\r']), {
        strict: true,
        sanitizeBottom: true,
        skipEmptyLines: false,
    });
    t.deepEqual(await Array.fromAsync(replayFiles(result)), [
        { a: 'x', b: 'y' },
        { a: 'z', b: 'w' },
    ]);
    t.is(result.cleanup.removedRecords, 1);
    const [file] = await files(['a\nx\n\n']);
    const single = await validateFile(file, { sanitizeBottom: true, skipEmptyLines: false });
    t.is(single.recordCount, 1);
    t.deepEqual(await Array.fromAsync(replayFiles(single)), [{ a: 'x' }]);
    t.deepEqual(await validateFile(file, { sanitizeBottom: false, skipEmptyLines: true }), {
        headers: ['a'],
        recordCount: 1,
    });
    await t.throwsAsync(validateFiles(await files(['a,a\nx,y\n']), { sanitizeBottom: true }), {
        message: /Duplicate header/,
    });
});

test('file-set rejects invalid inputs and callback exceptions', async (t) => {
    await t.throwsAsync(validateFiles([]), { instanceOf: TypeError });
    await t.throwsAsync(validateFiles([42]), { instanceOf: TypeError });
    await t.throwsAsync(validateFiles(['unused'], { sanitizeBottom: 'true' }), {
        instanceOf: TypeError,
    });
    await t.throwsAsync(Array.fromAsync(replayFiles({})), { instanceOf: TypeError });
    await t.throwsAsync(
        validateFiles(await files(['a\nx']), {
            mapValues: () => {
                throw new Error('mapper');
            },
        }),
        { message: /mapper/ },
    );
    await t.throwsAsync(validateFiles([path.join(state.root, 'missing')]));
});
