import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers';
import test from 'ava';
import csv from '../index.js';

test('flowing data listeners keep synchronous mappings and final flush values', async (t) => {
    let seen = 0;
    let callbacks = 0;
    const parser = csv({ headers: ['id'], raw: true });
    const ended = once(parser, 'end');
    parser.on('data', (row) => {
        t.is(row.id.toString(), String(seen++));
    });
    parser.write(
        Buffer.from(Array.from({ length: 2000 }, (_, index) => `${index}\n`).join('')),
        () => callbacks++,
    );
    t.is(seen, 2000);
    parser.end('2000');
    await ended;
    t.is(seen, 2001);
    t.is(callbacks, 1);
    t.is(parser.fragmentBytes, 0);
});

test('iterator cancellation releases the paused chunk and completes its write once', async (t) => {
    const parser = csv({ headers: ['id'] });
    let callbacks = 0;
    parser.write(Buffer.from('x\n'.repeat(2000)), () => callbacks++);
    for await (const row of parser) {
        t.is(row.id, 'x');
        break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    t.true(parser.destroyed);
    t.is(callbacks, 1);
    t.is(parser.pendingScan, undefined);
});

for (const finalNewline of ['\n', '']) {
    test(`mapping failure after resumed input and EOF: ${JSON.stringify(finalNewline)}`, async (t) => {
        const failure = new Error('mapped failure');
        let mapped = 0;
        const parser = csv({
            headers: ['id'],
            mapValues: ({ value }) => {
                mapped++;
                if (value === 'bad') throw failure;
                return value;
            },
        });
        const consumer = new Writable({
            objectMode: true,
            highWaterMark: 1,
            write(row, encoding, callback) {
                t.is(row.id, 'ok');
                setImmediate(callback);
            },
        });
        const input = Buffer.from('ok\n'.repeat(40) + 'bad' + finalNewline);
        const source = Readable.from([input]);
        await t.throwsAsync(pipeline(source, parser, consumer), { is: failure });
        t.is(mapped, 41);
        t.is(parser.pendingScan, undefined);
        t.is(parser.fragmentBytes, 0);
    });
}

test('terminal width errors after suspension do not map later records', async (t) => {
    let mapped = 0;
    const parser = csv({
        headers: ['id'],
        strict: true,
        mapValues: ({ value }) => {
            mapped++;
            return value;
        },
    });
    parser.end(Buffer.from('ok\n'.repeat(40) + 'bad,width\nnever\n'));
    await t.throwsAsync(
        async () => {
            for await (const row of parser) t.is(row.id, 'ok');
        },
        { instanceOf: RangeError, message: 'Row length does not match headers' },
    );
    t.is(mapped, 42);
});

test('sink failure cancels a paused parser and its source', async (t) => {
    const failure = new Error('sink failed');
    const source = Readable.from([Buffer.from('ok\n'.repeat(2000))]);
    const parser = csv({ headers: ['id'] });
    const sink = new Writable({
        objectMode: true,
        highWaterMark: 1,
        write(row, encoding, callback) {
            setImmediate(callback, failure);
        },
    });
    await t.throwsAsync(pipeline(source, parser, sink), { is: failure });
    t.true(source.destroyed);
    t.true(parser.destroyed);
    t.is(parser.pendingScan, undefined);
});
