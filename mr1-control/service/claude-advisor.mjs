// Read-only Claude advisor. It runs the operator's own Claude Code CLI
// (`claude -p`), which uses whatever login that CLI already has (a Claude
// subscription or an API key). The advisor never receives the serial port,
// the controller or a command channel: it can only return text for a person
// to read. Nothing is sent until the operator asks a question.
import { spawn as defaultSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

export const ADVISOR_PROTOCOL = 'mr1-claude-advisor-v1';
export const MAX_QUESTION_CHARS = 4000;
export const MAX_PROGRAM_CHARS = 64 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// Constant flags only: the question and context travel on stdin, so nothing
// the operator types is ever parsed by a shell. The tool list is read-only.
// No MCP servers are loaded and the session is not saved.
export const ADVISOR_ARGS = Object.freeze(['-p', '--output-format', 'json', '--tools', 'Read,Grep,Glob',
  '--strict-mcp-config', '--no-session-persistence']);

export const ADVISOR_INSTRUCTIONS = `You are the read-only engineering advisor inside the MR-1 CNC control application
(Langmuir MR-1, BTT Octopus Pro v1.1 with grblHAL, four CL57T V4.1 closed-loop drives).
You cannot send commands to the machine, and you must not tell the operator to bypass an
interlock, skip a HOLD item, edit firmware settings outside the documented profile, or energize
anything the documentation keeps on HOLD. When the controller state below shows an alarm or
fault, explain the likely cause and the documented recovery, and say what to check physically.
When reviewing G-code, point to specific line numbers and say whether the application's own
validator would already block it. Prefer the project's documents (docs/wiring/, grblHAL-STM32F4/mr1/,
mr1-control/*.md) over general knowledge, and say when you are unsure. Answer in plain text, briefly.`;

const sha256 = text => createHash('sha256').update(text).digest('hex');

function findOnPath(names, env, platform) {
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  for (const dir of dirs) for (const name of names) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Windows refuses to spawn .cmd/.bat shims without a shell. Every argument is
// a constant without spaces or shell metacharacters, so the shell only ever
// sees our own fixed command line.
export function resolveAdvisorCommand({ command, env = process.env, platform = process.platform, home } = {}) {
  if (command) {
    const viaShell = platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    return { file: command, shell: viaShell };
  }
  if (platform === 'win32') {
    const local = home ? resolve(home, '.local', 'bin', 'claude.exe') : null;
    if (local && existsSync(local)) return { file: local, shell: false };
    const exe = findOnPath(['claude.exe'], env, platform);
    if (exe) return { file: exe, shell: false };
    const shim = findOnPath(['claude.cmd'], env, platform);
    if (shim) return { file: shim, shell: true };
    return null;
  }
  const found = findOnPath(['claude'], env, platform);
  return found ? { file: found, shell: false } : null;
}

// Machine context comes from the service's own controller snapshot, never
// from the browser, so a page cannot misreport the machine state to Claude.
export function summarizeSnapshot(snapshot) {
  if (!snapshot) return { connected: false };
  const status = snapshot.status ?? null;
  return {
    connected: Boolean(snapshot.connected), armed: Boolean(snapshot.armed), busy: Boolean(snapshot.busy),
    motionQualified: Boolean(snapshot.motionQualified), fault: snapshot.fault ?? null,
    // Shape produced by parseGrblStatus: alarm codes arrive as the Alarm substate.
    state: status?.state ?? null, alarm: status?.state?.name === 'Alarm' ? status.state.substate ?? null : null,
    pins: status?.pins ?? null, machinePosition: status?.position?.machine ?? null, workPosition: status?.position?.work ?? null,
    preflight: snapshot.preflight ? { status: snapshot.preflight.status, counts: snapshot.preflight.counts,
      issues: (snapshot.preflight.issues ?? []).slice(0, 20).map(issue => issue.message ?? String(issue)) } : null,
    job: snapshot.job ? { state: snapshot.job.state, acknowledged: snapshot.job.acknowledged, total: snapshot.job.total } : null,
    program: snapshot.program ? { name: snapshot.program.name, sha256: snapshot.program.sha256, airRun: snapshot.program.airRun,
      validation: snapshot.program.validation } : null,
  };
}

export function buildAdvisorPrompt({ question, snapshot, program }) {
  const sections = [ADVISOR_INSTRUCTIONS, '', '## Live controller state (from the local service)',
    JSON.stringify(summarizeSnapshot(snapshot), null, 2)];
  if (program) sections.push('', `## Loaded program (${program.name ?? 'unnamed'}), as reviewed`, '```gcode', program.source, '```');
  sections.push('', '## Operator question', question);
  return sections.join('\n');
}

export function parseAdvisorOutput(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? ''); }
  catch { throw new Error('Claude Code returned output this version of MR1 cannot read. Update Claude Code and try again.'); }
  if (parsed?.is_error || (parsed?.subtype && parsed.subtype !== 'success') || typeof parsed?.result !== 'string') {
    throw new Error(`Claude Code reported an error: ${String(parsed?.result ?? parsed?.subtype ?? 'unknown').slice(0, 500)}`);
  }
  return { answer: parsed.result, durationMs: Number.isFinite(parsed.duration_ms) ? parsed.duration_ms : null,
    costUsd: Number.isFinite(parsed.total_cost_usd) ? parsed.total_cost_usd : null };
}

