/** Small Node watchdog. Its input pipe closes even if the supervising server
 * crashes or Windows terminates it without delivering SIGTERM. The runtime is
 * then stopped instead of being orphaned in the user's background processes.
 * No file or shell command supplied by remote content is evaluated here. */
export const LOCAL_RUNNER_SOURCE = String.raw`
const { spawn } = require('node:child_process');
let runtime;
let closing = false;
let timer;
function close() {
  if (closing) return;
  closing = true;
  if (!runtime) process.exit(0);
  runtime.kill('SIGTERM');
  timer = setTimeout(() => runtime.kill('SIGKILL'), 2500);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (runtime || closing) return;
  input += chunk;
  if (input.length > 64000) process.exit(1);
  if (!input.includes('\n')) return;
  try {
    const spec = JSON.parse(input.split('\n')[0]);
    runtime = spawn(spec.executable, spec.args, { cwd: spec.cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    runtime.stderr.pipe(process.stderr);
    runtime.once('error', (error) => process.stderr.write(error.message));
    runtime.once('close', (code) => { clearTimeout(timer); process.exit(closing ? 0 : (code || 1)); });
  } catch (error) { process.stderr.write(error.message); process.exit(1); }
});
process.stdin.on('end', close);
process.stdin.on('error', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
`;
