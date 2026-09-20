/** Little helper for reading structured binary data. */
export class DataReader {
  view: DataView;
  bytes: Uint8Array;
  offset: number;
  little: boolean;

  constructor(bytes: Uint8Array | ArrayBuffer, little = true, startOffset = 0) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = startOffset;
    this.little = little;
  }

  get length(): number { return this.bytes.length; }
  get remaining(): number { return this.bytes.length - this.offset; }
  seek(o: number): this { this.offset = o; return this; }
  skip(n: number): this { this.offset += n; return this; }

  u8At(o: number): number { return this.bytes[o]; }

  u8(): number { return this.bytes[this.offset++]; }
  i8(): number { const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.offset, this.little); this.offset += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.offset, this.little); this.offset += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.offset, this.little); this.offset += 4; return v; }
  i32(): number { const v = this.view.getInt32(this.offset, this.little); this.offset += 4; return v; }
  u64(): bigint { const v = this.view.getBigUint64(this.offset, this.little); this.offset += 8; return v; }
  i64(): bigint { const v = this.view.getBigInt64(this.offset, this.little); this.offset += 8; return v; }
  f32(): number { const v = this.view.getFloat32(this.offset, this.little); this.offset += 4; return v; }
  f64(): number { const v = this.view.getFloat64(this.offset, this.little); this.offset += 8; return v; }

  ascii(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.offset + i] ?? 0);
    this.offset += n;
    return s;
  }

  /** read bytes until NUL, at current offset (bounded) */
  cstr(max = 512): string {
    let s = "";
    let n = 0;
    while (this.offset < this.bytes.length && n < max) {
      const b = this.bytes[this.offset++];
      if (b === 0) break;
      s += String.fromCharCode(b);
      n++;
    }
    return s;
  }

  bytesOf(n: number): Uint8Array {
    const v = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  has(n: number): boolean { return this.offset + n <= this.bytes.length; }
}

export function u16be(b: Uint8Array, o: number): number { return (b[o] << 8) | b[o + 1]; }
export function u32be(b: Uint8Array, o: number): number { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
export function u32le(b: Uint8Array, o: number): number { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
export function u16le(b: Uint8Array, o: number): number { return b[o] | (b[o + 1] << 8); }

export function asciiAt(b: Uint8Array, o: number, n: number): string {
  let s = "";
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

export function startsWithAscii(b: Uint8Array, s: string, o = 0): boolean {
  if (o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
}

export function findAscii(b: Uint8Array, s: string, from = 0, to = b.length): number {
  const limit = Math.min(to, b.length) - s.length;
  for (let i = from; i <= limit; i++) {
    let ok = true;
    for (let j = 0; j < s.length; j++) {
      if (b[i + j] !== s.charCodeAt(j)) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

/** Parse an EBML vint (Matroska/WebM). Returns { value, length } */
export function readVint(b: Uint8Array, o: number): { value: number; length: number; allOnes: boolean } {
  const first = b[o];
  if (first === 0) return { value: 0, length: 0, allOnes: false };
  let mask = 0x80;
  let len = 0;
  while (mask && !(first & mask)) { mask >>= 1; len++; }
  const size = 8 - len;
  let value = first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < size; i++) {
    value = value * 256 + b[o + i];
    if (b[o + i] !== 0xff) allOnes = false;
  }
  return { value, length: size, allOnes };
}
