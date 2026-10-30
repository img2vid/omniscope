"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import { parseArff } from "@/lib/arff";
import { ViewerBody, ViewerToolbar, Chip, EmptyHint } from "./viewer-ui";

/** Native tabular preview for ARFF (Weka) data, without uploading it. */
export default function ArffViewer({ arrayBuffer, head }: ViewerProps) {
  const preview = React.useMemo(() => {
    const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    return parseArff(new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 6 * 1024 * 1024)));
  }, [arrayBuffer, head]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={<><Chip tone="emerald">ARFF</Chip><Chip>{preview.relation || "Unnamed relation"}</Chip><Chip>{preview.attributes.length} attributes</Chip><Chip>{preview.rows.length} rows previewed</Chip></>}
      />
      <ViewerBody className="p-4">
        {preview.warnings.length ? (
          <div className="mb-3 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-300">
            {preview.warnings.join(" · ")}
          </div>
        ) : null}
        {preview.attributes.length ? (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-left">
                <tr>
                  <th className="border-b border-r border-zinc-800 px-2 py-2 text-zinc-500">#</th>
                  {preview.attributes.map((a, i) => (
                    <th key={i} className="min-w-24 border-b border-r border-zinc-800 px-3 py-2">
                      <div className="text-zinc-200">{a.name}</div>
                      <div className="font-normal text-zinc-500">{a.type}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 250).map((row, ri) => (
                  <tr key={ri} className="hover:bg-zinc-900/60">
                    <td className="border-b border-r border-zinc-800/60 px-2 py-1 text-zinc-600">{ri + 1}</td>
                    {preview.attributes.map((_, ci) => (
                      <td key={ci} className="max-w-80 truncate border-b border-r border-zinc-800/60 px-3 py-1 text-zinc-300" title={row[ci] ?? ""}>{row[ci] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyHint>No ARFF attributes found. Use the text/hex viewer to inspect the source.</EmptyHint>}
        {preview.truncated || preview.rows.length > 250 ? (
          <p className="mt-2 text-xs text-zinc-500">Preview capped at 250 displayed rows, 5,000 parsed rows and 6 MiB of input. No file modifications are made.</p>
        ) : null}
      </ViewerBody>
    </div>
  );
}
