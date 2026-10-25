import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'ava';
import csv from '../index.js';

/**
 * Count parser-owned concatenation bytes without overlapping other tests.
 * @param {() => void} run - Synchronous parser workload.
 * @returns {number} Bytes passed to concatenation.
 */
function copiedBytes(run) {
    const original = Buffer.concat;
    let bytes = 0;
    Buffer.concat = (buffers, length) => {
        bytes += length ?? buffers.reduce((sum, buffer) => sum + buffer.length, 0);
        return original(buffers, length);
    };
    try {
        run();
    } finally {
        Buffer.concat = original;
    }
    return bytes;
}

for (const size of [64 * 1024, 1024 * 1024, 8 * 1024 * 1024]) {
    for (const chunkSize of [1024, 16 * 1024, 64 * 1024]) {
        test.serial(`linear record copies: ${size}/${chunkSize}`, (t) => {
            const input = Buffer.from('x'.repeat(size - 1) + '\n');
            const parser = csv({ headers: ['value'] });
            let rows = 0;
            parser.on('data', (row) => {
                rows++;
                t.is(row.value, 'x'.repeat(size - 1));
            });
            const copied = copiedBytes(() => {
                for (let index = 0; index < input.length; index += chunkSize)
                    parser.write(input.subarray(index, index + chunkSize));
                parser.end();
            });
            t.is(rows, 1);
            t.is(copied, size > chunkSize ? size : 0);
        });
    }
}

for (const separator of [',', '\t']) {
    test.serial(
        `fragmented exact values and physical offsets: ${JSON.stringify(separator)}`,
        async (t) => {
            const prefix = '\u{FEFF}//ignored "\r\n \r\n';
            const header = ['id', 'text', 'empty'].join(separator) + '\r\n';
            const record = ['α', '"line\r\n雪\\"end"', ''].join(separator) + '\r\n';
            const last = ['β', '"last"', ''].join(separator);
            const input = Buffer.from(prefix + header + record + last);
            const expected = [
                {
                    row: { id: 'α', text: 'line\r\n雪"end', empty: '' },
                    byteOffset: Buffer.byteLength(prefix + header),
                },
                {
                    row: { id: 'β', text: 'last', empty: '' },
                    byteOffset: Buffer.byteLength(prefix + header + record),
                },
            ];
            for (let split = 1; split < input.length; split++) {
                const rows = [];
                await pipeline(
                    [Buffer.from(input.subarray(0, split)), Buffer.from(input.subarray(split))],
                    csv({
                        separator,
                        escape: '\\',
                        bom: true,
                        skipComments: '//',
                        skipEmptyLines: true,
                        strictQuotes: true,
                        outputByteOffset: true,
                    }),
                    new Writable({
                        objectMode: true,
                        write(row, encoding, callback) {
                            rows.push(row);
                            callback();
                        },
                    }),
                );
                t.deepEqual(rows, expected, `split ${split}`);
            }
            const rows = [];
            await pipeline(
                [...input].map((byte) => Buffer.from([byte])),
                csv({
                    separator,
                    escape: '\\',
                    bom: true,
                    skipComments: '//',
                    skipEmptyLines: true,
                    strictQuotes: true,
                    outputByteOffset: true,
                }),
                new Writable({
                    objectMode: true,
                    write(row, encoding, callback) {
                        rows.push(row);
                        callback();
                    },
                }),
            );
            t.deepEqual(rows, expected);
        },
    );
}

test.serial('marker and CR lookahead do not copy a whole incoming chunk', (t) => {
    for (const [prefix, options, suffix] of [
        ['/', { skipComments: '//' }, '/ignored\n'],
        ['value\r', {}, '\n'],
    ]) {
        const parser = csv(options);
        let rows = 0;
        parser.on('data', () => rows++);
        const input = Buffer.from(suffix + 'x\n'.repeat(40_000));
        const copied = copiedBytes(() => {
            parser.write(Buffer.from(prefix));
            parser.end(input);
        });
        t.is(rows, 39_999 + (options.skipComments ? 0 : 1));
        t.true(copied < 32);
    }
});

test.serial('unterminated final fragmented record assembles only once', (t) => {
    const parser = csv({ headers: ['value'], outputByteOffset: true });
    const rows = [];
    parser.on('data', (row) => {
        rows.push(row);
    });
    const copied = copiedBytes(() => {
        parser.write(Buffer.from('prefix\n'));
        for (let index = 0; index < 64; index++) parser.write(Buffer.alloc(1024, 'x'));
        parser.end();
    });
    t.deepEqual(rows, [
        { row: { value: 'prefix' }, byteOffset: 0 },
        { row: { value: 'x'.repeat(65_536) }, byteOffset: 7 },
    ]);
    t.is(copied, 65_536);
});

test.serial('raw fragmented output storage is not reused for later records', async (t) => {
    const rows = [];
    await pipeline(
        [Buffer.from('"a""'), Buffer.from('b"\nc'), Buffer.from('d\n"e""f"')],
        csv({ headers: ['value'], raw: true }),
        new Writable({
            objectMode: true,
            write(row, encoding, callback) {
                rows.push(row.value);
                callback();
            },
        }),
    );
    t.deepEqual(
        rows.map((value) => value.toString()),
        ['a"b', 'cd', 'e"f'],
    );
});

/**
 * Assert that EOF no longer owns record or lookahead storage.
 * @param {import('ava').ExecutionContext} t - Test assertions.
 * @param {ReturnType<typeof csv>} parser - Completed parser.
 * @returns {void} Checks reference state without relying on garbage collection.
 */
function assertReleased(t, parser) {
    t.deepEqual(parser.fragments, []);
    t.is(parser.fragmentBytes, 0);
    // eslint-disable-next-line unicorn/no-null -- The parser preserves its inherited lookahead sentinel.
    t.is(parser._prev, null);
    t.is(parser.bomPending, undefined);
}

