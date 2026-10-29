import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ANALYSIS_FILE,
  BUILD_LOG_TAIL_LINES,
  COMMAND_USAGE,
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_COMMAND,
  DEFAULT_QUERY_TIMEOUT_MS,
  GRAPH_FILE,
  GRAPHIFY_OUT,
  HTML_FILE,
  INSTALL_HINT,
  REPORT_FILE,
  WIKI_INDEX,
  buildSteps,
  commandCandidates,
  firstLine,
  formatBytes,
  graphFileFor,
  inspectAnalysis,
  inspectArtifacts,
  inspectGraph,
  normalizeFormat,
  normalizeMode,
  positive,
  readConfig,
  requireProject,
  resolveProject,
  statusText,
  tailLines,
  text,
} from '../lib/core.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));
const FIXTURE_GRAPH = join(FIXTURE, GRAPHIFY_OUT, GRAPH_FILE);

/** Minimal Agent stand-in: services are duck-typed by the operations layer. */
const AGENT = { id: 'agent-test' };
const SIGNAL = new AbortController().signal;

/**
 * Build a context whose working directory is fixed.
 * @param {string} directory - directory `ensure` reports.
 * @returns ctx stand-in with `get()`.
 */
function contextAt(directory) {
  return {
    get(name) {
      if (name === 'workingDirectory') {
        return { ensure: async () => directory, set: async (_agent, next) => next };
      }
      return undefined;
    },
  };
}

test('readConfig applies defaults to an empty row config', () => {
  assert.deepEqual(readConfig({}), {
    command: DEFAULT_COMMAND,
    extraArgs: [],
    projectPath: '',
    graphPath: '',
    buildTimeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
    queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
  });
});

test('readConfig normalizes overrides and rejects unusable values', () => {
  const config = readConfig({
    command: '  uvx ',
    extraArgs: ['graphifyy', '', 7, null],
    projectPath: ' ./demo ',
    graphPath: '/tmp/graph.json',
    buildTimeoutMs: 5000,
    queryTimeoutMs: -1,
  });
  assert.equal(config.command, 'uvx');
  assert.deepEqual(config.extraArgs, ['graphifyy']);
  assert.equal(config.projectPath, './demo');
  assert.equal(config.graphPath, '/tmp/graph.json');
  assert.equal(config.buildTimeoutMs, 5000);
  assert.equal(config.queryTimeoutMs, DEFAULT_QUERY_TIMEOUT_MS);
});

test('readConfig ignores array and null input', () => {
  assert.equal(readConfig(null).command, DEFAULT_COMMAND);
  assert.equal(readConfig(['graphify']).command, DEFAULT_COMMAND);
});

test('text, firstLine, and positive normalize untrusted values', () => {
  assert.equal(text('  hi  '), 'hi');
  assert.equal(text('   ', 'fallback'), 'fallback');
  assert.equal(text(42), '');
  assert.equal(firstLine('\n  first line  \nsecond'), 'first line');
  assert.equal(firstLine(undefined), '');
  assert.equal(positive(5, 1), 5);
  assert.equal(positive(0, 7), 7);
  assert.equal(positive(Number.NaN, 7), 7);
  assert.equal(positive('5', 7), 7);
});

test('formatBytes renders bounded human sizes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(15 * 1024 * 1024), '15 MB');
  assert.equal(formatBytes(-1), 'n/a');
  assert.equal(formatBytes('12'), 'n/a');
});

test('tailLines keeps the trailing non-empty lines', () => {
  const log = 'one\n\ntwo\nthree\n';
  assert.equal(tailLines(log, 2), 'two\nthree');
  assert.equal(BUILD_LOG_TAIL_LINES, 24);
});

