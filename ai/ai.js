// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// AI-KIT core (ES module). One entry point, two providers:
//
//   askAI(task, payload, { onToken }) -> Promise<string>
//
//   * If AI_ENDPOINT is empty  -> a local, deterministic MockProvider produces
//     useful Korean text from the app's own templates/fields. The live demo
//     runs entirely on this — no network, no key, no cost.
//   * If AI_ENDPOINT is set    -> POST { task, payload } to that proxy and
//     stream the text response back (the proxy holds the real API key).
//
// onToken(chunk) is called with incremental text as it arrives (real streaming
// against the proxy, simulated streaming against the mock) so the UI can render
// progressively. The full text is always returned when the promise resolves.

import { AI_ENDPOINT } from './config.js';

// ---- Task identifiers (stable string ids, shared with the proxy) ----
export const TASKS = Object.freeze({
  EXPLAIN_CLAUSE: 'explain_clause', // plain-language + risk flags for one clause
  DRAFT_CONTRACT: 'draft_contract', // brief -> field values (JSON) to prefill wizard
  CONTRACT_QA: 'contract_qa',       // Q&A about the current contract
  RISK_SUMMARY: 'risk_summary'      // auto digest: plain-language risk check for the whole draft
});

const NOT_LEGAL_ADVICE =
  '※ 본 설명은 이해를 돕기 위한 일반 정보이며 법률 자문이 아닙니다. ' +
  '중요한 결정 전에는 반드시 변호사 등 전문가의 검토를 받으세요.';

/**
 * Main AI entry point.
 * @param {string} task one of TASKS
 * @param {object} payload task-specific input
 * @param {{ onToken?: (chunk:string)=>void }} [opts]
 * @returns {Promise<string>} the full text response
 */
export async function askAI(task, payload, opts = {}) {
  const onToken = typeof opts.onToken === 'function' ? opts.onToken : null;
  if (!AI_ENDPOINT) {
    return mockProvider(task, payload || {}, onToken);
  }
  return remoteProvider(task, payload || {}, onToken);
}

// ---------- Remote provider (real AI via your proxy) ----------
// 무인(autonomous): if the proxy is unreachable, errors, or replies 429
// {fallback:true} (rate limit / monthly token cap), we transparently fall back
// to the offline mock so the app NEVER breaks. Streaming via onToken is kept in
// both paths.
async function remoteProvider(task, payload, onToken) {
  let res;
  try {
    res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, payload })
    });
  } catch {
    // Network error -> offline mock.
    return mockProvider(task, payload, onToken);
  }

  // 429 {fallback:true} (or any non-OK / bodyless response) -> offline mock.
  if (res.status === 429 || !res.ok || !res.body) {
    return mockProvider(task, payload, onToken);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        full += chunk;
        if (onToken) onToken(chunk);
      }
    }
  } catch {
    // Mid-stream failure with nothing yet rendered -> fall back to the mock.
    if (!full) return mockProvider(task, payload, onToken);
  }
  return full;
}

// ---------- Mock provider (deterministic, offline) ----------
async function mockProvider(task, payload, onToken) {
  let text;
  switch (task) {
    case TASKS.EXPLAIN_CLAUSE:
      text = mockExplainClause(payload);
      break;
    case TASKS.DRAFT_CONTRACT:
      text = mockDraftContract(payload);
      break;
    case TASKS.CONTRACT_QA:
      text = mockContractQA(payload);
      break;
    case TASKS.RISK_SUMMARY:
      text = mockRiskSummary(payload);
      break;
    default:
      text = '지원하지 않는 AI 작업입니다: ' + String(task);
  }
  return streamOut(text, onToken);
}

