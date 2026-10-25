import fs from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'ava';
import csv, { validateFile } from '../index.js';
import { validateTemporaryDirectories } from './helpers/temporary-directories.js';

const state = {};
// eslint-disable-next-line unicorn/no-null -- Assert the public null header and removed-column contracts.
const absent = null;
test.before(async () => {
    validateTemporaryDirectories(process.platform, {
        TEMP: process.env.TEMP,
        NODE: os.tmpdir(),
        TMP: process.env.TMP,
        TMPDIR: process.env.TMPDIR,
    });
    state.root = await mkdtemp(path.join(os.tmpdir(), 'csv-validate-'));
    await writeFile(path.join(state.root, 'owner'), randomUUID());
});

/**
 * Register a fresh synthetic file; retain fixtures rather than recursively cleaning.
 * @param {string} text - Synthetic CSV text.
 * @returns {Promise<string>} Owned file path.
 */
async function fixture(text) {
    const file = path.join(state.root, `${randomUUID()}.csv`);
    await writeFile(file, text);
    return file;
}

for (const separator of [',', '\t']) {
    test.serial(
        `validateFile matches parser values and callbacks: ${JSON.stringify(separator)}`,
        async (t) => {
            const text = `\u{FEFF}NAME${separator}DROP${separator}CODE\r\nΔelta${separator}${separator}var label = "demo";\r\n"two\nparts"${separator}x${separator}"tail"`;
            const file = await fixture(text);
            const mappings = [];
            const options = {
                separator,
                strict: true,
                strictQuotes: true,
                outputByteOffset: true,
                mapHeaders: ({ header, index }) =>
                    index === 1 ? absent : header.replace(/^\u{FEFF}/u, '').toLowerCase(),
                mapValues: (entry) => {
                    mappings.push({ ...entry });
                    return entry.value;
                },
            };
            const summary = await validateFile(file, options);
            const validationMappings = mappings.splice(0);
            const parser = csv(options);
            const rows = [];
            parser.on('data', (row) => {
                rows.push(row);
            });
            await pipeline(fs.createReadStream(file), parser);
            t.deepEqual(summary, { headers: ['name', absent, 'code'], recordCount: 2 });
            t.deepEqual(mappings, validationMappings);
            t.deepEqual(
                rows.map(({ row }) => row),
                [
                    { name: 'Δelta', code: 'var label = "demo";' },
                    { name: 'two\nparts', code: 'tail' },
                ],
            );
        },
    );
}

test.serial('validateFile shares BOM preprocessing, counts and callback failures', async (t) => {
    for (const separator of [',', '\t']) {
        const text = `\u{FEFF}"a${separator}b"${separator}c\n"x\ny"${separator}z`;
        const file = await fixture(text);
        const options = { bom: true, separator, strictQuotes: true, strict: true };
        t.deepEqual(await validateFile(file, options), {
            headers: [`a${separator}b`, 'c'],
            recordCount: 1,
        });
    }
    const only = await fixture('\u{FEFF}');
    t.deepEqual(await validateFile(only, { bom: true, maxRowBytes: 0 }), {
        headers: absent,
        recordCount: 0,
    });
    const partial = await fixture(Buffer.from([0xef, 0xbb]));
    for (const key of ['mapHeaders', 'mapValues']) {
        let calls = 0;
        const cause = new Error('synthetic incomplete-prefix mapper failure');
        const options = {
            bom: true,
            ...(key === 'mapValues' && { headers: ['a'] }),
            [key]: () => {
                calls++;
                throw cause;
            },
        };
        const error = await t.throwsAsync(validateFile(partial, options));
        t.is(error.cause, cause);
        t.is(calls, 1);
    }
    t.deepEqual(await validateFile(partial, { bom: true, headers: false, raw: true }), {
        headers: false,
        recordCount: 1,
    });
    const limited = await fixture('\u{FEFF}x\n');
    t.deepEqual(await validateFile(limited, { bom: true, headers: ['a'], maxRowBytes: 2 }), {
        headers: ['a'],
        recordCount: 1,
    });
});

