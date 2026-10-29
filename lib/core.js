/**
 * Pure graphify facts and path handling shared by the Host surfaces.
 *
 * Nothing in this module talks to the Harness: it turns a project directory
 * into graph paths, reads the graphify artifacts on disk, and renders the
 * status text the tools, the command, and the Web page all use. That keeps the
 * behaviour unit-testable without a running Host.
 *
 * @module dsh-graphify/lib/core
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Output directory the graphify CLI owns inside a project. */
const GRAPHIFY_OUT = 'graphify-out';

/** Workspace graph written by `graphify extract` / `graphify update`. */
const GRAPH_FILE = 'graph.json';

/** Human-readable report rendered by `graphify cluster-only` / `graphify label`. */
const REPORT_FILE = 'GRAPH_REPORT.md';

/** Interactive vis.js page rendered next to the graph. */
const HTML_FILE = 'graph.html';

/** Agent-navigable wiki entry point (`graphify export wiki`). */
const WIKI_INDEX = join('wiki', 'index.md');

/** Cluster/analysis sidecar written next to graph.json. */
const ANALYSIS_FILE = '.graphify_analysis.json';

/** Default executable name; overridable through the bundle config. */
const DEFAULT_COMMAND = 'graphify';

/** Hard deadline for one build/update/export step (30 minutes). */
const DEFAULT_BUILD_TIMEOUT_MS = 30 * 60 * 1000;

/** Hard deadline for one query/path/explain/god-nodes call. */
const DEFAULT_QUERY_TIMEOUT_MS = 2 * 60 * 1000;

/** graph.json size cap for in-process inspection; larger graphs are still queryable. */
const MAX_GRAPH_BYTES = 128 * 1024 * 1024;

/** Report text cap served to the page. */
const MAX_REPORT_BYTES = 512 * 1024;

/** How many trailing CLI lines a build result keeps in its model-facing text. */
const BUILD_LOG_TAIL_LINES = 24;

/** Install hint shown whenever the CLI cannot be resolved. */
const INSTALL_HINT = 'uv tool install graphifyy';

/** Usage line shared by the command handler and its error text. */
const COMMAND_USAGE =
  'usage: /graphify [status] | /graphify build [code|update|full] | /graphify query <question> | /graphify path <a> <b> | /graphify explain <node> | /graphify god';

/**
 * Trimmed non-empty string, or the fallback.
 * @param value - untrusted config or argument value.
 * @param fallback - value used when the input is not a non-empty string.
 * @returns The normalized string.
 */
function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * First non-empty line of a multi-line message.
 * @param value - raw message.
 * @returns A single trimmed line.
 */
function firstLine(value) {
  const source = typeof value === 'string' ? value : '';
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
  }
  return '';
}

/**
 * Positive finite number, or the fallback.
 * @param value - untrusted config value.
 * @param fallback - value used when the input is unusable.
 * @returns The normalized number.
 */
function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Normalize the row config the Loader passed to this plugin.
 * @param raw - config value from cordis.patch.yml, already schema-normalized when Config loaded.
 * @returns Complete settings with defaults applied.
 */
function readConfig(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const extraArgs = Array.isArray(source.extraArgs)
    ? source.extraArgs.filter((value) => typeof value === 'string' && value !== '')
    : [];
  return {
    command: text(source.command, DEFAULT_COMMAND),
    extraArgs,
    projectPath: text(source.projectPath),
    graphPath: text(source.graphPath),
    buildTimeoutMs: positive(source.buildTimeoutMs, DEFAULT_BUILD_TIMEOUT_MS),
    queryTimeoutMs: positive(source.queryTimeoutMs, DEFAULT_QUERY_TIMEOUT_MS),
  };
}

/**
 * Executable candidates for one configured command: an explicit path is used
 * as-is, a bare name also probes the standard uv/pipx/homebrew install roots.
 * @param command - configured executable.
 * @returns Candidate paths in probe order.
 */
function commandCandidates(command) {
  if (isAbsolute(command) || command.includes('/')) return [command];
  const home = homedir();
  return [
    command,
    join(home, '.local', 'bin', command),
    join(home, '.local', 'share', 'uv', 'tools', 'graphifyy', 'bin', command),
    join(home, '.local', 'pipx', 'venvs', 'graphifyy', 'bin', command),
    join('/opt/homebrew/bin', command),
    join('/usr/local/bin', command),
  ];
}

/**
 * Resolve the directory a tool call should operate on.
 * @param ctx - plugin context (workingDirectory is optional).
 * @param config - normalized settings.
 * @param requested - per-call `path` argument.
 * @param exec - tool execution context carrying the Agent and signal.
 * @returns Absolute project directory.
 */
async function resolveProject(ctx, config, requested, exec) {
  let base = process.cwd();
  try {
    const directories = ctx.get('workingDirectory');
    if (directories !== undefined && exec?.agent !== undefined) {
      const current = await directories.ensure(exec.agent, exec.signal);
      if (typeof current === 'string' && current !== '') base = resolve(current);
    }
  } catch {
    // Fall back to the process directory; the caller sees the resolved path.
  }
  const explicit = text(requested);
  if (explicit !== '') return isAbsolute(explicit) ? resolve(explicit) : resolve(base, explicit);
  if (config.projectPath !== '') {
    return isAbsolute(config.projectPath) ? resolve(config.projectPath) : resolve(base, config.projectPath);
  }
  return resolve(base);
}

