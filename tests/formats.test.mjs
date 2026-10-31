import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EXT_MAP, FILENAME_MAP, findByExt, findByFilename } from '../src/lib/formats/index.ts';
import { SOURCED_FORMATS } from '../src/lib/formats/sourced-formats.ts';
import { detectFromHead, getExt } from '../src/lib/detect.ts';
import { probeText } from '../src/lib/text-probe.ts';
import { decodeUnicode, readTextBytes } from '../src/lib/text-reader.ts';
import { EXPLORER_ROWS, FORMAT_STATS } from '../src/lib/formats/stats.ts';

const encode = text => new TextEncoder().encode(text);
const baseline = new Set(JSON.parse(readFileSync(new URL('./fixtures/baseline-extensions.json', import.meta.url))).map(e => e.toLowerCase()));
const added = [...EXT_MAP].filter(([ext]) => !baseline.has(ext));
const unicode = '日本語の文章。 বাংলা লেখা। हिन्दी पाठ। தமிழ் உரை। Ελληνικά 😀\n';
function utf16(text, bigEndian = false) {
  const out = new Uint8Array(2 + text.length * 2);
  new DataView(out.buffer).setUint16(0, 0xfeff, !bigEndian);
  for (let i = 0; i < text.length; i++) new DataView(out.buffer).setUint16(2 + i * 2, text.charCodeAt(i), !bigEndian);
  return out;
}

test('all existing suffixes remain discoverable, independent of case', () => {
  for (const ext of baseline) {
    assert.ok(findByExt(ext), ext);
    assert.equal(findByExt('.' + ext.toUpperCase()), findByExt(ext), ext);
  }
  assert.equal(findByExt('json').name, 'JSON Data');
  assert.equal(findByExt('pdf').viewer, 'pdf');
  assert.equal(findByExt('zip').viewer, 'archive');
  const routing = JSON.parse(readFileSync(new URL('./fixtures/baseline-routing.json', import.meta.url)));
  const protectedExtensions = [...baseline].sort().filter(e => !routing.previouslyUnreachable.includes(e));
  const routes = protectedExtensions.map(e => {
    const r = findByExt(e);
    return [e, r.name, r.viewer, r.mime ?? null];
  });
  assert.equal(routes.length, routing.extensions);
  assert.equal(createHash('sha256').update(JSON.stringify(routes)).digest('hex'), routing.sha256,
    'An existing extension changed its name, MIME identity, or default reader');
});

test('every added source suffix is traceable to a snapshot; no numeric padding', () => {
  const linguist = JSON.parse(readFileSync(new URL('../data/format-sources/linguist.json', import.meta.url)));
  const mime = JSON.parse(readFileSync(new URL('../data/format-sources/mime-db.json', import.meta.url)));
  const documented = {
    'github-linguist': new Set(linguist.flatMap(l => l.extensions ?? []).map(e => e.replace(/^\./, '').toLowerCase())),
    'mime-db': new Set(Object.values(mime).flatMap(m => m.extensions ?? []).map(e => e.toLowerCase())),
  };
  for (const [ext, r] of added) {
    assert.ok(r.source, ext);
    assert.ok(documented[r.source].has(ext), ext);
  }
  assert.equal(added.filter(([, r]) => r.source).length, 1233);
  assert.equal(added.length, 1233);
  assert.equal(EXT_MAP.size, 7121);
  assert.equal(findByExt('invented30001'), undefined);
  assert.equal(findByExt('a000001'), undefined);
});

test('source snapshot checksums remain stable', () => {
  const hashes = JSON.parse(readFileSync(new URL('../data/format-sources/snapshot-hashes.json', import.meta.url)));
  for (const [path, hash] of Object.entries(hashes)) {
    const bytes = readFileSync(new URL('../' + path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, path);
  }
});

test('each new text alias routes readable Unicode; JSON/XML aliases get valid structures', () => {
  let checked = 0;
  for (const [ext, r] of added) {
    if (!r.source || r.reading !== 'text') continue;
    const text = r.viewer === 'json' ? JSON.stringify({ message: unicode }) : r.viewer === 'xml'
      ? '<?xml version="1.0"?><root>' + unicode + '</root>' : unicode;
    const bytes = encode(text);
    const actual = detectFromHead('sample.' + ext, bytes);
    assert.equal(actual.viewer, r.viewer, ext);
    assert.equal(actual.record, r, ext);
    assert.equal(decodeUnicode(bytes), text, ext);
    checked++;
  }
  assert.equal(checked, 826);
});

test('imported text aliases do not force binary bytes into text parsers', () => {
  const binary = Uint8Array.of(0x99, 0xff, 0x8b, 0x00, 0x01, 0x02);
  for (const [ext, r] of added) {
    if (!r.textOnly) continue;
    assert.equal(detectFromHead('sample.' + ext, binary).viewer, 'hex', ext);
  }
});

test('inspection-only entries stay separate from decoders', () => {
  const binary = Uint8Array.of(0x99, 0xff, 0x8b, 0x00, 0x01, 0x02);
  const inspection = added.filter(([, r]) => r.reading === 'inspect');
  assert.equal(inspection.length, 404);
  for (const [ext] of inspection) assert.equal(detectFromHead('sample.' + ext, binary).viewer, 'fallback', ext);
});

test('content signatures override new filename aliases', () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  assert.equal(detectFromHead('image.abnf', png).viewer, 'image');
  assert.equal(detectFromHead('Makefile', png).viewer, 'image');
  assert.equal(detectFromHead('page.abnf', encode('%PDF-1.7\n')).viewer, 'pdf');
  const fakePdf = detectFromHead('page.pdf', encode('<?xml version="1.0"?><root/>'));
  assert.equal(fakePdf.viewer, 'xml');
  const netcdf = detectFromHead('data.nc', Uint8Array.of(0x43, 0x44, 0x46, 0x01, 0, 0, 0, 0));
  assert.equal(netcdf.method, 'magic');
  assert.equal(netcdf.viewer, 'hex');
  assert.equal(netcdf.record, null, 'nesC source must not acquire the NetCDF signature');
});

