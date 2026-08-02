// Render primitives shared by the board, the modals and the assistant.
//
// Extracted so the surfaces cannot drift: a call and a confidence have to read
// identically wherever you meet them, or the artifact stops being one argument
// and becomes several screens.

import { DISPOSITION_LABEL } from '../engine/dispose.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const num = (n) => Number(n).toLocaleString('en-GB');

// Inline evidence chips — the Studio Notes pattern. A rationale is a list of
// strings and chips so the numbers inside a sentence stay quotable.
export function renderChips(parts) {
  return parts.map((p) => (typeof p === 'string' ? esc(p) : `<span class="chip chip--${p.tone}">${esc(p.v)}</span>`)).join('');
}

// Confidence is never colour alone — colour carries the call, confidence
// carries its own mark and its own word.
export function confidenceMark(level) {
  const on = { high: 3, medium: 2, low: 1 }[level] ?? 1;
  return `<span class="conf conf--${level}"><span class="dots">${[0, 1, 2]
    .map((i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>${esc(level)} confidence</span>`;
}

export function callChip(call) {
  return `<span class="badge badge--${esc(call)}">${esc(DISPOSITION_LABEL[call])}</span>`;
}
