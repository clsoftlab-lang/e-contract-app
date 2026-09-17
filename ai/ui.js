// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// AI-KIT UI wiring. Builds the three AI features into the existing app views
// and calls askAI() (which transparently uses the local mock or a real proxy).
// Kept in its own module so app.js stays focused on the core contract flow.

import { askAI, TASKS } from './ai.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const AI_BADGE =
  '<span class="ai-badge" title="비어 있는 AI_ENDPOINT에서는 내장 목업이 동작합니다">AI</span>';
const DISCLAIMER =
  '법률 자문이 아닙니다 — 이해를 돕는 일반 정보이며, 중요한 결정 전 전문가 검토가 필요합니다.';

// ---------- Feature 2: brief -> draft (in the wizard view) ----------
/**
 * @param {HTMLElement} container
 * @param {{ getTemplate:()=>object, applyValues:(v:object)=>void }} hooks
 */
export function mountWizardAI(container, hooks) {
  if (!container) return;
  container.classList.add('ai-panel');
  container.innerHTML = `
    <h2 class="ai-h">${AI_BADGE} 조건 입력 → 계약 초안 생성</h2>
    <p class="ai-sub">당사자·금액·기간 등 핵심 조건을 자유롭게 적으면 AI가 초안을 만들어 아래 항목을 채웁니다.</p>
    <textarea id="ai-brief" class="input" rows="3"
      placeholder="예: 임대인 박정원, 임차인 최유진, 보증금 1억원, 월 차임 80만원, 2026-03-01부터 2028-02-28까지"></textarea>
    <div class="ai-row">
      <button type="button" class="btn primary" id="ai-draft-btn">AI 초안 생성</button>
    </div>
    <div id="ai-draft-out" class="ai-out" aria-live="polite"></div>
    <p class="ai-note">${DISCLAIMER}</p>`;

  const btn = container.querySelector('#ai-draft-btn');
  const out = container.querySelector('#ai-draft-out');
  btn.addEventListener('click', async () => {
    const template = hooks.getTemplate && hooks.getTemplate();
    if (!template) { out.textContent = '먼저 템플릿을 선택하세요.'; return; }
    const brief = (container.querySelector('#ai-brief').value || '').trim();
    setBusy(btn, out, true, '초안 생성 중…');
    try {
      const text = await askAI(TASKS.DRAFT_CONTRACT, {
        brief,
        templateName: template.name,
        fields: template.fields || []
      });
      const parsed = safeJson(text);
      if (parsed && parsed.values && hooks.applyValues) {
        hooks.applyValues(parsed.values);
        out.textContent = (parsed.note || 'AI가 초안을 채웠습니다.') +
          '\n\n생성된 항목을 확인하고 필요한 부분을 수정하세요.';
      } else {
        out.textContent = text;
      }
    } catch (err) {
      out.textContent = 'AI 초안 생성 실패: ' + err.message;
    } finally {
      setBusy(btn, out, false);
    }
  });
}

// ---------- Features 1 & 3: explain + Q&A (in the preview view) ----------
/**
 * @param {HTMLElement} container
 * @param {{ getContract:()=>object, getTemplate:()=>object }} hooks
 * @returns {{ refresh:()=>void }}
 */
export function mountPreviewAI(container, hooks) {
  if (!container) return { refresh() {} };
  container.classList.add('ai-panel');
  container.innerHTML = `
    <h2 class="ai-h">${AI_BADGE} AI 계약 도우미</h2>

    <div class="ai-block">
      <h3 class="ai-h3">조항 쉬운 설명 + 리스크 플래그</h3>
      <select id="ai-clause-sel" class="input" aria-label="설명할 조항 선택"></select>
      <div class="ai-row">
        <button type="button" class="btn" id="ai-explain-btn">쉬운 설명 보기</button>
      </div>
      <div id="ai-explain-out" class="ai-out" aria-live="polite"></div>
    </div>

    <div class="ai-block">
      <h3 class="ai-h3">계약 Q&amp;A 챗봇</h3>
      <div class="ai-row">
        <input id="ai-q" class="input" type="text"
          placeholder="예: 보증금은 얼마인가요? / 계약 기간은 언제까지인가요?" aria-label="계약 질문" />
        <button type="button" class="btn primary" id="ai-q-btn">질문</button>
      </div>
      <div id="ai-q-out" class="ai-out" aria-live="polite"></div>
    </div>

    <p class="ai-note">${DISCLAIMER}</p>`;

  const sel = container.querySelector('#ai-clause-sel');
  const explainBtn = container.querySelector('#ai-explain-btn');
  const explainOut = container.querySelector('#ai-explain-out');
  const qInput = container.querySelector('#ai-q');
  const qBtn = container.querySelector('#ai-q-btn');
  const qOut = container.querySelector('#ai-q-out');

  function refresh() {
    const c = hooks.getContract && hooks.getContract();
    const clauses = (c && c.clauses) || [];
    sel.innerHTML = clauses.length
      ? clauses.map((cl, i) => `<option value="${i}">${esc(shortLabel(cl, i))}</option>`).join('')
      : '<option value="">(조항이 아직 없습니다)</option>';
    explainOut.textContent = '';
    qOut.textContent = '';
  }
  refresh();

  explainBtn.addEventListener('click', async () => {
    const c = hooks.getContract && hooks.getContract();
    const clauses = (c && c.clauses) || [];
    const idx = Number(sel.value);
    const clause = clauses[idx];
    if (!clause) { explainOut.textContent = '설명할 조항을 선택하세요.'; return; }
    setBusy(explainBtn, explainOut, true, '분석 중…');
    try {
      let acc = '';
      await askAI(TASKS.EXPLAIN_CLAUSE,
        { clause, templateName: (c && c.templateName) || '계약서' },
        { onToken: (t) => { acc += t; explainOut.textContent = acc; } });
    } catch (err) {
      explainOut.textContent = 'AI 설명 실패: ' + err.message;
    } finally {
      setBusy(explainBtn, explainOut, false);
    }
  });

  const ask = async () => {
    const c = hooks.getContract && hooks.getContract();
    const template = hooks.getTemplate && hooks.getTemplate();
    const question = (qInput.value || '').trim();
    if (!question) { qOut.textContent = '질문을 입력하세요.'; return; }
    setBusy(qBtn, qOut, true, '답변 생성 중…');
    try {
      let acc = '';
      await askAI(TASKS.CONTRACT_QA,
        { question, contract: c || {}, fields: (template && template.fields) || [] },
        { onToken: (t) => { acc += t; qOut.textContent = acc; } });
    } catch (err) {
      qOut.textContent = 'AI 답변 실패: ' + err.message;
    } finally {
      setBusy(qBtn, qOut, false);
    }
  };
  qBtn.addEventListener('click', ask);
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });

  return { refresh };
}

function shortLabel(clause, i) {
  const m = String(clause).match(/^\s*(제\s*\d+\s*조\s*\([^)]*\))/);
  return m ? m[1].trim() : `조항 ${i + 1}`;
}
function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
function setBusy(btn, out, busy, msg) {
  if (btn) btn.disabled = busy;
  if (busy && out && msg) out.textContent = msg;
}
