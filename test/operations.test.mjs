import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import { createRunner } from '../lib/cli.js';
import { readConfig } from '../lib/core.js';
import {
  buildGraph,
  collectStatus,
  explainNode,
  exportGraph,
  godNodes,
  pathGraph,
  queryGraph,
  runCommand,
} from '../lib/operations.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));
const CONFIG = readConfig({});
const RUNNER = createRunner(CONFIG);
const AGENT = { id: 'agent-test' };
const SIGNAL = new AbortController().signal;

let cliSkip = false;
try {
  await RUNNER.probe(process.cwd(), SIGNAL);
} catch {
  cliSkip = 'graphify CLI is not installed in this environment';
}

const project = await mkdtemp(join(tmpdir(), 'graphify-operations-'));
await cp(join(FIXTURE, 'src'), join(project, 'src'), { recursive: true });

after(async () => {
  await rm(project, { recursive: true, force: true });
});

/** Context whose Session directory is the temporary project. */
const ctx = {
  get(name) {
    if (name === 'workingDirectory') return { ensure: async () => project };
    return undefined;
  },
};

const exec = { agent: AGENT, signal: SIGNAL };

test('collectStatus reports the CLI and the missing graph before a build', { skip: cliSkip }, async () => {
  const status = await collectStatus(ctx, CONFIG, RUNNER, '', exec);
  assert.equal(status.cli.found, true);
  assert.match(status.cli.version, /graphify/u);
  assert.equal(status.project, project);
  assert.equal(status.projectExists, true);
  assert.equal(status.graph.exists, false);
  assert.equal(status.totals.nodes, 0);
  assert.equal(status.artifacts.report, false);
});

test('buildGraph indexes the corpus locally and writes every artifact', { skip: cliSkip }, async () => {
  const result = await buildGraph(ctx, CONFIG, RUNNER, { mode: 'code' }, exec);
  assert.equal(result.mode, 'code');
  assert.equal(result.project, project);
  assert.match(result.text, /finished/u);
  assert.match(result.log, /extract/u);
  assert.match(result.log, /cluster-only/u);
  assert.ok(result.status.totals.nodes > 0);
  assert.ok(result.status.totals.edges > 0);
  assert.equal(result.status.artifacts.report, true);
  assert.equal(result.status.artifacts.html, true);
});

test('collectStatus now reads the built graph and its analysis', { skip: cliSkip }, async () => {
  const status = await collectStatus(ctx, CONFIG, RUNNER, '', exec);
  assert.equal(status.graph.exists, true);
  assert.ok(status.graph.nodes > 0);
  assert.ok(status.graph.edges > 0);
  assert.ok(status.graph.communities.length > 0);
  assert.equal(
    status.graph.confidence.extracted + status.graph.confidence.inferred + status.graph.confidence.ambiguous,
    status.graph.edges,
  );
  assert.ok(status.analysis.gods.length > 0);
});

test('queryGraph answers a natural-language question', { skip: cliSkip }, async () => {
  const result = await queryGraph(ctx, CONFIG, RUNNER, { question: 'how does start use the connection pool' }, exec);
  assert.equal(result.exitCode, 0);
  assert.match(result.text, /Graph:/u);
  assert.match(result.text, /NODE /u);
});

test('queryGraph rejects an empty question before spawning the CLI', async () => {
  await assert.rejects(queryGraph(ctx, CONFIG, RUNNER, { question: '   ' }, exec), /question is required/u);
});

test('queryGraph rejects a missing project directory', async () => {
  await assert.rejects(
    queryGraph(ctx, CONFIG, RUNNER, { question: 'x', path: join(project, 'missing') }, exec),
    /project directory not found/u,
  );
});

test('pathGraph finds a path between two symbols', { skip: cliSkip }, async () => {
  const result = await pathGraph(ctx, CONFIG, RUNNER, { source: 'start()', target: 'pool' }, exec);
  assert.ok([0, 3, 4].includes(result.exitCode));
  assert.ok(result.text.length > 0);
  if (result.exitCode === 0) assert.match(result.text, /Shortest path/u);
});

test('explainNode describes one node and its neighbors', { skip: cliSkip }, async () => {
  const result = await explainNode(ctx, CONFIG, RUNNER, { node: 'pool' }, exec);
  assert.equal(result.exitCode, 0);
  assert.match(result.text, /Node: pool/u);
  assert.match(result.text, /Connections/u);
});

test('godNodes returns the architectural hubs as data and text', { skip: cliSkip }, async () => {
  const result = await godNodes(ctx, CONFIG, RUNNER, { top: 3 }, exec);
  assert.ok(result.nodes.length > 0);
  assert.ok(result.nodes.length <= 3);
  assert.match(result.text, /^1\. /u);
  for (const node of result.nodes) assert.equal(typeof node.degree, 'number');
});

test('graphify_build rejects an unknown mode before spawning', async () => {
  await assert.rejects(buildGraph(ctx, CONFIG, RUNNER, { mode: 'deep' }, exec), /unknown build mode/u);
});

test('buildGraph reports a missing project directory', async () => {
  await assert.rejects(buildGraph(ctx, CONFIG, RUNNER, { path: join(project, 'missing') }, exec), /project directory not found/u);
});

test('exportGraph writes the wiki artifact', { skip: cliSkip }, async () => {
  const result = await exportGraph(ctx, CONFIG, RUNNER, { format: 'wiki' }, exec);
  assert.match(result.text, /exported wiki/u);
  assert.ok(result.produced.endsWith(join('graphify-out', 'wiki', 'index.md')));
  const index = await readFile(join(project, 'graphify-out', 'wiki', 'index.md'), 'utf8');
  assert.ok(index.length > 0);
});

test('exportGraph rejects an unsupported format', { skip: cliSkip }, async () => {
  await assert.rejects(exportGraph(ctx, CONFIG, RUNNER, { format: 'pdf' }, exec), /unsupported export format/u);
});

test('runCommand maps subcommands to operations', { skip: cliSkip }, async () => {
  assert.match(await runCommand(ctx, CONFIG, RUNNER, '', exec), /project:/u);
  assert.match(await runCommand(ctx, CONFIG, RUNNER, 'status', exec), /graph:/u);
  assert.match(await runCommand(ctx, CONFIG, RUNNER, 'build code', exec), /finished/u);
  assert.match(await runCommand(ctx, CONFIG, RUNNER, 'query how does start reach the pool', exec), /Graph:|No matching/u);
  assert.match(await runCommand(ctx, CONFIG, RUNNER, 'explain pool', exec), /Node: pool/u);
  assert.match(await runCommand(ctx, CONFIG, RUNNER, 'god', exec), /\d+\. /u);
  assert.match(await runCommand(ctx, CONFIG, RUNNER, 'export wiki', exec), /exported wiki/u);
  assert.match(await runCommand(ctx, CONFIG, RUNNER, 'help', exec), /usage: \/graphify/u);
});

test('runCommand rejects unusable input without spawning', async () => {
  await assert.rejects(runCommand(ctx, CONFIG, RUNNER, 'nope', exec), /unknown subcommand/u);
  await assert.rejects(runCommand(ctx, CONFIG, RUNNER, 'query', exec), /missing question/u);
  await assert.rejects(runCommand(ctx, CONFIG, RUNNER, 'path', exec), /missing path endpoints/u);
  await assert.rejects(runCommand(ctx, CONFIG, RUNNER, 'explain', exec), /missing node/u);
  await assert.rejects(runCommand(ctx, CONFIG, RUNNER, 'export', exec), /missing export format/u);
});
