import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate as immediate } from 'node:timers';
import { setImmediate } from 'node:timers/promises';
import test from 'ava';
import csv from '../index.js';

for (const chunkSize of [Number.MAX_SAFE_INTEGER, 65_536, 12]) {
    for (const mode of ['sink', 'batch']) {
        test.serial(`within-chunk backpressure: ${chunkSize} / ${mode}`, async (t) => {
            const count = 10_000;
            const input = Buffer.from(
                'id,value\n' +
                    Array.from({ length: count }, (_, index) => `${index},Δ${index}\n`).join(''),
            );
            let supplied = 0;
            const source = Readable.from(
                (function* () {
                    for (let start = 0; start < input.length; start += chunkSize) {
                        supplied++;
                        yield input.subarray(start, start + chunkSize);
                    }
                })(),
                { highWaterMark: 1 },
            );
            const parser = csv({ outputByteOffset: true });
            let seen = 0;
            let offset = Buffer.byteLength('id,value\n');
            let peak = 0;
            let progressAtFirst;
            const baseline = process.memoryUsage();
            const started = performance.now();
            const check = ({ row, byteOffset }) => {
                if (!seen) progressAtFirst = supplied;
                t.deepEqual(row, { id: String(seen), value: `Δ${seen}` });
                t.is(byteOffset, offset);
                offset += Buffer.byteLength(`${seen},Δ${seen}\n`);
                seen++;
                peak = Math.max(peak, parser.readableLength);
                t.true(parser.readableLength <= parser.readableHighWaterMark);
            };
            if (mode === 'sink') {
                await pipeline(
                    source,
                    parser,
                    new Writable({
                        objectMode: true,
                        highWaterMark: 1,
                        write(row, encoding, callback) {
                            check(row);
                            immediate(callback);
                        },
                    }),
                );
            } else {
                const completion = pipeline(source, parser);
                for await (const row of parser) {
                    check(row);
                    if (seen % 7 === 0) await setImmediate();
                }
                await completion;
            }
            t.is(seen, count);
            t.is(offset, input.length);
            if (chunkSize === 12) {
                t.true(progressAtFirst < supplied);
                t.true(progressAtFirst <= 32);
            }
            t.log(
                JSON.stringify({
                    peak,
                    elapsedMs: performance.now() - started,
                    memoryBefore: baseline,
                    memoryAfter: process.memoryUsage(),
                }),
            );
        });
    }
}

test('a paused transform does not finish or map later records before demand', async (t) => {
    let mapped = 0;
    let callbacks = 0;
    const parser = csv({
        headers: ['id'],
        mapValues: ({ value }) => {
            mapped++;
            return value;
        },
    });
    parser.write(Buffer.from('x\n'.repeat(2000)), () => callbacks++);
    t.is(parser.readableLength, 16);
    t.is(mapped, 16);
    t.is(callbacks, 0);
    parser.end('final');
    let seen = 0;
    for await (const row of parser) {
        t.is(row.id, seen < 2000 ? 'x' : 'final');
        seen++;
    }
    t.is(seen, 2001);
    t.is(callbacks, 1);
});

test('destroy while paused settles the outstanding write once and releases input', async (t) => {
    const parser = csv({ headers: ['id'] });
    let callbacks = 0;
    parser.write(Buffer.from('x\n'.repeat(2000)), () => callbacks++);
    parser.destroy();
    await setImmediate();
    t.is(callbacks, 1);
    t.is(parser.pendingScan, undefined);
    t.is(parser.fragmentBytes, 0);
});

test('resumed mapping failures reject async consumption instead of escaping _read', async (t) => {
    const error = new Error('resumed mapping failed');
    const parser = csv({
        headers: ['id'],
        mapValues: ({ value }) => {
            if (value === 'fail') throw error;
            return value;
        },
    });
    parser.end(Buffer.from('ok\n'.repeat(40) + 'fail\nnever\n'));
    const consume = async () => {
        for await (const row of parser) t.is(row.id, 'ok');
    };
    await t.throwsAsync(consume, { is: error });
});

for (const separator of [',', '\t']) {
    test(`fragmented syntax, comments, BOM and custom quotes under demand: ${JSON.stringify(separator)}`, async (t) => {
        const record = `~a${separator}b~${separator}~Δ\r\n~~end~\r\n`;
        const input = Buffer.from(
            `\u{FEFF}#~ignored\r\nx${separator}y\r\n` +
                record.repeat(80) +
                `~last~${separator}~end~`,
        );
        const parser = csv({ separator, quote: '~', bom: true, skipComments: true, strict: true });
        const source = Readable.from(
            (function* () {
                for (let index = 0; index < input.length; index += 31)
                    yield input.subarray(index, index + 31);
            })(),
        );
        const completion = pipeline(source, parser);
        let seen = 0;
        for await (const row of parser) {
            t.deepEqual(
                row,
                seen < 80 ? { x: `a${separator}b`, y: 'Δ\r\n~end' } : { x: 'last', y: 'end' },
            );
            seen++;
            await setImmediate();
        }
        await completion;
        t.is(seen, 81);
    });
}
