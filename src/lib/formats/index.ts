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
import { emitFormatsChanged } from "./formats-events";

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

/**
 * Mutable registries — lazily-loaded expansions (see ensureFormatsLoaded) merge
 * into these same objects at runtime, so every consumer holding a live ES-module
 * binding (detect.ts, stats.ts, explorer) sees the expanded catalog without any
 * async plumbing at call sites.
 */
export const FORMAT_RECORDS: FormatRecord[] = [];
export const EXT_MAP: Map<string, FormatRecord> = new Map();
export const KEY_MAP: Map<string, FormatRecord> = new Map();
export const SIG_RECORDS: FormatRecord[] = [];

/** Bumped every time new formats register; lets memoized UI recompute. */
export const FORMATS_VERSION = { n: 0 };

function addToIndex(r: RawFormat): void {
  const rec: FormatRecord = { ...r, key: r.ext[0] ?? slug(r.name) };
  // skip records whose extensions are all already mapped (defensive; expansion
  // datasets are pre-filtered, but this keeps FORMAT_RECORDS ↔ EXT_MAP coherent)
  if (r.ext.length > 0 && r.ext.every((e) => EXT_MAP.has(e))) return;
  FORMAT_RECORDS.push(rec);
  if (!KEY_MAP.has(rec.key)) KEY_MAP.set(rec.key, rec);
  for (const e of r.ext) {
    if (!EXT_MAP.has(e)) EXT_MAP.set(e, rec);
  }
  if (rec.sig) SIG_RECORDS.push(rec);
}

for (const r of ALL_RAW) addToIndex(r);

/**
 * Merge additional authored records into the live registries.
 * Extension duplicates: first wins (existing curated records keep priority).
 * Returns the number of NEW extensions added.
 */
export function registerRawFormats(raw: RawFormat[]): number {
  const before = EXT_MAP.size;
  for (const r of raw) addToIndex(r);
  const added = EXT_MAP.size - before;
  if (added > 0) {
    FORMATS_VERSION.n++;
    emitFormatsChanged();
  }
  return added;
}

let loadPromise: Promise<void> | null = null;
/**
 * Lazily load the letter-A expansion chunk (~700 extra real A-extensions from
 * FileInfo/Wikipedia/mime-db/Tika/shared-mime-info/FileExt) and merge it into
 * the registries. Idempotent; resolves even if the chunk fails (logged).
 */
export function ensureFormatsLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = import("./a-expansion")
      .then((m) => {
        registerRawFormats(m.A_EXPANSION_FORMATS);
      })
      .catch((err) => {
        console.error("[formats] A-expansion chunk failed to load", err);
      });
  }
  return loadPromise;
}

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
