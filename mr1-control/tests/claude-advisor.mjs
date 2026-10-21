import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVISOR_ARGS, MAX_QUESTION_CHARS, MAX_PROGRAM_CHARS, buildAdvisorPrompt, createClaudeAdvisor,
  parseAdvisorOutput, resolveAdvisorCommand, summarizeSnapshot } from '../service/claude-advisor.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const snapshot = { connected: true, armed: false, busy: false, motionQualified: false, fault: null,
  status: { state: { name: 'Alarm', raw: 'Alarm:17' }, alarm: 17, pins: { controls: { motorFault: true } } },
  preflight: { status: 'PASS', counts: { settingsPassed: 66, settingsExpected: 66 }, issues: [] },
  job: { state: 'loaded', acknowledged: 0, total: 3 },
  program: { name: 'part.nc', sha256: 'a'.repeat(64), airRun: false, validation: { errors: [], warnings: [] } } };
const advisor = (mode = 'ok', extra = {}) => createClaudeAdvisor({ command: process.execPath, baseArgs: [FAKE],
  env: { ...process.env, FAKE_CLAUDE_MODE: mode }, platform: process.platform, ...extra });
const echo = result => JSON.parse(result.answer);

test('the CLI is started with constant, read-only flags and no shell-parsed operator text', () => {
  for (const arg of ADVISOR_ARGS) assert.match(arg, /^[A-Za-z0-9,=.-]+$/, `${arg} must need no shell quoting`);
  const tools = ADVISOR_ARGS[ADVISOR_ARGS.indexOf('--tools') + 1].split(',');
  assert.deepEqual(tools.sort(), ['Glob', 'Grep', 'Read']);
  for (const flag of ['-p', '--strict-mcp-config', '--no-session-persistence']) assert.ok(ADVISOR_ARGS.includes(flag));
  assert.equal(ADVISOR_ARGS[ADVISOR_ARGS.indexOf('--output-format') + 1], 'json');
});

test('command resolution prefers a native binary and needs a shell only for a Windows .cmd shim', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mr1-advisor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(resolveAdvisorCommand({ env: { PATH: dir }, platform: 'linux' }), null);
  await writeFile(join(dir, 'claude'), '');
  assert.deepEqual(resolveAdvisorCommand({ env: { PATH: dir }, platform: 'linux' }), { file: join(dir, 'claude'), shell: false });
  await writeFile(join(dir, 'claude.cmd'), '');
  assert.deepEqual(resolveAdvisorCommand({ env: { Path: dir }, platform: 'win32' }), { file: join(dir, 'claude.cmd'), shell: true });
  await writeFile(join(dir, 'claude.exe'), '');
  assert.deepEqual(resolveAdvisorCommand({ env: { Path: dir }, platform: 'win32' }), { file: join(dir, 'claude.exe'), shell: false });
  assert.deepEqual(resolveAdvisorCommand({ command: 'C:\\tools\\claude.cmd', platform: 'win32' }), { file: 'C:\\tools\\claude.cmd', shell: true });
});

test('the question and live state travel on stdin; the program only when asked for', async () => {
  const withoutProgram = echo(await advisor().ask({ question: 'Why ALARM 17?' }, { snapshot, programSource: 'G0 X1\nM30\n' }));
  assert.deepEqual(withoutProgram.argv, ADVISOR_ARGS);
  assert.match(withoutProgram.prompt, /Why ALARM 17\?/);
  assert.match(withoutProgram.prompt, /"alarm": 17/);
  assert.match(withoutProgram.prompt, /cannot send commands/);
  assert.doesNotMatch(withoutProgram.prompt, /G0 X1/);
  const withProgram = echo(await advisor().ask({ question: 'Check line 1', includeProgram: true }, { snapshot, programSource: 'G0 X1\nM30\n' }));
  assert.match(withProgram.prompt, /```gcode\nG0 X1\nM30\n\n```/);
});

test('an answer is advisory text and reports that no machine command was sent', async () => {
  const result = await advisor().ask({ question: 'hello' }, { snapshot });
  assert.equal(result.advisory, true);
  assert.equal(result.machineCommandsSent, 0);
  assert.match(result.promptSha256, /^[a-f0-9]{64}$/);
});

test('invalid questions and program requests are refused before the CLI starts', async () => {
  const a = advisor();
  await assert.rejects(a.ask({ question: '   ' }, { snapshot }), /Type a question/);
  await assert.rejects(a.ask({ question: 'x'.repeat(MAX_QUESTION_CHARS + 1) }, { snapshot }), /limited/);
  await assert.rejects(a.ask({ question: 'review', includeProgram: true }, { snapshot: { ...snapshot, program: null } }), /Load a program/);
  await assert.rejects(a.ask({ question: 'review', includeProgram: true }, { snapshot, programSource: 'G1\n'.repeat(MAX_PROGRAM_CHARS) }), /too large/);
});

test('CLI failures, unreadable output, oversized output and timeouts become operator-readable errors', async () => {
  await assert.rejects(advisor('exit').ask({ question: 'q' }, { snapshot }), /exited with code 1\. Not logged in/);
  await assert.rejects(advisor('error').ask({ question: 'q' }, { snapshot }), /reported an error: usage limit reached/);
  await assert.rejects(advisor('garbage').ask({ question: 'q' }, { snapshot }), /cannot read/);
  await assert.rejects(advisor('big').ask({ question: 'q' }, { snapshot }), /more output/);
  const started = Date.now();
  await assert.rejects(advisor('hang', { timeoutMs: 400 }).ask({ question: 'q' }, { snapshot }), /did not answer within/);
  assert.ok(Date.now() - started < 5000);
});

test('one question at a time; a missing CLI and a disabled advisor say so', async () => {
  const slow = advisor('hang', { timeoutMs: 600 });
  const first = slow.ask({ question: 'first' }, { snapshot });
  assert.equal(slow.status().busy, true);
  await assert.rejects(slow.ask({ question: 'second' }, { snapshot }), error => error.busy === true);
  await assert.rejects(first, /did not answer/);
  assert.equal(slow.status().busy, false);
  const missing = createClaudeAdvisor({ env: { PATH: '' }, platform: 'linux' });
  assert.equal(missing.status().available, false);
  await assert.rejects(missing.ask({ question: 'q' }, { snapshot }), /not found/);
  const off = createClaudeAdvisor({ disabled: true, command: process.execPath });
  assert.equal(off.status().available, false);
  await assert.rejects(off.ask({ question: 'q' }, { snapshot }), /disabled/);
});

test('the summary carries state and validation but not the session or port handles', () => {
  const summary = summarizeSnapshot({ ...snapshot, port: 'COM7', token: 'secret' });
  assert.equal(summary.alarm, 17);
  assert.equal(summary.program.name, 'part.nc');
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  assert.deepEqual(summarizeSnapshot(null), { connected: false });
  assert.match(buildAdvisorPrompt({ question: 'q', snapshot: null }), /Operator question\nq$/);
  assert.throws(() => parseAdvisorOutput('{"result": 5}'), /reported an error/);
});
