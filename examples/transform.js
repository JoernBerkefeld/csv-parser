import write from 'csv-write-stream';
import { Transform } from 'node:stream';
import parse from '../index.js';
import fs from 'node:fs';

// Read a file, transform it and send it
// to stdout. Optionally could also write
// to a file instead of stdout with:
// .pipe(fs.createWriteStream('./file'))
fs.createReadStream(new URL('../test/data/dummy.csv', import.meta.url))
    .pipe(parse())
    .pipe(new Transform({ objectMode: true, transform }))
    .pipe(write())
    .pipe(process.stdout);

// Prepend all chunks with `value: `.
// @param {Object} chunk
// @param {String} encoding
// @param {(error?: Error, row?: object) => void} callback
/**
 * Prefix each cell before passing the row downstream.
 * @param {object} chunk - Parsed row.
 * @param {string} enc - Stream encoding.
 * @param {(error?: Error, row?: object) => void} callback - Transform completion callback.
 */
function transform(chunk, enc, callback) {
    for (const key of Object.keys(chunk)) {
        chunk[key] = `value: ${chunk[key]}`;
    }
    callback(undefined, chunk);
}
