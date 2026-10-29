/**
 * The one subprocess seam over the installed `graphify` CLI.
 *
 * Resolution is lazy and cached after the first successful probe: a user who
 * installs graphify after starting the Host gets picked up without a restart.
 * Failures are never cached for the same reason.
 *
 * @module dsh-graphify/lib/cli
 */
import { execFile } from 'node:child_process';
import { INSTALL_HINT, commandCandidates, firstLine } from './core.js';

/** CLI stdout/stderr cap; graphify prints bounded summaries, not whole graphs. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Run one process and always settle with its streams instead of rejecting.
 * @param file - executable.
 * @param argv - arguments, never shell-interpreted.
 * @param options - cwd, deadline, and cancellation signal.
 * @returns The raw execution result.
 */
function execute(file, argv, options) {
  return new Promise((settle) => {
    execFile(
      file,
      argv,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env: process.env,
        encoding: 'utf8',
        windowsHide: true,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        settle({
          error: error ?? null,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        });
      },
    );
  });
}

/**
 * Classify one execution result without throwing.
 * @param execution - raw result from {@link execute}.
 * @returns Exit facts and trimmed streams.
 */
function outcomeOf(execution) {
  const error = execution.error;
  const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
  const missing = error !== null && error.code === 'ENOENT';
  const aborted = error !== null && error.name === 'AbortError';
  const timedOut = error !== null && !aborted && error.killed === true;
  return {
    exitCode,
    missing,
    aborted,
    timedOut,
    stdout: execution.stdout.trim(),
    stderr: execution.stderr.trim(),
    message: error === null ? '' : firstLine(error.message),
  };
}

/**
 * Timeout classification used by tools: the process was killed by its own
 * deadline rather than by caller cancellation.
 * @param outcome - classified execution.
 * @param signal - the caller signal, consulted to tell cancellation from deadline.
 * @returns Whether the deadline fired.
 */
function wasTimedOut(outcome, signal) {
  return outcome.timedOut && signal?.aborted !== true;
}

/**
 * One CLI runner shared by tools, command, and HTTP API. Resolution is cached
 * after the first successful probe; failures are not cached so installing the
 * CLI later recovers without a restart.
 * @param config - normalized plugin settings.
 * @returns probe/run helpers over the configured executable.
 */
function createRunner(config) {
  let resolved = null;

  /**
   * Resolve the CLI and its version.
   * @param cwd - working directory for the probe.
   * @param signal - caller cancellation.
   * @returns The resolved executable record.
   */
  async function probe(cwd, signal) {
    if (resolved !== null) return resolved;
    const failures = [];
    for (const file of commandCandidates(config.command)) {
      const outcome = outcomeOf(
        await execute(file, [...config.extraArgs, '--version'], { cwd, timeoutMs: 20_000, signal }),
      );
      if (outcome.missing) {
        failures.push(`${file}: not found`);
        continue;
      }
      const version = firstLine(outcome.stdout) || firstLine(outcome.stderr);
      if (outcome.exitCode === 0 || version !== '') {
        resolved = { file, version };
        return resolved;
      }
      failures.push(`${file}: ${outcome.message || `exit ${outcome.exitCode}`}`);
    }
    const error = new Error(
      `graphify CLI not found or not runnable (tried ${failures.join('; ')}). Install it with "${INSTALL_HINT}", or set the bundle config command/extraArgs.`,
    );
    error.code = 'GRAPHIFY_UNAVAILABLE';
    throw error;
  }

  /**
   * Run one graphify subcommand.
   * @param args - subcommand and its arguments.
   * @param options - cwd, deadline, and cancellation signal.
   * @returns The classified outcome plus resolution facts.
   */
  async function run(args, options) {
    const target = await probe(options.cwd, options.signal);
    const outcome = outcomeOf(
      await execute(target.file, [...config.extraArgs, ...args], {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      }),
    );
    return { ...outcome, version: target.version, command: target.file };
  }

  return {
    probe,
    run,
    /** Forget a resolution so a reinstalled CLI is picked up. */
    reset() {
      resolved = null;
    },
  };
}

/**
 * Fail a tool call with an installer-friendly message.
 * @param outcome - classified execution.
 * @param action - what the caller was doing.
 * @param signal - caller signal.
 * @returns The error to throw.
 */
function failure(outcome, action, signal) {
  if (outcome.aborted || signal?.aborted === true) return new Error(`${action} was cancelled`);
  if (wasTimedOut(outcome, signal)) return new Error(`${action} timed out`);
  const detail = outcome.stderr || outcome.stdout || outcome.message || `graphify exited with code ${outcome.exitCode}`;
  return new Error(`${action} failed: ${firstLine(detail)}`);
}

export {
  execute,
  outcomeOf,
  wasTimedOut,
  createRunner,
  failure,
};
