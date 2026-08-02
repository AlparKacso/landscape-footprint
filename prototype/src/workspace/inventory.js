// The object inventory.
//
// The decisions are what gets funded, and they are the point. But the first
// question anyone with a stake asks is "where is my object" — the FI lead wants
// ZFI_MASS_REVERSAL, not "clean-core write blockers" — and a tool that cannot
// answer it reads as a slide rather than a system. So the same 106 objects are
// available a second way, in the order the decisions put them.
//
// The Call column shows the call of the object's *decision*, not the rule that
// caught the object. That is deliberate: a decision is the unit that gets taken
// and funded, so it is the unit that has a call. Where the two differ — three
// custom tables with no recorded access, sitting inside a decision to carry the
// tables forward — the drawer says so plainly rather than the table hiding it.

import { esc, plural, num, evidenceDot, EVIDENCE_RANK, flagsFor, renderFlags, callChip } from './ui.js';
import { DISPOSITION_LABEL } from '../engine/dispose.js';

export const COLUMNS = [
  { key: 'object', label: 'Object' },
  { key: 'type', label: 'Type' },
  { key: 'package', label: 'Package' },
  { key: 'evidence', label: 'Evidence', tip: 'What the extract can say about whether this runs. A missing usage row is a gap in measurement, not a measured zero — the two are never merged.' },
  { key: 'decision', label: 'Decision' },
  { key: 'call', label: 'Call' },
];

const CALL_RANK = { remediate: 0, investigate: 1, rebuild: 2, retire: 3, retain: 4 };
export const FIRST_DIR = { object: 'asc', type: 'asc', package: 'asc', evidence: 'asc', decision: 'asc', call: 'asc' };

export const SORT_KEYS = {
  object: (r) => r.name.toLowerCase(),
  type: (r) => r.type.toLowerCase(),
  package: (r) => r.package.toLowerCase(),
  evidence: (r) => `${EVIDENCE_RANK[r.evidence] ?? 9}${String(1e9 - (r.executions ?? 0)).padStart(10, '0')}`,
  decision: (r) => r.decisionTitle.toLowerCase(),
  call: (r) => CALL_RANK[r.call] ?? 9,
};

/**
 * One row per object in the extract, plus one per phantom. Built once per
 * recompute; the decision's call is resolved by the caller so overrides and the
 * transition path flow through without this module knowing about either.
 */
export function buildInventory(graph, packages, rules, callOf) {
  const packById = new Map(packages.map((p) => [p.id, p]));
  const rows = [];

  for (const object of graph.objects.values()) {
    const pack = object.packageId ? packById.get(object.packageId) : null;
    rows.push({
      name: object.name,
      object,
      type: object.type,
      package: object.package,
      developerId: object.developerId,
      isCustom: object.isCustom,
      isPhantom: false,
      evidence: object.evidence,
      executions: object.usage?.executions ?? 0,
      decisionId: pack?.id ?? null,
      decisionTitle: pack ? pack.title : 'SAP standard — not yours to decide',
      call: pack ? callOf(pack) : null,
      ruleCall: object.proposed,
      flags: flagsFor(object, rules),
      risk: object.risk?.score ?? 0,
    });
  }

  for (const phantom of graph.phantoms) {
    rows.push({
      name: phantom.name,
      object: null,
      phantom,
      type: 'Not in inventory',
      package: '—',
      developerId: '—',
      isCustom: false,
      isPhantom: true,
      evidence: null,
      executions: 0,
      decisionId: null,
      decisionTitle: 'Inventory exception',
      call: null,
      ruleCall: null,
      flags: [],
      risk: 0,
    });
  }

  // Natural order is the decision order, and inside a decision the same order
  // the modal uses. The two tabs are then the same list read two ways rather
  // than two lists that happen to share a data source.
  const packIndex = new Map(packages.map((p, i) => [p.id, i]));
  rows.sort((a, b) => {
    const ia = a.decisionId ? packIndex.get(a.decisionId) : a.isPhantom ? 1e5 : 1e4;
    const ib = b.decisionId ? packIndex.get(b.decisionId) : b.isPhantom ? 1e5 : 1e4;
    return ia - ib || b.risk - a.risk || a.name.localeCompare(b.name);
  });
  return rows;
}

export function filterInventory(rows, { query, filter, includeStandard }) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (!includeStandard && !r.isCustom) return false;
    // Filtering by call is a question about the custom estate. SAP standard
    // objects and phantoms have no call to filter on, so they drop out rather
    // than being silently counted under someone else's heading.
    if (filter !== 'all' && r.call !== filter) return false;
    if (!q) return true;
    return `${r.name} ${r.package} ${r.developerId} ${r.type} ${r.decisionTitle}`.toLowerCase().includes(q);
  });
}

export function renderInventory(rows, { sort }) {
  const head = COLUMNS.map((c) => {
    const active = sort.key === c.key;
    const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
    return `<th data-sort="${c.key}" tabindex="0"
      ${c.tip ? `data-tip="${esc(c.tip)}"` : ''}
      ${active ? `aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}
    >${esc(c.label)}<span class="arrow" aria-hidden="true">${arrow}</span></th>`;
  }).join('');

  if (!rows.length) {
    return `<div class="card"><p class="empty-row">No object matches that. Clear the search, or widen the filter.</p></div>`;
  }

  const body = rows.map((r) => `<tr data-object="${esc(r.name)}"${r.isCustom ? '' : ' class="is-context"'}>
    <td class="title obj">${esc(r.name)}${renderFlags(r.flags)}</td>
    <td>${esc(r.type)}</td>
    <td class="mono-cell">${esc(r.package)}</td>
    <td>${r.isPhantom ? '<span class="ev"><i class="e-phantom"></i>Referenced, never inventoried</span>' : evidenceDot(r.object)}</td>
    <td class="decision-cell">${esc(r.decisionTitle)}</td>
    <td>${r.call ? callChip(r.call) : `<span class="badge badge--muted">${r.isPhantom ? 'No call possible' : 'SAP standard'}</span>`}</td>
  </tr>`).join('');

  return `<div class="card" style="overflow-x:auto"><table class="dtable dtable--inventory">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Counts for the shared filter pills, in object terms rather than decision
// terms. Same pills, same order, different unit — which is the honest way to
// say "eleven decisions" and "one hundred and six objects" on one row.
export function inventoryCounts(rows, includeStandard) {
  const scope = rows.filter((r) => includeStandard || r.isCustom);
  const counts = { all: scope.length };
  for (const r of scope) if (r.call) counts[r.call] = (counts[r.call] ?? 0) + 1;
  return counts;
}

export function summarise(rows, total) {
  return rows.length === total
    ? `${plural(total, 'object')}`
    : `${num(rows.length)} of ${plural(total, 'object')}`;
}

export const CALL_LABEL = DISPOSITION_LABEL;