export function createClaudeAdvisor(options = {}) {
  const spawn = options.spawn ?? defaultSpawn;
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const cwd = options.cwd ?? process.cwd();
  const disabled = options.disabled ?? process.env.MR1_ADVISOR === 'off';
  const resolveCommand = () => resolveAdvisorCommand({ command: options.command ?? process.env.MR1_CLAUDE_COMMAND,
    env: options.env ?? process.env, platform, home: options.home ?? process.env.USERPROFILE ?? process.env.HOME });
  const baseArgs = options.baseArgs ?? [];
  let active = null;

  function run(input) {
    const command = resolveCommand();
    if (!command) throw new Error('Claude Code was not found. Install it and sign in once with `claude`, then try again.');
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command.file, [...baseArgs, ...ADVISOR_ARGS], { cwd, shell: command.shell, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'], env: options.env ?? process.env });
      let stdout = '', stderr = '', size = 0, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolvePromise(value);
      };
      const kill = () => {
        // A shell shim's child keeps running unless the whole tree is ended.
        if (platform === 'win32' && child.pid) {
          try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
        }
        try { child.kill(); } catch {}
      };
      const timer = setTimeout(() => { kill(); finish(new Error(`Claude did not answer within ${Math.round(timeoutMs / 1000)} s.`)); }, timeoutMs);
      child.on('error', error => finish(new Error(error.code === 'ENOENT'
        ? 'Claude Code was not found. Install it and sign in once with `claude`, then try again.'
        : `Claude Code could not start: ${error.message}`)));
      const collect = target => chunk => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) { kill(); finish(new Error('Claude Code returned more output than the advisor accepts.')); return; }
        if (target === 'out') stdout += chunk; else stderr += chunk;
      };
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', collect('out')); child.stderr.on('data', collect('err'));
      child.on('close', code => {
        if (settled) return;
        if (code !== 0 && !stdout.trim()) {
          finish(new Error(`Claude Code exited with code ${code}. ${stderr.trim().slice(0, 400) || 'Run `claude` once in a terminal to sign in.'}`));
          return;
        }
        try { finish(null, parseAdvisorOutput(stdout)); } catch (error) { finish(error); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }

  return {
    status() {
      if (disabled) return { protocol: ADVISOR_PROTOCOL, available: false, busy: false, reason: 'Advisor disabled by MR1_ADVISOR=off.' };
      const command = resolveCommand();
      return { protocol: ADVISOR_PROTOCOL, available: Boolean(command), busy: Boolean(active),
        reason: command ? null : 'Claude Code was not found on this PC.', readOnly: true, commandChannel: false };
    },
    async ask({ question, includeProgram = false }, { snapshot, programSource } = {}) {
      if (disabled) throw new Error('The Claude advisor is disabled on this PC (MR1_ADVISOR=off).');
      if (typeof question !== 'string' || !question.trim()) throw new Error('Type a question for the advisor.');
      if (question.length > MAX_QUESTION_CHARS) throw new Error(`Questions are limited to ${MAX_QUESTION_CHARS} characters.`);
      if (active) throw Object.assign(new Error('The advisor is still answering the previous question.'), { busy: true });
      let program = null;
      if (includeProgram === true) {
        if (typeof programSource !== 'string' || !snapshot?.program) throw new Error('Load a program before asking about it.');
        if (programSource.length > MAX_PROGRAM_CHARS) throw new Error('The loaded program is too large to send; ask about a specific section instead.');
        program = { name: snapshot.program.name, source: programSource };
      }
      const prompt = buildAdvisorPrompt({ question: question.trim(), snapshot, program });
      const started = Date.now();
      active = run(prompt);
      try {
        const result = await active;
        return { protocol: ADVISOR_PROTOCOL, ...result, promptSha256: sha256(prompt), includedProgram: Boolean(program),
          elapsedMs: Date.now() - started, advisory: true, machineCommandsSent: 0 };
      } finally { active = null; }
    },
  };
}
