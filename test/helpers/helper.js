import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import csv from '../../index.js';

const read = fs.createReadStream;

/**
 * Resolve an inherited fixture relative to this module.
 * @param {string} name - Fixture filename.
 * @returns {string} Absolute fixture path.
 */
function fixture(name) {
    return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/**
 * Collect a fixture with the inherited callback test contract.
 * @param {string} file - Fixture basename without extension.
 * @param {object|Array|((error: Error|false, rows: object[]) => void)} options - Parser options or completion callback.
 * @param {(error: Error|false, rows: object[]) => void} [callback] - Receives an error or false, then parsed rows.
 * @returns {import('node:stream').Transform} Parser stream.
 */
function collect(file, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }
    const data = read(fixture(`${file}.csv`));
    const lines = [];
    const parser = csv(options);
    data.pipe(parser)
        .on('data', (line) => {
            lines.push(line);
        })
        .on('error', (error) => {
            callback(error, lines);
        })
        .on('end', () => {
            callback(false, lines);
        });
    return parser;
}

export { collect, fixture };
