/** Dependency-free byte formatting and signature parsing, shared by detection and UI. */
export function toHexByte(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, "0");
}

export function toHex(bytes: Uint8Array, sep = " "): string {
  return Array.from(bytes, toHexByte).join(sep);
}

export function parseHexPattern(pattern: string): (number | null)[] | null {
  const out: (number | null)[] = [];
  for (const p of pattern.trim().split(/\s+/)) {
    if (p === "??" || p === "**") out.push(null);
    else if (/^[0-9a-fA-F]{2}$/.test(p)) out.push(parseInt(p, 16));
    else return null;
  }
  return out.length ? out : null;
}
