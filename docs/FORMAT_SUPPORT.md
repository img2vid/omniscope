# File-reading coverage

The requested **over 30,000 additional, genuinely existing extensions is not met**.
This change adds **1,262 distinct documented suffixes** relative to upstream
`cb12ecca3379b43356ca6efaf8d66ce0c4058a0b`, after case normalization:

| Addition | Count | What is provided |
| --- | ---: | --- |
| Text-reader routes | 833 | Decode and display source text; JSON/XML aliases use their structured viewers |
| Routes to existing binary readers | 8 | Existing executable, ZIP, and MPEG-audio viewers; valid compatible payloads are required |
| Inspection only | 421 | Identify the extension and inspect its bytes; no format-specific decoder is claimed |
| Total new suffixes | 1,262 | Not 1,262 independently implemented parsers |

The resulting registry contains **7,150 unique suffixes**, plus **421 exact
basenames**, including `Makefile`, `.gitignore`, and application configuration
filenames. Basenames, MIME identities, encodings, signatures, duplicate aliases,
and generated filename combinations are not counted as new extensions.

The original registry stored 5,891 case-sensitive suffix keys. Its normalized
baseline is 5,888; normalization makes several previously unreachable aliases
discoverable. The regression fixture protects every previously reachable
extension's name, MIME identity, and default reader.

## Evidence and reproduction

- [Machine-readable coverage and every addition](format-coverage.json)
- [Pinned source repositories, commits, blob IDs, and licenses](../data/format-sources/sources.json)
- [Normalized source snapshots](../data/format-sources/)
- [Snapshot SHA-256 checksums](../data/format-sources/snapshot-hashes.json)
- [Upstream license notices](../third_party/)

GitHub Linguist supplies 710 genuinely new text suffixes. MIME-db supplies
another 115 text suffixes, 3 MPEG-audio aliases, and 403 inspection-only suffixes.
Registering the previously disconnected `extra-formats-l.ts` table supplies the
remaining 31 extensions. No synthesized numeric families or Cartesian products
were added to reach a numeric target.

The snapshots retain the source extension spellings before normalization. The
Linguist snapshot includes only `name`, `type`, `extensions`, and `filenames`;
the MIME-db snapshot includes MIME keys and their `extensions`. Source data is
MIT licensed. Runtime reading is local and does not download these catalogs.

Use Node.js 22.15+ (Node 24 recommended):

```sh
npm run test:formats
npm run formats:report
npm run formats:generate
```

The focused suite needs no installed application dependencies. It audits source
membership and checksums, all newly sourced text routes, every legacy mapping,
compound suffixes, Unicode decoding, binary rejection, content signatures,
filename matching, and bounded file previews. `formats:generate` regenerates
the runtime table from committed snapshots. Regenerate the coverage report with
`node --import ./tests/register-typescript.mjs scripts/report-format-coverage.mjs --write`
after intentional source changes.

## Reader behavior and limits

Existing extension mappings retain priority. New source aliases cannot replace
an existing reader. Longest documented suffix matching supports punctuation and
multiple segments; exact basenames are matched separately and case sensitively.
Binary signatures continue to take priority over either form of filename match.

New text-only aliases validate their bytes before selecting a text parser.
UTF-8, UTF-16LE, and UTF-16BE detection handles Japanese, Indian-language text,
and emoji. Invalid Unicode or binary bytes use the hex view instead. Unknown or
inspection-only extensions with recognizable Unicode text can still open in
the content-selected text, JSON, XML, or delimited-data reader. This does not
constitute a decoder for a proprietary binary format.

Text/source reading preserves the text; it does not compile or semantically
interpret every programming language. JSON-with-comments and other non-strict
syntaxes in Linguist use the source reader. Browser audio decoding remains
dependent on browser codec support. UTF-32 is not automatically decoded.

The source reader reads at most 4 MiB, including when the application has only
loaded a large file's 64 KiB detection head, and labels a truncated preview.
JSON and XML viewers now decode UTF-16 consistently with the detector.

The format explorer displays winning aliases once, shows exact filenames
separately, and labels sourced inspection entries **Bytes only**. Advertised
charset entries are limited to labels accepted by the runtime `TextDecoder`.