// Emit the text in small chunks so the UI shows a streaming effect (mock).
async function streamOut(text, onToken) {
  if (!onToken) return text;
  const chunks = String(text).match(/[\s\S]{1,18}/g) || [];
  for (const c of chunks) {
    onToken(c);
    // A short, deterministic-ish pause; kept tiny so the demo stays snappy.
    await sleep(16);
  }
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Feature 1: 조항 쉬운 설명 + 리스크 플래그 ----
// Risk keywords the mock scans for, each with a short "why it matters" note.
const RISK_TERMS = [
  ['지연손해금', '기한을 넘기면 추가 금전 부담이 생길 수 있습니다.'],
  ['연체', '납부가 늦어지면 불이익(가산금 등)이 따를 수 있습니다.'],
  ['해지', '일정 조건에서 상대가 계약을 끝낼 수 있는 조항입니다.'],
  ['위약', '약속을 어길 경우 위약금 등 책임이 발생할 수 있습니다.'],
  ['손해배상', '위반 시 손해를 물어줘야 할 수 있습니다.'],
  ['전액', '부분이 아닌 전부를 한 번에 부담·변제해야 할 수 있습니다.'],
  ['즉시', '유예 없이 곧바로 의무가 발생할 수 있어 주의가 필요합니다.'],
  ['기한의 이익 상실', '한 번 늦으면 남은 금액을 한꺼번에 갚아야 할 수 있습니다.'],
  ['위반', '조건을 지키지 못하면 불이익이 따를 수 있습니다.'],
  ['공제', '받을 금액에서 일부가 빠질 수 있습니다.'],
  ['원상회복', '반환 시 원래 상태로 되돌릴 의무·비용이 생길 수 있습니다.'],
  ['담보', '채무를 갚지 못하면 담보가 처분될 수 있습니다.']
];

function mockExplainClause(payload) {
  const clause = String(payload.clause || '').trim();
  const tmpl = String(payload.templateName || '계약서');
  if (!clause) return '설명할 조항 내용이 없습니다. 먼저 조항을 선택하세요.';

  const title = clauseTitle(clause);
  const body = clauseBody(clause);
  const lines = [];
  lines.push(`[쉬운 설명] ${title ? title + ' — ' : ''}${tmpl}`);
  lines.push('');
  lines.push('이 조항을 쉽게 풀면 다음과 같습니다:');
  lines.push('· ' + plainify(body));

  const found = RISK_TERMS.filter(([t]) => clause.includes(t));
  lines.push('');
  if (found.length) {
    lines.push('⚠ 눈여겨볼 부분(리스크 플래그):');
    for (const [t, why] of found) lines.push(`  · "${t}": ${why}`);
  } else {
    lines.push('✔ 뚜렷한 고위험 문구는 발견되지 않았습니다. 그래도 금액·기간·의무 주체는 다시 확인하세요.');
  }
  lines.push('');
  lines.push(NOT_LEGAL_ADVICE);
  return lines.join('\n');
}

function clauseTitle(clause) {
  const m = clause.match(/^\s*(제\s*\d+\s*조[^)]*\))/);
  return m ? m[1].trim() : '';
}
function clauseBody(clause) {
  return clause.replace(/^\s*제\s*\d+\s*조\s*\([^)]*\)\s*/, '').trim();
}
// Turn formal legalese into a shorter, plainer sentence (heuristic, deterministic).
function plainify(body) {
  let s = body
    .replace(/함을 목적으로 한다\.?/g, '하는 것이 목적입니다.')
    .replace(/하여야 한다\.?/g, '해야 합니다.')
    .replace(/한다\.?/g, '합니다.')
    .replace(/할 수 있다\.?/g, '할 수 있습니다.')
    .replace(/하지 않는다\.?/g, '하지 않습니다.')
    .replace(/따른다\.?/g, '따릅니다.');
  const first = s.split(/(?<=습니다\.)\s+/)[0] || s;
  return first.length > 160 ? first.slice(0, 157) + '…' : first;
}

