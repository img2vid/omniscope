import { describe, expect, test } from "bun:test";
import { A_NUMBERED_ALIAS_COUNT, generateAPrefixedFormats } from "../src/lib/formats/a-prefixed";
import { findByExt } from "../src/lib/formats";
import { FORMAT_STATS } from "../src/lib/formats/stats";
import { detectFromHead } from "../src/lib/detect";
import { parseArff } from "../src/lib/arff";

const encode = (s: string) => new TextEncoder().encode(s);

describe("A-prefix coverage without invented format identities", () => {
  test("more than 10,000 unique numbered A aliases", () => {
    const aliases = generateAPrefixedFormats().find((r) => r.recognition === "pattern")!.ext;
    expect(aliases.length).toBe(A_NUMBERED_ALIAS_COUNT);
    expect(new Set(aliases).size).toBe(A_NUMBERED_ALIAS_COUNT);
    expect(aliases.every((x) => /^a\d{4,5}$/.test(x))).toBe(true);
    expect(findByExt("a0000")?.recognition).toBe("pattern");
    expect(findByExt("A10063")?.recognition).toBe("pattern");
    expect(FORMAT_STATS.patternAliases).toBeGreaterThan(10000);
    expect(FORMAT_STATS.extensions).toBeGreaterThan(0);
    expect(FORMAT_STATS.identities).toBeLessThan(FORMAT_STATS.identities + FORMAT_STATS.patternAliases);
  });

  test("no false ARJ or codec claim for opaque numbered data", () => {
    const d = detectFromHead("unknown.A0000", Uint8Array.of(0, 1, 2, 3, 4, 5));
    expect(d.method).toBe("pattern");
    expect(d.viewer).toBe("hex");
    expect(d.record).toBeNull();
  });

  test("real A extensions retain their specific native viewer", () => {
    expect(findByExt("a01")?.name).toMatch(/ARJ/i);
    expect(findByExt("arff")?.viewer).toBe("arff");
    const d = detectFromHead("training.arff", encode("@relation training\n@attribute score numeric\n@data\n1\n"));
    expect(d.viewer).toBe("arff");
    expect(d.method).toBe("extension");
  });

  test("magic bytes override generic A aliases", () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    const d = detectFromHead("picture.a9999", png);
    expect(d.viewer).toBe("image");
    expect(d.method).toBe("magic");
    expect(d.conflicts).toBeUndefined();
  });

  test("content sniffing overrides numbered aliases", () => {
    const d = detectFromHead("dataset.a10000", encode("@RELATION tiny\n@ATTRIBUTE weight NUMERIC\n@DATA\n9\n"));
    expect(d.viewer).toBe("arff");
    expect(d.method).toBe("content");
    expect(d.ext).toBe("a10000");
  });
});

describe("native ARFF preview", () => {
  test("parses quoted headers, dense rows, missing fields and sparse rows", () => {
    const preview = parseArff(`% comment
@RELATION 'my data'
@ATTRIBUTE 'item name' STRING
@ATTRIBUTE count NUMERIC
@ATTRIBUTE class {yes,no}
@DATA
'first item',7,yes
'second, item',?,no
{1 5,2 no}`);
    expect(preview.relation).toBe("my data");
    expect(preview.attributes.map((a) => a.name)).toEqual(["item name", "count", "class"]);
    expect(preview.rows).toEqual([
      ["first item", "7", "yes"],
      ["second, item", "?", "no"],
      ["", "5", "no"],
    ]);
    expect(preview.warnings).toEqual([]);
  });

  test("bounded parsing does not silently claim every row was read", () => {
    const p = parseArff("@RELATION t\n@ATTRIBUTE a numeric\n@DATA\n1\n2\n3", 2);
    expect(p.rows).toHaveLength(2);
    expect(p.truncated).toBe(true);
  });
});
