import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers';
import csv from '../index.js';

// Refuse unsafe temporary placement even though this benchmark creates no files.
const environment = Object.entries({
    TEMP: process.env.TEMP,
    node: os.tmpdir(),
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
});
for (const [key, value] of environment) {
    if (key !== 'TEMP' && key !== 'node' && !value) continue;
    assert.ok(path.isAbsolute(value));
    assert.equal(
        path
            .resolve(value)
            .replace(/[\\/]+$/u, '')
            .toLowerCase(),
        String.raw`f:\temp`,
    );
}

/**
 * Measure synchronous parser-owned concatenations, elapsed time and sampled memory.
 * @param {Buffer} input - Synthetic input, allocated outside the measurement.
 * @param {number} chunkSize - Incoming chunk length.
 * @returns {object} Measurement with exact row/copy counts.
 */
function measure(input, chunkSize) {
    const parser = csv({ headers: ['value'] });
    let rows = 0;
    parser.on('data', () => rows++);
    const original = Buffer.concat;
    let copied = 0;
    Buffer.concat = (buffers, length) => {
        copied += length ?? buffers.reduce((sum, buffer) => sum + buffer.length, 0);
        return original(buffers, length);
    };
    const baseline = process.memoryUsage();
    const peak = { ...baseline };
    const start = performance.now();
    try {
        for (let offset = 0; offset < input.length; offset += chunkSize) {
            parser.write(input.subarray(offset, offset + chunkSize));
            const memory = process.memoryUsage();
            for (const key of ['external', 'arrayBuffers', 'rss'])
                peak[key] = Math.max(peak[key], memory[key]);
        }
        parser.end();
    } finally {
        Buffer.concat = original;
    }
    return {
        chunkSize,
        bytes: input.length,
        rows,
        copied,
        ms: performance.now() - start,
        baseline,
        peak,
    };
}

console.log(JSON.stringify({ node: process.version, date: new Date().toISOString() }));
for (const size of [64 * 1024, 1024 * 1024, 8 * 1024 * 1024]) {
    const input = Buffer.from('x'.repeat(size - 1) + '\n');
    for (const chunk of [1024, 16 * 1024, 64 * 1024]) {
        const result = measure(input, chunk);
        assert.equal(result.rows, 1);
        console.log(JSON.stringify({ kind: 'long', ...result }));
    }
}
const short = Buffer.from('one,two,three\n'.repeat(100_000));
for (let run = 0; run < 3; run++) {
    const result = measure(short, 64 * 1024);
    assert.equal(result.rows, 100_000);
    console.log(JSON.stringify({ kind: 'short', run, ...result }));
}
/**
 * Characterize the existing one-chunk readable queue without optimizing it.
 * @returns {Promise<void>} Completes after draining the slow sink.
 */
async function measureSlow() {
    let maxReadable = 0;
    let seen = 0;
    const parser = csv({ headers: ['value'] });
    const start = performance.now();
    await pipeline(
        [Buffer.from('value\n'.repeat(2000))],
        parser,
        new Writable({
            objectMode: true,
            write(row, encoding, callback) {
                assert.equal(row.value, 'value');
                seen++;
                maxReadable = Math.max(maxReadable, parser.readableLength);
                setImmediate(callback);
            },
        }),
    );
    console.log(
        JSON.stringify({ kind: 'slow', rows: seen, maxReadable, ms: performance.now() - start }),
    );
}
await measureSlow();