for (const [name, chunks, options, expected] of [
    ['empty BOM-enabled input', [], { bom: true }, []],
    ['single fragment', ['value'], { headers: ['v'] }, [{ v: 'value' }]],
    ['multiple fragments', ['val', 'ue'], { headers: ['v'] }, [{ v: 'value' }]],
    ['header only', ['va', 'lue'], {}, []],
    ['comment', ['//', 'ignored "'], { skipComments: '//' }, []],
    ['comment prefix mismatch', ['/'], { headers: ['v'], skipComments: '//' }, [{ v: '/' }]],
    ['header CR lookahead', ['value\r'], {}, []],
    ['quoted CR lookahead', ['"value"\r'], { headers: ['v'], strictQuotes: true }, undefined],
    ['unterminated quote', ['"val', 'ue'], { headers: ['v'], strictQuotes: true }, undefined],
    ['strict width', ['val', 'ue'], { headers: ['a', 'b'], strict: true }, undefined],
    ['duplicate headers', ['a,', 'a'], {}, undefined],
    ['overflow collision', ['a,', 'b'], { headers: ['_1'] }, undefined],
    ['empty line', [' ', ' '], { skipEmptyLines: true }, []],
    ['incomplete BOM', [Buffer.from([0xef, 0xbb])], { bom: true, headers: ['v'] }, [{ v: '�' }]],
    ['BOM replay size error', [Buffer.from([0xef])], { bom: true, maxRowBytes: 0 }, undefined],
    ['comment replay quote error', ['"'], { skipComments: '"x', strictQuotes: true }, undefined],
]) {
    test.serial(`EOF releases references: ${name}`, (t) => {
        const parser = csv(options);
        const rows = [];
        parser.on('data', (row) => {
            rows.push(row);
        });
        for (const chunk of chunks) parser.write(chunk);
        let completions = 0;
        parser._flush((error) => {
            completions++;
            assertReleased(t, parser);
            if (expected === undefined) t.true(error instanceof Error);
            else t.is(error, undefined);
        });
        t.is(completions, 1);
        t.deepEqual(rows, expected ?? []);
        parser.destroy();
    });
}

for (const mapping of ['mapValues', 'mapHeaders']) {
    test.serial(`EOF releases references before preserving thrown ${mapping}`, (t) => {
        const failure = new Error('mapping failed');
        const parser = csv({
            ...(mapping === 'mapValues' && { headers: ['v'] }),
            [mapping]: () => {
                throw failure;
            },
        });
        parser.write('val');
        parser.write('ue');
        let completions = 0;
        t.is(
            t.throws(() => parser._flush(() => completions++)),
            failure,
        );
        t.is(completions, 0);
        assertReleased(t, parser);
        parser.destroy();
    });
}

for (const chunks of [['"a""b"'], ['"a"', '"b"']]) {
    test.serial(
        `raw EOF values survive reference release: ${chunks.length} fragments`,
        async (t) => {
            const parser = csv({ headers: ['v'], raw: true });
            const rows = [];
            await pipeline(
                chunks.map((chunk) => Buffer.from(chunk)),
                parser,
                new Writable({
                    objectMode: true,
                    write(row, encoding, callback) {
                        rows.push(row.v);
                        callback();
                    },
                }),
            );
            assertReleased(t, parser);
            t.deepEqual(rows, [Buffer.from('a"b')]);
        },
    );
}

test.serial('earlier raw values survive EOF error reference release', async (t) => {
    const parser = csv({ headers: ['v'], raw: true, strictQuotes: true });
    const rows = [];
    await t.throwsAsync(
        pipeline(
            [Buffer.from('"a""'), Buffer.from('b"\n"unter'), Buffer.from('minated')],
            parser,
            new Writable({
                objectMode: true,
                write(row, encoding, callback) {
                    rows.push(row.v);
                    callback();
                },
            }),
        ),
        { message: 'Unterminated quoted field' },
    );
    assertReleased(t, parser);
    t.deepEqual(rows, [Buffer.from('a"b')]);
});

test.serial('reject oversized fragmented rows before assembling them', (t) => {
    const parser = csv({ headers: ['value'], maxRowBytes: 8 });
    const errors = [];
    parser.on('error', (error) => {
        errors.push(error);
    });
    let error;
    const copied = copiedBytes(() => {
        parser.scan(Buffer.from('12345678'), () => {});
        parser.scan(Buffer.from('9\n'), (result) => {
            error = result;
        });
    });
    t.is(error.message, 'Row exceeds the maximum size');
    t.is(copied, 0);
    t.deepEqual(errors, []);
    parser.destroy();
});

test.serial('large fragmented streams validate incrementally without retaining rows', async (t) => {
    const value = '雪"line\n'.repeat(10_000);
    const encoded = Buffer.from('"' + value.replaceAll('"', '""') + '"\n');
    let generated = 0;
    let seen = 0;
    let isIncremental = false;
    /**
     * Produce one bounded synthetic record at a time.
     * @yields {Buffer} Next fragment.
     */
    async function* source() {
        for (; generated < 24; generated++) {
            for (let index = 0; index < encoded.length; index += 1024)
                yield Buffer.from(encoded.subarray(index, index + 1024));
        }
    }
    await pipeline(
        Readable.from(source(), { highWaterMark: 1 }),
        csv({ headers: ['value'] }),
        new Writable({
            objectMode: true,
            write(row, encoding, callback) {
                if (seen === 0) isIncremental = generated < 24;
                t.is(row.value, value);
                seen++;
                callback();
            },
        }),
    );
    t.is(seen, 24);
    t.true(isIncremental);
});
