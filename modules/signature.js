// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// Canvas signature pad. Handles mouse + touch (pointer events), high-DPI
// scaling, clearing, and exporting the drawn signature as a PNG data URL.

export class SignaturePad {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drawing = false;
    this.hasInk = false;
    this._last = null;
    this._bound = {};
    this._resize();
    this._attach();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._style();
  }

  _style() {
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.ctx.lineWidth = 2.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = dark ? '#e8eef7' : '#12233b';
  }

  _pos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  _start(evt) {
    evt.preventDefault();
    this.drawing = true;
    this._last = this._pos(evt);
  }

  _move(evt) {
    if (!this.drawing) return;
    evt.preventDefault();
    const p = this._pos(evt);
    this.ctx.beginPath();
    this.ctx.moveTo(this._last.x, this._last.y);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
    this._last = p;
    this.hasInk = true;
  }

  _end(evt) {
    if (evt && evt.preventDefault) evt.preventDefault();
    this.drawing = false;
    this._last = null;
  }

  _attach() {
    this._bound.start = (e) => this._start(e);
    this._bound.move = (e) => this._move(e);
    this._bound.end = (e) => this._end(e);
    this.canvas.addEventListener('pointerdown', this._bound.start);
    this.canvas.addEventListener('pointermove', this._bound.move);
    window.addEventListener('pointerup', this._bound.end);
    this.canvas.addEventListener('pointerleave', this._bound.end);
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._bound.start);
    this.canvas.removeEventListener('pointermove', this._bound.move);
    window.removeEventListener('pointerup', this._bound.end);
    this.canvas.removeEventListener('pointerleave', this._bound.end);
  }

  /** Clear the canvas. */
  clear() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    this.hasInk = false;
  }

  /** @returns {boolean} whether any stroke was drawn */
  isEmpty() {
    return !this.hasInk;
  }

  /** @returns {string} PNG data URL of the signature */
  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}
