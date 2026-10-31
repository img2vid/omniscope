export interface TextProbe {
  text: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be";
}

/**
 * Bounded, strict Unicode probe. ASCII-byte ratios reject perfectly valid Hindi,
 * Japanese, emoji, and UTF-16. Decode first and measure Unicode controls instead.
 * Streaming decoding tolerates a code point cut off by the head-buffer boundary.
 */
export function probeText(bytes: Uint8Array): TextProbe | null {
  if (!bytes.length) return { text: "", encoding: "utf-8" };
  const sample = bytes.subarray(0, 65536);
  let encoding: TextProbe["encoding"] = "utf-8";
  if (sample[0] === 0xff && sample[1] === 0xfe) {
    // UTF-32 is not UTF-16; the browser TextDecoder does not support it.
    if (sample[2] === 0 && sample[3] === 0) return null;
    encoding = "utf-16le";
  } else if (sample[0] === 0xfe && sample[1] === 0xff) {
    encoding = "utf-16be";
  } else if (sample.length >= 16) {
    const pairs = Math.min(Math.floor(sample.length / 2), 128);
    let evenNull = 0, oddNull = 0;
    for (let i = 0; i < pairs * 2; i += 2) {
      if (sample[i] === 0) evenNull++;
      if (sample[i + 1] === 0) oddNull++;
    }
    if (oddNull / pairs > 0.6 && evenNull === 0) encoding = "utf-16le";
    else if (evenNull / pairs > 0.6 && oddNull === 0) encoding = "utf-16be";
  }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(sample, { stream: true });
    let total = 0, controls = 0;
    for (const c of text) {
      const n = c.codePointAt(0)!;
      if (n === 0) return null;
      if ((n < 0x20 && ![9, 10, 12, 13].includes(n)) || (n >= 0x7f && n <= 0x9f)) controls++;
      total++;
    }
    if (!total || controls / total > 0.02) return null;
    return { text, encoding };
  } catch {
    return null;
  }
}
