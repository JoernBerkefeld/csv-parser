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
 * Collect fixture rows while distinguishing source and parser failures.
 * @param {string} file - Fixture basename without extension.
 * @param {object|Array} options - Parser options.
 * @param {(error: Error|false, rows: object[]) => void} callback - Parser completion callback.
 * @param {(error: Error, rows: object[]) => void} sourceError - Source failure callback.
 * @returns {import('node:stream').Transform} Parser stream.
 */
function collectFixture(file, options, callback, sourceError) {
    const data = read(fixture(`${file}.csv`));
    const lines = [];
    const parser = csv(options);
    data.on('error', (error) => {
        parser.destroy();
        sourceError(error, lines);
    });
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
    return collectFixture(file, options, callback, callback);
}

/**
 * Await fixture completion, retaining partial rows on parser failure.
 * @param {string} file - Fixture basename without extension.
 * @param {object|Array} [options] - Parser options.
 * @returns {Promise<{error: Error|false, lines: object[]}>} Parser result; source failures reject.
 */
function collectAsync(file, options) {
    return new Promise((resolve, reject) => {
        collectFixture(file, options, (error, lines) => resolve({ error, lines }), reject);
    });
}

export { collect, collectAsync, fixture };
