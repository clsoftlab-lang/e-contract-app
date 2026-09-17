// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// CI validator: JSON parse check, index.html container check, and unit tests
// for the pure domain helpers. Run with: node check.mjs
// Exits non-zero on any failure (used by .github/workflows/ci.yml).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AI_ENDPOINT } from './ai/config.js';
import {
  templateFieldCount, validateField, validateAll, renderClause,
  deriveStatus, filterContracts, expiryStatus, appendAudit, STATUS
} from './modules/contract.js';
import { formatHash, canonicalContractText, bufferToHex } from './modules/hash.js';

const root = dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;

function ok(name, cond) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.error('  x FAIL: ' + name); }
}
function eq(name, a, b) {
  ok(name + ` (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
}

console.log('\n[1] data/templates.json parses and is well-formed');
const tj = JSON.parse(readFileSync(join(root, 'data/templates.json'), 'utf8'));
ok('templates.json has templates array', Array.isArray(tj.templates));
ok('at least 5 templates', tj.templates.length >= 5);
ok('every template has id/name/fields/clauses', tj.templates.every(
  (t) => t.id && t.name && Array.isArray(t.fields) && t.fields.length > 0 && Array.isArray(t.clauses) && t.clauses.length > 0
));
ok('every field has key/label/type', tj.templates.every(
  (t) => t.fields.every((f) => f.key && f.label && f.type)
));
const requiredIds = ['employment', 'lease', 'loan', 'service', 'nda'];
ok('contains the 5 core contract types', requiredIds.every((id) => tj.templates.some((t) => t.id === id)));

console.log('\n[2] index.html required containers present');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const requiredIds2 = [
  'template-gallery', 'wizard', 'preview', 'signature-canvas',
  'contract-box', 'view-home', 'view-detail', 'audit-log', 'reset-btn'
];
requiredIds2.forEach((id) => ok(`#${id} present`, html.includes(`id="${id}"`)));
ok('loads app.js as module', /<script[^>]+type="module"[^>]+src="app\.js"/.test(html));
ok('lang is ko', /<html[^>]+lang="ko"/.test(html));

console.log('\n[3] unit: templateFieldCount');
eq('counts fields of a template', templateFieldCount(tj.templates[0]), tj.templates[0].fields.length);
eq('null template -> 0', templateFieldCount(null), 0);
eq('no fields -> 0', templateFieldCount({}), 0);

console.log('\n[4] unit: validateField / validateAll');
ok('required empty fails', validateField({ label: 'X', type: 'text', required: true }, '') !== null);
ok('required filled passes', validateField({ label: 'X', type: 'text', required: true }, 'v') === null);
ok('optional empty passes', validateField({ label: 'X', type: 'text', required: false }, '') === null);
ok('number rejects text', validateField({ label: 'N', type: 'number', required: true }, 'abc') !== null);
ok('number accepts digits', validateField({ label: 'N', type: 'number', required: true }, '12') === null);
ok('select rejects unknown', validateField({ label: 'S', type: 'select', options: ['a', 'b'] }, 'z') !== null);
ok('select accepts known', validateField({ label: 'S', type: 'select', options: ['a', 'b'] }, 'a') === null);
const va = validateAll(
  { fields: [{ key: 'a', label: 'A', type: 'text', required: true }, { key: 'b', label: 'B', type: 'text', required: false }] },
  { a: '', b: '' }
);
ok('validateAll flags missing required', va.ok === false && !!va.errors.a);

console.log('\n[5] unit: renderClause');
eq('fills placeholders', renderClause('안녕 {{name}}', { name: '철수' }), '안녕 철수');
ok('missing placeholder shows blank marker', renderClause('금액 {{amt}}', {}).includes('［'));

console.log('\n[6] unit: deriveStatus');
eq('no signatures -> draft', deriveStatus({ signatures: [], requiredSigners: 2 }), STATUS.DRAFT);
eq('partial -> awaiting', deriveStatus({ signatures: [{}], requiredSigners: 2 }), STATUS.AWAITING);
eq('all signed -> completed', deriveStatus({ signatures: [{}, {}], requiredSigners: 2 }), STATUS.COMPLETED);

console.log('\n[7] unit: filterContracts');
const sample = [
  { title: '근로계약 김', status: 'draft', values: { a: '서울' } },
  { title: '임대차 박', status: 'completed', values: { a: '부산' } }
];
eq('search by title', filterContracts(sample, { query: '김' }).length, 1);
eq('filter by status', filterContracts(sample, { status: 'completed' }).length, 1);
eq('search by value', filterContracts(sample, { query: '부산' }).length, 1);
eq('no filter returns all', filterContracts(sample, {}).length, 2);

console.log('\n[8] unit: expiryStatus');
const now = new Date('2026-01-01');
eq('empty -> none', expiryStatus('', now).state, 'none');
eq('past -> overdue', expiryStatus('2025-12-01', now).state, 'overdue');
eq('within 30d -> soon', expiryStatus('2026-01-20', now).state, 'soon');
eq('far -> ok', expiryStatus('2026-06-01', now).state, 'ok');

console.log('\n[9] unit: appendAudit');
const log = appendAudit([], 'created', '테스터', { note: 'x' });
ok('appends entry', log.length === 1 && log[0].action === 'created' && log[0].actor === '테스터' && !!log[0].at);

console.log('\n[10] unit: hash helpers (pure)');
eq('formatHash groups by 8', formatHash('aabbccdd11223344', 8), 'aabbccdd 11223344');
eq('formatHash non-string -> empty', formatHash(null), '');
eq('bufferToHex converts bytes', bufferToHex(new Uint8Array([0, 255, 16]).buffer), '00ff10');
ok('canonicalContractText is deterministic + includes fields', (() => {
  const c = { templateId: 't', title: 'T', values: { b: '2', a: '1' }, clauses: ['c1'], signatures: [] };
  const s1 = canonicalContractText(c);
  const s2 = canonicalContractText(c);
  return s1 === s2 && s1.includes('FIELD:a=1') && s1.includes('CLAUSE:0:c1');
})());

console.log('\n[11] AI-KIT: syntax check ai/ and server/ files (node --check)');
const aiFiles = [
  'ai/config.js', 'ai/ai.js', 'ai/ui.js',
  'server/index.mjs', 'server/worker.js'
];
for (const rel of aiFiles) {
  try {
    execFileSync(process.execPath, ['--check', join(root, rel)], { stdio: 'pipe' });
    ok(`node --check ${rel}`, true);
  } catch (err) {
    ok(`node --check ${rel} (${String(err.stderr || err).slice(0, 120)})`, false);
  }
}

console.log('\n[12] AI-KIT: AI_ENDPOINT defaults to empty (mock mode)');
ok('AI_ENDPOINT is exactly "" by default', AI_ENDPOINT === '');

console.log('\n[13] AI-KIT: no REAL API key committed anywhere');
// Match only a real Anthropic key (20+ chars after the prefix), built by
// concatenation so this pattern never appears literally in the repo. This lets
// docs mention "sk-ant…" generically without a false positive.
const keyRe = new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const SCAN_EXT = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.example', '.txt', '.toml']);
function scanFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...scanFiles(join(dir, ent.name)));
    } else if (SCAN_EXT.has(extname(ent.name)) || ent.name === '.env.example') {
      out.push(join(dir, ent.name));
    }
  }
  return out;
}
const offenders = [];
for (const file of scanFiles(root)) {
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  if (keyRe.test(content)) offenders.push(file.replace(root, '.'));
}
ok(`no real Anthropic key committed (found in: ${offenders.join(', ') || 'none'})`, offenders.length === 0);

console.log('\n[14] AI-KIT: .gitignore excludes .env (no key/.env committed)');
const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
ok('.gitignore excludes .env', /^\.env\b/m.test(gitignore));

console.log(`\n=== check.mjs result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
