# Changelog

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
