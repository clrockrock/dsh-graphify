/**
 * Loader-facing configuration.
 *
 * The Host half imports only Node built-ins, so schemastery is loaded when it
 * resolves (the profile links Harness packages) and the plugin falls back to a
 * defensive normalizer when it does not.
 *
 * @module dsh-graphify/lib/config
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DEFAULT_BUILD_TIMEOUT_MS, DEFAULT_COMMAND, DEFAULT_QUERY_TIMEOUT_MS } from './core.js';

/**
 * Load schemastery from whichever install location is reachable: the plugin's
 * own resolution chain first, then the active profile's node_modules (Harness
 * packages are linked there by the profile launcher).
 * @returns The schemastery module, or undefined when unavailable.
 */
function loadSchema() {
  const requireFrom = [];
  try {
    requireFrom.push(createRequire(import.meta.url));
  } catch {
    // Resolution from the plugin path is best-effort only.
  }
  const profileDir = process.env.DSH_PROFILE_DIR;
  if (typeof profileDir === 'string' && profileDir !== '') {
    try {
      requireFrom.push(createRequire(join(profileDir, 'package.json')));
    } catch {
      // A profile without a package.json still runs; config falls back.
    }
  }
  for (const resolver of requireFrom) {
    try {
      return resolver('@deepseek-ai/schemastery');
    } catch {
      continue;
    }
  }
  return undefined;
}

const Schema = loadSchema();

/**
 * Build the Loader-facing Config schema.
 * @returns A schemastery schema, or undefined so the plugin accepts raw config.
 */
function buildConfigSchema() {
  if (Schema === undefined) return undefined;
  try {
    return Schema.object({
      command: Schema.string()
        .default(DEFAULT_COMMAND)
        .description('graphify executable name or absolute path. Use extraArgs for launchers such as uvx.'),
      extraArgs: Schema.array(Schema.string())
        .default([])
        .description('Arguments placed before every graphify subcommand, e.g. ["graphifyy"] when command is uvx.'),
      projectPath: Schema.string()
        .default('')
        .description('Default project directory for tools and the Web page. Empty means the Session working directory.'),
      graphPath: Schema.string()
        .default('')
        .description('Explicit graph.json path. Empty means <project>/graphify-out/graph.json.'),
      buildTimeoutMs: Schema.number()
        .default(DEFAULT_BUILD_TIMEOUT_MS)
        .description('Hard deadline in milliseconds for one build, update, or export step.'),
      queryTimeoutMs: Schema.number()
        .default(DEFAULT_QUERY_TIMEOUT_MS)
        .description('Hard deadline in milliseconds for one query, path, explain, or god-nodes call.'),
    });
  } catch {
    return undefined;
  }
}

/**
 * Loader-facing Config; undefined when schemastery is unreachable, in which
 * case the profile's raw config still reaches `apply` and is normalized there.
 */
export const Config = buildConfigSchema();

export { loadSchema, buildConfigSchema };
