/**
 * Graphify operations shared by the tools, the `/graphify` command, and the
 * HTTP surface the Web page reads.
 *
 * Every operation delegates to the upstream CLI so build steps, query scoring,
 * and report rendering stay identical to graphify itself; this module only
 * resolves the project, assembles arguments, bounds the run, and classifies the
 * outcome.
 *
 * @module dsh-graphify/lib/operations
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_LOG_TAIL_LINES,
  COMMAND_USAGE,
  GRAPHIFY_OUT,
  buildSteps,
  firstLine,
  graphFileFor,
  inspectAnalysis,
  inspectGraph,
  inspectArtifacts,
  normalizeFormat,
  normalizeMode,
  requireProject,
  resolveProject,
  statusText,
  tailLines,
  text,
} from './core.js';
import { failure, wasTimedOut } from './cli.js';

/**
 * One-shot status probe shared by the status tool, the /graphify command, and
 * the Web API.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param requested - optional project directory from the caller.
 * @param exec - tool/command execution context.
 * @returns Status value with CLI, project, graph, artifacts, and analysis facts.
 */
async function collectStatus(ctx, config, runner, requested, exec) {
  const project = await resolveProject(ctx, config, requested, exec);
  const graphPath = graphFileFor(project, config);
  const artifacts = inspectArtifacts(project);
  const graph = inspectGraph(graphPath);
  const analysis = graph.exists === true ? inspectAnalysis(graphPath) : { exists: false, gods: [], questions: [], surprises: [] };
  let cli;
  try {
    const target = await runner.probe(existsSync(project) ? project : process.cwd(), exec?.signal);
    cli = { found: true, command: target.file, version: target.version };
  } catch (error) {
    cli = { found: false, command: null, version: null, error: firstLine(error?.message) || String(error) };
  }
  const total = graph.exists === true ? graph.nodes + graph.edges : 0;
  return {
    cli,
    project,
    projectExists: existsSync(project),
    graph,
    analysis,
    artifacts,
    graphPath,
    totals: {
      nodes: graph.exists === true ? graph.nodes : 0,
      edges: graph.exists === true ? graph.edges : 0,
      communities: graph.exists === true ? graph.communities.length : 0,
      confidence: graph.exists === true ? graph.confidence : { extracted: 0, inferred: 0, ambiguous: 0 },
      weighted: total,
    },
    defaults: {
      projectPath: config.projectPath,
      command: config.command,
    },
  };
}

/**
 * Build, update, or fully extract the graph for one project.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param args - tool arguments.
 * @param exec - tool execution context.
 * @returns Build value with the produced graph summary and CLI log tail.
 */
async function buildGraph(ctx, config, runner, args, exec) {
  const project = await resolveProject(ctx, config, args.path, exec);
  if (!existsSync(project)) throw new Error(`project directory not found: ${project}`);
  const mode = normalizeMode(args.mode);
  const force = args.force === true;
  const deadline = Date.now() + config.buildTimeoutMs;
  const steps = buildSteps(project, mode, force);
  const logs = [];
  const started = Date.now();
  for (const step of steps) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('build timed out before completing every step');
    logs.push(`$ graphify ${step.args.join(' ')}`);
    const outcome = await runner.run(step.args, {
      cwd: project,
      timeoutMs: remaining,
      signal: exec?.signal,
    });
    const log = [outcome.stdout, outcome.stderr].filter((part) => part !== '').join('\n');
    if (log !== '') logs.push(tailLines(log, BUILD_LOG_TAIL_LINES));
    if (outcome.aborted || exec?.signal?.aborted === true) throw new Error('build was cancelled');
    if (wasTimedOut(outcome, exec?.signal)) throw new Error(`build timed out while running "graphify ${step.args[0]}"`);
    if (outcome.exitCode !== 0) {
      throw new Error(
        `graphify ${step.args[0]} failed (exit ${outcome.exitCode}): ${firstLine(outcome.stderr || outcome.stdout || outcome.message)}`,
      );
    }
  }
  const status = await collectStatus(ctx, config, runner, project, {});
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const lines = [
    `graphify ${mode} finished for ${project} in ${elapsed}s`,
    `graph: ${status.totals.nodes} nodes · ${status.totals.edges} edges · ${status.totals.communities} communities`,
    `artifacts: ${[status.artifacts.report ? 'GRAPH_REPORT.md' : '', status.artifacts.html ? 'graph.html' : '', status.artifacts.wiki ? 'wiki/index.md' : '']
      .filter((entry) => entry !== '')
      .join(', ') || 'none'}`,
  ];
  return { project, mode, status, text: lines.join('\n'), log: logs.join('\n') };
}

/**
 * Query the graph and return the CLI answer.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param args - tool arguments.
 * @param exec - tool execution context.
 * @returns Answer text plus the CLI exit code (3 = ambiguous, 4 = no match).
 */
