import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunner, execute, failure, outcomeOf, wasTimedOut } from '../lib/cli.js';
import { readConfig } from '../lib/core.js';

/**
 * Build the error shape `execFile` settles with.
 * @param {object} overrides - fields applied over an empty error.
 * @returns Error-like object.
 */
function cliError(overrides) {
  const error = Object.assign(new Error(overrides.message ?? 'spawn failed'), overrides);
  return error;
}

test('outcomeOf classifies success, exit codes, and spawn errors', () => {
  assert.deepEqual(outcomeOf({ error: null, stdout: ' ok ', stderr: ' ' }), {
    exitCode: 0,
    missing: false,
    aborted: false,
    timedOut: false,
    stdout: 'ok',
    stderr: '',
    message: '',
  });

  const exited = outcomeOf({ error: cliError({ code: 3, message: 'ambiguous' }), stdout: 'candidates', stderr: '' });
  assert.equal(exited.exitCode, 3);
  assert.equal(exited.missing, false);
  assert.match(exited.message, /ambiguous/u);

  const missing = outcomeOf({ error: cliError({ code: 'ENOENT' }), stdout: '', stderr: '' });
  assert.equal(missing.missing, true);
  assert.equal(missing.exitCode, null);

  const aborted = outcomeOf({ error: cliError({ name: 'AbortError' }), stdout: '', stderr: '' });
  assert.equal(aborted.aborted, true);

  const timedOut = outcomeOf({ error: cliError({ killed: true, signal: 'SIGTERM', code: null }), stdout: '', stderr: '' });
  assert.equal(timedOut.timedOut, true);
});

test('wasTimedOut separates a deadline from caller cancellation', () => {
  const killed = outcomeOf({ error: cliError({ killed: true, signal: 'SIGTERM', code: null }), stdout: '', stderr: '' });
  const live = new AbortController();
  assert.equal(wasTimedOut(killed, live.signal), true);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(wasTimedOut(killed, aborted.signal), false);
  assert.equal(wasTimedOut({ timedOut: false }, live.signal), false);
});

test('failure prefers cancellation, then the deadline, then CLI output', () => {
  assert.match(failure({ aborted: true }, 'query').message, /cancelled/u);
  assert.match(failure({ timedOut: true }, 'query', new AbortController().signal).message, /timed out/u);
  assert.match(failure({ exitCode: 2, stderr: 'bad flag', stdout: '', message: '' }, 'build').message, /failed: bad flag/u);
  assert.match(failure({ exitCode: 2, stderr: '', stdout: '', message: '' }, 'build').message, /exitCode|code 2|exited/u);
});

test('execute settles with streams instead of rejecting for a missing binary', async () => {
  const result = await execute('graphify-definitely-not-installed-xyz', ['--version'], {
    cwd: process.cwd(),
    timeoutMs: 5000,
  });
  assert.equal(outcomeOf(result).missing, true);
});

test('execute forwards the caller cancellation signal', async () => {
  const controller = new AbortController();
  const pending = execute('node', ['-e', 'setTimeout(() => {}, 5000)'], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
    signal: controller.signal,
  });
  controller.abort();
  const outcome = outcomeOf(await pending);
  assert.equal(outcome.aborted, true);
});

test('createRunner reports an actionable error when the CLI cannot be resolved', async () => {
  const runner = createRunner(readConfig({ command: 'graphify-definitely-not-installed-xyz' }));
  await assert.rejects(runner.probe(process.cwd(), undefined), (error) => {
    assert.equal(error.code, 'GRAPHIFY_UNAVAILABLE');
    assert.match(error.message, /uv tool install graphifyy/u);
    return true;
  });
});

test('createRunner resolves the real CLI and runs a command', async (t) => {
  const runner = createRunner(readConfig({}));
  let resolved;
  try {
    resolved = await runner.probe(process.cwd(), undefined);
  } catch {
    t.skip('graphify CLI is not installed in this environment');
    return;
  }
  assert.match(resolved.version, /graphify/u);

  const outcome = await runner.run(['--version'], { cwd: process.cwd(), timeoutMs: 20_000 });
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.stdout, /graphify/u);
  assert.equal(outcome.version, resolved.version);
});

test('createRunner caches a resolution but not a failure', async (t) => {
  const runner = createRunner(readConfig({}));
  try {
    await runner.probe(process.cwd(), undefined);
  } catch {
    t.skip('graphify CLI is not installed in this environment');
    return;
  }
  const first = await runner.probe(process.cwd(), undefined);
  const second = await runner.probe(process.cwd(), undefined);
  assert.equal(first, second);
  runner.reset();
  const third = await runner.probe(process.cwd(), undefined);
  assert.notEqual(first, third);
  assert.equal(third.file, first.file);
});
