import { FORMAT_RECORDS, EXT_MAP } from "./index";
import { SIGNATURES } from "./signatures";
import { MIME_REGISTRY_ALL } from "./mime-registry-all";
import { ENCODINGS } from "@/lib/utils";
import type { FormatCategory } from "@/lib/types";

export interface ExplorerRow {
  key: string;
  kind: "format" | "mime" | "encoding";
  label: string;
  sub: string;
  cat: FormatCategory;
  viewer: string;
  desc?: string;
}

const EXT_ONLY = FORMAT_RECORDS.flatMap((r) => r.ext.map((e) => ({ e, r })));

const MIME_UNIQUE = (() => {
  const seen = new Set<string>();
  const out: typeof MIME_REGISTRY_ALL = [];
  for (const m of MIME_REGISTRY_ALL) {
    if (seen.has(m.mime)) continue;
    seen.add(m.mime);
    out.push(m);
  }
  return out;
})();

export const FORMAT_STATS = (() => {
  const byCat = new Map<FormatCategory, number>();
  for (const r of FORMAT_RECORDS) byCat.set(r.cat, (byCat.get(r.cat) ?? 0) + 1);
  const sigCount = new Set<string>([
    ...SIGNATURES.map((s) => s.key + s.pattern),
    ...FORMAT_RECORDS.filter((r) => r.sig).map((r) => r.key + r.sig),
  ]).size;
  const encodingLabels = new Set(ENCODINGS.flatMap((g) => g.labels)).size;
  return {
    formats: FORMAT_RECORDS.length,
    extensions: EXT_MAP.size,
    mimes: MIME_UNIQUE.length,
    signatures: sigCount,
    encodings: encodingLabels,
    categories: byCat.size,
    byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    /** total recognized format identities */
    identities: EXT_MAP.size + MIME_UNIQUE.length + sigCount + encodingLabels,
  };
})();

export const EXPLORER_ROWS: ExplorerRow[] = [
  ...EXT_ONLY.map(({ e, r }) => ({
    key: `ext:${e}`,
    kind: "format" as const,
    label: "." + e,
    sub: r.name,
    cat: r.cat,
    viewer: r.viewer,
    desc: r.desc,
  })),
  ...MIME_UNIQUE.map((m) => ({
    key: `mime:${m.mime}`,
    kind: "mime" as const,
    label: m.mime,
    sub: m.name,
    cat: m.cat,
    viewer: m.viewer,
    desc: m.desc,
  })),
  ...ENCODINGS.flatMap((g) =>
    g.labels.map((l) => ({
      key: `enc:${l}`,
      kind: "encoding" as const,
      label: l,
      sub: `Charset (${g.group})`,
      cat: "text" as FormatCategory,
      viewer: "text",
    })),
  ),
];
