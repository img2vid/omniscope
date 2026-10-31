import { readFileSync, writeFileSync } from 'node:fs';
import { EXT_MAP, FILENAME_MAP } from '../src/lib/formats/index.ts';

const root = new URL('../', import.meta.url);
const baseline = new Set(JSON.parse(readFileSync(new URL('tests/fixtures/baseline-extensions.json', root))).map(e => e.toLowerCase()));
const added = [...EXT_MAP].filter(([ext]) => !baseline.has(ext)).map(([extension, record]) => ({
  extension, name: record.name, viewer: record.viewer, source: record.source ?? 'existing-table-l',
  reading: record.reading ?? (['fallback', 'hex'].includes(record.viewer) ? 'inspect' : ['text', 'xml', 'code'].includes(record.viewer) ? 'text' : 'decoded'),
})).sort((a, b) => a.extension < b.extension ? -1 : a.extension > b.extension ? 1 : 0);
const report = {
  baselineCommit: 'cb12ecca3379b43356ca6efaf8d66ce0c4058a0b',
  requestedAdditionalExtensions: 30001,
  baselineUniqueExtensions: baseline.size,
  totalUniqueExtensions: EXT_MAP.size,
  additionalUniqueExtensions: added.length,
  additionalTextReaders: added.filter(r => r.reading === 'text').length,
  additionalDecoderRoutes: added.filter(r => r.reading === 'decoded').length,
  additionalInspectionOnly: added.filter(r => r.reading === 'inspect').length,
  documentedFilenames: FILENAME_MAP.size,
  targetMet: added.filter(r => r.reading !== 'inspect').length > 30000,
  additions: added,
};
const contents = JSON.stringify(report, null, 2) + '\n';
const output = new URL('docs/format-coverage.json', root);
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== contents) throw new Error('Stale docs/format-coverage.json');
} else if (process.argv.includes('--write')) writeFileSync(output, contents);
const { additions, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
