import type { RawFormat } from "@/lib/types";

/**
 * PROGRAMMATIC FORMAT FAMILIES
 * Real numbered/multi-part extension conventions generated in loops.
 */
export function generateFamilyFormats(): RawFormat[] {
  const out: RawFormat[] = [];

  // Split volumes & numbered segments (7-Zip split, HJSplit, generic backups) — .000 … .999
  for (let i = 0; i <= 999; i++) {
    const ext = String(i).padStart(3, "0");
    out.push({
      ext: [ext],
      name: `Numbered file segment ${ext}`,
      cat: "archive",
      viewer: "archive",
      mime: "application/octet-stream",
      desc: "Split-volume / numbered segment (7-Zip split, HJSplit, logrotate-style numbering). Inner content is re-detected from bytes.",
    });
  }

  // Legacy multi-volume RAR — .r00 … .r99
  for (let i = 0; i <= 99; i++) {
    const ext = "r" + String(i).padStart(2, "0");
    out.push({
      ext: [ext],
      name: `RAR multi-volume part ${ext}`,
      cat: "archive",
      viewer: "archive",
      mime: "application/vnd.rar",
      desc: "Legacy RAR split-naming (part of a .rar sequence).",
    });
  }

  // Legacy PKZIP multi-volume — .z00 … .z99
  for (let i = 0; i <= 99; i++) {
    const ext = "z" + String(i).padStart(2, "0");
    out.push({
      ext: [ext],
      name: `PKZIP multi-volume part ${ext}`,
      cat: "archive",
      viewer: "archive",
      mime: "application/zip",
      desc: "Legacy PKZIP split-naming (part of a .zip sequence).",
    });
  }

  // ARJ multi-volume — .a01 … .a99
  for (let i = 1; i <= 99; i++) {
    const ext = "a" + String(i).padStart(2, "0");
    out.push({
      ext: [ext],
      name: `ARJ multi-volume part ${ext}`,
      cat: "archive",
      viewer: "archive",
      mime: "application/x-arj",
      desc: "ARJ split archive part.",
    });
  }

  // Vim swap file cascade — .swa … .swz (vim allocates .swp first, then walks backwards)
  for (let c = 0x61; c <= 0x7a; c++) {
    const ext = "sw" + String.fromCharCode(c);
    if (ext === "swp") continue; // present in the authored database
    out.push({
      ext: [ext],
      name: `Vim swap file variant .${ext}`,
      cat: "other",
      viewer: "fallback",
      mime: "application/octet-stream",
      desc: "Alternate vim swap file (used when .swp already exists).",
    });
  }

  // RetroArch / libretro save states — .state1 … .state9 plus .state.auto
  for (let i = 1; i <= 9; i++) {
    out.push({
      ext: [`state${i}`],
      name: `libretro save state slot ${i}`,
      cat: "game",
      viewer: "fallback",
      mime: "application/octet-stream",
      desc: "RetroArch quick-save slot.",
    });
  }
  out.push({
    ext: ["state.auto"],
    name: "libretro auto save state",
    cat: "game",
    viewer: "fallback",
    mime: "application/octet-stream",
    desc: "RetroArch periodic auto-save (detected via compound name).",
  });

  // Unix manual page sections — .1 … .9 plus common lettered sections
  const manSections: [string, string][] = [
    ["1", "User commands"], ["2", "System calls"], ["3", "Library functions"], ["4", "Special files"],
    ["5", "File formats"], ["6", "Games"], ["7", "Miscellaneous"], ["8", "Admin commands"], ["9", "Kernel docs"],
    ["1x", "X11 user commands"], ["3x", "X11 library calls"], ["3p", "POSIX programmer's manual"],
    ["3pm", "Perl modules"], ["3posix", "POSIX library calls"], ["3perl", "Perl library calls"],
    ["3am", "GNU awk extensions"], ["3form", "ncurses forms"], ["3menu", "ncurses menus"],
    ["3ncurses", "ncurses library"], ["3tiff", "libtiff functions"], ["3bluetooth", "Bluetooth library"],
    ["3curl", "libcurl functions"], ["3readline", "GNU readline"], ["3ssl", "OpenSSL functions"],
    ["3m", "Mathematical library"], ["3n", "Networking library"], ["3s", "Standard I/O"],
    ["3f", "Fortran library"], ["3v", "System V library"], ["8l", "lpr daemon"],
  ];
  for (const [sec, desc] of manSections) {
    out.push({
      ext: [sec],
      name: `Unix manual page (section ${sec})`,
      cat: "text",
      viewer: "code",
      mime: "text/troff",
      desc: `roff manual page — ${desc}.`,
    });
  }

  // Compound compressed tarballs — real double-extension conventions
  const tarComps: [string, string][] = [
    ["gz", "gzip"], ["bz2", "bzip2"], ["xz", "xz"], ["zst", "zstandard"], ["lz", "lzip"],
    ["lz4", "lz4"], ["lzo", "lzop"], ["br", "brotli"], ["lzma", "lzma"], ["Z", "compress (LZW)"],
    ["sz", "snappy"],
  ];
  for (const [suffix, codec] of tarComps) {
    out.push({
      ext: [`tar.${suffix}`],
      name: `Tarball (${codec}-compressed)`,
      cat: "archive",
      viewer: "archive",
      mime: "application/x-tar",
      sig: suffix === "gz" || suffix === "Z" ? "1F 8B 08" : undefined,
      desc: `TAR archive compressed with ${codec}.`,
    });
  }

  // Rotated log / numbered backup segments (.10 … .99) — logrotate-style convention
  for (let i = 10; i <= 99; i++) {
    out.push({
      ext: [String(i)],
      name: `Rotated log / backup segment ${i}`,
      cat: "text",
      viewer: "text",
      mime: "text/plain",
      desc: "Numbered rotated log or backup segment (logrotate-style numbering).",
    });
  }

  // Blender auto-save backups (.blend2 … .blend9) — Blender numbered backups
  for (let i = 2; i <= 9; i++) {
    out.push({
      ext: [`blend${i}`],
      name: `Blender backup revision ${i}`,
      cat: "3d",
      viewer: "fallback",
      mime: "application/x-blender",
      desc: "Automatic .blend backup revision.",
    });
  }

  // Compressed compound formats — real archive-convention pairings
  const compressible: [string, string, string, string][] = [
    ["log", "Rotated compressed log", "text", "text"],
    ["txt", "Compressed text", "text", "text"],
    ["csv", "Compressed CSV", "data", "csv"],
    ["tsv", "Compressed TSV", "data", "csv"],
    ["json", "Compressed JSON", "data", "json"],
    ["xml", "Compressed XML", "data", "xml"],
    ["md", "Compressed Markdown", "document", "markdown"],
    ["yaml", "Compressed YAML", "config", "code"],
    ["vcf", "bgzip-compressed VCF (genomics)", "scientific", "text"],
    ["bed", "Compressed BED intervals", "scientific", "text"],
    ["sam", "Compressed SAM alignments", "scientific", "text"],
    ["fastq", "Compressed FASTQ reads", "scientific", "text"],
    ["fasta", "Compressed FASTA sequences", "scientific", "text"],
    ["gff", "Compressed GFF annotation", "scientific", "text"],
    ["gtf", "Compressed GTF annotation", "scientific", "text"],
    ["gpx", "Compressed GPS track", "geo", "map"],
    ["html", "Compressed HTML page", "document", "code"],
    ["css", "Compressed stylesheet", "code", "code"],
    ["js", "Compressed script", "code", "code"],
    ["sql", "Compressed SQL dump", "database", "code"],
    ["ntriples", "Compressed N-Triples", "data", "text"],
    ["turtle", "Compressed Turtle RDF", "data", "text"],
    ["hdr", "Compressed EEG header", "scientific", "text"],
    ["pgp", "Compressed PGP data", "system", "fallback"],
    ["asc", "Compressed ASCII armor", "system", "text"],
  ];
  const codecs: [string, string, string][] = [
    ["gz", "gzip", "1F 8B 08"],
    ["bz2", "bzip2", "42 5A 68"],
    ["xz", "xz", "FD 37 7A 58 5A 00"],
    ["zst", "zstandard", "28 B5 2F FD"],
  ];
  for (const [base, label, cat, viewer] of compressible) {
    for (const [suffix, codecName, magic] of codecs) {
      out.push({
        ext: [`${base}.${suffix}`],
        name: `${label} (${codecName})`,
        cat: cat as RawFormat["cat"],
        viewer: viewer as RawFormat["viewer"],
        sig: magic,
        desc: `.${base} payload inside a ${codecName} stream — decompressed and parsed.`,
      });
    }
  }

  return out;
}
