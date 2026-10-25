# @joern.berkefeld/csv-parser

Fork of [mafintosh/csv-parser](https://github.com/mafintosh/csv-parser), originally
created by Mathias Buus (mafintosh), with contributions and upstream maintenance
by Andrew Powell and the upstream community. This fork is maintained independently
by Jörn Berkefeld (<joern.berkefeld@gmail.com>); upstream maintainers are not
responsible for maintaining this fork.

Version 4.0.0 intentionally replaces upstream CommonJS with native ESM and raises
the Node.js requirement to `^22.22.2 || >=24.15.0`. Import the default parser
factory from `@joern.berkefeld/csv-parser`; there is no CommonJS distribution.
Version 4.0.1 corrects literal-quote handling and automatic CRLF detection across
stream chunks. A quote opens a quoted field only at the start of that field;
quotes inside an unquoted value remain literal data. Quoted delimiters, escaped
quotes and multiline quoted values remain supported. Automatic CRLF detection
also handles a chunk ending between `\r` and `\n` without adding a line feed to
the next value, including when input arrives one byte at a time.
The MIT license and original copyright are retained.

Streaming CSV parser that aims for maximum speed as well as compatibility with
the [csv-spectrum](https://npmjs.org/csv-spectrum) CSV acid test suite.

`csv-parser` can convert CSV into JSON at at rate of around 90,000 rows per
second. Performance varies with the data used; from a repository checkout, try
`node bin/bench <your file>` to benchmark your data.

[neat-csv](https://github.com/sindresorhus/neat-csv) can be used if a `Promise`
based interface to `csv-parser` is needed.

_Runtime: Node.js `^22.22.2 || >=24.15.0`. Native ESM exposes one default parser
factory; the `csv-parser` CLI name and TypeScript declarations are retained.
Use `npm ci --no-workspaces`, `npm run lint:fix --no-workspaces`,
`npm run lint --no-workspaces`, and `npm test --no-workspaces` in this repository._

Version 4.0.7 updates development test tooling to AVA 8 and migrates callback
checks and snapshot containers without changing their expected parser results.
Runtime dependencies remain at zero; parser behavior, the API, CLI and Node.js
requirement are unchanged.

Version 4.1.0 adds `validateFile` and opt-in `strictQuotes`, while preserving
the default factory API and permissive quote handling unless explicitly enabled.

## Benchmarks

From a repository checkout, `node bin/bench <filename>` streams the file through
an object-mode counting sink without retaining parsed rows. With no filename,
it discovers the checkout's CSV fixtures. The report keeps the filename, emitted
data-row count (excluding inferred headers), and elapsed milliseconds to two
significant digits. Timing includes reading, parsing and draining the pipeline;
it is not an isolated parser throughput measurement. Filesystem and parser
failures exit nonzero without printing a successful summary. Memory still depends
on stream buffering and record size, not just the benchmark's counter.

Fragmented records retain incoming slices and are assembled once at the record
boundary, instead of repeatedly copying the growing record prefix. Records wholly
inside an input chunk use that buffer directly. Run `node scripts/fragmented-bench.js`
from a checkout for synthetic long-record copy counts, sampled memory, short-row
throughput and a slow-consumer queue baseline. Timings are machine- and data-dependent,
not a general speed guarantee. Storage still depends on the current record, chunk,
stream queues and caller-retained raw buffers. At EOF, parser-owned final-record
and lookahead references are released on completion or failure without clearing or
reusing the backing storage of emitted raw values. Caller-retained raw buffers can
still keep that storage alive. Readable queue growth within a large input chunk
remains a separate limitation.

⚡️ `csv-parser` is greased-lightning fast

```console
→ npm run bench

  Filename                 Rows Parsed  Duration
  backtick.csv                       2     3.5ms
  bad-data.csv                       3    0.55ms
  basic.csv                          1    0.26ms
  comma-in-quote.csv                 1    0.29ms
  comment.csv                        2    0.40ms
  empty-columns.csv                  1    0.40ms
  escape-quotes.csv                  3    0.38ms
  geojson.csv                        3    0.46ms
  large-dataset.csv               7268      73ms
  newlines.csv                       3    0.35ms
  no-headers.csv                     3    0.26ms
  option-comment.csv                 2    0.24ms
  option-escape.csv                  3    0.25ms
  option-maxRowBytes.csv          4577      39ms
  option-newline.csv                 0    0.47ms
  option-quote-escape.csv            3    0.33ms
  option-quote-many.csv              3    0.38ms
  option-quote.csv                   2    0.22ms
  quotes+newlines.csv                3    0.20ms
  strict.csv                         3    0.22ms
  latin.csv                          2    0.38ms
  mac-newlines.csv                   2    0.28ms
  utf16-big.csv                      2    0.33ms
  utf16.csv                          2    0.26ms
  utf8.csv                           2    0.24ms
```

## Install

Using npm:

```console
$ npm install @joern.berkefeld/csv-parser
```

Using yarn:

```console
$ yarn add @joern.berkefeld/csv-parser
```

## Usage

To use the module, create a readable stream to a desired CSV file, instantiate
`csv`, and pipe the stream to `csv`.

Suppose you have a CSV file `data.csv` which contains the data:

```
NAME,AGE
Daffy Duck,24
Bugs Bunny,22
```

It could then be parsed, and results shown like so:

```js
import csv from '@joern.berkefeld/csv-parser';
import fs from 'node:fs';
const results = [];

fs.createReadStream('data.csv')
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => {
        console.log(results);
        // [
        //   { NAME: 'Daffy Duck', AGE: '24' },
        //   { NAME: 'Bugs Bunny', AGE: '22' }
        // ]
    });
```

To specify options for `csv`, pass an object argument to the function. For
example:

```js
csv({ separator: '\t' });
```

## API

### csv([options | headers])

Returns: `Array[Object]`

#### options

Type: `Object`

As an alternative to passing an `options` object, you may pass an `Array[String]`
which specifies the headers to use. For example:

```js
csv(['Name', 'Age']);
```

If you need to specify options _and_ headers, please use the the object notation
with the `headers` property as shown below.

#### bom

Type: `Boolean`<br>
Default: `false`

With `bom: true`, strip exactly one leading UTF-8 BOM (`EF BB BF`) before
parsing CSV or TSV, even when those bytes arrive in separate stream chunks.
This applies in raw mode too. The option is shared by the factory and
`validateFile`; pass the same settings to validation and a later import.
Caller-supplied header arrays are not changed. Non-leading BOMs, a second BOM
and incomplete or non-matching prefixes remain data.

`outputByteOffset` remains relative to the original input: offsets include the
three removed BOM bytes. The removed bytes do not count toward `maxRowBytes`.
Omitting `bom`, or setting it to `false`, preserves the existing parsing path
without automatic BOM removal.

#### escape

Type: `String`<br>
Default: `"`

A single-character string used to specify the character used to escape strings
in a CSV row.

#### headers

Type: `Array[String] | Boolean`

Specifies the headers to use. Headers define the property key for each value in
a CSV row. If no `headers` option is provided, `csv-parser` will use the first
line in a CSV file as the header specification.

If `false`, specifies that the first row in a data file does _not_ contain
headers, and instructs the parser to use the column index as the key for each column.
Using `headers: false` with the same `data.csv` example from above would yield:

```js
[
    { 0: 'Daffy Duck', 1: 24 },
    { 0: 'Bugs Bunny', 1: 22 },
];
```

_Note: If using the `headers` for an operation on a file which contains headers on the first line, specify `skipLines: 1` to skip over the row, or the headers row will appear as normal row data. Alternatively, use the `mapHeaders` option to manipulate existing headers in that scenario._

Duplicate retained header names are rejected by default instead of silently
replacing earlier column values. Explicit header arrays (including the factory's
array shorthand) throw an error when the parser is created. Inferred headers are
checked after `mapHeaders` and the existing header sanitization; a collision ends
the stream with an error before any data rows or `headers` event are emitted.
Empty-string names count as names, while removed (`null`) columns do not.
`headers: false` continues to use numeric column keys without this validation.
This is an intentional correction to duplicate-input behavior in the 4.0.3 patch;
it does not provide transaction or pre-clear protection for importing consumers.

Rows retain the ordinary `Object.prototype`. An explicit `__proto__` header is
stored as an own data property, including string, raw Buffer and object-valued
`mapValues` results; it does not replace the individual row's prototype.
Explicit `constructor` and `prototype` columns are retained too. Inferred headers
still remove `__proto__`, `constructor` and `prototype` after `mapHeaders`;
ordinary names such as `toString` and `hasOwnProperty` remain valid columns.

#### mapHeaders

Type: `Function`

A function that can be used to modify the values of each header. Return a `String` to modify the header. Return `null` to remove the header, and it's column, from the results.

```js
csv({
    mapHeaders: ({ header, index }) => header.toLowerCase(),
});
```

##### Parameters

**header** _String_ The current column header.<br/>
**index** _Number_ The current column index.

#### mapValues

Type: `Function`

A function that can be used to modify the content of each column. The return value will replace the current column content.

```js
csv({
    mapValues: ({ header, index, value }) => value.toLowerCase(),
});
```

##### Parameters

**header** _String_ The current column header.<br/>
**index** _Number_ The current column index.<br/>
**value** _String | Buffer_ The current column value (or content); a `Buffer` when `raw: true`.

##### newline

Type: `String`<br>
Default: `\n`

Specifies a single-character string to denote the end of a line in a CSV file.

#### quote

Type: `String`<br>
Default: `"`

Specifies a single-character string to denote a quoted string.

#### raw

Type: `Boolean`<br>

If `true`, data cells remain `Buffer` values instead of being decoded as UTF-8
strings, including empty cells. Inferred headers are still decoded as UTF-8
strings before `mapHeaders` and sanitization, so row keys and header callbacks
use the same names as in non-raw mode. Duplicate retained headers are rejected in
raw mode too. Explicit headers and `headers: false` keep their existing behavior.

#### separator

Type: `String`<br>
Default: `,`

Specifies a single-character string to use as the column separator for each row.

#### skipComments

Type: `Boolean | String`<br>
Default: `false`

Ignores non-standard comment records. Set `true` to skip records beginning with
`#`, or supply a string such as `'//'` to match that complete marker. Matching is
exact at the record start, without trimming whitespace, and supports Unicode
markers and markers split across stream chunks. An incomplete marker at EOF or
a prefix mismatch remains ordinary CSV data; an empty marker skips nothing.

Comments are recognized before CSV quote handling, so quotes and separators in
a comment cannot consume later records. Comment text ends at the physical record
ending, using the detected or configured newline. A marker inside quoted
multiline content remains data. Comments do not invoke mappings or count toward
`skipLines`; their bytes still count toward `maxRowBytes` and physical output
byte offsets. With `bom: true`, matching starts after the stripped leading BOM.

#### skipEmptyLines

Type: `Boolean`<br>
Default: `false`

Set `skipEmptyLines: true` in the parser or `validateFile` options to ignore empty
and whitespace-only records outside quoted fields. This happens before header
inference, mappings, strict column-count checks and `skipLines` counting; ignored
blanks do not consume the skip count. Whitespace follows JavaScript's definition
except that a BOM (`U+FEFF`) remains data unless removed by `bom: true`. Only one
leading BOM can be removed; interior and second BOMs remain data.

CSV syntax takes precedence over whitespace: delimiter-only records (including
TSV tabs), quoted empty or whitespace-only values, and multiline quoted blanks
remain data. The original record is checked before quoted cells are decoded,
including with `raw: true`. Physical byte offsets are unchanged, and ignored
records still count toward `maxRowBytes`. EOF does not create an extra record.
Omitting the option or setting `false` preserves existing blank-record behavior,
including strict width errors. The CLI exposes the same opt-in behavior through
`--skipEmptyLines`, for example `csv-parser input.csv --skipEmptyLines`.

```js
const options = { skipEmptyLines: true, strict: true };
const summary = await validateFile('data.csv', options);
const parser = csv(options);
```

#### skipLines

Type: `Number`<br>
Default: `0`

Specifies the number of CSV records at the beginning of a data file to discard
before inferring headers or producing data with explicit headers or `headers: false`.
Quoted multiline records count once; records ignored by `skipComments` or
`skipEmptyLines: true` do not count.
Discarded records do not invoke `mapValues`. The inferred header record still uses
`mapHeaders`, not `mapValues`. Record boundaries and `maxRowBytes` are enforced even
for discarded records, and output byte offsets remain relative to the original input.

#### maxRowBytes

Type: `Number`<br>
Default: `Number.MAX_SAFE_INTEGER`

Maximum number of bytes per row. An error is thrown if a line exeeds this value. The default value is on 8 peta byte.

#### strict

Type: `Boolean`<br>
Default: `false`

If `true`, instructs the parser that the number of columns in each row must match
the number of `headers` specified. A mismatch terminates the stream with one
`RangeError`, including for a final row without a newline. No later rows are
emitted or mapped, even when an `error` listener is attached. `pipeline()` and
async iteration reject; `validateFile()` rejects with that error as its cause.
Values in the failing row are mapped before its width is checked.
`headers: false` still disables this check.

if `false`: the headers are mapped to the column index
less columns: any missing column in the middle will result in a wrong property mapping!
more columns: additional columns create `"_" + index` properties, for example
`"_10": "value"`. If an actual output key collides with another column's key,
the stream terminates with `Duplicate row key: <key>` instead of overwriting a
value. For example, headers `['_1']` with input `a,b` fail because both cells
would use `_1`. The conflicting row is not emitted, and later records are not
mapped or emitted. This applies to explicit, inferred and mapped headers,
including final records without a newline. Removed (`null`) columns do not
reserve keys; `headers: false` keeps its numeric keys. All cells in the
conflicting record are still passed to `mapValues` before the collision check,
in the existing order.

#### strictQuotes

Type: `Boolean`<br>
Default: `false`

Reject unterminated quoted fields (including an unfinished custom escape at
quoted EOF) and characters after a closing quote other than the configured
separator or record ending. A properly closed final field needs no final
newline. Literal quotes inside unquoted fields remain data. This is a narrow
opt-in quote check, not a general RFC-compliance mode.

`strictQuotes` and `strict` are independent and default to `false` in both the
parser factory and `validateFile`. Use `{ strict: true, strictQuotes: true }` for
both column-count and quote checks. `headers: false` disables column-count
checking even with `strict: true`, but does not disable `strictQuotes`.

#### outputByteOffset

Type: `Boolean`<br>
Default: `false`

If `true`, instructs the parser to emit each row with a `byteOffset` property.
The byteOffset represents the offset in bytes of the beginning of the parsed row in the original stream.
Will change the output format of stream to be `{ byteOffset, row }`.

### validateFile(path, optionsOrHeaders?)

Named ESM export, alongside the unchanged default parser factory. Accepts a
**string filesystem path** and the same parser options or readonly header-array
shorthand as the factory. Returns a `Promise<{ headers, recordCount }>` after
reading the whole file successfully, or rejects on the first failure.

- `headers` is a copied `(string | null)[]` of effective inferred names (after
  `mapHeaders` and sanitization, retaining `null` removed-column positions), a
  copy of explicit headers, `false` for positional `headers: false`, or `null`
  when no header was inferred. `mapHeaders` only runs for inferred headers;
  explicit headers are not remapped.
- `recordCount` counts emitted **data records**, excluding inferred headers,
  skipped records and comments. `outputByteOffset` does not change the count.
  Empty files succeed with zero records and `headers: null` by default, or the
  supplied explicit headers / `false` in those modes. Header-only files succeed
  with inferred headers and zero records. Callers decide whether zero is allowed.
- All parser settings apply, including TSV `separator: '\t'`, quote/escape,
  newline, skips, `raw`, `bom`, `maxRowBytes`, mappings and byte-offset output.
  Strictness and leading UTF-8 BOM removal are opt-in (`strict` /
  `strictQuotes` and `bom: true`); there is no automatic nonempty-file policy.
  Duplicate retained headers are rejected by the same parser rules.
- Mappings execute during validation exactly as during parsing. They execute
  **again** on a later import; equivalent results assume deterministic callbacks.
  Options and header arrays are copied, not modified in place.
- Rejections are readable `Error` objects whose message includes the supplied
  path and reason. `cause` retains the underlying error, and filesystem `code`
  is retained when available (for example `ENOENT`). Mapping exceptions also
  reject the promise; non-Error throws are wrapped. Errors do not invent physical
  line or record numbers.

The helper streams through the **same parser**, draining and counting rows
without retaining them, caching a verdict or making a second scanner. Memory is
bounded by stream buffering and the current record, not total record count;
choose `maxRowBytes` to constrain exceptionally large records. It does not copy
or snapshot the input, check file identity, or guarantee unchanged source bytes
between validation and import. It is not a transaction, rollback mechanism or
guarantee that a later read or remote upload will succeed.

For a consumer that requires nonempty input, validate **before** destructive
CLEAR or upload operations, then import with the **same** options. This general
pattern does not add preflight safety to Data Loader; its adoption is deferred.
The caller-supplied operations below stand for application-specific effects:

```js
import csv, { validateFile } from '@joern.berkefeld/csv-parser';
import { createReadStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function importValidatedFile(path, clearDestination, uploadRow) {
    const options = { strict: true, strictQuotes: true };
    const { recordCount } = await validateFile(path, options);
    if (recordCount === 0) throw new Error('No data records to import');

    // Validation finished before either destructive or upload operation.
    await clearDestination();
    await pipeline(
        createReadStream(path),
        csv(options),
        new Writable({
            objectMode: true,
            write(row, encoding, callback) {
                Promise.resolve()
                    .then(() => uploadRow(row))
                    .then(() => callback(), callback);
            },
        }),
    );
}
```

For multiple files or targets, validate **all** selected inputs before the first
CLEAR or upload anywhere in the job. The example assumes the source remains
unchanged between passes; failures after CLEAR can still leave partial effects.

## Events

The following events are emitted during parsing:

### `data`

Emitted for each row of data parsed with the notable exception of the header
row. Please see [Usage](#Usage) for an example.

### `headers`

Emitted after the header row is parsed. The first parameter of the event
callback is an `Array[String]` containing the header names.

```js
fs.createReadStream('data.csv')
    .pipe(csv())
    .on('headers', (headers) => {
        console.log(`First header: ${headers[0]}`);
    });
```

### Readable Stream Events

Events available on Node built-in
[Readable Streams](https://nodejs.org/api/stream.html#stream_class_stream_readable)
are also emitted. The `end` event should be used to detect the end of parsing.

## CLI

This module also provides a CLI which will convert CSV to
[newline-delimited](http://ndjson.org/) JSON. The following CLI flags can be
used to control how input is parsed. Stream failures print a concise message to
stderr and exit with status 1; already-written NDJSON is not rolled back:

```
Usage: csv-parser [filename?] [options]

  --escape,-e         Set the escape character (defaults to quote value)
  --headers,-h        Explicitly specify csv headers as a comma separated list
  --help              Show this help
  --output,-o         Set output file. Defaults to stdout
  --quote,-q          Set the quote character ('"' by default)
  --remove            Remove inferred columns by comma-separated header names
  --separator,-s      Set the separator character ("," by default)
  --skipComments,-c   Skip '#' comments; a following value sets a custom marker
  --skipComments=...  Set a custom comment marker without consuming a filename
  --skipEmptyLines    Skip empty and whitespace-only unquoted records
  --skipLines,-l      Set the number of lines to skip to before parsing headers
  --strict            Require column length match headers length
  --version,-v        Print out the installed version
```

Comment flags preserve space-separated custom markers. A bare flag uses `#`
only when there is no following value, so put a filename **before** the bare flag:

```sh
csv-parser input.csv --skipComments        # Bare '#' comments, filename first
csv-parser input.csv -c                    # Bare short alias, filename first
csv-parser --skipComments '//' input.csv    # Custom marker before filename
csv-parser input.csv -c '//'               # Custom marker after filename
csv-parser --skipComments=// input.csv      # Unambiguous custom marker
cat input.csv | csv-parser --skipComments   # Bare '#' comments from stdin
cat input.csv | csv-parser -c '//'          # Custom marker from stdin
```

**Ordering matters:** `csv-parser --skipComments input.csv` consumes `input.csv`
as a custom marker and reads stdin; it does not open that file. Use
`csv-parser input.csv --skipComments` for a bare flag with file input. A custom
marker may contain multiple characters; `--skipComments=<marker>` also supports
markers starting with `-` without ambiguity. Other CLI argument syntax is unchanged.

Use `csv-parser input.csv --strict` (or `csv-parser --strict input.csv`) to
reject rows whose column count differs from the headers. For stdin, use
`cat input.csv | csv-parser --strict`. Strict width checking remains off unless
requested; a mismatch exits with status 1.

Remove inferred columns by passing comma-separated header names, for example
`csv-parser input.csv --remove private,internal`. Other columns keep their original
names and values; unknown names are ignored. As with the parser API, explicit
`--headers` bypasses header mapping, so `--remove` applies only to inferred headers.

Choose a custom quote character with `--quote` or `-q`, for example
`csv-parser input.csv --quote "'"` for apostrophe-quoted fields. The escape character
defaults to that quote character. Override it with `--escape` or `-e`, for example
`csv-parser input.csv --quote "'" --escape "!"` for `!'` escapes.

For example; to parse a TSV file:

```
cat data.tsv | csv-parser -s $'\t'
```

## Encoding

Users may encounter issues with the encoding of a CSV file. Transcoding the
source stream can be done neatly with a modules such as:

- [`iconv-lite`](https://www.npmjs.com/package/iconv-lite)
- [`iconv`](https://www.npmjs.com/package/iconv)

Or native [`iconv`](http://man7.org/linux/man-pages/man1/iconv.1.html) if part
of a pipeline.

## Byte Order Marks

A leading UTF-8 [Byte Order Mark](https://en.wikipedia.org/wiki/Byte_order_mark#UTF-8)
can otherwise become part of a header or first value. Enable [`bom`](#bom) to
remove exactly that leading marker without an extra transform:

```js
import csv, { validateFile } from '@joern.berkefeld/csv-parser';
import { createReadStream } from 'node:fs';

const options = { bom: true };
await validateFile('data.csv', options);
const parser = createReadStream('data.csv').pipe(csv(options));
for await (const row of parser) {
    console.log(row);
}
```

The default is still `bom: false`: neither parsing nor validation removes a BOM
unless requested. Only one marker at the start of the stream is removed, even
when split across chunks; BOM bytes later in the file are preserved. This is
not transcoding or detection of UTF-16/UTF-32 encodings.

The CLI has no `--bom` flag. If using an external leading-BOM transform with
the default parser or CLI, that transform changes the input stream, so parser
byte offsets no longer include bytes removed upstream.

## Meta

[CONTRIBUTING](./.github/CONTRIBUTING)

[LICENSE (MIT)](./LICENSE)