async function queryGraph(ctx, config, runner, args, exec) {
  const project = await resolveProject(ctx, config, args.path, exec);
  requireProject(project);
  const question = text(args.question);
  if (question === '') throw new Error('question is required');
  const graphPath = graphFileFor(project, config);
  const argv = ['query', question];
  if (args.dfs === true) argv.push('--dfs');
  if (typeof args.budget === 'number' && Number.isFinite(args.budget) && args.budget > 0) {
    argv.push('--budget', String(Math.trunc(args.budget)));
  }
  if (Array.isArray(args.context)) {
    for (const filter of args.context) {
      if (typeof filter === 'string' && filter !== '') argv.push('--context', filter);
    }
  }
  if (args.seed !== undefined) {
    for (const seed of Array.isArray(args.seed) ? args.seed : [args.seed]) {
      if (typeof seed === 'string' && seed !== '') argv.push('--seed', seed);
    }
  }
  argv.push('--graph', graphPath);
  const outcome = await runner.run(argv, { cwd: project, timeoutMs: config.queryTimeoutMs, signal: exec?.signal });
  if (outcome.aborted || exec?.signal?.aborted === true) throw new Error('query was cancelled');
  if (wasTimedOut(outcome, exec?.signal)) throw new Error('query timed out');
  const answer = outcome.stdout || outcome.stderr;
  if (outcome.exitCode === 3) return { text: `Ambiguous name — candidates listed below.\n\n${answer}`, exitCode: 3 };
  if (outcome.exitCode === 4) return { text: `No matching node found.\n\n${answer}`, exitCode: 4 };
  if (outcome.exitCode !== 0) throw failure(outcome, 'query', exec?.signal);
  return { text: answer, exitCode: 0 };
}

/**
 * Shortest-path query between two concepts.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param args - tool arguments.
 * @param exec - tool execution context.
 * @returns Path answer text.
 */
async function pathGraph(ctx, config, runner, args, exec) {
  const project = await resolveProject(ctx, config, args.path, exec);
  requireProject(project);
  const source = text(args.source);
  const target = text(args.target);
  if (source === '' || target === '') throw new Error('source and target are required');
  const graphPath = graphFileFor(project, config);
  const argv = ['path', source, target, '--graph', graphPath];
  if (args.undirected === true) argv.push('--undirected');
  const outcome = await runner.run(argv, { cwd: project, timeoutMs: config.queryTimeoutMs, signal: exec?.signal });
  if (outcome.aborted || exec?.signal?.aborted === true) throw new Error('path query was cancelled');
  if (wasTimedOut(outcome, exec?.signal)) throw new Error('path query timed out');
  const answer = outcome.stdout || outcome.stderr;
  if (outcome.exitCode === 0 || outcome.exitCode === 3 || outcome.exitCode === 4) return { text: answer, exitCode: outcome.exitCode };
  throw failure(outcome, 'path query', exec?.signal);
}

/**
 * Explain one node and its neighbors.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param args - tool arguments.
 * @param exec - tool execution context.
 * @returns Explanation text.
 */
async function explainNode(ctx, config, runner, args, exec) {
  const project = await resolveProject(ctx, config, args.path, exec);
  requireProject(project);
  const label = text(args.node) || text(args.label);
  if (label === '') throw new Error('node is required');
  const graphPath = graphFileFor(project, config);
  const argv = ['explain', label, '--graph', graphPath];
  if (args.all === true) argv.push('--all');
  const outcome = await runner.run(argv, { cwd: project, timeoutMs: config.queryTimeoutMs, signal: exec?.signal });
  if (outcome.aborted || exec?.signal?.aborted === true) throw new Error('explain was cancelled');
  if (wasTimedOut(outcome, exec?.signal)) throw new Error('explain timed out');
  const answer = outcome.stdout || outcome.stderr;
  if (outcome.exitCode === 0 || outcome.exitCode === 3 || outcome.exitCode === 4) return { text: answer, exitCode: outcome.exitCode };
  throw failure(outcome, 'explain', exec?.signal);
}

/**
 * List the graph's architectural hubs.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param args - tool arguments.
 * @param exec - tool execution context.
 * @returns Hub list as text.
 */
async function godNodes(ctx, config, runner, args, exec) {
  const project = await resolveProject(ctx, config, args.path, exec);
  requireProject(project);
  const top = typeof args.top === 'number' && Number.isFinite(args.top) && args.top > 0 ? Math.min(Math.trunc(args.top), 100) : 10;
  const graphPath = graphFileFor(project, config);
  const outcome = await runner.run(['god-nodes', '--top', String(top), '--json', '--graph', graphPath], {
    cwd: project,
    timeoutMs: config.queryTimeoutMs,
    signal: exec?.signal,
  });
  if (outcome.aborted || exec?.signal?.aborted === true) throw new Error('god-nodes was cancelled');
  if (wasTimedOut(outcome, exec?.signal)) throw new Error('god-nodes timed out');
  if (outcome.exitCode !== 0) throw failure(outcome, 'god-nodes', exec?.signal);
  let parsed;
  try {
    parsed = JSON.parse(outcome.stdout);
  } catch {
    return { text: outcome.stdout || outcome.stderr, nodes: [] };
  }
  const nodes = Array.isArray(parsed)
    ? parsed
        .filter((node) => node !== null && typeof node === 'object')
        .map((node) => ({ label: text(node.label) || text(node.id), id: text(node.id), degree: Number.isFinite(node.degree) ? node.degree : 0 }))
    : [];
  const lines = nodes.map((node, index) => `${index + 1}. ${node.label} — ${node.degree} edges${node.id !== '' && node.id !== node.label ? ` (${node.id})` : ''}`);
  return { text: lines.length > 0 ? lines.join('\n') : 'no god nodes recorded', nodes };
}

