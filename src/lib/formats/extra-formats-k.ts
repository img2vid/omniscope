import type { RawFormat } from "@/lib/types";

/** AUTHORED EXPANSION K — deep cuts: legacy animation, dictation, retro disks, DCP, avionics, OOo 1.x. */
export const EXTRA_FORMATS_K: RawFormat[] = [
  // ---------------- legacy animation ----------------
  { ext: ["dl"], name: "DL Animation", cat: "video", viewer: "fallback" },

  // ---------------- audio deep cuts ----------------
  { ext: ["msv"], name: "Sony Memory Stick Voice", cat: "audio", viewer: "fallback" },
  { ext: ["dvf"], name: "Sony Digital Voice", cat: "audio", viewer: "fallback" },
  { ext: ["dss", "ds2"], name: "Olympus Dictation", cat: "audio", viewer: "fallback" },
  { ext: ["vec"], name: "Vectrex ROM", cat: "game", viewer: "fallback" },

  // ---------------- retro disks/saves ----------------
  { ext: ["d84"], name: "Commodore 8250 Disk", cat: "disk", viewer: "fallback" },
  { ext: ["vsf"], name: "VICE Snapshot", cat: "game", viewer: "fallback" },
  { ext: ["d13", "2img", "niba"], name: "Apple II Disk Image", cat: "disk", viewer: "fallback" },
  { ext: ["brm"], name: "Dreamcast VMU Data", cat: "game", viewer: "fallback" },
  { ext: ["hi"], name: "MAME Non-Volatile RAM", cat: "game", viewer: "fallback" },

  // ---------------- motorsports / telemetry / ECUs ----------------
  { ext: ["ldx"], name: "MoTeC Log", cat: "scientific", viewer: "fallback" },
  { ext: ["mf4"], name: "ASAM MF4 Measurement", cat: "scientific", viewer: "fallback" },

  // ---------------- digital cinema ----------------
  { ext: ["kdm"], name: "DCP Component", cat: "video", viewer: "xml" },

  // ---------------- radio / aviation ----------------
  { ext: ["chirp"], name: "CHIRP Radio Export", cat: "system", viewer: "csv" },
  { ext: ["fpl"], name: "Flight Plan", cat: "geo", viewer: "text" },

  // ---------------- rhythm games ----------------

  // ---------------- OpenOffice 1.x ----------------
  { ext: ["stw", "sxg"], name: "OpenOffice 1.x Document", cat: "document", viewer: "archive", sig: "50 4B 03 04" },

  // ---------------- office leftovers ----------------
  { ext: ["xlk", "xlb"], name: "Excel Add-in/Backup", cat: "spreadsheet", viewer: "fallback" },
  { ext: ["mswmm", "msdvd", "wlmp"], name: "Windows Movie Maker Project", cat: "video", viewer: "fallback" },
  { ext: ["savf"], name: "IBM i Save File", cat: "system", viewer: "fallback" },
];
