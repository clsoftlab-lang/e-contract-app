// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// 한국전자계약 (e-Contract) — demo SPA controller.
// Wires the template gallery, wizard, preview/signing, contract box and
// detail views together. All persistence is client-side (localStorage) and
// all cryptographic hashing uses the real Web Crypto API.

import { sha256Hex, formatHash, canonicalContractText } from './modules/hash.js';
import * as store from './modules/storage.js';
import { SignaturePad } from './modules/signature.js';
import {
  STATUS, STATUS_LABEL, validateAll, renderClauses,
  deriveStatus, appendAudit, filterContracts, expiryStatus, templateFieldCount
} from './modules/contract.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  templates: [],
  currentTemplate: null,
  draft: null,        // contract being authored
  pad: null,
  contracts: []
};

// ---------- bootstrap ----------
init().catch((err) => {
  console.error('초기화 실패', err);
  toast('앱 초기화에 실패했습니다: ' + err.message);
});

async function init() {
  const res = await fetch('data/templates.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('templates.json 로드 실패 (' + res.status + ')');
  const data = await res.json();
  state.templates = data.templates || [];
  state.contracts = store.loadContracts();
  renderGallery();
  updateBoxCount();
  bindGlobalNav();
  bindWizardNav();
  bindPreview();
  bindBox();
  bindDetail();
  showView('home');
}

// ---------- navigation ----------
function showView(name, id) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const view = $('#view-' + name);
  if (view) view.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'box') renderBox();
  if (name === 'detail' && id) renderDetail(id);
}

function bindGlobalNav() {
  $$('[data-nav]').forEach((el) => {
    const go = () => showView(el.getAttribute('data-nav'));
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('모든 데모 계약 데이터를 삭제할까요? 되돌릴 수 없습니다.')) return;
    store.resetAll();
    state.contracts = [];
    updateBoxCount();
    renderBox();
    toast('데모 데이터를 초기화했습니다.');
  });
}

// ---------- template gallery ----------
function renderGallery() {
  const gal = $('#template-gallery');
  gal.innerHTML = '';
  state.templates.forEach((t) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tmpl-card';
    card.innerHTML = `
      <span class="tmpl-icon" aria-hidden="true">${t.icon || '📄'}</span>
      <span class="tmpl-cat">${esc(t.category || '')}</span>
      <span class="tmpl-name">${esc(t.name)}</span>
      <span class="tmpl-sum">${esc(t.summary || '')}</span>
      <span class="tmpl-meta">${templateFieldCount(t)}개 입력 항목</span>`;
    card.addEventListener('click', () => startWizard(t));
    gal.appendChild(card);
  });
}

// ---------- wizard ----------
function startWizard(template) {
  state.currentTemplate = template;
  state.draft = {
    id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    templateId: template.id,
    templateName: template.name,
    title: template.name,
    values: {},
    clauses: [],
    signatures: [],
    requiredSigners: 2,
    audit: appendAudit([], 'created', '나(데모)', { note: template.name + ' 초안 생성' }),
    status: STATUS.DRAFT,
    createdAt: new Date().toISOString()
  };
  renderWizard(template);
  renderChecklist(template);
  showView('wizard');
}

function renderWizard(template) {
  const form = $('#wizard');
  form.innerHTML = '';
  const groups = {};
  template.fields.forEach((f) => {
    (groups[f.group || '기타'] = groups[f.group || '기타'] || []).push(f);
  });
  // title field
  const titleWrap = document.createElement('div');
  titleWrap.className = 'field';
  titleWrap.innerHTML = `<label class="field-label" for="f-title">계약서 제목</label>`;
  const titleInput = document.createElement('input');
  titleInput.className = 'input';
  titleInput.id = 'f-title';
  titleInput.value = state.draft.title;
  titleInput.addEventListener('input', () => { state.draft.title = titleInput.value; });
  titleWrap.appendChild(titleInput);
  form.appendChild(titleWrap);

  Object.keys(groups).forEach((g) => {
    const fs = document.createElement('fieldset');
    fs.className = 'field-group';
    fs.innerHTML = `<legend>${esc(g)}</legend>`;
    groups[g].forEach((f) => fs.appendChild(buildField(f)));
    form.appendChild(fs);
  });
}

