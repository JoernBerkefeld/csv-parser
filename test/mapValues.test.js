import test from 'ava';

import { collect } from './helpers/helper.js';

test.cb('map values', (t) => {
    const headers = [];
    const indexes = [];
    const mapValues = ({ header, index, value }) => {
        headers.push(header);
        indexes.push(index);
        return Math.trunc(Number(value));
    };

    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.snapshot(lines[0], 'first row');
        t.is(lines.length, 1, '1 row');
        t.snapshot(headers, 'headers');
        t.snapshot(indexes, 'indexes');
        t.end();
    };

    collect('basic', { mapValues }, verify);
});

const mapEmptyValue = ({ value }) => {
    // eslint-disable-next-line unicorn/no-null -- Preserve the existing regression that explicitly maps empty strings to null.
    return value === '' ? null : value;
};

test.cb('map last empty value', (t) => {
    const mapValues = mapEmptyValue;

    const verify = (error, lines) => {
        t.false(error, 'no err');
        t.is(lines.length, 2, '2 rows');
        // eslint-disable-next-line unicorn/no-null -- Assert the callback's intentional null result, not undefined.
        t.is(lines[0].name, null, 'name is mapped');
        // eslint-disable-next-line unicorn/no-null -- Assert the callback's intentional null result, not undefined.
        t.is(lines[0].location, null, 'last value mapped');
        t.end();
    };

    collect('empty-columns', { mapValues, headers: ['date', 'name', 'location'] }, verify);
});
