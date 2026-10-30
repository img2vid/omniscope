import type { RawFormat } from "@/lib/types";

/**
 * Generic A-numbered filename aliases, NOT 10,064 distinct file formats.
 *
 * Numeric A-series names occur in heterogeneous datasets, archives and backups.
 * Only .a01-.a99 are registered separately as genuine ARJ volume names. A
 * generic numerical suffix carries no reliable codec identity. These aliases
 * make the naming pattern discoverable, while content detection and hex view
 * do the actual inspection. Never mark these as native format decoders.
 */
export const A_NUMBERED_ALIAS_COUNT = 10064;

export function generateAPrefixedFormats(): RawFormat[] {
  const aNumberedAliases = Array.from(
    { length: A_NUMBERED_ALIAS_COUNT },
    (_, i) => "a" + String(i).padStart(4, "0"),
  );
  return [
    {
      ext: ["arff"],
      name: "Attribute-Relation File Format (ARFF)",
      cat: "data",
      viewer: "arff",
      mime: "text/plain",
      desc: "Weka-compatible machine-learning dataset: relation, typed attributes, dense/sparse data preview.",
    },
    {
      ext: aNumberedAliases,
      name: "Unclassified A-numbered file",
      cat: "binary",
      viewer: "hex",
      mime: "application/octet-stream",
      recognition: "pattern",
      desc: "Numeric A-prefixed filename only. It does not identify an encoding or imply a decoder. Omniscope tries magic bytes and readable content first, otherwise showing a raw hex inspection.",
    },
  ];
}
