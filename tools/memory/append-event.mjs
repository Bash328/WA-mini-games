#!/usr/bin/env node
// Append one validated agent-memory event to docs/agent-memory/events.jsonl.
//
//   node tools/memory/append-event.mjs event.json
//   Get-Content event.json | node tools/memory/append-event.mjs -
//   node tools/memory/append-event.mjs --check
//
// Optional: --file <path>  (used by tests; defaults to the repository log)
//           --dry-run      (validate and print, do not write)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOG = path.join(ROOT, 'docs/agent-memory/events.jsonl');

const TYPES = new Set([
  'implementation_completed',
  'bug_discovered',
  'bug_fixed',
  'approach_rejected',
  'decision_made',
  'test_failed',
  'handoff_created',
  'limitation_discovered',
  'commit_recorded',
]);

const CONFIDENCE = new Set(['verified', 'reported', 'hypothesis']);
const WORKTREE = new Set(['clean', 'dirty', 'unknown']);

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};
const has = (name) => args.includes('--' + name);
const logPath = path.resolve(ROOT, option('file') || DEFAULT_LOG);
const input = args.find((a) => !a.startsWith('--') && a !== option('file'));

function fail(message) {
  console.error('append-event: ' + message);
  process.exit(1);
}

function strings(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail('"' + field + '" must be an array of strings');
  }
  return value;
}

function validate(event, line = '') {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    fail('event must be a JSON object' + (line ? ' (' + line + ')' : ''));
  }
  const where = line ? ' (' + line + ')' : '';
  if (event.schema_version !== 1) fail('schema_version must be 1' + where);
  if (typeof event.event_id !== 'string' || !event.event_id.trim()) fail('event_id is required' + where);
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) fail('timestamp must be an ISO date' + where);
  if (typeof event.task_id !== 'string' || !event.task_id.trim()) fail('task_id is required' + where);
  if (!TYPES.has(event.type)) fail('unknown type "' + event.type + '"' + where);
  if (typeof event.summary !== 'string' || !event.summary.trim()) fail('summary is required' + where);
  if (typeof event.reason !== 'string' || !event.reason.trim()) fail('reason is required' + where);
  if (!CONFIDENCE.has(event.confidence)) fail('confidence must be verified, reported or hypothesis' + where);
  if (event.commit != null && typeof event.commit !== 'string') fail('commit must be a string or null' + where);
  if (!WORKTREE.has(event.worktree_state)) fail('worktree_state must be clean, dirty or unknown' + where);
  strings(event.files_changed, 'files_changed');
  strings(event.decisions, 'decisions');
  strings(event.known_issues, 'known_issues');
  strings(event.tags, 'tags');
  strings(event.evidence, 'evidence');
  strings(event.supersedes, 'supersedes');
  if (event.tests != null) {
    if (!Array.isArray(event.tests)) fail('tests must be an array' + where);
    for (const test of event.tests) {
      if (!test || typeof test !== 'object' || typeof test.command !== 'string' || typeof test.result !== 'string') {
        fail('each test needs command and result strings' + where);
      }
    }
  }
  if (event.agent != null && (typeof event.agent !== 'object' || Array.isArray(event.agent))) {
    fail('agent must be an object' + where);
  }
}

function readLog() {
  if (!fs.existsSync(logPath)) return [];
  const text = fs.readFileSync(logPath, 'utf8');
  const events = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      fail('line ' + (i + 1) + ' is not valid JSON: ' + error.message);
    }
    validate(event, 'line ' + (i + 1));
    events.push(event);
  });
  return events;
}

function normalise(event) {
  const stamp = event.timestamp || new Date().toISOString();
  const compact = stamp.replace(/\D/g, '').slice(0, 14);
  const id = event.event_id || 'evt_' + compact + '_' + crypto.randomBytes(4).toString('hex');
  return {
    schema_version: 1,
    event_id: id,
    timestamp: stamp,
    task_id: event.task_id,
    agent: event.agent || { role: 'agent' },
    type: event.type,
    summary: event.summary,
    reason: event.reason,
    files_changed: event.files_changed || [],
    decisions: event.decisions || [],
    tests: event.tests || [],
    known_issues: event.known_issues || [],
    commit: event.commit ?? null,
    worktree_state: event.worktree_state || 'unknown',
    confidence: event.confidence,
    tags: event.tags || [],
    evidence: event.evidence || [],
    supersedes: event.supersedes || [],
  };
}

if (has('check')) {
  const events = readLog();
  const ids = new Set();
  for (const event of events) {
    if (ids.has(event.event_id)) fail('duplicate event_id "' + event.event_id + '"');
    ids.add(event.event_id);
  }
  console.log('events.jsonl ok (' + events.length + ' event' + (events.length === 1 ? '' : 's') + ')');
  process.exit(0);
}

if (!input) fail('pass an event JSON file, - for stdin, or --check');

let raw;
try {
  raw = input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(process.cwd(), input), 'utf8');
} catch (error) {
  fail('cannot read ' + input + ': ' + error.message);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  fail('event is not valid JSON: ' + error.message);
}

const event = normalise(parsed);
validate(event);
const events = readLog();
if (events.some((e) => e.event_id === event.event_id)) fail('event_id "' + event.event_id + '" already exists');

if (has('dry-run')) {
  console.log(JSON.stringify(event, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(logPath), { recursive: true });
if (fs.existsSync(logPath)) {
  const current = fs.readFileSync(logPath, 'utf8');
  if (current && !current.endsWith('\n')) fs.appendFileSync(logPath, '\n');
}
fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
console.log('added ' + event.event_id + ' (' + event.type + ')');