// ---- Feature 2: 조건 입력 -> 계약 초안 생성 (returns JSON text) ----
function mockDraftContract(payload) {
  const brief = String(payload.brief || '').trim();
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const tmpl = String(payload.templateName || '계약서');
  const values = {};

  // Pull structured hints out of the free-text brief.
  const amounts = brief.match(/[0-9][0-9,]*\s*(?:억|천만|만원|만|원)/g) || [];
  const dates = brief.match(/\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/g) || [];
  const names = brief.match(/[가-힣]{2,4}(?=\s*(?:씨|님|과|와|은|는|이|가|,|에게)|$)/g) || [];
  const isoDates = dates.map(toIsoDate).filter(Boolean);

  let ai = 0; // amount cursor
  let di = 0; // date cursor
  let ni = 0; // name cursor

  for (const f of fields) {
    const key = f.key || '';
    const label = f.label || key;
    if (f.type === 'date') {
      values[key] = isoDates[di++] || '';
      continue;
    }
    if (f.group === '당사자') {
      values[key] = names[ni++] || nameFromLabel(label);
      continue;
    }
    if (isMoneyField(key, label)) {
      values[key] = amounts[ai++] || '';
      continue;
    }
    if (f.type === 'select') {
      values[key] = (f.options && f.options[0]) || '';
      continue;
    }
    // Sensible text default derived from the brief + label.
    values[key] = deriveText(key, label, brief);
  }

  const note = brief
    ? `입력하신 조건("${trim(brief, 60)}")을 바탕으로 ${tmpl} 초안을 채웠습니다. 빈 칸은 정보가 부족한 항목이니 직접 확인·보완하세요.`
    : `${tmpl}의 표준 초안을 제안합니다. 각 항목을 실제 조건으로 수정하세요.`;

  // Real proxy returns the same JSON shape; the UI JSON.parses this text.
  return JSON.stringify({ values, note, disclaimer: NOT_LEGAL_ADVICE }, null, 2);
}