test('exact basenames are distinct from suffixes and work in paths', () => {
  assert.equal(FILENAME_MAP.size, 421);
  for (const [filename, record] of FILENAME_MAP) {
    assert.equal(findByFilename('/folder/' + filename), record, filename);
    assert.equal(findByFilename('C:\\folder\\' + filename), record, filename);
  }
  assert.equal(detectFromHead('Makefile', encode('all:\n\techo ready\n')).method, 'filename');
  assert.equal(detectFromHead('.gitignore', encode('node_modules/\n')).method, 'filename');
  assert.equal(getExt('folder.name/README'), undefined);
  assert.equal(getExt('C:\\folder.name\\README'), undefined);
});

test('longest real compound suffix wins, including punctuation', () => {
  assert.equal(getExt('source.c++'), 'c++');
  assert.equal(getExt('source.C++-OBJDUMP'), 'c++-objdump');
  assert.equal(getExt('source.JSON-tmLanguage'), 'json-tmlanguage');
  assert.equal(getExt('archive.tar.gz'), 'tar.gz');
  assert.equal(getExt('archive.tar.inventedcodec'), 'inventedcodec');
  assert.equal(getExt('.secret-unknown'), undefined);
  for (const ext of EXT_MAP.keys()) assert.equal(getExt('fixture.' + ext), ext, ext);
  assert.equal(getExt('a.'.repeat(100000) + 'json'), 'json');
});

test('unknown suffixes and inspection records can still reveal Unicode text', () => {
  for (const bytes of [encode(unicode), utf16(unicode), utf16(unicode, true)]) {
    assert.equal(detectFromHead('book.unregistered-extension', bytes).viewer, 'text');
    assert.equal(decodeUnicode(bytes), unicode);
  }
  const unknown = added.find(([, r]) => r.reading === 'inspect')[0];
  const result = detectFromHead('content.' + unknown, encode(JSON.stringify({ message: unicode })));
  assert.equal(result.viewer, 'json');
  assert.equal(result.method, 'content');
});

test('strict Unicode rejects malformed bytes and accepts truncated head code points', () => {
  for (const bad of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0, 1, 2, 3], [0xff, 0xfe, 0, 0, 65, 0, 0, 0]]) {
    assert.equal(probeText(Uint8Array.from(bad)), null, bad.toString());
  }
  const bytes = encode(unicode.repeat(20) + '😀');
  for (const cut of [1, 2, 3]) assert.ok(probeText(bytes.subarray(0, bytes.length - cut)));
  assert.equal(probeText(utf16('a sufficiently long ASCII message').subarray(2)).encoding, 'utf-16le');
});

test('text reader fetches beyond the 64KB head and reports preview truncation', async () => {
  const text = 'x'.repeat(90000) + unicode;
  const file = new Blob([text]);
  const result = await readTextBytes(file, null, 100000);
  assert.equal(decodeUnicode(result.bytes), text);
  assert.equal(result.truncated, false);
  const limited = await readTextBytes(file, null, 8192);
  assert.equal(limited.bytes.length, 8192);
  assert.equal(limited.truncated, true);
  const loaded = await readTextBytes(file, await file.arrayBuffer(), 8192);
  assert.deepEqual(loaded, limited);
});

test('explorer has unique keys and separates filenames, extensions, and byte inspection', () => {
  assert.equal(new Set(EXPLORER_ROWS.map(r => r.key)).size, EXPLORER_ROWS.length);
  assert.equal(EXPLORER_ROWS.filter(r => r.kind === 'format').length, EXT_MAP.size);
  assert.equal(EXPLORER_ROWS.filter(r => r.kind === 'filename').length, FILENAME_MAP.size);
  assert.equal(FORMAT_STATS.sourcedTextExtensions, 831);
  assert.equal(FORMAT_STATS.sourcedDecodedExtensions, 3);
  assert.equal(FORMAT_STATS.sourcedInspectionExtensions, 404);
  for (const row of EXPLORER_ROWS.filter(r => r.kind === 'encoding')) assert.doesNotThrow(() => new TextDecoder(row.label));
  assert.ok(SOURCED_FORMATS.every(r => r.source && r.reading));
});
