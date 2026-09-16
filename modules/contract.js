// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Pure contract-domain helpers: validation, status, clause rendering,
// audit logging. Kept side-effect free so check.mjs can unit-test them.

export const STATUS = {
  DRAFT: 'draft',
  AWAITING: 'awaiting',
  COMPLETED: 'completed'
};

export const STATUS_LABEL = {
  draft: '작성중',
  awaiting: '서명대기',
  completed: '완료'
};

/**
 * Count the fields defined by a template. Pure helper (unit-tested).
 * @param {object} template
 * @returns {number}
 */
export function templateFieldCount(template) {
  if (!template || !Array.isArray(template.fields)) return 0;
  return template.fields.length;
}

/**
 * Validate a single field value against its schema entry.
 * Returns null when valid, otherwise an error string. Pure (unit-tested).
 * @param {object} field  field schema { key, label, type, required, options }
 * @param {*} value
 * @returns {string|null}
 */
export function validateField(field, value) {
  if (!field) return '알 수 없는 필드입니다.';
  const raw = value == null ? '' : String(value).trim();
  if (field.required && raw === '') {
    return `${field.label}은(는) 필수 입력입니다.`;
  }
  if (raw === '') return null; // optional & empty is fine
  if (field.type === 'number' && Number.isNaN(Number(raw))) {
    return `${field.label}은(는) 숫자여야 합니다.`;
  }
  if (field.type === 'select' && Array.isArray(field.options) && !field.options.includes(raw)) {
    return `${field.label}의 값이 올바르지 않습니다.`;
  }
  return null;
}

/**
 * Validate all values for a template. Pure (unit-tested).
 * @param {object} template
 * @param {object} values map keyed by field.key
 * @returns {{ ok: boolean, errors: Object<string,string> }}
 */
export function validateAll(template, values) {
  const errors = {};
  const fields = (template && template.fields) || [];
  for (const field of fields) {
    const err = validateField(field, values ? values[field.key] : '');
    if (err) errors[field.key] = err;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Fill a clause string's {{placeholders}} from values. Missing values are
 * shown as a bracketed blank so the gap is obvious. Pure (unit-tested).
 * @param {string} clause
 * @param {object} values
 * @returns {string}
 */
export function renderClause(clause, values) {
  const v = values || {};
  return String(clause).replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key) => {
    const val = v[key];
    return val != null && String(val).trim() !== '' ? String(val) : '［　　］';
  });
}

/**
 * Render every clause of a template. Pure helper.
 * @param {object} template
 * @param {object} values
 * @returns {string[]}
 */
export function renderClauses(template, values) {
  const clauses = (template && template.clauses) || [];
  return clauses.map((c) => renderClause(c, values));
}

/**
 * Derive the status of a contract from its signature state. Pure (unit-tested).
 * @param {object} contract
 * @returns {string} one of STATUS values
 */
export function deriveStatus(contract) {
  const sigs = (contract && contract.signatures) || [];
  const required = (contract && contract.requiredSigners) || 0;
  if (sigs.length === 0) return STATUS.DRAFT;
  if (required > 0 && sigs.length >= required) return STATUS.COMPLETED;
  return STATUS.AWAITING;
}

/**
 * Append an audit-log entry to a contract (returns a new array). Pure.
 * @param {Array<object>} log existing entries
 * @param {string} action  e.g. 'created', 'signed', 'shared'
 * @param {string} actor
 * @param {object} [extra]
 * @returns {Array<object>}
 */
export function appendAudit(log, action, actor, extra = {}) {
  const entry = {
    action,
    actor: actor || '익명',
    at: new Date().toISOString(),
    ...extra
  };
  return [...(log || []), entry];
}

/**
 * Filter + search contracts for the "내 계약함" view. Pure (unit-tested).
 * @param {Array<object>} contracts
 * @param {{ query?: string, status?: string }} opts
 * @returns {Array<object>}
 */
export function filterContracts(contracts, opts = {}) {
  const q = (opts.query || '').trim().toLowerCase();
  const status = opts.status || 'all';
  return (contracts || []).filter((c) => {
    if (status !== 'all' && c.status !== status) return false;
    if (!q) return true;
    const hay = [c.title, c.templateName, ...(Object.values(c.values || {}))]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Compute days until an expiry date and whether it is near/overdue. Pure.
 * @param {string} expiryDate ISO date (yyyy-mm-dd) or empty
 * @param {Date} [now]
 * @returns {{ days: number|null, state: 'none'|'ok'|'soon'|'overdue' }}
 */
export function expiryStatus(expiryDate, now = new Date()) {
  if (!expiryDate) return { days: null, state: 'none' };
  const end = new Date(expiryDate + 'T00:00:00');
  if (Number.isNaN(end.getTime())) return { days: null, state: 'none' };
  const ms = end.getTime() - new Date(now.toDateString()).getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  let state = 'ok';
  if (days < 0) state = 'overdue';
  else if (days <= 30) state = 'soon';
  return { days, state };
}
