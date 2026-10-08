# Exclusion CSV

Project managers can import and export exclusion rules from **Translations → Import & export**. The UTF-8 CSV header is `type,value`. Each row uses one of `URL`, `REGEX`, `CSS_CLASS`, or `CSS_ID`.

```csv
type,value
URL,/checkout/*
REGEX,^/en/(cart|checkout)
CSS_CLASS,.no-translate
CSS_ID,#hero
```

An import accepts at most 100 rows and 128 KiB. Preview reports new rules, existing rules, and row conflicts without writing anything. Import is atomic: a file with an invalid or duplicate rule writes no rows. Reimporting the same file skips the existing rules. No rule is removed or changed by CSV import. The export includes all rules; split an export larger than the import limit before reimporting it. It uses the same two columns and protects spreadsheet formula prefixes while preserving a lossless Deepglot import roundtrip within the import limit.

`URL` values follow the WordPress runtime contract: a value can match a URL or path substring, and `*` is a wildcard. `REGEX` values are PCRE pattern bodies, used against the URL/path candidates in the WordPress runtime. URL patterns are checked before regex patterns; either match excludes the route. `CSS_CLASS` and `CSS_ID` values name one literal class or ID token, optionally prefixed by `.` or `#`. They exclude text and supported attributes inside the matching element. The runtime compares literal class and ID names, so Unicode names and punctuation within one token are supported; whitespace and control characters are not.

The CSV importer does not compile or execute regular expressions. It checks their type, nonempty value, length, and control characters. WordPress remains the authority for PCRE syntax and matching at runtime; malformed patterns are ignored there.

The new exclusion CSV labels and API errors have German and English copy. Other dashboard locales currently use the English copy for this feature until translated catalogue entries are available.
