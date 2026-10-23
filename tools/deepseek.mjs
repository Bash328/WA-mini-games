// Hand a bounded task to DeepSeek through its API and print the answer. No dependencies, no tools: it can only
// read the files you name and reply with text. It never runs or writes anything it gets back; the caller
// (a person, or Claude) reviews the reply and applies it.
//
//   node tools/deepseek.mjs --task "Write a unit test like worker/skull.test.mjs for ludo" --file worker/skull.test.mjs --file ludo/engine.js
//   node tools/deepseek.mjs --task-file task.md --file a.js --out answer.md
//   add --dry-run to see exactly what would be sent (and the rough size) without calling the API
//
// The key comes from the DEEPSEEK_API_KEY environment variable and is never printed or stored. Set it once:
//   PowerShell:  [Environment]::SetEnvironmentVariable('DEEPSEEK_API_KEY', '<your key>', 'User')   then open a new terminal
// Options: --model (default DEEPSEEK_MODEL or deepseek-flash), --thinking (slower, for harder reasoning), --max-tokens N.
// Ask for changes as a unified diff; check it with `git apply --check` before applying.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const all = (n) => argv.flatMap((a, i) => (a === '--' + n ? [argv[i + 1]] : []));
const has = (n) => argv.includes('--' + n);

const MAX_FILE = 200 * 1024, MAX_TOTAL = 600 * 1024;
const REFUSE = /(^|[\\/])(\.env[^\\/]*|node_modules|\.git|\.wrangler)([\\/]|$)|\.(pem|key|p12|pfx)$|secret|credential|vapid-keys/i;

const task = opt('task') || (opt('task-file') && fs.readFileSync(path.resolve(opt('task-file')), 'utf8'));
if (!task) { console.error('Give the task with --task "..." or --task-file file.md'); process.exit(2); }

let total = 0; const blocks = [];
for (const f of all('file')) {
  const abs = path.resolve(ROOT, f), rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (rel.startsWith('..')) { console.error('Refusing a file outside the repo: ' + f); process.exit(2); }
  if (REFUSE.test(rel)) { console.error('Refusing to send a file that may hold secrets: ' + rel); process.exit(2); }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { console.error('No such file: ' + rel); process.exit(2); }
  const text = fs.readFileSync(abs, 'utf8');
  if (text.length > MAX_FILE) { console.error(rel + ' is ' + text.length + ' bytes; send a smaller slice (limit ' + MAX_FILE + ')'); process.exit(2); }
  total += text.length;
  if (total > MAX_TOTAL) { console.error('Too much to send in one request (limit ' + MAX_TOTAL + ' bytes)'); process.exit(2); }
  blocks.push('### File: ' + rel + '\n```\n' + text + '\n```');
}

const system = [
  'You are helping on the WA-mini-games repository: static browser games plus a Cloudflare Worker, no build step.',
  'Answer only what the task asks. Use only the files shown; do not invent files, functions or paths you were not shown.',
  'When asked to change code, reply with a unified diff in one ```diff block, paths relative to the repo root, and nothing else that is not needed.',
  'No emoji in game UI text. Keep the style of the surrounding code.',
].join(' ');
const user = task + (blocks.length ? '\n\n' + blocks.join('\n\n') : '');
const model = opt('model') || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const body = { model, stream: false, max_tokens: Number(opt('max-tokens')) || 8000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
if (has('thinking')) { body.thinking = { type: 'enabled' }; body.reasoning_effort = 'high'; }

if (has('dry-run')) {
  console.log('model: ' + model + (has('thinking') ? ' (thinking)' : '') + '\nfiles: ' + all('file').join(', ') + '\nabout ' + Math.round(user.length / 4) + ' tokens to send\n---\n' + user.slice(0, 1500) + (user.length > 1500 ? '\n[... ' + (user.length - 1500) + ' more characters]' : ''));
  process.exit(0);
}
const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.error('DEEPSEEK_API_KEY is not set. See the top of tools/deepseek.mjs.'); process.exit(2); }

const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 240000);
let res;
try {
  res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
} catch (e) { console.error('Request failed: ' + (e.name === 'AbortError' ? 'timed out after 240 s' : e.message)); process.exit(1); } finally { clearTimeout(timer); }
const data = await res.json().catch(() => null);
if (!res.ok || !data || !data.choices) { console.error('DeepSeek returned ' + res.status + ': ' + JSON.stringify(data && (data.error || data)).slice(0, 400)); process.exit(1); }
const answer = data.choices[0].message.content || '';
if (opt('out')) fs.writeFileSync(path.resolve(opt('out')), answer);
else console.log(answer);
const u = data.usage || {};
console.error('[deepseek ' + model + ': ' + (u.prompt_tokens || '?') + ' tokens in, ' + (u.completion_tokens || '?') + ' out' + (data.choices[0].finish_reason === 'length' ? ', CUT OFF at max tokens' : '') + ']');
