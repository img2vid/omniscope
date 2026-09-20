"use client";

import dynamic from "next/dynamic";
import type { ViewerProps } from "@/lib/types";
import { Loader2 } from "lucide-react";

function ViewerFallback() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
      Loading viewer…
    </div>
  );
}

const d = (loader: () => Promise<{ default: React.ComponentType<ViewerProps> }>) =>
  dynamic(loader, { ssr: false, loading: ViewerFallback }) as unknown as React.ComponentType<ViewerProps>;

/** Registry: ViewerId → lazy viewer component. */
export const VIEWER_REGISTRY: Record<string, React.ComponentType<ViewerProps>> = {
  // core
  text: d(() => import("./text-viewer")),
  code: d(() => import("./code-viewer")),
  hex: d(() => import("./hex-viewer")),
  image: d(() => import("./image-viewer")),
  audio: d(() => import("./audio-viewer")),
  video: d(() => import("./video-viewer")),
  json: d(() => import("./json-viewer")),
  xml: d(() => import("./xml-viewer")),
  csv: d(() => import("./csv-viewer")),
  markdown: d(() => import("./markdown-viewer")),
  svg: d(() => import("./svg-viewer")),
  ico: d(() => import("./ico-viewer")),
  // office & documents (subagent 2-b)
  pdf: d(() => import("./pdf-viewer")),
  docx: d(() => import("./docx-viewer")),
  xlsx: d(() => import("./xlsx-viewer")),
  pptx: d(() => import("./pptx-viewer")),
  odf: d(() => import("./odf-viewer")),
  epub: d(() => import("./epub-viewer")),
  mobi: d(() => import("./mobi-viewer")),
  rtf: d(() => import("./rtf-viewer")),
  // binary & system (subagents 2-c / 2-c-2)
  archive: d(() => import("./archive-viewer")),
  exe: d(() => import("./exe-viewer")),
  wasm: d(() => import("./wasm-viewer")),
  font: d(() => import("./font-viewer")),
  sqlite: d(() => import("./sqlite-viewer")),
  torrent: d(() => import("./torrent-viewer")),
  nbt: d(() => import("./nbt-viewer")),
  // 3D & media (subagent 2-d)
  three3d: d(() => import("./three3d-viewer")),
  gcode: d(() => import("./gcode-viewer")),
  midi: d(() => import("./midi-viewer")),
  chess: d(() => import("./chess-viewer")),
  subtitle: d(() => import("./subtitle-viewer")),
  // domain viewers (subagent 2-e)
  map: d(() => import("./map-viewer")),
  eml: d(() => import("./eml-viewer")),
  ical: d(() => import("./ical-viewer")),
  vcf: d(() => import("./ical-viewer")),
  dbf: d(() => import("./dbf-viewer")),
  dicom: d(() => import("./dicom-viewer")),
  nfo: d(() => import("./nfo-viewer")),
  // forensic fallback
  fallback: d(() => import("./fallback-viewer")),
};

export const VIEWER_LABELS: Record<string, string> = {
  image: "Image", video: "Video", audio: "Audio", text: "Text", code: "Code", hex: "Hex",
  json: "JSON", xml: "XML", csv: "Table", markdown: "Markdown", pdf: "PDF", docx: "Word",
  xlsx: "Excel", pptx: "Slides", odf: "OpenDocument", epub: "EPUB", mobi: "Mobi",
  rtf: "RTF", archive: "Archive", three3d: "3D", font: "Font", sqlite: "SQLite",
  chess: "Chess", midi: "MIDI", subtitle: "Subtitles", map: "Map", gcode: "G-code",
  nfo: "NFO", torrent: "Torrent", exe: "Executable", wasm: "Wasm", nbt: "NBT",
  eml: "Email", ical: "Calendar", vcf: "Contacts", dbf: "dBase", dicom: "DICOM",
  svg: "SVG", ico: "Icon", fallback: "Forensics",
};
