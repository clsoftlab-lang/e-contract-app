// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// SHA-256 document integrity hashing via the Web Crypto API.
// This is a real cryptographic hash of the contract content, used to
// demonstrate tamper-evidence. If a single character of the contract
// changes, the hash changes completely.

/**
 * Compute the SHA-256 hex digest of a string using crypto.subtle.
 * @param {string} text
 * @returns {Promise<string>} lowercase hex string (64 chars)
 */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bufferToHex(digest);
}

/**
 * Convert an ArrayBuffer to a lowercase hex string. Pure helper.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function bufferToHex(buffer) {
  const view = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Format a hash for display with grouped segments for readability.
 * Pure helper (also unit-tested by check.mjs).
 * @param {string} hex
 * @param {number} group segment size (default 8)
 * @returns {string}
 */
export function formatHash(hex, group = 8) {
  if (typeof hex !== 'string') return '';
  const clean = hex.trim();
  const parts = [];
  for (let i = 0; i < clean.length; i += group) {
    parts.push(clean.slice(i, i + group));
  }
  return parts.join(' ');
}

/**
 * Build the canonical text representation of a contract that gets hashed.
 * Keeping this stable and pure guarantees a reproducible integrity hash.
 * @param {object} contract
 * @returns {string}
 */
export function canonicalContractText(contract) {
  const c = contract || {};
  const lines = [];
  lines.push(`TEMPLATE:${c.templateId || ''}`);
  lines.push(`TITLE:${c.title || ''}`);
  const values = c.values || {};
  Object.keys(values).sort().forEach((k) => {
    lines.push(`FIELD:${k}=${values[k]}`);
  });
  (c.clauses || []).forEach((clause, i) => {
    lines.push(`CLAUSE:${i}:${clause}`);
  });
  (c.signatures || []).forEach((sig, i) => {
    lines.push(`SIGN:${i}:${sig.signer || ''}@${sig.signedAt || ''}`);
  });
  return lines.join('\n');
}
