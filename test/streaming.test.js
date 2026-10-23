import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import test from 'ava';
import csv from '../index.js';

/**
 * Quote an export cell containing delimiters, newlines or double quotes.
 * @param {string} value - Cell value.
 * @returns {string} Encoded cell.
 */
function encode(value) {
    return '"' + value.replaceAll('"', '""') + '"';
}

/**
 * Stream export-like synthetic records into an awaited upload-like consumer.
 * @param {number} count - Number of generated records.
 * @param {string} separator - CSV or TSV delimiter.
 * @returns {Promise<object>} Observed buffering and sampled process memory.
 */
async function measure(count, separator) {
    let isSourceEnded = false;
    let bytes = 0;
    const values = (index) => [
        String(index),
        'var label = "demo";',
        `Δ${separator}line\r\n"end"`,
        '',
    ];
    /**
     * Generate bounded records without retaining the input file.
     * @yields {Buffer} Next input chunk.
     */
    async function* source() {
        // Split the inferred header CRLF independently of record generation.
        yield Buffer.from(['id', 'code', 'note', 'empty'].join(separator) + '\r');
        yield Buffer.from('\n');
        for (let index = 0; index < count; index++) {
            const cells = values(index);
            // Keep code-like literal quotes unquoted and stringify embedded delimiters/newlines.
            const row = Buffer.from(
                [cells[0], cells[1], encode(cells[2]), ''].join(separator) + '\r\n',
            );
            bytes += row.length;
            yield row;
        }
        isSourceEnded = true;
    }
    const parser = Readable.from(source(), { highWaterMark: 1 }).pipe(
        csv({ separator, strict: true }),
    );
    let seen = 0;
    let isIncremental = false;
    let maxReadable = 0;
    let maxWritable = 0;
    let maxPrevious = 0;
    const baseline = process.memoryUsage();
    const peak = { ...baseline };
    for await (const row of parser) {
        if (seen === 0) isIncremental = !isSourceEnded;
        const expected = Object.fromEntries(
            ['id', 'code', 'note', 'empty'].map((key, index) => [key, values(seen)[index]]),
        );
        if (JSON.stringify(row) !== JSON.stringify(expected))
            throw new Error('Exact streaming row mismatch at ' + seen);
        seen++;
        maxReadable = Math.max(maxReadable, parser.readableLength);
        maxWritable = Math.max(maxWritable, parser.writableLength);
        maxPrevious = Math.max(maxPrevious, parser._prev?.length || 0);
        if (seen % 128 !== 0) continue;
        // Await each synthetic upload batch; never accumulate an output list.
        await setImmediate();
        const memory = process.memoryUsage();
        for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers'])
            peak[key] = Math.max(peak[key], memory[key]);
    }
    return {
        count: seen,
        bytes,
        incremental: isIncremental,
        maxReadable,
        maxWritable,
        maxPrevious,
        baseline,
        peak,
    };
}

for (const separator of [',', '\t']) {
    test.serial(
        `combined incremental export/re-import with awaited batches: ${JSON.stringify(separator)}`,
        async (t) => {
            const small = await measure(2000, separator);
            const large = await measure(20_000, separator);
            t.is(small.count, 2000);
            t.is(large.count, 20_000);
            for (const result of [small, large]) {
                t.true(result.incremental);
                t.true(result.maxReadable <= 32);
                t.true(result.maxWritable <= 16);
                t.true(result.maxPrevious <= 256);
            }
            // Process-wide GC/JIT/AVA noise is not parser storage: allow 64 MiB slack.
            t.true(
                large.peak.heapUsed - large.baseline.heapUsed <
                    small.peak.heapUsed - small.baseline.heapUsed + 64 * 1024 * 1024,
            );
            t.log(
                JSON.stringify({ separator, small, large, memoryToleranceBytes: 64 * 1024 * 1024 }),
            );
        },
    );
}
