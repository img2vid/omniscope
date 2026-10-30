# A-prefixed extension support

Omniscope distinguishes **known file formats** from **filename aliases**.

- Its authored registry contains hundreds of existing `a*` suffixes such as `.aac`, `.aiff`, `.apk`, `.ar`, `.arj`, `.ass` and `.azw3`. These continue to use their existing specialized viewers, wherever implemented.
- It now recognizes **10,064 additional numeric A-prefixed filename aliases**, `.a0000` to `.a10063`. This is filename-pattern coverage, **not** 10,064 real and distinct codecs or a claim that those suffixes are standardized file extensions.
- For these aliases, content signatures, ZIP/CFB container detection and text sniffing take priority. If bytes cannot be identified, Omniscope opens a native hexadecimal forensic view and labels the identification as an **unclassified filename pattern**, not a known format.
- A genuinely new native `.arff` (Weka Attribute-Relation File Format) viewer parses relation names, typed attributes, comma-quoted dense data and sparse data to a read-only table. Its preview limits are 6 MiB input, 5,000 parsed rows and 250 displayed rows. It is not a complete ARFF validation engine.

Pattern aliases are listed separately from authored format identities in registry statistics. The application never implies that a filename alone proves its payload type. Do not use these aliases as a substitute for adding real format decoders.

Run relevant regression tests using `bun test tests/a-extension-support.test.ts`.
