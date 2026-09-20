"use client";

import CodeViewer from "./code-viewer";
import type { ViewerProps } from "@/lib/types";

/** Plain text: same engine as code viewer but without syntax highlighting. */
export default function TextViewer(props: ViewerProps) {
  return <CodeViewer {...props} forcedPlain />;
}
