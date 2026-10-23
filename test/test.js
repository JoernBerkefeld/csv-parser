import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import test from 'ava';
import spectrum from 'csv-spectrum';
import execa from 'execa';

import csv from '../index.js';

import { collectAsync } from './helpers/helper.js';

const eol = '\n';

for (const separator of [',', '\t']) {
    test(`raw explicit and false headers preserve data (${JSON.stringify(separator)})`, async (t) => {
        for (const headers of [['name', 'empty'], false]) {
            const parser = csv({ raw: true, separator, headers });
            parser.end(`Δelta${separator}\nnext${separator}`);
            const keys = headers || ['0', '1'];
            t.deepEqual(await Array.fromAsync(parser), [
                { [keys[0]]: Buffer.from('Δelta'), [keys[1]]: Buffer.alloc(0) },
                { [keys[0]]: Buffer.from('next'), [keys[1]]: Buffer.alloc(0) },
            ]);
        }
    });
}

test('simple csv', async (t) => {
    const { error, lines } = await collectAsync('basic');
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.is(lines.length, 1, '1 row');
});

test('supports strings', async (t) => {
    const parser = csv();

    parser.write('hello\n');
    parser.write('world\n');
    parser.end();

    for await (const data of parser) {
        t.snapshot(data);
    }
});

test('newlines in a cell', async (t) => {
    const { error, lines } = await collectAsync('newlines');
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.snapshot(lines[1], 'second row');
    t.snapshot(lines[2], 'fourth row');
    t.is(lines.length, 3, '3 rows');
});

test('raw escaped quotes', async (t) => {
    const { error, lines } = await collectAsync('escape-quotes');
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.snapshot(lines[1], 'second row');
    t.snapshot(lines[2], 'third row');
    t.is(lines.length, 3, '3 rows');
});

test('raw escaped quotes and newlines', async (t) => {
    const { error, lines } = await collectAsync('quotes+newlines');
    t.false(error, 'no err');
    t.snapshot(lines[0], 'first row');
    t.snapshot(lines[1], 'second row');
    t.snapshot(lines[2], 'third row');
    t.is(lines.length, 3, '3 rows');
});

test('line with comma in quotes', async (t) => {
    const headers = Buffer.from('a,b,c,d,e\n');
    const line = Buffer.from('John,Doe,120 any st.,"Anytown, WW",08123\n');
    const correct = JSON.stringify({
        a: 'John',
        b: 'Doe',
        c: '120 any st.',
        d: 'Anytown, WW',
        e: '08123',
    });
    const parser = csv();

    parser.write(headers);
    parser.write(line);
    parser.end();

    const [data] = await Array.fromAsync(parser);
    t.is(JSON.stringify(data), correct);
});

test('line with newline in quotes', async (t) => {
    const headers = Buffer.from('a,b,c\n');
    const line = Buffer.from(`1,"ha ${eol}""ha"" ${eol}ha",3\n`);
    const correct = JSON.stringify({ a: '1', b: `ha ${eol}"ha" ${eol}ha`, c: '3' });
    const parser = csv();

    parser.write(headers);
    parser.write(line);
    parser.end();

    const [data] = await Array.fromAsync(parser);
    t.is(JSON.stringify(data), correct);
});

test('cell with comma in quotes', async (t) => {
    const headers = Buffer.from('a\n');
    const cell = Buffer.from('"Anytown, WW"\n');
    const correct = 'Anytown, WW';
    const parser = csv();

    parser.write(headers);
    parser.write(cell);
    parser.end();

    const [data] = await Array.fromAsync(parser);
    t.is(data.a, correct);
});

test('cell with newline', async (t) => {
    const headers = Buffer.from('a\n');
    const cell = Buffer.from(`"why ${eol}hello ${eol}there"\n`);
    const correct = `why ${eol}hello ${eol}there`;
    const parser = csv();

    parser.write(headers);
    parser.write(cell);
    parser.end();

    const [data] = await Array.fromAsync(parser);
    t.is(data.a, correct);
});

test('cell with escaped quote in quotes', async (t) => {
    const headers = Buffer.from('a\n');
    const cell = Buffer.from('"ha ""ha"" ha"\n');
    const correct = 'ha "ha" ha';
    const parser = csv();

    parser.write(headers);
    parser.write(cell);
    parser.end();

    const [data] = await Array.fromAsync(parser);
    t.is(data.a, correct);
});

test('cell with multibyte character', async (t) => {
    const headers = Buffer.from('a\n');
    const cell = Buffer.from('this ʤ is multibyte\n');
    const correct = 'this ʤ is multibyte';
    const parser = csv();

    parser.write(headers);
    parser.write(cell);
    parser.end();

    const [data] = await Array.fromAsync(parser);
    t.is(data.a, correct, 'multibyte character is preserved');
});

test('geojson', async (t) => {
    const { error, lines } = await collectAsync('geojson');
    t.false(error, 'no err');
    const lineObject = {
        type: 'LineString',
        coordinates: [
            [102, 0],
            [103, 1],
            [104, 0],
            [105, 1],
        ],
    };
    t.deepEqual(JSON.parse(lines[1].geojson), lineObject, 'linestrings match');
});

test('empty columns', async (t) => {
    const { error, lines } = await collectAsync('empty-columns', ['a', 'b', 'c']);
    t.false(error, 'no err');
    /**
     * Check that empty cells remain present as strings.
     * @param {object} row - Parsed row to check.
     */
    function testLine(row) {
        t.is(Object.keys(row).length, 3, 'Split into three columns');
        t.truthy(/^2007-01-0\d$/.test(row.a), 'First column is a date');
        t.truthy(row.b !== undefined, 'Empty column is in line');
        t.is(row.b.length, 0, 'Empty column is empty');
        t.truthy(row.c !== undefined, 'Empty column is in line');
        t.is(row.c.length, 0, 'Empty column is empty');
    }
    for (const line of lines) testLine(line);
});

test('csv-spectrum', async (t) => {
    const data = await promisify(spectrum)();
    const rows = await Promise.all(
        data.map((d) => {
            const parser = csv();
            const collected = Array.fromAsync(parser);
            parser.end(d.csv);
            return collected;
        }),
    );
    for (const [index, d] of data.entries()) {
        const objs = rows[index];
        t.snapshot(objs, d.name);
    }
});

test('process all rows', async (t) => {
    const { error, lines } = await collectAsync('large-dataset', {});
    t.false(error, 'no err');
    t.is(lines.length, 7268, '7268 rows');
});

test('binary stanity', async (t) => {
    const binPath = fileURLToPath(new URL('../bin/csv-parser', import.meta.url));
    const { stdout } = await execa(process.execPath, [binPath], { input: 'a\n1\n' });

    t.snapshot(stdout);
});
