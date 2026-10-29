import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { apply, Config } from '../index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));
const AGENT = { id: 'agent-test' };
const SIGNAL = new AbortController().signal;

/**
 * Build a minimal Cordis context that records every registration.
 * @param {string} cwd - directory the Session reports.
 * @returns registration tables plus the context handed to `apply`.
 */
function createContext(cwd) {
  const registrations = { tools: new Map(), routes: [], commands: [] };
  const ctx = {
    effect(run) {
      run();
      return () => {};
    },
    inject(_dependencies, callback) {
      callback(ctx);
    },
    get(name) {
      if (name === 'workingDirectory') return { ensure: async () => cwd };
      return undefined;
    },
    tools: {
      register(definition) {
        registrations.tools.set(definition.name, definition);
        return () => {};
      },
    },
    webServer: {
      register(route) {
        registrations.routes.push(route);
        return () => {};
      },
    },
    commands: {
      register(definition) {
        registrations.commands.push(definition);
        return () => {};
      },
    },
    logger: { info() {}, warn() {}, debug() {} },
  };
  return { ctx, ...registrations };
}

test('apply registers the seven tools, the route, and the command', () => {
  const { ctx, tools, routes, commands } = createContext(FIXTURE);
  apply(ctx, {});

  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      'graphify_build',
      'graphify_explain',
      'graphify_export',
      'graphify_god_nodes',
      'graphify_path',
      'graphify_query',
      'graphify_status',
    ],
  );
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, '/graphify');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'graphify');
  assert.equal(typeof commands[0].handler, 'function');

  for (const definition of tools.values()) {
    assert.equal(typeof definition.name, 'string');
    assert.ok(definition.description.length > 40);
    assert.equal(definition.parameters.type, 'object');
    assert.equal(definition.output.schema.type, 'object');
    assert.equal(typeof definition.output.render, 'function');
    assert.equal(typeof definition.execute, 'function');
    assert.deepEqual(definition.output.render({}, { text: 'x' }), [{ type: 'text', text: 'x' }]);
  }
});

test('Config is either a loader schema or intentionally absent', () => {
  assert.ok(Config === undefined || typeof Config === 'function');
  if (typeof Config === 'function') {
    const resolved = Config({});
    assert.equal(resolved.command, 'graphify');
    assert.deepEqual(resolved.extraArgs, []);
  }
});

test('graphify_status renders the fixture facts', async () => {
  const { ctx, tools } = createContext(FIXTURE);
  apply(ctx, {});
  const definition = tools.get('graphify_status');
  const exec = { agent: AGENT, signal: SIGNAL };
  const value = await definition.execute({ path: FIXTURE }, exec);
  const text = definition.output.render({ path: FIXTURE }, value)[0].text;
  assert.match(text, /project: /u);
  assert.match(text, /8 nodes · 11 edges · 2 communities/u);
  assert.match(text, /artifacts: report ✗ · html ✗ · wiki ✗/u);
});

test('configured projectPath is the default when a call omits path', async () => {
  const { ctx, tools } = createContext('/unused');
  apply(ctx, { projectPath: FIXTURE });
  const definition = tools.get('graphify_status');
  const exec = { agent: AGENT, signal: SIGNAL };
  const value = await definition.execute({}, exec);
  const text = definition.output.render({}, value)[0].text;
  assert.match(text, new RegExp(`project: ${FIXTURE.replaceAll('/', '\\/')}`, 'u'));
  assert.match(text, /8 nodes/u);
});

test('tools reject unusable arguments before spawning the CLI', async () => {
  const { ctx, tools } = createContext(FIXTURE);
  apply(ctx, {});
  const exec = { agent: AGENT, signal: SIGNAL };
  await assert.rejects(tools.get('graphify_query').execute({}, exec), /question is required/u);
  await assert.rejects(tools.get('graphify_build').execute({ mode: 'deep' }, exec), /unknown build mode/u);
  await assert.rejects(tools.get('graphify_export').execute({ format: 'pdf' }, exec), /unsupported export format/u);
  await assert.rejects(tools.get('graphify_path').execute({ source: 'a' }, exec), /source and target are required/u);
  await assert.rejects(tools.get('graphify_explain').execute({}, exec), /node is required/u);
});

test('the HTTP surface serves status and rejects unknown routes', async (t) => {
  const { ctx, routes } = createContext(FIXTURE);
  apply(ctx, {});
  const route = routes[0];
  const server = createServer((request, response) => {
    route.handler(request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(
    () =>
      new Promise((ready) => {
        server.closeAllConnections();
        server.close(ready);
      }),
  );
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const statusResponse = await fetch(`${base}/graphify/api/status?path=${encodeURIComponent(FIXTURE)}`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.ok, true);
  assert.equal(status.value.graph.nodes, 8);
  assert.equal(status.value.graph.edges, 11);
  assert.ok(status.value.graphPath.endsWith(join('graphify-out', 'graph.json')));
  assert.equal(status.value.artifacts.report, false);

  for (const routePath of ['/graphify/api/report', '/graphify/graph.html']) {
    const response = await fetch(`${base}${routePath}?path=${encodeURIComponent(FIXTURE)}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).ok, false);
  }

  const unknown = await fetch(`${base}/graphify/api/nope`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'graphify/not-found');

  const malformed = await fetch(`${base}/graphify/api/build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json',
  });
  assert.equal(malformed.status, 500);
  assert.equal((await malformed.json()).error.code, 'graphify/internal');
});
