// Stand-in for `claude -p --output-format json`. Reads the prompt from stdin
// and answers according to FAKE_CLAUDE_MODE. Never contacts any service.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'exit') { process.stderr.write('Not logged in. Run claude and sign in.'); process.exit(1); }
  if (mode === 'error') { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'usage limit reached' })); return; }
  if (mode === 'garbage') { process.stdout.write('not json'); return; }
  if (mode === 'big') { process.stdout.write('x'.repeat(3 * 1024 * 1024)); return; }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 12, total_cost_usd: 0,
    result: JSON.stringify({ argv: process.argv.slice(2), promptBytes: Buffer.byteLength(input), prompt: input }) }) + '\n');
});
