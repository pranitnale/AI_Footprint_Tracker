import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { llmAssets, videoAssets } from '../src/index.js';
import { boundaryCases } from '../test/fixtures.js';
import { catalogCases, numericalCases } from './differential.js';

export interface SourceMappingRow {
  upstream_file: string; symbol: string; line: number; source_sha256: string;
  port: string | null; implementation: string | null; fixtures: string[];
  disposition: string; reason?: string;
}
export interface SourceMap { schema_version: number; functions_and_types: SourceMappingRow[] }
const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = new Set([...boundaryCases(), ...catalogCases(), ...numericalCases(1)].map(fixture => fixture.id));
const declarations = new Map<string, Set<string>>();

function declarationNames(file: string): Set<string> {
  const cached = declarations.get(file);
  if (cached) return cached;
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  declarations.set(file, names);
  return names;
}

/** Resolve references; source hashes/AST inventory are independently checked by check_surface.py. */
export function validateReferences(mapping: SourceMap): void {
  assert.equal(mapping.schema_version, 2, 'Unsupported source-map schema');
  for (const row of mapping.functions_and_types) {
    const label = `${row.upstream_file}:${row.symbol}`;
    assert.ok(['implemented', 'adapted', 'domain-limited', 'build-time', 'excluded'].includes(row.disposition), `${label}: disposition`);
    assert.ok(Array.isArray(row.fixtures), `${label}: fixtures must be executable IDs`);
    if (row.disposition !== 'implemented') assert.ok(typeof row.reason === 'string' && row.reason.length >= 30, `${label}: specific disposition reason`);
    if (row.disposition === 'excluded') {
      assert.equal(row.port, null, `${label}: excluded code must not claim an implementation`);
      assert.equal(row.implementation, null);
      assert.deepEqual(row.fixtures, []);
      continue;
    }
    assert.equal(typeof row.port, 'string', `${label}: implementation file`);
    assert.equal(typeof row.implementation, 'string', `${label}: implementation symbol`);
    const file = resolve(root, row.port!);
    const path = relative(root, file);
    assert.ok(!path.startsWith('..') && !isAbsolute(path) && existsSync(file), `${label}: missing or outside implementation file`);
    if (file.endsWith('.ts')) {
      const [symbol, member, extra] = row.implementation!.split('.');
      assert.equal(extra, undefined, `${label}: unsupported symbol path`);
      assert.ok(declarationNames(file).has(symbol), `${label}: missing TypeScript declaration ${symbol}`);
      if (member !== undefined) {
        const assets = row.port === 'src/llm.ts' && symbol === 'llmAssets' ? llmAssets : row.port === 'src/video.ts' && symbol === 'videoAssets' ? videoAssets : null;
        assert.ok(assets && Object.hasOwn(assets, member), `${label}: missing asset ${member}`);
      }
    } else assert.ok(file.endsWith('.py'), `${label}: unsupported implementation file kind`);
    assert.ok(row.fixtures.length > 0, `${label}: missing executable fixtures`);
    for (const id of row.fixtures) assert.ok(fixtures.has(id), `${label}: unknown fixture ${id}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mapping = process.argv.includes('--stdin') ? JSON.parse(readFileSync(0, 'utf8')) : JSON.parse(readFileSync(resolve(root, 'source-to-port-map.json'), 'utf8'));
  validateReferences(mapping);
  console.log(`Resolved ${mapping.functions_and_types.length} implementation/fixture dispositions.`);
}
