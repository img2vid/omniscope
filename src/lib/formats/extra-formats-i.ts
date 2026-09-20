import type { RawFormat } from "@/lib/types";

/** AUTHORED EXPANSION I — calculators, IDE projects, LaTeX artifacts, consoles, embroidery, FPGA, printers. */
export const EXTRA_FORMATS_I: RawFormat[] = [
  // ---------------- TI / Casio calculators ----------------
  { ext: ["83p", "8xl", "8ca", "8cu", "8xi", "8xv", "8xu", "8xc", "8ci", "8cm", "8eu"], name: "TI Calculator Variable", cat: "other", viewer: "fallback", desc: "TI-83/84/89/92 variable & OS payloads." },
  { ext: ["9xi", "9xe", "89y", "89k", "89z", "89a", "89c", "v2y", "v2z", "v2f"], name: "TI-89/92/V200 Variable", cat: "other", viewer: "fallback" },
  { ext: ["g1a", "g1m", "g1r", "g1e", "g3a", "g3e", "g3m", "g3r"], name: "Casio Calculator File", cat: "other", viewer: "fallback", desc: "Prizm/fx add-ins, memory & eActivities." },
  { ext: ["fxi"], name: "Casio Data Transfer", cat: "other", viewer: "fallback" },
  { ext: ["hp"], name: "HP Calculator Object", cat: "other", viewer: "fallback" },

  // ---------------- Visual Studio / MSBuild ----------------
  { ext: ["slnx"], name: "Visual Studio Solution", cat: "code", viewer: "text" },
  { ext: ["vcxproj.filters", "wixproj", "fsproj", "eproj"], name: "MSBuild Project File", cat: "code", viewer: "xml" },
  { ext: ["positions"], name: "Visual Studio Build Artifact", cat: "system", viewer: "fallback" },

  // ---------------- LaTeX build artifacts ----------------
  { ext: ["fls", "fdb_latexmk", "synctex.gz", "synctex", "nav", "snm", "vrb", "run.xml"], name: "LaTeX Build File", cat: "text", viewer: "text" },
  { ext: ["gls", "acn", "alg", "bgt", "lol"], name: "LaTeX Index/Glossary", cat: "text", viewer: "text" },

  // ---------------- R / stats profiles ----------------

  // ---------------- consoles / ROMs ----------------
  { ext: ["p3t"], name: "PlayStation Theme", cat: "game", viewer: "archive" },
  { ext: ["neo"], name: "Neo Geo MVS ROM", cat: "game", viewer: "fallback" },
  { ext: ["x68"], name: "X68000 Floppy Image", cat: "disk", viewer: "fallback" },
  { ext: ["fe", "fg"], name: "Family BASIC Data", cat: "game", viewer: "fallback" },

  // ---------------- embroidery ----------------
  { ext: ["xxx"], name: "Singer Embroidery", cat: "other", viewer: "fallback" },
  { ext: ["fxy", "fxc"], name: "Toyota Embroidery", cat: "other", viewer: "fallback" },
  { ext: ["pcq"], name: "Pfaff Variants", cat: "other", viewer: "fallback" },

  // ---------------- FPGA vendors ----------------
  { ext: ["xpe", "xise", "gise"], name: "Xilinx Vivado/ISE Project", cat: "code", viewer: "xml" },
  { ext: ["ngo", "ut"], name: "Xilinx FPGA Netlist", cat: "system", viewer: "fallback" },
  { ext: ["qws"], name: "Intel/Altera Quartus Project", cat: "code", viewer: "text" },

  // ---------------- label printers / CNC ----------------
  { ext: ["zpl2", "epl2"], name: "Zebra Label Language", cat: "code", viewer: "text" },

  // ---------------- music engraving ----------------
  { ext: ["mzz"], name: "Musedata", cat: "audio", viewer: "text" },

  // ---------------- GeoGebra / education ----------------
  { ext: ["ggb"], name: "GeoGebra Worksheet", cat: "scientific", viewer: "archive", sig: "50 4B 03 04" },
  { ext: ["ggs"], name: "GeoGebra Spreadsheet", cat: "scientific", viewer: "archive" },
  { ext: ["ggt"], name: "GeoGebra Tool", cat: "scientific", viewer: "archive" },
  { ext: ["lgeo"], name: "LDraw Element", cat: "3d", viewer: "text" },
  { ext: ["io"], name: "Stud.io Brick Model", cat: "3d", viewer: "fallback" },
  { ext: ["jcz"], name: "Hot Potatoes Data", cat: "other", viewer: "fallback" },

  // ---------------- Apple ----------------
  { ext: ["xcworkspace", "xcresult", "xcbundle"], name: "Xcode Artifact", cat: "code", viewer: "fallback" },
  { ext: ["apnx"], name: "Kindle Periodical", cat: "ebook", viewer: "fallback" },
  { ext: ["distz"], name: "Apple Distribution", cat: "system", viewer: "fallback" },
  { ext: ["sdef"], name: "Scripting Definition", cat: "code", viewer: "xml" },
  { ext: ["osax"], name: "Scripting Addition", cat: "system", viewer: "fallback" },

  // ---------------- Symbian / misc mobile ----------------
  { ext: ["wgz"], name: "Symbian Widget", cat: "system", viewer: "archive" },
  { ext: ["mbm"], name: "Symbian Bitmap", cat: "image", viewer: "image" },

  // ---------------- legacy word processors ----------------
  { ext: ["rft"], name: "RFT/DCA Document", cat: "document", viewer: "fallback" },
  { ext: ["dca"], name: "DCA/RFT Document", cat: "document", viewer: "fallback" },
  { ext: ["fft"], name: "First Choice Document", cat: "document", viewer: "fallback" },
  { ext: ["pfs"], name: "PFS:Write Document", cat: "document", viewer: "fallback" },

  // ---------------- misc ----------------
  { ext: ["sha", "sha1sum", "b2sum", "cksum"], name: "Checksum Manifest", cat: "data", viewer: "text" },
  { ext: ["hhc", "hhk", "hhp"], name: "HTML Help Workshop", cat: "code", viewer: "text" },
  { ext: ["hl_"], name: "Compressed HLP", cat: "system", viewer: "fallback" },
  { ext: ["zz", "z6"], name: "Z-machine Story File", cat: "game", viewer: "fallback" },
  { ext: ["gblorb", "zblorb"], name: "Glulx Interactive Fiction", cat: "game", viewer: "fallback" },
  { ext: ["1da"], name: "2DA Data Table", cat: "data", viewer: "text" },
  { ext: ["2da"], name: "BioWare 2DA Table", cat: "data", viewer: "text" },
  { ext: ["twoda"], name: "2DA (alias slot)", cat: "other", viewer: "fallback" },
  { ext: ["utw", "ute", "uts", "utr", "utp", "utm", "utl", "uti", "utc", "utd"], name: "NWN Blueprint (slots)", cat: "other", viewer: "fallback" },
  { ext: ["seed"], name: "BitTorrent Seed", cat: "data", viewer: "fallback" },
  { ext: ["s2mv", "s2gs", "s2sa", "s2ma", "s2re", "s2sv"], name: "StarCraft II Asset", cat: "game", viewer: "fallback" },
  { ext: ["h4spx"], name: "Heroes IV Sprite", cat: "game", viewer: "fallback" },
  { ext: ["vcg"], name: "VCG Graph", cat: "data", viewer: "text" },
  { ext: ["json.gz"], name: "Compressed JSON", cat: "data", viewer: "json" },
  { ext: ["okular"], name: "Okular Document", cat: "document", viewer: "archive" },
  { ext: ["fb3"], name: "FictionBook 3", cat: "ebook", viewer: "archive" },
  { ext: ["tr3"], name: "TomeRaider 3", cat: "ebook", viewer: "fallback" },
  { ext: ["pml"], name: "Palm Markup", cat: "ebook", viewer: "text" },
  { ext: ["pmlz"], name: "Zipped Palm Markup", cat: "ebook", viewer: "archive" },
  { ext: ["deflate", "raw-deflate"], name: "Raw DEFLATE Stream", cat: "archive", viewer: "archive" },
];
