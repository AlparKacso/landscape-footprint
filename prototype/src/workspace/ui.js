// Render primitives shared by the board, the inventory and the drawer.
//
// Extracted so the three surfaces cannot drift: an object's evidence has to
// read identically whether you meet it in a decision, in a table row or in a
// drawer, or the artifact stops being one argument and becomes three screens.

import { EVIDENCE, EVIDENCE_LABEL } from '../core/evidence.js';
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

// --- evidence, said the same way everywhere ---------------------------------

export const EVIDENCE_RANK = {
  [EVIDENCE.ACTIVE]: 0,
  [EVIDENCE.DEAD]: 1,
  [EVIDENCE.UNMEASURED]: 2,
  [EVIDENCE.UNMEASURABLE]: 3,
};

export const EVIDENCE_CLASS = {
  [EVIDENCE.ACTIVE]: 'e-active',
  [EVIDENCE.DEAD]: 'e-dead',
  [EVIDENCE.UNMEASURED]: 'e-unmeasured',
  [EVIDENCE.UNMEASURABLE]: 'e-unmeasurable',
};

// One line. For a running object that means the numbers, because "Running" on
// its own is the kind of label that survives a screenshot and loses the
// argument; for the other three it means the state, because there is nothing
// else honest to say.
export function evidenceLine(object) {
  if (object.evidence === EVIDENCE.ACTIVE && object.usage) {
    return `${num(object.usage.executions)}/mo · ${plural(object.usage.users, 'user')}`;
  }
  return EVIDENCE_LABEL[object.evidence];
}

export function evidenceDot(object) {
  return `<span class="ev"><i class="${EVIDENCE_CLASS[object.evidence]}"></i>${esc(evidenceLine(object))}</span>`;
}

// --- flags ------------------------------------------------------------------
//
// Every one of these is a signal the engine already derives for scoring. None
// of them decides anything on its own — they are here so a row carries the
// same "look at this" a person would say out loud while scrolling.

export function flagsFor(object, rules) {
  const flags = [];
  if (object.writesStandard?.length) {
    flags.push({ id: 'clean-core', label: 'clean-core', tone: 'risk',
      tip: `Writes into ${plural(object.writesStandard.length, 'standard object')}: ${object.writesStandard.join(', ')}. Blocks a clean core independently of usage.` });
  }
  if (object.forkPartner) {
    flags.push({ id: 'fork', label: 'version fork', tone: 'warn',
      tip: `Runs alongside ${object.forkPartner}. Migrating either side without resolving the fork carries it into S/4.` });
  }
  if (object.tcodeDirect) {
    flags.push({ id: 'entry', label: 'entry point', tone: 'ok',
      tip: 'A transaction code runs on this. The business reaches it directly.' });
  }
  if (rules?.externalAuthorPrefix && object.developerId?.startsWith(rules.externalAuthorPrefix)) {
    flags.push({ id: 'external', label: 'external author', tone: 'warn',
      tip: `Authored by ${object.developerId}, an external consultant. Nobody in-house owns the knowledge.` });
  }
  if (rules?.migrationEraPackages?.includes(object.package)) {
    flags.push({ id: 'migration', label: 'migration-era', tone: 'warn',
      tip: `Lives in ${object.package} — built for the 2011 migration and still resident fifteen years later.` });
  }
  return flags;
}

export function renderFlags(flags) {
  if (!flags.length) return '';
  return `<span class="flags">${flags
    .map((f) => `<span class="flag flag--${f.tone}" data-tip="${esc(f.tip)}">${esc(f.label)}</span>`)
    .join('')}</span>`;
}
