import type { RawFormat } from "@/lib/types";

/**
 * PROGRAMMATIC TOOLCHAIN CONVENTIONS
 * Real compound-extension filename conventions recognized by build tooling
 * (TypeScript, webpack, Jest, esbuild, rollup, Next.js, Angular, Vue).
 */
export function generateConventionFormats(): RawFormat[] {
  const out: RawFormat[] = [];

  // source-code compound conventions — recognized and routed by compilers/bundlers
  const baseExt = ["js", "mjs", "cjs", "ts", "tsx", "jsx", "mts", "cts", "css", "json", "yaml"];
  const modifiers: [string, string, string][] = [
    ["min", "Minified build output", "code"],
    ["test", "Test suite module", "code"],
    ["spec", "Specification module", "code"],
    ["config", "Tool configuration module", "config"],
    ["esm", "ES module build", "code"],
    ["umd", "UMD build", "code"],
    ["prod", "Production config", "config"],
    ["dev", "Development config", "config"],
    ["stories", "Storybook stories", "code"],
    ["benchmark", "Benchmark module", "code"],
    ["chunk", "Bundler chunk", "code"],
    ["bundle", "Bundled output", "code"],
    ["setup", "Setup module (tests)", "code"],
    ["teardown", "Teardown module (tests)", "code"],
    ["worker", "Web worker entry", "code"],
    ["d", "Type declaration", "code"],
  ];
  for (const b of baseExt) {
    for (const [mod, label, cat] of modifiers) {
      // only widely-real combos: d + ts/mts/cts; stories + js/ts/jsx/tsx; min + js/css; etc.
      const real =
        (mod === "d" && ["ts", "mts", "cts", "tsx", "jsx"].includes(b)) ||
        (mod === "stories" && ["js", "ts", "jsx", "tsx", "mjs"].includes(b)) ||
        (["min", "config", "test", "spec", "esm", "umd", "prod", "dev", "chunk", "bundle", "worker", "setup", "teardown", "benchmark"].includes(mod) &&
          ["js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "json", "mts"].includes(b));
      if (!real) continue;
      out.push({
        ext: [`${mod}.${b}`],
        name: `${label} (.${mod}.${b})`,
        cat: cat as RawFormat["cat"],
        viewer: "code",
        desc: `Toolchain filename convention: ${label.toLowerCase()} for .${b} assets.`,
      });
    }
  }

  // environment-scoped configs — Next.js, Create React App, Vite, Angular conventions
  for (const env of ["development", "production", "test", "staging", "local", "preview"]) {
    for (const base of ["env", "config"]) {
      out.push({
        ext: [`${base}.${env}`],
        name: `${base === "env" ? "Environment" : "Config"} file (${env})`,
        cat: "config",
        viewer: "text",
        desc: `Environment-scoped ${base} used by build tools (Vite/CRA/Next.js convention).`,
      });
    }
  }

  // Dockerfile variants — real naming conventions
  for (const v of ["Dockerfile.prod", "Dockerfile.dev", "Dockerfile.test", "Dockerfile.base", "Dockerfile.local", "containerfile", "Containerfile"]) {
    out.push({
      ext: [v.toLowerCase()],
      name: `Container recipe (${v})`,
      cat: "config",
      viewer: "code",
      desc: "Container build recipe.",
    });
  }

  // git/GitHub conventions
  for (const v of ["gitmodules", "gitignore", "gitattributes", "mailmap", "npmignore", "dockerignore", "prettierignore", "eslintignore", "hgignore", "cvsignore"]) {
    out.push({
      ext: [v],
      name: `${v} control file`,
      cat: "config",
      viewer: "text",
      desc: "VCS/tool ignore or metadata convention.",
    });
  }

  return out;
}