/**
 * Graph path for one project, honoring an explicit config override.
 * @param project - resolved project directory.
 * @param config - normalized settings.
 * @returns Absolute graph.json path.
 */
function graphFileFor(project, config) {
  if (config.graphPath !== '') {
    return isAbsolute(config.graphPath) ? config.graphPath : resolve(project, config.graphPath);
  }
  return join(project, GRAPHIFY_OUT, GRAPH_FILE);
}

/**
 * Parse graph.json into the summary the status tool and the Web page share.
 * @param graphPath - absolute graph.json path.
 * @returns Graph facts, or an `exists: false` / `error` record.
 */
function inspectGraph(graphPath) {
  if (!existsSync(graphPath)) return { exists: false, path: graphPath };
  let info;
  try {
    info = statSync(graphPath);
  } catch (error) {
    return { exists: true, path: graphPath, error: firstLine(error?.message) };
  }
  if (!info.isFile()) return { exists: true, path: graphPath, error: 'graph path is not a file' };
  if (info.size > MAX_GRAPH_BYTES) {
    return { exists: true, path: graphPath, bytes: info.size, error: 'graph.json exceeds the inspection size cap' };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(graphPath, 'utf8'));
  } catch (error) {
    return { exists: true, path: graphPath, bytes: info.size, error: `graph.json is not valid JSON: ${firstLine(error?.message)}` };
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const links = Array.isArray(data.links) ? data.links : Array.isArray(data.edges) ? data.edges : [];
  const confidence = { extracted: 0, inferred: 0, ambiguous: 0 };
  for (const link of links) {
    if (link === null || typeof link !== 'object') continue;
    const tag = String(link.confidence ?? '').toUpperCase();
    if (tag === 'EXTRACTED') confidence.extracted += 1;
    else if (tag === 'INFERRED') confidence.inferred += 1;
    else if (tag === 'AMBIGUOUS') confidence.ambiguous += 1;
  }
  const communities = new Map();
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    const id = node.community;
    if (typeof id !== 'number' || !Number.isFinite(id)) continue;
    let entry = communities.get(id);
    if (entry === undefined) {
      entry = { id, name: text(node.community_name, `Community ${id}`), size: 0, labels: [] };
      communities.set(id, entry);
    }
    entry.size += 1;
    if (entry.labels.length < 4) {
      const label = text(node.label) || text(node.id);
      if (label !== '') entry.labels.push(label);
    }
  }
  return {
    exists: true,
    path: graphPath,
    bytes: info.size,
    modifiedAt: info.mtimeMs,
    version: text(data.graph?.graphify_version),
    directed: data.directed === true,
    nodes: nodes.length,
    edges: links.length,
    communities: [...communities.values()].sort((left, right) => right.size - left.size),
    confidence,
  };
}

/**
 * Read the analysis sidecar that `graphify cluster-only` writes next to the graph.
 * @param graphPath - absolute graph.json path.
 * @returns God nodes, cohesion, and suggested questions, or an empty record.
 */
function inspectAnalysis(graphPath) {
  const analysisPath = join(dirname(graphPath), ANALYSIS_FILE);
  if (!existsSync(analysisPath)) return { path: analysisPath, exists: false, gods: [], questions: [], surprises: [] };
  try {
    const data = JSON.parse(readFileSync(analysisPath, 'utf8'));
    const gods = Array.isArray(data.gods)
      ? data.gods
          .filter((node) => node !== null && typeof node === 'object')
          .slice(0, 20)
          .map((node) => ({
            label: text(node.label) || text(node.id),
            id: text(node.id),
            degree: Number.isFinite(node.degree) ? node.degree : 0,
          }))
      : [];
    const questions = Array.isArray(data.questions)
      ? data.questions
          .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.question === 'string')
          .slice(0, 6)
          .map((entry) => ({ question: entry.question, why: text(entry.why) }))
      : [];
    const surprises = Array.isArray(data.surprises) ? data.surprises.length : 0;
    const cohesion = data.cohesion !== null && typeof data.cohesion === 'object' ? data.cohesion : {};
    return { path: analysisPath, exists: true, gods, questions, surprises, cohesion };
  } catch (error) {
    return { path: analysisPath, exists: true, error: firstLine(error?.message), gods: [], questions: [], surprises: [] };
  }
}

/**
 * Artifact presence for one project.
 * @param project - resolved project directory.
 * @returns Paths and existence flags for report, HTML, and wiki.
 */
function inspectArtifacts(project) {
  const outDir = join(project, GRAPHIFY_OUT);
  const reportPath = join(outDir, REPORT_FILE);
  const htmlPath = join(outDir, HTML_FILE);
  const wikiPath = join(outDir, WIKI_INDEX);
  return {
    reportPath,
    htmlPath,
    wikiPath,
    report: existsSync(reportPath),
    html: existsSync(htmlPath),
    wiki: existsSync(wikiPath),
  };
}