test.serial('validateFile empty, header-only, explicit and positional modes', async (t) => {
    const empty = await fixture('');
    t.deepEqual(await validateFile(empty), { headers: absent, recordCount: 0 });
    t.deepEqual(await validateFile(empty, { headers: false }), { headers: false, recordCount: 0 });
    t.deepEqual(await validateFile(empty, { headers: true }), { headers: absent, recordCount: 0 });
    const headers = Object.freeze(['label', 'value']);
    const options = Object.freeze({ headers });
    const result = await validateFile(empty, options);
    t.deepEqual(result, { headers, recordCount: 0 });
    t.not(result.headers, headers);
    result.headers.push('local');
    t.deepEqual(await validateFile(empty, headers), { headers, recordCount: 0 });
    const file = await fixture('a,b');
    t.deepEqual(await validateFile(file), { headers: ['a', 'b'], recordCount: 0 });
    t.deepEqual(await validateFile(file, headers), { headers, recordCount: 1 });
    t.deepEqual(await validateFile(file, { headers: false, strict: true }), {
        headers: false,
        recordCount: 1,
    });
    t.deepEqual(await validateFile(file, { mapHeaders: () => absent }), {
        headers: [absent, absent],
        recordCount: 0,
    });
});

test.serial('validateFile forwards skip, raw, custom quote/escape/newline options', async (t) => {
    const values = [];
    const file = await fixture(String.raw`ignored|#comment|a;b|'hello\'world';|`);
    t.deepEqual(
        await validateFile(file, {
            separator: ';',
            newline: '|',
            quote: "'",
            escape: '\\',
            skipLines: 1,
            skipComments: true,
            raw: true,
            strictQuotes: true,
            mapValues: ({ value }) => {
                values.push(value.toString());
                return value;
            },
        }),
        { headers: ['a', 'b'], recordCount: 1 },
    );
    t.deepEqual(values, ["hello'world", '']);
});

for (const [text, options, message] of [
    ['a,b\nx', { strict: true }, 'Row length'],
    ['a\n"open', { strictQuotes: true }, 'Unterminated'],
    ['a\n"closed"x', { strictQuotes: true }, 'Invalid character'],
    ['a\nlong', { maxRowBytes: 3 }, 'maximum size'],
    ['a,a\nx,y', {}, 'Duplicate header'],
    ['x,y', { headers: ['a', 'a'] }, 'Duplicate header'],
    ['a,b\nlater,row\n', { headers: ['_1'] }, 'Duplicate row key: _1'],
    ['_1\na,b', {}, 'Duplicate row key: _1'],
]) {
    test.serial(`validateFile rejects parser failure: ${message} ${text}`, async (t) => {
        const file = await fixture(text);
        const error = await t.throwsAsync(validateFile(file, options));
        t.true(error.message.includes(file));
        t.true(error.cause.message.includes(message));
        t.false(/line \d|record \d/i.test(error.message));
    });
}

test.serial(
    'validateFile rejects non-Error mapper throws without swallowing falsy values',
    async (t) => {
        const file = await fixture('a\nx');
        for (const value of [undefined, false, 'failure']) {
            const error = await t.throwsAsync(
                validateFile(file, {
                    mapValues: () => {
                        throw value;
                    },
                }),
            );
            t.is(error.cause.cause, value);
        }
    },
);

for (const ending of ['\n', '']) {
    test.serial(
        `validateFile stops mappings after strict width failure: ${JSON.stringify(ending)}`,
        async (t) => {
            const text = `a,b\ngood,row\nshort${ending}${ending ? 'later,row\n' : ''}`;
            const file = await fixture(text);
            const validationMappings = [];
            const parserMappings = [];
            const validationError = await t.throwsAsync(
                validateFile(file, {
                    strict: true,
                    mapValues: ({ value }) => {
                        validationMappings.push(value);
                        return value;
                    },
                }),
            );
            const parser = csv({
                strict: true,
                mapValues: ({ value }) => {
                    parserMappings.push(value);
                    return value;
                },
            });
            const parserError = await t.throwsAsync(
                pipeline(
                    Readable.from([text]),
                    parser,
                    new Writable({
                        objectMode: true,
                        write(row, encoding, callback) {
                            callback();
                        },
                    }),
                ),
            );
            t.true(validationError.cause instanceof RangeError);
            t.is(validationError.cause.message, parserError.message);
            t.true(validationError.message.includes(file));
            t.deepEqual(validationMappings, ['good', 'row', 'short']);
            t.deepEqual(parserMappings, validationMappings);
        },
    );
}