function buildField(f) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = 'f-' + f.key;
  const req = f.required ? ' <span class="req">*</span>' : '';
  wrap.innerHTML = `<label class="field-label" for="${id}">${esc(f.label)}${req}</label>`;
  let input;
  if (f.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else if (f.type === 'select') {
    input = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '선택하세요';
    input.appendChild(blank);
    (f.options || []).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      input.appendChild(opt);
    });
  } else {
    input = document.createElement('input');
    input.type = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
  }
  input.className = 'input';
  input.id = id;
  if (f.placeholder) input.placeholder = f.placeholder;
  input.value = state.draft.values[f.key] || '';
  input.addEventListener('input', () => {
    state.draft.values[f.key] = input.value;
    wrap.classList.remove('has-error');
    const e = $('.field-error', wrap);
    if (e) e.remove();
  });
  wrap.appendChild(input);
  return wrap;
}

function renderChecklist(template) {
  const box = $('#wizard-checklist');
  const items = (template.checklist || []).map((c) => `<li>${esc(c)}</li>`).join('');
  box.innerHTML = `<h2>계약 항목 체크리스트</h2><ul class="check-ul">${items}</ul>`;
}

function bindWizardNav() {
  $('#to-preview-btn').addEventListener('click', () => {
    const { ok, errors } = validateAll(state.currentTemplate, state.draft.values);
    if (!ok) {
      Object.entries(errors).forEach(([key, msg]) => {
        const wrap = $('#f-' + key)?.closest('.field');
        if (wrap && !$('.field-error', wrap)) {
          wrap.classList.add('has-error');
          const p = document.createElement('p');
          p.className = 'field-error';
          p.textContent = msg;
          wrap.appendChild(p);
        }
      });
      toast('필수 항목을 확인해 주세요.');
      return;
    }
    goPreview();
  });
}

// ---------- preview + signing ----------
async function goPreview() {
  state.draft.clauses = renderClauses(state.currentTemplate, state.draft.values);
  renderPreviewDoc();
  await refreshIntegrity();
  setupPad();
  showView('preview');
}

