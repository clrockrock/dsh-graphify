/**
 * Graphify — codebase knowledge graphs for DeepSeek Harness.
 *
 * The Host half owns three surfaces over one integration: seven model-facing
 * `graphify_*` tools, a `/graphify` command, and the `/graphify/api/*` routes
 * the Graphify page reads. All of them delegate to the installed `graphify`
 * CLI (PyPI `graphifyy`), so graph building, query scoring, and report
 * rendering stay identical to the upstream tool.
 *
 * @module dsh-graphify
 */
import { readFileSync, statSync } from 'node:fs';
import { GRAPHIFY_OUT, HTML_FILE, MAX_GRAPH_BYTES, MAX_REPORT_BYTES, REPORT_FILE, firstLine, readConfig, statusText } from './lib/core.js';
import { createRunner } from './lib/cli.js';
import { Config } from './lib/config.js';
import {
  buildGraph,
  collectStatus,
  explainNode,
  exportGraph,
  godNodes,
  pathGraph,
  queryGraph,
  runCommand,
} from './lib/operations.js';

/** Cordis plugin name. */
export const name = 'dsh-graphify';
/** Services this plugin cannot work without; the Web and command halves inject their own. */
export const inject = ['tools'];

/** Request-body cap for the build API. */
const MAX_REQUEST_BYTES = 64 * 1024;

/** Canonical output declaration shared by every tool in this plugin. */
const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', description: 'Model-facing result text.' },
    },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: typeof value?.text === 'string' ? value.text : '' }],
};

/**
 * Build the tool definitions registered for every Agent.
 * @param ctx - plugin context used to resolve Session state.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @returns Registry-ready tool definitions.
 */
