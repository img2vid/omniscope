export type FormatCategory =
  | "image" | "video" | "audio" | "document" | "spreadsheet" | "presentation"
  | "ebook" | "archive" | "code" | "text" | "data" | "font" | "3d"
  | "database" | "email" | "geo" | "scientific" | "game" | "system"
  | "disk" | "config" | "subtitle" | "binary" | "network" | "other";

export type ViewerId =
  | "image" | "video" | "audio" | "text" | "code" | "hex" | "json" | "xml"
  | "csv" | "markdown" | "pdf" | "docx" | "xlsx" | "pptx" | "odf" | "epub"
  | "mobi" | "rtf" | "archive" | "three3d" | "font" | "sqlite" | "chess"
  | "midi" | "subtitle" | "map" | "gcode" | "nfo" | "torrent" | "exe"
  | "wasm" | "nbt" | "eml" | "ical" | "vcf" | "dbf" | "dicom" | "svg"
  | "ico" | "fallback";

/** A format record as authored in the knowledge base. */
export interface RawFormat {
  /** lowercase file extensions without the leading dot */
  ext: string[];
  name: string;
  cat: FormatCategory;
  viewer: ViewerId;
  mime?: string;
  desc?: string;
  /** hex magic bytes, bytes separated by spaces, "??" = wildcard, e.g. "89 50 4E 47 0D 0A 1A 0A" */
  sig?: string;
  /** byte offset of the signature (default 0) */
  sigOffset?: number;
}

export interface FormatRecord extends RawFormat {
  /** primary key = first extension (or slug) */
  key: string;
}

/** Independent MIME identity (IANA vendor tree etc.), for the MIME registry. */
export interface MimeRecord {
  mime: string;
  name: string;
  cat: FormatCategory;
  viewer: ViewerId;
  desc?: string;
}

export type DetectionMethod =
  | "magic"        // matched binary signature
  | "container"    // sniffed inside container (CFB / OOXML / zip directory)
  | "extension"    // matched via file extension
  | "content"      // sniffed as text / structured content
  | "unknown";

export interface DetectedFormat {
  record: FormatRecord | null;
  name: string;
  cat: FormatCategory;
  viewer: ViewerId;
  mime: string;
  desc?: string;
  method: DetectionMethod;
  /** matched magic bytes as hex string (pretty, spaced) */
  magicHex?: string;
  /** extension used for matching (lowercase, no dot) */
  ext?: string;
  /** alternate candidates that also matched (renamed files etc.) */
  conflicts?: string[];
}

export interface ViewerProps {
  /** original File object (can be a virtual file extracted from an archive) */
  file: File;
  /** full bytes if loaded (null when the file exceeds the load cap) */
  arrayBuffer: ArrayBuffer | null;
  /** first 64KB head bytes (always available) */
  head: Uint8Array;
  /** detection result */
  detected: DetectedFormat;
  fileName: string;
  /** optional app hook: open an extracted/derived file as a new tab (e.g. archive entries) */
  onOpenFile?: (file: File) => void;
}

export interface FileTab {
  id: string;
  file: File;
  name: string;
  size: number;
  detected: DetectedFormat | null;
  status: "detecting" | "ready" | "error";
  viewerOverride: ViewerId | null;
  objectUrl?: string;
}
