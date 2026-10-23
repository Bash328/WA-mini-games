#!/usr/bin/env node
// Search the repository's agent-memory event log.
//
//   node tools/memory/search.mjs --text "water sort"
//   node tools/memory/search.mjs --file shared/fun.css --limit 10
//   node tools/memory/search.mjs --tag pc-layout
//   node tools/memory/search.mjs --type limitation_discovered
//   node tools/memory/search.mjs --text desktop --json
//
// Optional: --log <path>  (defaults to docs/agent-memory/events.jsonl)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOG = path.join(ROOT, 'docs/agent-memory/events.jsonl');

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};
const has = (name) => args.includes('--' + name);

const text = (option('text') || '').toLowerCase();
const file = option('file');
const tag = option('tag');
const type = option('type');
const confidence = option('confidence');
const task = option('task');
const limit = Math.max(0, Number(option('limit') ?? 20) || 0);
const asJson = has('json');
const logPath = path.resolve(ROOT, option('log') || DEFAULT_LOG);

if (!fs.existsSync(logPath)) {
  console.error('search: no event log at ' + logPath);
  process.exit(1);
}

const events = [];
for (const [i, line] of fs.readFileSync(logPath, 'utf8').split(/\r?\n/).entries()) {
  if (!line.trim()) continue;
  try {
    events.push(JSON.parse(line));
  } catch (error) {
    console.error('search: line ' + (i + 1) + ' is not valid JSON; skipping');
  }
}

const haystack = (event) =>
  [
    event.summary,
    event.reason,
    ...(event.decisions || []),
    ...(event.known_issues || []),
    ...(event.files_changed || []),
    ...(event.tags || []),
    ...(event.evidence || []),
  ]
    .join(' ')
    .toLowerCase();

const matches = events
  .filter((event) => {
    if (text && !haystack(event).includes(text)) return false;
    if (file && ![...(event.files_changed || []), ...(event.evidence || [])].some((f) => f.toLowerCase().includes(file.toLowerCase()))) return false;
    if (tag && !(event.tags || []).includes(tag)) return false;
    if (type && event.type !== type) return false;
    if (confidence && event.confidence !== confidence) return false;
    if (task && event.task_id !== task) return false;
    return true;
  })
  .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || String(b.event_id).localeCompare(String(a.event_id)));

const selected = limit ? matches.slice(0, limit) : matches;

if (asJson) {
  console.log(JSON.stringify(selected, null, 2));
} else if (!selected.length) {
  console.log('no matching events');
} else {
  for (const event of selected) {
    console.log(event.timestamp + '  ' + event.type + '  ' + event.summary);
    console.log('  ' + event.event_id + ' | ' + (event.commit || 'uncommitted') + ' | ' + (event.tags || []).join(', '));
  }
  if (limit && matches.length > selected.length) {
    console.log('\n' + (matches.length - selected.length) + ' more; raise --limit to see them');
  }
}
