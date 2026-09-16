// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// localStorage persistence layer. All reads/writes are wrapped in try/catch
// so the app keeps working in private windows or when storage is blocked.
// NOTE (DEMO MODE): localStorage is NOT a real database. Data lives only in
// this browser and is not shared, backed up, or legally reliable.

const KEY = 'e-contract-app:contracts:v1';

/**
 * Load all saved contracts. Returns [] on any failure.
 * @returns {Array<object>}
 */
export function loadContracts() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[storage] load failed, using empty list', err);
    return [];
  }
}

/**
 * Persist the full contract list.
 * @param {Array<object>} contracts
 * @returns {boolean} success
 */
export function saveContracts(contracts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(contracts || []));
    return true;
  } catch (err) {
    console.warn('[storage] save failed', err);
    return false;
  }
}

/**
 * Upsert a single contract by id.
 * @param {object} contract
 * @returns {Array<object>} the updated list
 */
export function upsertContract(contract) {
  const list = loadContracts();
  const idx = list.findIndex((c) => c.id === contract.id);
  if (idx >= 0) list[idx] = contract;
  else list.unshift(contract);
  saveContracts(list);
  return list;
}

/**
 * Remove a contract by id.
 * @param {string} id
 * @returns {Array<object>} the updated list
 */
export function deleteContract(id) {
  const list = loadContracts().filter((c) => c.id !== id);
  saveContracts(list);
  return list;
}

/**
 * Wipe all app data (used by the reset button).
 * @returns {boolean} success
 */
export function resetAll() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch (err) {
    console.warn('[storage] reset failed', err);
    return false;
  }
}
