/** Bounded, dependency-free ARFF dataset preview parser. */
export interface ArffAttribute { name: string; type: string }
export interface ArffPreview {
  relation: string;
  attributes: ArffAttribute[];
  rows: string[][];
  warnings: string[];
  truncated: boolean;
}

/** Split comma-separated ARFF tokens, respecting single and double quotes. */
function splitArffFields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quote = "";
  let escaped = false;
  for (const ch of line) {
    if (escaped) { field += ch; escaped = false; continue; }
    if (quote && ch === "\\") { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = "";
      else field += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ",") {
      out.push(field.trim()); field = "";
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

function nameToken(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && (t[0] === "'" || t[0] === '"') && t[t.length - 1] === t[0]) {
    return t.slice(1, -1).replace(/\\(['"\\])/g, "$1");
  }
  return t;
}

export function parseArff(text: string, maxRows = 5000): ArffPreview {
  const result: ArffPreview = { relation: "", attributes: [], rows: [], warnings: [], truncated: false };
  let inData = false;
  const warn = (message: string) => { if (result.warnings.length < 8) result.warnings.push(message); };
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("%")) continue;
    if (!inData) {
      const rel = /^@relation\s+(.+)$/i.exec(line);
      if (rel) { result.relation = nameToken(rel[1]); continue; }
      const attr = /^@attribute\s+(?:(['"])(.*?)\1|(\S+))\s+(.+)$/i.exec(line);
      if (attr) {
        result.attributes.push({ name: nameToken(attr[2] ?? attr[3]), type: attr[4].trim() });
        continue;
      }
      if (/^@data\s*(?:%.*)?$/i.test(line)) { inData = true; continue; }
      warn(`Unrecognized header at line ${i + 1}`);
      continue;
    }
    if (result.rows.length >= maxRows) { result.truncated = true; break; }
    let row: string[];
    if (line.startsWith("{") && line.endsWith("}")) {
      // Sparse ARFF defaults: zero for numeric fields, first nominal label
      // for categorical fields, and an empty value for strings.
      row = result.attributes.map((a) =>
        /^(numeric|real|integer)$/i.test(a.type) ? "0" :
        a.type.startsWith("{") ? (splitArffFields(a.type.slice(1, -1))[0] ?? "") : "",
      );
      for (const entry of splitArffFields(line.slice(1, -1))) {
        if (!entry) continue;
        const m = /^(\d+)\s+([\s\S]+)$/.exec(entry);
        if (!m || Number(m[1]) >= row.length) { warn(`Invalid sparse value at line ${i + 1}`); continue; }
        row[Number(m[1])] = nameToken(m[2]);
      }
    } else {
      row = splitArffFields(line);
    }
    if (row.length !== result.attributes.length) {
      warn(`Column mismatch at line ${i + 1} (found ${row.length}, expected ${result.attributes.length})`);
      row = result.attributes.map((_, n) => row[n] ?? "");
    }
    result.rows.push(row);
  }
  if (!inData) warn("Missing @DATA declaration");
  if (!result.attributes.length) warn("No @ATTRIBUTE declarations found");
  return result;
}
