/**
 * OMNISCOPE — shared highlight.js syntax engine.
 *
 * Single source of truth for filename→language mapping (used by the code viewer
 * and the Compare text mode), lazy hl.js loading, and whole-text tokenization
 * into per-line token arrays that can be re-rendered as React spans.
 */

export type Hljs = typeof import("highlight.js/lib/common").default;

/** One syntax token within a line (`cls` is a raw hl.js class, null = plain text). */
export interface LineTok {
  text: string;
  cls: string | null;
}

/** extension → hl.js language id (kept in sync with the code viewer). */
export const LANG_BY_EXT: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  py: "python", pyw: "python", rb: "ruby", php: "php", java: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", go: "go", rs: "rust", swift: "swift", kt: "kotlin", scala: "scala",
  sh: "bash", bash: "bash", zsh: "bash", ksh: "bash", ps1: "powershell", bat: "dos",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", xhtml: "xml", xsl: "xml", plist: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  json: "json", json5: "json", jsonl: "json",
  yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini",
  md: "markdown", markdown: "markdown", sql: "sql", graphql: "graphql", gql: "graphql",
  lua: "lua", pl: "perl", pm: "perl", tcl: "tcl", r: "r", jl: "julia",
  dart: "dart", groovy: "groovy", asm: "x86asm", s: "x86asm", f90: "fortran", for: "fortran",
  cob: "cobol", pas: "delphi", d: "d", zig: "zig", nim: "nim", hs: "haskell",
  ml: "ocaml", fs: "fsharp", erl: "erlang", ex: "elixir", exs: "elixir",
  clj: "clojure", vim: "vim", dockerfile: "dockerfile", makefile: "makefile",
  nix: "nix", puppet: "puppet", cr: "crystal", sol: "solidity", vb: "vbnet",
  v: "verilog", sv: "verilog", vhd: "vhdl", tex: "latex", sty: "latex",
  csv: "plaintext", tsv: "plaintext", diff: "diff", patch: "diff",
  vue: "xml", svelte: "xml", proto: "protobuf", twig: "twig", http: "http",
};

/** languages offered to highlightAuto when the extension gives no hint. */
const AUTO_SUBSET = [
  "javascript", "typescript", "python", "bash", "json", "yaml", "ini", "xml",
  "css", "sql", "markdown", "java", "go", "rust", "ruby", "php", "c", "cpp",
  "csharp", "plaintext",
];

/** module-level cache so the ~1 MB common bundle loads at most once per tab. */
let hljsPromise: Promise<Hljs | null> | null = null;

export function loadHljs(): Promise<Hljs | null> {
  if (!hljsPromise) {
    hljsPromise = import("highlight.js/lib/common")
      .then((m) => m.default as Hljs)
      .catch(() => null);
  }
  return hljsPromise;
}

/** Extension of a filename without dot, lower-cased ("" when none). */
export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i <= 0 || i === fileName.length - 1) return "";
  return fileName.slice(i + 1).toLowerCase();
}

/** Pick a language from the filename (extension map + shebang sniff). "" = none. */
export function detectLang(fileName: string, firstLine = ""): string {
  const byExt = LANG_BY_EXT[extOf(fileName)];
  if (byExt) return byExt;
  const shebang = /^\s*#!.*\b(bash|sh|zsh|python|perl|ruby|node|php)\b/.exec(firstLine);
  if (shebang) {
    const s = shebang[1];
    if (s === "python") return "python";
    if (s === "perl") return "perl";
    if (s === "ruby") return "ruby";
    if (s === "node") return "javascript";
    if (s === "php") return "php";
    return "bash";
  }
  return "";
}

/** Content-based fallback: highlightAuto over a small sample (≤ 400 lines). */
export function autoDetectLang(sample: string, hljs: Hljs): string {
  try {
    const lines = sample.split(/\r\n|\r|\n/);
    const s = lines.slice(0, 400).join("\n");
    if (!s.trim()) return "";
    const r = hljs.highlightAuto(s, AUTO_SUBSET);
    return r.language ?? "";
  } catch {
    return "";
  }
}

/**
 * Tokenize a whole text with hl.js and split the token stream into per-line
 * arrays (token positions restart at 0 on each line). Returns null when the
 * language is unknown or highlighting fails — callers then render plain text.
 */
export function tokenizeLines(text: string, lang: string, hljs: Hljs): LineTok[][] | null {
  if (!lang || !hljs.getLanguage(lang)) return null;
  try {
    const res = hljs.highlight(text, { language: lang, ignoreIllegals: true });
    const doc = new DOMParser().parseFromString(res.value, "text/html");
    const out: LineTok[][] = [[]];
    const walk = (node: Node, cls: string | null) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const pieces = (node.textContent ?? "").split("\n");
        for (let i = 0; i < pieces.length; i++) {
          if (i > 0) out.push([]);
          if (pieces[i]) out[out.length - 1].push({ text: pieces[i], cls });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const c = el.getAttribute("class");
        // innermost span wins (nested hl.js emitters)
        const inner = c && c.startsWith("hljs-") ? c : cls;
        for (const ch of Array.from(el.childNodes)) walk(ch, inner);
      }
    };
    for (const ch of Array.from(doc.body.childNodes)) walk(ch, null);
    return out;
  } catch {
    return null;
  }
}

/**
 * Slice a line's token list to a character range [start, end) so word-level
 * diff parts can inherit the underlying syntax colors.
 */
export function sliceTokens(toks: LineTok[], start: number, end: number): LineTok[] {
  const out: LineTok[] = [];
  let pos = 0;
  for (const t of toks) {
    const tStart = pos;
    const tEnd = pos + t.text.length;
    pos = tEnd;
    if (tEnd <= start || tStart >= end) continue;
    const from = Math.max(0, start - tStart);
    const to = Math.min(t.text.length, end - tStart);
    const s = t.text.slice(from, from + Math.max(0, to - from));
    if (s) out.push({ text: s, cls: t.cls });
  }
  return out;
}