function renderPreviewDoc(target = '#preview') {
  const el = $(target);
  const d = state.draft;
  const partyRows = state.currentTemplate.fields
    .filter((f) => f.group === '당사자')
    .map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(d.values[f.key] || '-')}</td></tr>`)
    .join('');
  const clauseHtml = d.clauses.map((c) => `<p class="clause">${esc(c)}</p>`).join('');
  const sigHtml = renderSignatureBlock(d);
  el.innerHTML = `
    <h2 class="doc-title">${esc(d.title)}</h2>
    <table class="party-table">${partyRows}</table>
    <div class="doc-body">${clauseHtml}</div>
    ${sigHtml}
    <p class="doc-date">작성일: ${new Date(d.createdAt).toLocaleDateString('ko-KR')}</p>`;
}

function renderSignatureBlock(d) {
  if (!d.signatures.length) {
    return `<p class="sig-placeholder">아직 서명이 없습니다. 오른쪽 캔버스에서 서명하세요.</p>`;
  }
  const rows = d.signatures.map((s) => `
    <div class="sig-item">
      <img src="${s.image}" alt="${esc(s.signer)} 서명" class="sig-img" />
      <div class="sig-info">
        <strong>${esc(s.signer)}</strong>
        <span>서명 시각: ${new Date(s.signedAt).toLocaleString('ko-KR')}</span>
      </div>
    </div>`).join('');
  return `<div class="sig-block"><h3>서명</h3>${rows}</div>`;
}

function setupPad() {
  if (state.pad) state.pad.destroy();
  const canvas = $('#signature-canvas');
  state.pad = new SignaturePad(canvas);
  $('#signer-name').value = '';
}

function bindPreview() {
  $('#back-to-wizard').addEventListener('click', () => showView('wizard'));
  $('#clear-sign-btn').addEventListener('click', () => state.pad && state.pad.clear());
  $('#apply-sign-btn').addEventListener('click', applySignature);
  $('#save-draft-btn').addEventListener('click', () => saveContract(false));
  $('#finish-btn').addEventListener('click', () => saveContract(true));
}

async function applySignature() {
  if (!state.pad || state.pad.isEmpty()) {
    toast('먼저 캔버스에 서명을 그려주세요.');
    return;
  }
  const name = $('#signer-name').value.trim();
  if (!name) {
    toast('서명자 이름을 입력하세요.');
    return;
  }
  const sig = {
    signer: name,
    signedAt: new Date().toISOString(),
    image: state.pad.toDataURL()
  };
  state.draft.signatures.push(sig);
  state.draft.audit = appendAudit(state.draft.audit, 'signed', name, { note: name + ' 서명 날인' });
  state.draft.status = deriveStatus(state.draft);
  renderPreviewDoc();
  await refreshIntegrity();
  state.pad.clear();
  $('#signer-name').value = '';
  toast(name + ' 님의 서명이 날인되었습니다.');
}

async function refreshIntegrity() {
  const d = state.draft;
  const canonical = canonicalContractText(d);
  const hash = await sha256Hex(canonical);
  d.hash = hash;
  const badge = state.draft.signatures.length
    ? `<span class="ok">✔ ${state.draft.signatures.length}인 서명됨</span>`
    : `<span class="warn">서명 대기</span>`;
  $('#integrity').innerHTML = `
    <h3>문서 무결성 (SHA-256)</h3>
    <p class="status-line">${badge}</p>
    <code class="hash">${formatHash(hash)}</code>
    <p class="hint">계약 내용이나 서명이 한 글자라도 바뀌면 이 해시가 완전히 달라져 위·변조를 감지할 수 있습니다.</p>`;
}

async function saveContract(finalize) {
  const d = state.draft;
  if (finalize && d.signatures.length === 0) {
    if (!confirm('서명이 없습니다. 서명 없이 계약함에 저장할까요?')) return;
  }
  d.clauses = renderClauses(state.currentTemplate, d.values);
  d.status = deriveStatus(d);
  d.updatedAt = new Date().toISOString();
  d.hash = await sha256Hex(canonicalContractText(d));
  if (finalize) {
    d.audit = appendAudit(d.audit, 'saved', '나(데모)', { note: '계약함 저장' });
  }
  state.contracts = store.upsertContract(d);
  updateBoxCount();
  toast(finalize ? '계약이 계약함에 저장되었습니다.' : '임시 저장되었습니다.');
  showView('box');
}

// ---------- contract box ----------
function bindBox() {
  $('#search-input').addEventListener('input', renderBox);
  $('#status-filter').addEventListener('change', renderBox);
}

function updateBoxCount() {
  $('#box-count').textContent = String(state.contracts.length);
}

function renderBox() {
  const list = $('#contract-box');
  const filtered = filterContracts(state.contracts, {
    query: $('#search-input').value,
    status: $('#status-filter').value
  });
  if (!filtered.length) {
    list.innerHTML = `<p class="empty">표시할 계약이 없습니다. 템플릿에서 새 계약을 만들어 보세요.</p>`;
    return;
  }
  list.innerHTML = '';
  filtered.forEach((c) => {
    const exp = expiryStatus(c.values.endDate || c.values.leaseEnd || c.values.repayDate || '');
    let expTag = '';
    if (exp.state === 'overdue') expTag = `<span class="tag overdue">만료됨</span>`;
    else if (exp.state === 'soon') expTag = `<span class="tag soon">D-${exp.days} 만료임박</span>`;
    const card = document.createElement('div');
    card.className = 'contract-card';
    card.innerHTML = `
      <div class="cc-head">
        <span class="status-badge ${c.status}">${STATUS_LABEL[c.status] || c.status}</span>
        ${expTag}
      </div>
      <h3 class="cc-title">${esc(c.title)}</h3>
      <p class="cc-meta">${esc(c.templateName)} · 서명 ${c.signatures.length}/${c.requiredSigners}</p>
      <p class="cc-hash" title="문서 해시">🔐 ${esc((c.hash || '').slice(0, 16))}…</p>
      <button type="button" class="btn small">열기</button>`;
    card.querySelector('button').addEventListener('click', () => showView('detail', c.id));
    list.appendChild(card);
  });
}

// ---------- detail ----------
let detailId = null;
function bindDetail() {
  $('#print-btn').addEventListener('click', () => window.print());
  $('#delete-btn').addEventListener('click', () => {
    if (!detailId) return;
    if (!confirm('이 계약을 삭제할까요?')) return;
    state.contracts = store.deleteContract(detailId);
    updateBoxCount();
    toast('계약을 삭제했습니다.');
    showView('box');
  });
  $('#share-btn').addEventListener('click', () => {
    const c = state.contracts.find((x) => x.id === detailId);
    if (!c) return;
    const link = `${location.origin}${location.pathname}#/share/${c.id}?h=${(c.hash || '').slice(0, 12)}`;
    c.audit = appendAudit(c.audit, 'shared', '나(데모)', { note: '공유 링크 생성(모의)' });
    store.upsertContract(c);
    const out = $('#share-out');
    out.classList.remove('hidden');
    out.innerHTML = `<p class="hint">모의 공유 링크(실제 전송되지 않음):</p><code class="share-link">${esc(link)}</code>`;
    renderAudit(c);
    toast('모의 공유 링크를 생성했습니다.');
  });
}