test('commandCandidates probes absolute paths once and expands bare names', () => {
  assert.deepEqual(commandCandidates('/opt/graphify'), ['/opt/graphify']);
  assert.deepEqual(commandCandidates('./bin/graphify'), ['./bin/graphify']);
  const candidates = commandCandidates('graphify');
  assert.equal(candidates[0], 'graphify');
  assert.ok(candidates.some((candidate) => candidate.endsWith(join('.local', 'bin', 'graphify'))));
  assert.ok(candidates.some((candidate) => candidate.includes(join('uv', 'tools', 'graphifyy'))));
});

test('resolveProject prefers the call, then config, then the Session directory', async () => {
  const ctx = contextAt('/work/base');
  const exec = { agent: AGENT, signal: SIGNAL };
  assert.equal(await resolveProject(ctx, readConfig({}), '', exec), '/work/base');
  assert.equal(await resolveProject(ctx, readConfig({ projectPath: '/configured' }), '', exec), '/configured');
  assert.equal(await resolveProject(ctx, readConfig({ projectPath: './relative' }), '', exec), '/work/base/relative');
  assert.equal(await resolveProject(ctx, readConfig({ projectPath: '/configured' }), './call', exec), '/work/base/call');
  assert.equal(await resolveProject(ctx, readConfig({}), '/absolute/call', exec), '/absolute/call');
});

test('resolveProject falls back to the process directory without a workingDirectory service', async () => {
  const project = await resolveProject({ get: () => undefined }, readConfig({}), '', { signal: SIGNAL });
  assert.equal(project, process.cwd());
});

test('graphFileFor honors the graphPath override', () => {
  assert.equal(graphFileFor('/project', readConfig({})), join('/project', GRAPHIFY_OUT, GRAPH_FILE));
  assert.equal(graphFileFor('/project', readConfig({ graphPath: '/explicit.json' })), '/explicit.json');
  assert.equal(graphFileFor('/project', readConfig({ graphPath: 'out/graph.json' })), join('/project', 'out', 'graph.json'));
});

test('inspectGraph reads the authentic fixture graph', () => {
  const graph = inspectGraph(FIXTURE_GRAPH);
  assert.equal(graph.exists, true);
  assert.equal(graph.path, FIXTURE_GRAPH);
  assert.equal(graph.nodes, 8);
  assert.equal(graph.edges, 11);
  assert.equal(graph.communities.length, 2);
  assert.deepEqual(graph.confidence, { extracted: 11, inferred: 0, ambiguous: 0 });
  assert.ok(graph.bytes > 0);
  assert.equal(graph.directed, false);
  for (const community of graph.communities) {
    assert.equal(typeof community.id, 'number');
    assert.ok(community.size > 0);
    assert.ok(community.labels.length > 0);
  }
});