test.serial('validateFile does not enable either strictness option', async (t) => {
    const file = await fixture('a,b\n"open');
    t.deepEqual(await validateFile(file), { headers: ['a', 'b'], recordCount: 1 });
});

for (const [key, text] of [
    ['mapHeaders', 'a\nx\n'],
    ['mapValues', 'a\nx\n'],
    ['mapValues', 'a\nx'],
]) {
    test.serial(
        `validateFile captures ${key} exception including EOF: ${JSON.stringify(text)}`,
        async (t) => {
            const cause = new Error('synthetic mapper failure');
            const file = await fixture(text);
            const error = await t.throwsAsync(
                validateFile(file, {
                    [key]: () => {
                        throw cause;
                    },
                }),
            );
            t.is(error.cause, cause);
            t.true(error.message.includes(file));
        },
    );
}

test.serial(
    'validateFile rejects missing, unreadable and invalid paths asynchronously',
    async (t) => {
        const missing = path.join(state.root, 'missing.csv');
        const error = await t.throwsAsync(validateFile(missing));
        t.is(error.code, 'ENOENT');
        t.is(error.cause.code, 'ENOENT');
        t.true(error.message.includes(missing));
        const directoryError = await t.throwsAsync(validateFile(state.root));
        t.truthy(directoryError.cause.code);
        const invalid = await t.throwsAsync(validateFile(Buffer.from('no')));
        t.true(invalid.cause instanceof TypeError);
        const symbol = await t.throwsAsync(validateFile(Symbol('synthetic-path')));
        t.true(symbol.cause instanceof TypeError);
        t.is(symbol.cause.message, 'filePath must be a string');
        t.is(
            symbol.message,
            'Unable to validate Symbol(synthetic-path): filePath must be a string',
        );
        await t.throwsAsync(validateFile('bad\0path'));
    },
);

test.serial(
    'validateFile destroys owned sources after parser and source failures and success',
    async (t) => {
        const original = fs.createReadStream;
        try {
            for (const mode of ['parser', 'source', 'success']) {
                const cause = new Error('synthetic read failure');
                const source = new Readable({
                    read() {
                        if (mode === 'source') {
                            source.destroy(cause);
                            return;
                        }
                        source.push(mode === 'parser' ? 'a\n"open' : 'a\nx\n');
                        source.push(absent);
                    },
                });
                fs.createReadStream = () => source;
                syncBuiltinESMExports();
                if (mode === 'success') {
                    const result = await validateFile('synthetic');
                    t.is(result.recordCount, 1);
                } else {
                    const error = await t.throwsAsync(
                        validateFile('synthetic', { strictQuotes: true }),
                    );
                    if (mode === 'source') t.is(error.cause, cause);
                }
                t.true(source.destroyed);
                t.true(source.closed);
            }
        } finally {
            fs.createReadStream = original;
            syncBuiltinESMExports();
        }
    },
);

test.serial('validateFile streams scaled input and maps each data value once', async (t) => {
    const file = path.join(state.root, 'scaled.csv');
    let produced = 0;
    /**
     * Produce rows incrementally without a file-sized array.
     * @yields {string} One synthetic record.
     * @returns {AsyncGenerator<string>} Bounded producer.
     */
    async function* chunks() {
        yield 'a,b\n';
        for (let index = 0; index < 100_000; index++) {
            produced++;
            yield `${index},value\n`;
        }
    }
    await pipeline(Readable.from(chunks()), fs.createWriteStream(file));
    let mapped = 0;
    const result = await validateFile(file, {
        mapValues: ({ value }) => {
            mapped++;
            return value;
        },
    });
    t.is(produced, 100_000);
    t.is(result.recordCount, produced);
    t.is(mapped, produced * 2);
    t.deepEqual(
        Object.keys(result).toSorted((left, right) => left.localeCompare(right)),
        ['headers', 'recordCount'],
    );
});