function defineTools(ctx, config, runner) {
  return [
    {
      name: 'graphify_status',
      description:
        'Inspect the graphify knowledge graph of a project: whether the graphify CLI is installed, where graph.json lives, its node/edge/community and EXTRACTED-INFERRED-AMBIGUOUS counts, and which artifacts (GRAPH_REPORT.md, graph.html, wiki) exist. Call this first; if no graph exists, call graphify_build with mode "code".',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Project directory. Defaults to the Session working directory.' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const status = await collectStatus(ctx, config, runner, args.path, exec);
        return { text: statusText(status) };
      },
    },
    {
      name: 'graphify_build',
      description:
        'Build or refresh the graphify knowledge graph for a project. mode "code" runs a local tree-sitter AST extraction with no LLM/API key and writes graph.json, GRAPH_REPORT.md and graph.html; mode "update" re-extracts only changed code files and merges them (fast, no LLM); mode "full" also extracts docs/PDFs/images through an LLM backend and needs an API key. Prefer "code" first.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Project directory. Defaults to the Session working directory.' },
          mode: { type: 'string', enum: ['code', 'update', 'full'], description: 'Extraction scope. Default code.' },
          force: { type: 'boolean', description: 'Force a full re-scan instead of the incremental cache.' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await buildGraph(ctx, config, runner, args, exec);
        return { text: [result.text, '', 'log tail:', result.log].filter((line) => line !== '').join('\n') };
      },
    },
    {
      name: 'graphify_query',
      description:
        'Ask a natural-language question about the project through its knowledge graph. BFS (default) returns broad context around matching nodes; dfs traces one dependency chain. The answer lists nodes with file/location and edges tagged EXTRACTED (found in source), INFERRED (deduced) or AMBIGUOUS (uncertain) — cheaper and more precise than reading many files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string', description: 'Natural-language question or keyword search.' },
          path: { type: 'string', description: 'Project directory. Defaults to the Session working directory.' },
          dfs: { type: 'boolean', description: 'Use depth-first traversal to trace one path instead of broad BFS context.' },
          budget: { type: 'integer', description: 'Output token budget. Default 2000.' },
          context: {
            type: 'array',
            items: { type: 'string' },
            description: 'Edge-context filters, e.g. ["call", "import"].',
          },
          seed: {
            type: 'array',
            items: { type: 'string' },
            description: 'Start nodes (id, label or file path) instead of keyword matches.',
          },
        },
        required: ['question'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await queryGraph(ctx, config, runner, args, exec);
        return { text: result.text };
      },
    },
    {
      name: 'graphify_path',
      description:
        'Find the shortest path between two concepts, symbols, files or modules in the knowledge graph — answers "how does A reach B" with every hop and its relation, instead of guessing import chains.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', description: 'Source concept label, id, file path, or keyword.' },
          target: { type: 'string', description: 'Target concept label, id, file path, or keyword.' },
          path: { type: 'string', description: 'Project directory. Defaults to the Session working directory.' },
          undirected: { type: 'boolean', description: 'Ignore stored edge direction while searching.' },
        },
        required: ['source', 'target'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await pathGraph(ctx, config, runner, args, exec);
        return { text: result.text };
      },
    },
    {
      name: 'graphify_explain',
      description:
        'Explain one node of the knowledge graph: its file and location, community, degree, and every neighbor with the relation that connects them. Use it after graphify_query identifies an interesting symbol.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          node: { type: 'string', description: 'Node label, id, or file path.' },
          path: { type: 'string', description: 'Project directory. Defaults to the Session working directory.' },
          all: { type: 'boolean', description: 'List every connection instead of the 20 most connected.' },
        },
        required: ['node'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await explainNode(ctx, config, runner, args, exec);
        return { text: result.text };
      },
    },
    {
      name: 'graphify_god_nodes',
      description:
        'List the most connected nodes of the knowledge graph — the architectural hubs everything flows through. Useful as the first orientation pass on an unfamiliar codebase.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Project directory. Defaults to the Session working directory.' },
          top: { type: 'integer', description: 'How many hubs to list. Default 10.' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await godNodes(ctx, config, runner, args, exec);
        return { text: result.text };
      },
    },
    {
      name: 'graphify_export',
      description:
        'Export one graph artifact: "wiki" writes agent-navigable markdown articles with an index, "html" writes the interactive graph page, "svg"/"graphml" write diagram/Gephi files, "obsidian" writes a vault. Exports land in the project graphify-out directory.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: { type: 'string', enum: ['wiki', 'html', 'svg', 'graphml', 'obsidian'], description: 'Artifact to export.' },
          path: { type: 'string', description: 'Project directory. Defaults to the Session working directory.' },
        },
        required: ['format'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await exportGraph(ctx, config, runner, args, exec);
        return { text: result.text };
      },
    },
  ];
}

/**
 * Register the model-facing tools on the plugin context.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 */
function registerTools(ctx, config, runner) {
  for (const definition of defineTools(ctx, config, runner)) {
    ctx.effect(() => ctx.tools.register(definition), `dsh-graphify: ${definition.name}`);
  }
}

/**
 * Read a JSON request body with a size cap.
 * @param req - incoming request.
 * @returns Parsed JSON object, or an empty object.
 */