/**
 * Export one graph artifact through the graphify CLI.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param args - tool arguments.
 * @param exec - tool execution context.
 * @returns Export result with produced paths.
 */
async function exportGraph(ctx, config, runner, args, exec) {
  const project = await resolveProject(ctx, config, args.path, exec);
  requireProject(project);
  const format = normalizeFormat(args.format);
  const graphPath = graphFileFor(project, config);
  if (!existsSync(graphPath)) throw new Error(`no graph at ${graphPath}: build one first with graphify_build { mode: "code" }`);
  const outcome = await runner.run(['export', format, '--graph', graphPath], {
    cwd: project,
    timeoutMs: config.buildTimeoutMs,
    signal: exec?.signal,
  });
  if (outcome.aborted || exec?.signal?.aborted === true) throw new Error('export was cancelled');
  if (wasTimedOut(outcome, exec?.signal)) throw new Error('export timed out');
  if (outcome.exitCode !== 0) throw failure(outcome, `export ${format}`, exec?.signal);
  const artifacts = inspectArtifacts(project);
  const produced = {
    wiki: artifacts.wikiPath,
    html: artifacts.htmlPath,
    svg: join(project, GRAPHIFY_OUT, 'graph.svg'),
    graphml: join(project, GRAPHIFY_OUT, 'graph.graphml'),
    obsidian: join(project, GRAPHIFY_OUT, 'obsidian'),
  }[format];
  return {
    format,
    produced,
    text: [`exported ${format} for ${project}`, produced !== undefined ? `output: ${produced}` : '', tailLines(outcome.stdout || outcome.stderr, 10)]
      .filter((line) => line !== '')
      .join('\n'),
  };
}

/**
 * Execute one `/graphify` command line.
 * @param ctx - plugin context.
 * @param config - normalized settings.
 * @param runner - CLI runner.
 * @param rawInput - text following the command name.
 * @param exec - agent and cancellation signal.
 * @returns Result text.
 */
async function runCommand(ctx, config, runner, rawInput, exec) {
  const input = text(rawInput);
  const [subcommand, ...rest] = input === '' ? ['status'] : input.split(/\s+/);
  switch (subcommand.toLowerCase()) {
    case 'status':
    case 'info': {
      const status = await collectStatus(ctx, config, runner, '', exec);
      return statusText(status);
    }
    case 'build':
    case 'index': {
      const mode = rest.length > 0 && ['code', 'update', 'full'].includes(rest[0].toLowerCase()) ? rest[0].toLowerCase() : 'code';
      const result = await buildGraph(ctx, config, runner, { mode }, exec);
      return [result.text, '', result.log].filter((line) => line !== '').join('\n');
    }
    case 'update': {
      const result = await buildGraph(ctx, config, runner, { mode: 'update' }, exec);
      return [result.text, '', result.log].filter((line) => line !== '').join('\n');
    }
    case 'query':
    case 'ask': {
      const question = rest.join(' ').trim();
      if (question === '') throw new Error(`missing question\n${COMMAND_USAGE}`);
      const result = await queryGraph(ctx, config, runner, { question }, exec);
      return result.text;
    }
    case 'path': {
      if (rest.length < 2) throw new Error(`missing path endpoints\n${COMMAND_USAGE}`);
      const result = await pathGraph(ctx, config, runner, { source: rest[0], target: rest[1] }, exec);
      return result.text;
    }
    case 'explain': {
      const node = rest.join(' ').trim();
      if (node === '') throw new Error(`missing node\n${COMMAND_USAGE}`);
      const result = await explainNode(ctx, config, runner, { node }, exec);
      return result.text;
    }
    case 'god':
    case 'gods': {
      const result = await godNodes(ctx, config, runner, {}, exec);
      return result.text;
    }
    case 'export': {
      if (rest.length === 0) throw new Error(`missing export format\n${COMMAND_USAGE}`);
      const result = await exportGraph(ctx, config, runner, { format: rest[0] }, exec);
      return result.text;
    }
    case 'help': {
      return COMMAND_USAGE;
    }
    default:
      throw new Error(`unknown subcommand "${subcommand}"\n${COMMAND_USAGE}`);
  }
}

export {
  collectStatus,
  buildGraph,
  queryGraph,
  pathGraph,
  explainNode,
  godNodes,
  exportGraph,
  runCommand,
};
