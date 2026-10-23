# Changelog

## [4.0.7] — 2026-10-23

### Development dependencies

- Upgrade AVA from 3.15.0 to 8.1.1, migrate callback-based tests to awaited
  checks, and update the coverage runner for AVA's current CLI entry point.
- Convert snapshot containers to the current format while preserving all saved
  expected values. Parser behavior, the native ESM API, CLI, declarations and
  Node.js requirement are unchanged; runtime dependencies remain at zero.
- Fresh audits against the same npm registry before and after the tooling
  upgrade report development findings decreasing from five moderate findings
  to zero. Production findings remain at zero. This comparison reflects the
  advisories returned during that audit window, not historical audit totals
  or a guarantee against future advisories.

## [4.0.6] — 2026-10-23

### Fixed

- Discard `skipLines` records before invoking `mapValues`, so explicit-header and
  headerless numeric mappings no longer process skipped header or preamble text.
  Comment counting, inferred headers, quoted multiline record boundaries, record
  size limits and original-input byte offsets are unchanged.

## [4.0.5] — 2026-10-23

### Fixed

- Preserve explicit `__proto__` columns as own data properties without replacing
  individual row prototypes when raw Buffer cells or object-valued `mapValues`
  results are used. String values are retained as well. Rows keep their ordinary
  `Object.prototype`; inferred dangerous-header removal and duplicate rejection
  are unchanged. This corrects row-local prototype mutation, not global
  `Object.prototype` pollution.

## [4.0.4] — 2026-10-23

### Fixed

- Decode inferred headers as UTF-8 strings in raw mode before header mapping and
  sanitization, restoring named row properties while preserving Buffer-valued
  data cells, including Unicode and empty values. Header callbacks receive
  strings; duplicate rejection and dangerous inferred-header removal still
  apply. Explicit headers and `headers: false` are unchanged.

## [4.0.3] — 2026-10-23

### Fixed

- Reject duplicate retained headers by default rather than silently overwriting
  an earlier column. Explicit arrays fail when the parser is created; inferred
  headers fail through the stream after mapping and existing sanitization, before
  any data rows are emitted. Empty names participate in duplicate detection;
  removed columns and `headers: false` retain their existing behavior.
- This is an intentional patch behavior correction for duplicate input, not a
  rename, array-value or last-wins mode. Valid CSV/TSV values and streaming remain
  unchanged. It does not add import transaction or pre-clear safety to consumers.

## [4.0.2] — 2026-10-23

### Development dependencies

- Replace test-only `bops` with native `Buffer.from`, benchmark timing via
  `time-span` with `performance.now()`, and `loud-rejection` with Node.js default
  unhandled-rejection behavior. Direct development dependencies decrease from
  24 to 21; runtime dependencies remain at zero.
- Update eight compatible transitive development dependencies:
  `brace-expansion`, `fast-glob`, `http-cache-semantics`, `js-yaml`, `lodash`,
  `minimatch`, `picomatch` and `semver`. The measured development audit decreases
  from 19 findings (4 moderate, 15 high) to 12 (4 moderate, 8 high); the production
  audit reports zero findings. Remaining development findings are not resolved
  by this maintenance work.

Parser behavior, the native ESM API, CLI, declarations and Node.js requirement
are unchanged. This release contains development-dependency maintenance, not
additional parser fixes.

## [4.0.1] — 2026-10-23

### Fixed

- Resolved literal quotes inside unquoted CSV/TSV fields in this fork. Quotes now
  open quoted content only at field start, so interior literal quotes no longer
  swallow separators or following records. This addresses the quote-handling
  problem reported in original upstream [issue 236](https://github.com/mafintosh/csv-parser/issues/236),
  which describes tab-delimited data ending prematurely when a value contains a
  literal quote. Valid quoted delimiters, escaped quotes and multiline values
  remain supported. The correction is independently implemented and covered by
  synthetic regressions; it does not claim the original upstream issue is closed.
- Resolved automatic CRLF detection across stream chunks in this fork, including
  a split between CR and LF in the header. One-byte input no longer inserts a
  leading LF into subsequent values. Final records without a newline and
  inherited EOF behavior remain covered. This defect was reproduced with our own
  synthetic inputs; no matching original upstream ticket was found in the local
  evidence, so no original-ticket link is claimed for this correction.

The native ESM API, CLI name, TypeScript declarations and Node.js requirement
`^22.22.2 || >=24.15.0` are unchanged from 4.0.0. Original MIT attribution is
retained. This parser release does not change Data Loader consumers.