function readJsonBody(req) {
  return new Promise((settle, fail) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        settled = true;
        fail(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) {
        settle({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        settle(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        fail(new Error('request body is not valid JSON'));
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      fail(error);
    });
  });
}

/**
 * Write one JSON response.
 * @param res - response.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable payload.
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/**
 * Serve one text or binary file with a content type.
 * @param res - response.
 * @param filePath - absolute file path.
 * @param contentType - response content type.
 * @param maxBytes - read cap.
 */
function sendFile(res, filePath, contentType, maxBytes) {
  try {
    const info = statSync(filePath);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const body = readFileSync(filePath);
    if (body.length > maxBytes) {
      res.writeHead(413);
      res.end('file too large');
      return;
    }
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

/**
 * Handle one `/graphify/**` request.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param req - incoming request.
 * @param res - response.
 */
async function handleRoute(ctx, config, runner, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = `${req.method ?? 'GET'} ${url.pathname}`;
  try {
    if (route === 'GET /graphify/api/status') {
      const status = await collectStatus(ctx, config, runner, url.searchParams.get('path') ?? '', {});
      sendJson(res, 200, { ok: true, value: status });
      return;
    }
    if (route === 'POST /graphify/api/build') {
      const body = await readJsonBody(req);
      const result = await buildGraph(ctx, config, runner, { path: body.path, mode: body.mode, force: body.force === true }, {});
      sendJson(res, 200, { ok: true, value: { text: result.text, log: result.log, mode: result.mode, project: result.project, status: result.status } });
      return;
    }
    if (route === 'POST /graphify/api/export') {
      const body = await readJsonBody(req);
      const result = await exportGraph(ctx, config, runner, { path: body.path, format: body.format }, {});
      sendJson(res, 200, { ok: true, value: { text: result.text, format: result.format, produced: result.produced } });
      return;
    }
    if (route === 'GET /graphify/api/report') {
      const status = await collectStatus(ctx, config, runner, url.searchParams.get('path') ?? '', {});
      if (!status.artifacts.report) {
        sendJson(res, 404, { ok: false, error: { code: 'graphify/no-report', message: `no ${REPORT_FILE} in ${status.project}/${GRAPHIFY_OUT}` } });
        return;
      }
      sendFile(res, status.artifacts.reportPath, 'text/markdown; charset=utf-8', MAX_REPORT_BYTES);
      return;
    }
    if (route === 'GET /graphify/graph.html') {
      const status = await collectStatus(ctx, config, runner, url.searchParams.get('path') ?? '', {});
      if (!status.artifacts.html) {
        sendJson(res, 404, { ok: false, error: { code: 'graphify/no-html', message: `no ${HTML_FILE} in ${status.project}/${GRAPHIFY_OUT}` } });
        return;
      }
      sendFile(res, status.artifacts.htmlPath, 'text/html; charset=utf-8', MAX_GRAPH_BYTES);
      return;
    }
    sendJson(res, 404, { ok: false, error: { code: 'graphify/not-found', message: `unknown route ${route}` } });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: { code: 'graphify/internal', message: firstLine(error?.message) || String(error) } });
  }
}

/**
 * Register the read-only HTTP surface the Web page consumes.
 * @param ctx - plugin context that owns webServer.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 */
function registerHttp(ctx, config, runner) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/graphify',
        handler: (req, res) => handleRoute(ctx, config, runner, req, res),
      }),
    'dsh-graphify: http routes',
  );
}

/**
 * Register the human `/graphify` command.
 * @param ctx - plugin context that owns commands.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 */
function registerCommand(ctx, config, runner) {
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'graphify',
        description: 'Build, refresh, and query the graphify knowledge graph of the current project.',
        input: { hint: 'status | build [code|update|full] | query <question> | path <a> <b> | explain <node> | god' },
        async handler(invocation) {
          try {
            const output = await runCommand(ctx, config, runner, invocation.rawInput, {
              agent: invocation.agent,
              signal: invocation.signal,
            });
            return { kind: 'success', text: output };
          } catch (error) {
            return { kind: 'error', text: firstLine(error?.message) || String(error) };
          }
        },
      }),
    'dsh-graphify: /graphify command',
  );
}

/**
 * Activate the plugin: capture the context tools close over, then register each
 * surface. Optional services are injected so a profile without a web server or
 * command registry still gets the tools.
 * @param ctx - plugin context.
 * @param rawConfig - row config from the bundle patch.
 */
export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig);
  const runner = createRunner(config);
  registerTools(ctx, config, runner);
  ctx.inject(['webServer'], (scoped) => registerHttp(scoped, config, runner));
  ctx.inject(['commands'], (scoped) => registerCommand(scoped, config, runner));
}

export { Config };