function renderDetail(id) {
  detailId = id;
  const c = state.contracts.find((x) => x.id === id);
  if (!c) { showView('box'); return; }
  // render doc using stored data (rebuild currentTemplate reference)
  const tmpl = state.templates.find((t) => t.id === c.templateId) || { fields: [] };
  const partyRows = (tmpl.fields || [])
    .filter((f) => f.group === '당사자')
    .map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(c.values[f.key] || '-')}</td></tr>`)
    .join('');
  const clauseHtml = (c.clauses || []).map((cl) => `<p class="clause">${esc(cl)}</p>`).join('');
  $('#detail-doc').innerHTML = `
    <h2 class="doc-title">${esc(c.title)}</h2>
    <table class="party-table">${partyRows}</table>
    <div class="doc-body">${clauseHtml}</div>
    ${renderSignatureBlock(c)}
    <p class="doc-date">작성일: ${new Date(c.createdAt).toLocaleDateString('ko-KR')}</p>`;

  const exp = expiryStatus(c.values.endDate || c.values.leaseEnd || c.values.repayDate || '');
  const expLine = exp.state === 'none' ? '해당 없음'
    : exp.state === 'overdue' ? `만료됨 (${Math.abs(exp.days)}일 경과)`
    : exp.state === 'soon' ? `D-${exp.days} (만료 임박)`
    : `D-${exp.days}`;
  $('#detail-meta').innerHTML = `
    <h2>계약 정보</h2>
    <p><strong>상태:</strong> <span class="status-badge ${c.status}">${STATUS_LABEL[c.status]}</span></p>
    <p><strong>템플릿:</strong> ${esc(c.templateName)}</p>
    <p><strong>서명:</strong> ${c.signatures.length} / ${c.requiredSigners}</p>
    <p><strong>만료 알림:</strong> ${expLine}</p>
    <p><strong>문서 해시(SHA-256):</strong></p>
    <code class="hash">${formatHash(c.hash || '')}</code>`;
  renderAudit(c);
  $('#share-out').classList.add('hidden');
}

function renderAudit(c) {
  const map = { created: '생성', signed: '서명', saved: '저장', shared: '공유' };
  $('#audit-log').innerHTML = (c.audit || []).map((a) => `
    <li>
      <span class="audit-action">${map[a.action] || a.action}</span>
      <span class="audit-actor">${esc(a.actor)}</span>
      <time>${new Date(a.at).toLocaleString('ko-KR')}</time>
      ${a.note ? `<span class="audit-note">${esc(a.note)}</span>` : ''}
    </li>`).join('');
}

// ---------- utils ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