function isMoneyField(key, label) {
  const k = (key + ' ' + label).toLowerCase();
  return /(wage|deposit|rent|fee|principal|amount|보증금|차임|임금|대금|원금|금액|관리비|이자)/.test(k);
}
function nameFromLabel(label) {
  return '［' + String(label).replace(/\s*\*?$/, '') + ' 입력］';
}
function deriveText(key, label, brief) {
  if (/scope|purpose|내용|범위|목적|업무/.test(key + label) && brief) {
    return trim(brief, 120);
  }
  return '';
}
function toIsoDate(s) {
  const m = String(s).match(/(\d{4})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/);
  if (!m) return '';
  const y = m[1];
  const mo = String(m[2]).padStart(2, '0');
  const d = String(m[3]).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// ---- Feature 3: 계약 Q&A 챗봇 ----
function mockContractQA(payload) {
  const q = String(payload.question || '').trim();
  const contract = payload.contract || {};
  const values = contract.values || {};
  const clauses = Array.isArray(contract.clauses) ? contract.clauses : [];
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  if (!q) return '질문을 입력해 주세요.';

  const out = [];
  const labelOf = (k) => (fields.find((f) => f.key === k) || {}).label || k;

  // Intent routing by keyword.
  if (/(금액|얼마|보증금|임금|대금|원금|차임|이자|비용|관리비)/.test(q)) {
    const moneyKeys = Object.keys(values).filter((k) => isMoneyField(k, labelOf(k)) && val(values[k]));
    if (moneyKeys.length) {
      out.push('금액 관련 항목은 다음과 같습니다:');
      moneyKeys.forEach((k) => out.push(`  · ${labelOf(k)}: ${values[k]}`));
    } else {
      out.push('이 계약서에는 아직 입력된 금액 항목이 없습니다.');
    }
  } else if (/(언제|기간|날짜|시작|종료|만료|변제|납품)/.test(q)) {
    const dateKeys = fields.filter((f) => f.type === 'date' && val(values[f.key]));
    if (dateKeys.length) {
      out.push('날짜·기간 관련 항목은 다음과 같습니다:');
      dateKeys.forEach((f) => out.push(`  · ${f.label}: ${values[f.key]}`));
    } else {
      out.push('이 계약서에는 아직 입력된 날짜 항목이 없습니다.');
    }
  } else if (/(누구|당사자|상대|이름|성명|대표)/.test(q)) {
    const partyKeys = fields.filter((f) => f.group === '당사자' && val(values[f.key]));
    if (partyKeys.length) {
      out.push('계약 당사자는 다음과 같습니다:');
      partyKeys.forEach((f) => out.push(`  · ${f.label}: ${values[f.key]}`));
    } else {
      out.push('아직 당사자 정보가 입력되지 않았습니다.');
    }
  } else {
    // Fallback: return the clause most relevant to the question terms.
    const best = bestClause(q, clauses);
    if (best) {
      out.push('질문과 가장 관련 있어 보이는 조항입니다:');
      out.push('  · ' + trim(best, 200));
    } else {
      out.push('해당 내용을 계약서에서 찾지 못했습니다. 질문을 조금 더 구체적으로 적어 주세요.');
    }
  }

  out.push('');
  out.push(NOT_LEGAL_ADVICE);
  return out.join('\n');
}

function bestClause(q, clauses) {
  const terms = q.replace(/[?？.!,]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
  let best = null;
  let bestScore = 0;
  for (const c of clauses) {
    let score = 0;
    for (const t of terms) if (c.includes(t)) score++;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore > 0 ? best : (clauses[0] || null);
}

// ---- Autonomous feature: 계약 리스크 점검 요약 ----
// Runs on-load when a draft is open. Reuses the same RISK_TERMS engine as the
// per-clause explainer to produce a short, plain-language digest over the WHOLE
// contract. Deterministic, offline, and explicitly NOT legal advice.
function mockRiskSummary(payload) {
  const tmpl = String(payload.templateName || '계약서');
  const clauses = Array.isArray(payload.clauses) ? payload.clauses : [];
  if (!clauses.length) {
    return '요약할 조항이 아직 없습니다. 항목을 채우고 미리보기를 열면 자동으로 점검합니다.';
  }

  // Aggregate every risk term found across all clauses, remembering where.
  const hits = new Map(); // term -> { why, where:Set<label> }
  clauses.forEach((c, i) => {
    const label = shortClauseLabel(c, i);
    for (const [term, why] of RISK_TERMS) {
      if (String(c).includes(term)) {
        const e = hits.get(term) || { why, where: new Set() };
        e.where.add(label);
        hits.set(term, e);
      }
    }
  });

  const lines = [];
  lines.push(`[자동 요약] ${tmpl} — 조항 ${clauses.length}개를 훑어 주의할 지점을 점검했습니다.`);
  lines.push('');
  if (hits.size) {
    lines.push('⚠ 특히 눈여겨볼 지점:');
    // Keep it to the top 5 so the digest stays unobtrusive.
    let n = 0;
    for (const [term, e] of hits) {
      if (n++ >= 5) break;
      const where = Array.from(e.where).slice(0, 3).join(', ');
      lines.push(`  · "${term}" (${where}): ${e.why}`);
    }
    lines.push('');
    lines.push('금액·기간·의무 주체는 서명 전에 한 번 더 확인하세요.');
  } else {
    lines.push('✔ 뚜렷한 고위험 문구는 발견되지 않았습니다. 그래도 금액·기간·의무 주체는 다시 확인하세요.');
  }
  lines.push('');
  lines.push(NOT_LEGAL_ADVICE);
  return lines.join('\n');
}

function shortClauseLabel(clause, i) {
  const m = String(clause).match(/^\s*(제\s*\d+\s*조\s*\([^)]*\))/);
  return m ? m[1].trim() : `조항 ${i + 1}`;
}

// ---- small utils ----
function val(x) { return x != null && String(x).trim() !== ''; }
function trim(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