/**
 * Render a status value into model-facing text.
 * @param status - collected status value.
 * @returns Compact multi-line summary.
 */
function statusText(status) {
  const lines = [];
  if (status.cli.found) lines.push(`graphify CLI: ${status.cli.version || 'installed'} (${status.cli.command})`);
  else lines.push(`graphify CLI: missing — install with "${INSTALL_HINT}"`);
  lines.push(`project: ${status.project}`);
  if (!status.graph.exists) {
    lines.push(`graph: none at ${status.graph.path}`);
    if (status.cli.found) lines.push('next: call graphify_build { mode: "code" } to index this project locally (no API key needed).');
    return lines.join('\n');
  }
  if (status.graph.error !== undefined) {
    lines.push(`graph: unreadable (${status.graph.error})`);
    return lines.join('\n');
  }
  const { nodes, edges, confidence } = status.graph;
  const total = confidence.extracted + confidence.inferred + confidence.ambiguous || 1;
  const percent = (value) => `${Math.round((value / total) * 100)}%`;
  lines.push(
    `graph: ${nodes} nodes · ${edges} edges · ${status.graph.communities.length} communities · ${percent(confidence.extracted)} EXTRACTED / ${percent(confidence.inferred)} INFERRED / ${percent(confidence.ambiguous)} AMBIGUOUS`,
  );
  lines.push(`graph file: ${status.graph.path} (${formatBytes(status.graph.bytes)})`);
  const artifacts = status.artifacts;
  lines.push(
    `artifacts: report ${artifacts.report ? '✓' : '✗'} · html ${artifacts.html ? '✓' : '✗'} · wiki ${artifacts.wiki ? '✓' : '✗'}`,
  );
  if (status.analysis.gods.length > 0) {
    lines.push(`god nodes: ${status.analysis.gods.slice(0, 5).map((node) => `${node.label} (${node.degree})`).join(', ')}`);
  }
  if (status.analysis.questions.length > 0) {
    lines.push(`suggested questions: ${status.analysis.questions.slice(0, 3).map((entry) => entry.question).join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Format a byte count for display.
 * @param bytes - size in bytes.
 * @returns Human-readable size.
 */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

/**
 * Keep the trailing lines of one CLI log.
 * @param value - raw stdout/stderr.
 * @param lineCount - how many trailing lines to keep.
 * @returns Trimmed tail.
 */
function tailLines(value, lineCount) {
  const lines = value.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.slice(Math.max(0, lines.length - lineCount)).join('\n');
}

/**
 * Normalize the requested build mode.
 * @param value - raw tool argument.
 * @returns One of code/update/full.
 */
function normalizeMode(value) {
  const mode = text(value, 'code').toLowerCase();
  if (mode === 'code' || mode === 'update' || mode === 'full') return mode;
  throw new Error(`unknown build mode "${mode}": use code, update, or full`);
}

/**
 * CLI steps for one build mode. `code` and `update` stay fully local; `full`
 * dispatches the semantic extraction that needs an LLM backend/API key.
 * @param project - resolved project directory.
 * @param mode - normalized mode.
 * @param force - whether to force a full re-scan.
 * @returns Ordered CLI invocations.
 */
function buildSteps(project, mode, force) {
  if (mode === 'update') return [{ args: ['update', project, ...(force ? ['--force'] : [])] }];
  if (mode === 'full') return [{ args: ['extract', project, ...(force ? ['--force'] : [])] }];
  return [
    { args: ['extract', project, '--code-only', ...(force ? ['--force'] : [])] },
    { args: ['cluster-only', project, '--no-label'] },
  ];
}

/**
 * Reject a project path that does not exist before spawning the CLI in it.
 * @param project - resolved project directory.
 */
function requireProject(project) {
  if (!existsSync(project)) throw new Error(`project directory not found: ${project}`);
}

/**
 * Normalize one export format.
 * @param value - raw tool argument.
 * @returns Supported format name.
 */
function normalizeFormat(value) {
  const format = text(value, 'wiki').toLowerCase();
  if (['wiki', 'html', 'svg', 'graphml', 'obsidian'].includes(format)) return format;
  throw new Error(`unsupported export format "${format}": use wiki, html, svg, graphml, or obsidian`);
}

export {
  text,
  firstLine,
  positive,
  readConfig,
  commandCandidates,
  resolveProject,
  graphFileFor,
  inspectGraph,
  inspectAnalysis,
  inspectArtifacts,
  statusText,
  formatBytes,
  tailLines,
  normalizeMode,
  buildSteps,
  requireProject,
  normalizeFormat,
  GRAPHIFY_OUT,
  GRAPH_FILE,
  REPORT_FILE,
  HTML_FILE,
  WIKI_INDEX,
  ANALYSIS_FILE,
  DEFAULT_COMMAND,
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_GRAPH_BYTES,
  MAX_REPORT_BYTES,
  BUILD_LOG_TAIL_LINES,
  INSTALL_HINT,
  COMMAND_USAGE,
};