test('inspectGraph reports missing and malformed graph files', async () => {
  const missing = inspectGraph('/definitely/not/here/graph.json');
  assert.deepEqual(missing, { exists: false, path: '/definitely/not/here/graph.json' });

  const directory = await mkdtemp(join(tmpdir(), 'graphify-core-'));
  try {
    const malformed = join(directory, GRAPH_FILE);
    await writeFile(malformed, '{"nodes": [', 'utf8');
    const graph = inspectGraph(malformed);
    assert.equal(graph.exists, true);
    assert.match(graph.error, /not valid JSON/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('inspectAnalysis reads gods and questions from the sidecar', () => {
  const analysis = inspectAnalysis(FIXTURE_GRAPH);
  assert.equal(analysis.exists, true);
  assert.ok(analysis.gods.length > 0);
  for (const node of analysis.gods) {
    assert.equal(typeof node.label, 'string');
    assert.equal(typeof node.degree, 'number');
  }
  assert.ok(Array.isArray(analysis.questions));
  assert.equal(analysis.path, join(FIXTURE, GRAPHIFY_OUT, ANALYSIS_FILE));
});

test('inspectAnalysis degrades to an empty record when the sidecar is missing', () => {
  const analysis = inspectAnalysis('/definitely/not/here/graph.json');
  assert.equal(analysis.exists, false);
  assert.deepEqual(analysis.gods, []);
  assert.deepEqual(analysis.questions, []);
});

test('inspectArtifacts reports the fixture without generated artifacts', () => {
  const artifacts = inspectArtifacts(FIXTURE);
  assert.equal(artifacts.report, false);
  assert.equal(artifacts.html, false);
  assert.equal(artifacts.wiki, false);
  assert.equal(artifacts.reportPath, join(FIXTURE, GRAPHIFY_OUT, REPORT_FILE));
  assert.equal(artifacts.htmlPath, join(FIXTURE, GRAPHIFY_OUT, HTML_FILE));
  assert.equal(artifacts.wikiPath, join(FIXTURE, GRAPHIFY_OUT, WIKI_INDEX));
});

test('statusText renders the CLI, graph, and artifact facts', () => {
  const status = {
    cli: { found: true, command: '/usr/local/bin/graphify', version: 'graphify 9.9.9' },
    project: '/work/demo',
    graph: {
      exists: true,
      path: '/work/demo/graphify-out/graph.json',
      bytes: 2048,
      nodes: 40,
      edges: 90,
      communities: [{ id: 0 }, { id: 1 }],
      confidence: { extracted: 81, inferred: 9, ambiguous: 0 },
    },
    analysis: { gods: [{ label: 'core()', degree: 9 }], questions: [{ question: 'what connects A to B?' }] },
    artifacts: { report: true, html: false, wiki: false },
  };
  const rendered = statusText(status);
  assert.match(rendered, /graphify CLI: graphify 9\.9\.9/u);
  assert.match(rendered, /project: \/work\/demo/u);
  assert.match(rendered, /40 nodes · 90 edges · 2 communities/u);
  assert.match(rendered, /90% EXTRACTED/u);
  assert.match(rendered, /artifacts: report ✓ · html ✗ · wiki ✗/u);
  assert.match(rendered, /god nodes: core\(\) \(9\)/u);
});

test('statusText explains the missing CLI and the missing graph', () => {
  const missingCli = statusText({
    cli: { found: false },
    project: '/work/demo',
    graph: { exists: false, path: '/work/demo/graphify-out/graph.json' },
    analysis: { gods: [], questions: [] },
    artifacts: { report: false, html: false, wiki: false },
  });
  assert.match(missingCli, new RegExp(INSTALL_HINT, 'u'));
  assert.match(missingCli, /graph: none/u);
});

test('normalizeMode and buildSteps describe the three build modes', () => {
  assert.equal(normalizeMode(undefined), 'code');
  assert.equal(normalizeMode(' UPDATE '), 'update');
  assert.equal(normalizeMode('full'), 'full');
  assert.throws(() => normalizeMode('deep'), /unknown build mode/u);

  assert.deepEqual(buildSteps('/p', 'code', false), [
    { args: ['extract', '/p', '--code-only'] },
    { args: ['cluster-only', '/p', '--no-label'] },
  ]);
  assert.deepEqual(buildSteps('/p', 'update', true), [{ args: ['update', '/p', '--force'] }]);
  assert.deepEqual(buildSteps('/p', 'full', false), [{ args: ['extract', '/p'] }]);
});

test('normalizeFormat accepts only exported artifacts', () => {
  assert.equal(normalizeFormat('WIKI'), 'wiki');
  for (const format of ['html', 'svg', 'graphml', 'obsidian']) {
    assert.equal(normalizeFormat(format), format);
  }
  assert.throws(() => normalizeFormat('pdf'), /unsupported export format/u);
});

test('requireProject rejects a missing directory', () => {
  assert.doesNotThrow(() => requireProject(FIXTURE));
  assert.throws(() => requireProject(join(FIXTURE, 'missing')), /project directory not found/u);
});

test('COMMAND_USAGE lists the command surface', () => {
  for (const token of ['status', 'build', 'query', 'path', 'explain', 'god']) {
    assert.match(COMMAND_USAGE, new RegExp(token, 'u'));
  }
});
