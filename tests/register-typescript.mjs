import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve the same @/ alias and extensionless imports as the application.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith('@/')
      ? new URL('../src/' + specifier.slice(2), import.meta.url)
      : specifier.startsWith('.') ? new URL(specifier, context.parentURL) : null;
    if (base) {
      for (const suffix of ['', '.ts', '/index.ts']) {
        const url = new URL(base.href + suffix);
        if (existsSync(url) && !url.pathname.endsWith('/')) {
          if (suffix || /\.[cm]?[jt]s$/.test(url.pathname)) return nextResolve(url.href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
