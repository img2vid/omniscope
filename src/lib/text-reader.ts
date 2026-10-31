import { probeText } from "./text-probe";

/** Read a bounded preview even when the app deliberately did not load a large file. */
export async function readTextBytes(file: Blob, arrayBuffer: ArrayBuffer | null, limit: number) {
  const bytes = arrayBuffer
    ? new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, limit))
    : new Uint8Array(await file.slice(0, limit).arrayBuffer());
  return { bytes, truncated: file.size > bytes.byteLength };
}

/** JSON and XML may use UTF-16; use the same Unicode probe as detection. */
export function decodeUnicode(bytes: Uint8Array): string {
  const encoding = probeText(bytes)?.encoding ?? "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}
