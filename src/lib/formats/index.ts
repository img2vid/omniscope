import type { FormatRecord, RawFormat } from "@/lib/types";
import { CORE_FORMATS } from "./database";
import { EXTRA_FORMATS_A } from "./extra-formats";
import { EXTRA_FORMATS_B } from "./extra-formats-b";
import { EXTRA_FORMATS_C } from "./extra-formats-c";
import { EXTRA_FORMATS_D } from "./extra-formats-d";
import { EXTRA_FORMATS_E } from "./extra-formats-e";
import { EXTRA_FORMATS_F } from "./extra-formats-f";
import { EXTRA_FORMATS_G } from "./extra-formats-g";
import { EXTRA_FORMATS_H } from "./extra-formats-h";
import { EXTRA_FORMATS_I } from "./extra-formats-i";
import { EXTRA_FORMATS_J } from "./extra-formats-j";
import { EXTRA_FORMATS_K } from "./extra-formats-k";
import { generateConventionFormats } from "./conventions";
import { generateFamilyFormats } from "./families";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "fmt";
}

const ALL_RAW: RawFormat[] = [
  ...CORE_FORMATS,
  ...EXTRA_FORMATS_A,
  ...EXTRA_FORMATS_B,
  ...EXTRA_FORMATS_C,
  ...EXTRA_FORMATS_D,
  ...EXTRA_FORMATS_E,
  ...EXTRA_FORMATS_F,
  ...EXTRA_FORMATS_G,
  ...EXTRA_FORMATS_H,
  ...EXTRA_FORMATS_I,
  ...EXTRA_FORMATS_J,
  ...EXTRA_FORMATS_K,
  ...generateConventionFormats(),
  ...generateFamilyFormats(),
];

/** Merge format sources → records + lookup maps. Extension duplicates: first wins. */
function buildIndex(raw: RawFormat[]): {
  records: FormatRecord[];
  extMap: Map<string, FormatRecord>;
  keyMap: Map<string, FormatRecord>;
  sigRecords: FormatRecord[];
} {
  const records: FormatRecord[] = [];
  const extMap = new Map<string, FormatRecord>();
  const keyMap = new Map<string, FormatRecord>();
  const sigRecords: FormatRecord[] = [];

  for (const r of raw) {
    const rec: FormatRecord = { ...r, key: r.ext[0] ?? slug(r.name) };
    records.push(rec);
    if (!keyMap.has(rec.key)) keyMap.set(rec.key, rec);
    for (const e of r.ext) {
      if (!extMap.has(e)) extMap.set(e, rec);
    }
    if (rec.sig) sigRecords.push(rec);
  }
  return { records, extMap, keyMap, sigRecords };
}

const index = buildIndex(ALL_RAW);

export const FORMAT_RECORDS: FormatRecord[] = index.records;
export const EXT_MAP: Map<string, FormatRecord> = index.extMap;
export const KEY_MAP: Map<string, FormatRecord> = index.keyMap;
export const SIG_RECORDS: FormatRecord[] = index.sigRecords;

export function findByExt(ext?: string | null): FormatRecord | undefined {
  if (!ext) return undefined;
  return EXT_MAP.get(ext.toLowerCase().replace(/^\./, ""));
}

export function findByKey(key?: string | null): FormatRecord | undefined {
  if (!key) return undefined;
  return KEY_MAP.get(key);
}

export const CATEGORY_LABELS: Record<string, string> = {
  image: "Image", video: "Video", audio: "Audio", document: "Document",
  spreadsheet: "Spreadsheet", presentation: "Presentation", ebook: "E-book",
  archive: "Archive", code: "Code", text: "Text", data: "Data", font: "Font",
  "3d": "3D / CAD", database: "Database", email: "Email", geo: "Geospatial",
  scientific: "Scientific", game: "Game / ROM", system: "System", disk: "Disk image",
  config: "Configuration", subtitle: "Subtitles", binary: "Binary", other: "Other",
  network: "Network",
};
