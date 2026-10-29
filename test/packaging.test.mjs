import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Read one repository file as UTF-8.
 * @param {string} relativePath - repository-relative path.
 * @returns file text.
 */
async function readText(relativePath) {
  return readFile(join(ROOT, relativePath), 'utf8');
}

/**
 * Read and parse one JSON file.
 * @param {string} relativePath - repository-relative path.
 * @returns parsed JSON.
 */
async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

test('package.json declares the installable bundle and its metadata', async () => {
  const manifest = await readJson('package.json');
  assert.equal(manifest.name, 'dsh-graphify');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/u);
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, 'index.js');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.exports['./icon'], './icon.svg');
  assert.ok(manifest.exports['./locale/*.json']);
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.match(manifest.engines.dsh, /^>=/u);
  for (const required of ['index.js', 'lib', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'README.md', 'LICENSE']) {
    assert.ok(manifest.files.includes(required), `files is missing ${required}`);
  }
});

test('the bundle patch inserts exactly this package under a matching id', async () => {
  const patch = await readText('cordis.patch.yml');
  assert.match(patch, /^- insert:$/mu);
  assert.match(patch, /^\s+- id: dsh-graphify$/mu);
  assert.match(patch, /^\s+name: dsh-graphify$/mu);
  const manifest = await readJson('package.json');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
});

test('locale resources carry the Plugin Manager title and description in both languages', async () => {
  const en = await readJson('locale/en.json');
  const zh = await readJson('locale/zh.json');
  for (const locale of [en, zh]) {
    assert.equal(typeof locale.meta.title, 'string');
    assert.ok(locale.meta.title.length > 0);
    assert.ok(locale.meta.description.length > 20);
  }
  assert.deepEqual(Object.keys(en.meta).sort(), Object.keys(zh.meta).sort());
  assert.notEqual(en.meta.title, zh.meta.title);
});

test('icons are a valid SVG and a raster tile for the market', async () => {
  const svg = await readText('icon.svg');
  assert.match(svg, /^<svg /u);
  assert.match(svg, /viewBox="0 0 64 64"/u);

  const png = await readFile(join(ROOT, 'assets', 'icon-256.png'));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const info = await stat(join(ROOT, 'assets', 'icon-256.png'));
  assert.ok(info.size > 2_000, 'icon tile should be a real raster image');
  assert.ok(info.size < 256 * 1024);
});

test('the client half is a single loader module with no Harness Client imports', async () => {
  const client = await readText('client.js');
  const entry = client.replace(/^\/\*\*[\s\S]*?\*\/\n/u, '');
  assert.match(entry, /^window\.__ModuleLoader__\.load\(\{/u);
  assert.match(client, /id: 'dsh-graphify'/u);
  const required = [...client.matchAll(/require\('([^']+)'\)/gu)].map((match) => match[1]);
  assert.equal(required.length, required.filter((name) => name === 'react').length);
  assert.doesNotMatch(client, /@deepseek-ai\//u);
  assert.match(client, /ctx\.slots\.inject\('main'/u);
  assert.match(client, /ctx\.slots\.inject\('sidebar\.panellist'/u);
  assert.match(client, /ctx\.locale\.register/u);
});

test('the Host half imports only Node built-ins', async () => {
  const files = ['index.js', ...(await readdir(join(ROOT, 'lib'))).filter((name) => name.endsWith('.js')).map((name) => join('lib', name))];
  for (const file of files) {
    const source = await readText(file);
    for (const match of source.matchAll(/^import[^;]*?from '([^']+)';/gmu)) {
      const specifier = match[1];
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('./'), `${file} imports ${specifier}`);
      assert.doesNotMatch(specifier, /@deepseek-ai\//u);
    }
  }
});

test('READMEs document the install command and the CLI prerequisite', async () => {
  for (const file of ['README.md', 'README.zh.md']) {
    const text = await readText(file);
    assert.match(text, /uv tool install graphifyy/u);
    assert.match(text, /dsh plugin --profile web add github:clrockrock\/dsh-graphify/u);
    assert.match(text, /graphify_status/u);
  }
});

test('the committed test fixture is an authentic graphify graph', async () => {
  const graph = await readJson(join('test', 'fixtures', 'corpus', 'graphify-out', 'graph.json'));
  assert.ok(Array.isArray(graph.nodes));
  assert.ok(Array.isArray(graph.links));
  assert.equal(graph.nodes.length, 8);
  assert.equal(graph.links.length, 11);
  assert.ok(graph.nodes.every((node) => typeof node.id === 'string' && typeof node.label === 'string'));
  assert.ok(graph.links.every((link) => typeof link.confidence === 'string'));

  const analysis = await readJson(join('test', 'fixtures', 'corpus', 'graphify-out', '.graphify_analysis.json'));
  assert.ok(Array.isArray(analysis.gods));
  assert.ok(analysis.gods.length > 0);
});
