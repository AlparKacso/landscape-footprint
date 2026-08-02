// Two pages. The Extract Wizard turns a raw extract into a scored Context
// Model and shows its working; the Landscape Footprint is what you decide from.
// Neither holds opinions of its own — every number traces to a rule in the
// rulepack and a row in the extract, and every one of them can be opened.
//
// The Footprint reads position first, then the scope it rests on, then the
// decisions. That order is the argument: a transformation lead should be able
// to stop reading after the first card and still have the answer.

import { loadExtract, parseCsv, classifyTable } from '../core/parse.js';
import { buildGraph } from '../core/graph.js';
import { attachEvidence, EVIDENCE, EVIDENCE_LABEL, EVIDENCE_NOTE } from '../core/evidence.js';
import { scoreAll } from '../engine/score.js';
import { disposeAll, DISPOSITION, DISPOSITION_LABEL, DISPOSITION_NOTE, BASIS_RANK } from '../engine/dispose.js';
import { buildPackages } from '../engine/packages.js';
import { LENSES, ROLE_LABEL, roleFor, callForLens, sortForLens } from './lens.js';
import { renderSubgraph } from './subgraph.js';
import { renderTreemap } from './treemap.js';
import { renderAssistant, AUDIENCES, DEFAULT_AUDIENCE } from './assistant.js';
import { esc, plural, num, renderChips, confidenceMark, callChip } from './ui.js';
import { STEPS, ROLES, renderStepper, renderUpload, renderModel, renderNarrative } from './wizard.js';

const $ = (id) => document.getElementById(id);

// Wiring is deliberately defensive. index.html and app.js are two separate
// files behind a CDN that caches each for ten minutes independently, so a
// visitor can briefly hold a new page and an old script. A control that is not
// there should cost you that control, not the whole page — the alternative is
// a blank screen and an error blaming something else entirely.
const on = (id, event, handler, opts) => {
  const el = $(id);
  if (el) el.addEventListener(event, handler, opts);
  else console.warn(`[wire] #${id} is not in the document — handler skipped.`);
};

const state = {
  page: 'extract',
  hasRun: false,
  graph: null,
  rules: null,
  narrative: {},
  packages: [],
  rawUsage: [],
  shipped: null,
  source: { label: 'Shipped extract', files: [] },
  wizard: { open: false, step: 0, tables: [], mapping: [], error: null },
  lens: 'undecided',
  filter: 'all',
  overrides: {},
  sort: { key: null, dir: 'desc' },
  modal: null,
  ai: { open: false, audience: DEFAULT_AUDIENCE },
  returnFocus: null,
};

let treemapObserver = null;

const CALL_ORDER = [
  DISPOSITION.REMEDIATE,
  DISPOSITION.RETIRE,
  DISPOSITION.REBUILD,
  DISPOSITION.INVESTIGATE,
  DISPOSITION.RETAIN,
];
const CALL_RANK = Object.fromEntries(CALL_ORDER.map((c, i) => [c, i]));

const SORT_KEYS = {
  title: (p) => p.title.toLowerCase(),
  count: (p) => p.count,
  call: (p) => CALL_RANK[callFor(p)],
  basis: (p) => BASIS_RANK[p.basis],
  blast: (p) => p.blastRadius,
};
const FIRST_DIR = { title: 'asc', count: 'desc', call: 'asc', basis: 'asc', blast: 'desc' };

// Precedence: a person's decision, then what the transition path implies, then
// what the rules proposed. Each layer is kept, so the record always shows all
// three rather than only the answer.
const isOverridden = (pack) => Boolean(state.overrides[pack.id]);
const lensEntryFor = (pack) => (isOverridden(pack) ? null : callForLens(state.lens, pack.id));

function callFor(pack) {
  if (state.overrides[pack.id]) return state.overrides[pack.id];
  return callForLens(state.lens, pack.id)?.call ?? pack.proposed;
}

// What the call would be with no hand override — what "reset" goes back to.
const ruleCallFor = (pack) => callForLens(state.lens, pack.id)?.call ?? pack.proposed;

// ---------------------------------------------------------------- pipeline

function runPipeline(extract) {
  state.rawUsage = extract.usage;
  state.graph = buildGraph(extract);
  attachEvidence(state.graph, extract);
  scoreAll(state.graph, state.rules);
}

function recompute() {
  disposeAll(state.graph, state.rules);
  state.packages = buildPackages(state.graph, state.rules, state.narrative);
  render();
}

// Facts about what the pipeline just did, for the wizard to show.
function modelStats() {
  const g = state.graph;
  const all = [...g.objects.values()];
  const custom = all.filter((o) => o.isCustom);
  const evidence = {};
  for (const k of [EVIDENCE.ACTIVE, EVIDENCE.DEAD, EVIDENCE.UNMEASURED, EVIDENCE.UNMEASURABLE]) {
    evidence[k] = all.filter((o) => o.evidence === k).length;
  }
  const orphans = all.filter((o) => !o.usage && o.fanIn === 0 && o.fanOut === 0);
  const byRule = {};
  for (const o of custom) {
    byRule[o.rule] ??= { id: o.rule, basis: o.basis, count: 0, disposition: o.proposed };
    byRule[o.rule].count += 1;
  }

  // The wizard's pipeline strip walks the same 106 custom objects through four
  // stages, so every stage has to be counted over the same population. Mixing
  // the 366-object evidence split with the 106-object call split would make a
  // picture that quietly changes denominator halfway across.
  const tally = (list, key) => {
    const out = {};
    for (const o of list) out[o[key]] = (out[o[key]] ?? 0) + 1;
    return out;
  };
  const customEvidence = {};
  for (const k of [EVIDENCE.ACTIVE, EVIDENCE.DEAD, EVIDENCE.UNMEASURED, EVIDENCE.UNMEASURABLE]) {
    customEvidence[k] = custom.filter((o) => o.evidence === k).length;
  }

  // Two real objects, walked end to end. One reaches Retire on a measurement;
  // the other has every appearance of a retirement and reaches Investigate
  // because nothing about it was measured. Those two rows are the argument.
  const worked = [
    custom.find((o) => o.rule === 'measured-dead-unreferenced'),
    custom.find((o) => o.rule === 'unmeasured-unreferenced-custom'),
  ].filter(Boolean);

  return {
    customEvidence,
    customBasis: tally(custom, 'basis'),
    customConfidence: tally(custom, 'confidence'),
    customCalls: tally(custom, 'proposed'),
    worked,
    objects: all.length,
    customObjects: custom.length,
    edges: g.edges.length,
    transactions: g.transactions.length,
    phantoms: g.phantoms.length,
    evidence,
    reachable: custom.filter((o) => o.tcodeReachable).length,
    writesStandard: g.edges.filter((e) => e.type === 'Write' && g.objects.get(e.from)?.isCustom && g.objects.get(e.to)?.namespace === 'Standard').length,
    forks: all.filter((o) => o.forkPartner).length / 2,
    maxBlast: Math.max(...all.map((o) => o.blastRadius.length)),
    orphanTrap: orphans.length,
    orphanTrapStandard: orphans.filter((o) => !o.isCustom).length,
    packages: state.packages.length,
    rules: Object.values(byRule).sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------- wizard

// Loading and mapping are the same step now, so the gate that used to sit on
// the mapping screen sits here: four files is not enough, four files that fill
// all four adapters exactly once is.
function wizardCanAdvance() {
  const w = state.wizard;
  if (w.step === 0) {
    if (!w.tables.length) return false;
    const set = w.mapping.filter(Boolean);
    return ROLES.every((r) => set.includes(r)) && new Set(set).size === set.length;
  }
  return true;
}

function renderWizard() {
  const w = state.wizard;
  $('sec-wizard').hidden = !w.open;
  if (!w.open) return;

  $('stepper').innerHTML = renderStepper(w.step);
  $('wiz-title').textContent = STEPS[w.step].title;
  $('wiz-count').textContent = `Step ${w.step + 1} of ${STEPS.length}`;
  $('wiz-back').disabled = w.step === 0;
  $('wiz-next').disabled = !wizardCanAdvance();
  $('wiz-next').textContent = w.step === STEPS.length - 1 ? 'Finish' : 'Next';

  if (w.step === 0) $('wiz-body').innerHTML = renderUpload(w);
  if (w.step === 1) $('wiz-body').innerHTML = renderModel(modelStats());
  if (w.step === 2) {
    const sample = state.packages.find((p) => p.headline);
    $('wiz-body').innerHTML = renderNarrative(modelStats(), sample);
  }
}

// Step 2 builds the extract from whatever the mapping says, so a manual
// override is honoured exactly like a detected one.
function extractFromMapping() {
  const extract = {};
  state.wizard.mapping.forEach((role, i) => {
    if (role) extract[role] = state.wizard.tables[i].rows;
  });
  return extract;
}

async function acceptFiles(fileList) {
  const files = [...fileList].filter((f) => /\.csv$/i.test(f.name));
  const w = state.wizard;
  w.error = null;
  if (!files.length) {
    w.error = 'No CSV files in that drop.';
    return renderWizard();
  }
  const tables = [];
  for (const file of files) {
    const rows = parseCsv(await file.text());
    tables.push({ name: file.name, rows, detected: classifyTable(rows) });
  }
  w.tables = tables;
  w.mapping = tables.map((t) => t.detected ?? '');
  const unmatched = tables.filter((t) => !t.detected).length;
  if (unmatched) w.error = `${plural(unmatched, 'file')} did not match a known signature — set ${unmatched > 1 ? 'them' : 'it'} by hand in the list above.`;
  renderWizard();
}

// The card reports what has been *loaded*, which is not the same as what is in
// memory. A graph exists from boot and is rebuilt after a clear so the rest of
// the app always has something valid to read — but until the wizard has been run
// there is nothing the user put here, and saying "366 objects" before they have
// loaded anything, or after they have cleared it, is the card claiming credit
// for state they cannot see.
function updateLoadCard() {
  const s = state.source;
  $('clear-all').hidden = !state.hasRun;
  $('load-card').classList.toggle('is-empty', !state.hasRun);
  $('start-wizard').textContent = state.hasRun ? 'Load a different extract' : 'Load an extract';

  if (!state.hasRun) {
    $('load-what').textContent = 'No extract loaded';
    $('load-files').textContent = 'Four tables — an inventory, usage, dependencies and transaction codes';
    return;
  }
  $('load-what').textContent = `${s.label} — ${plural(s.files.length || 4, 'file')}, ${state.graph.objects.size} objects`;
  $('load-files').textContent = s.files.length ? s.files.join(' · ') : 'objects.csv · usage.csv · dependencies.csv · transactions.csv';
}

// Back to the empty state, for running the demo again from the top without a
// page reload. Deliberately not on a single rail click: returning to this page
// to re-read Evidence coverage is a normal thing to do and must not wipe
// anything. Double-click the rail icon, or use the button that appears here
// once a run has happened.
function clearAll() {
  state.hasRun = false;
  state.wizard = { open: false, step: 0, tables: [], mapping: [], error: null };
  state.overrides = {};
  state.filter = 'all';
  state.sort = { key: null, dir: 'desc' };
  state.modal = null;
  state.lens = 'undecided';
  state.ai = { open: false, audience: DEFAULT_AUDIENCE };
  state.source = { label: 'Shipped extract', files: [] };
  $('sec-wizard').hidden = true;
  $('sec-evidence').hidden = true;
  closeModal();
  closeAssistant();
  buildAudienceSeg();

  // Rebuild from the shipped extract so the app is in a valid state; hasRun
  // stays false, so the footprint shows its empty state until the wizard runs.
  runPipeline(state.shipped);
  goto('extract');
  recompute();
}

function useShipped() {
  const w = state.wizard;
  const names = { objects: 'objects.csv', usage: 'usage.csv', dependencies: 'dependencies.csv', transactions: 'transactions.csv' };
  w.tables = ROLES.map((r) => ({ name: names[r], rows: state.shipped[r], detected: r }));
  w.mapping = [...ROLES];
  w.error = null;
  renderWizard();
}

function wizardNext() {
  const w = state.wizard;
  if (!wizardCanAdvance()) return;

  // Leaving the load step is where the pipeline actually runs — the mapping is
  // already settled there, by column signature or by hand.
  if (w.step === 0) {
    runPipeline(extractFromMapping());
    state.overrides = {};
    const used = w.mapping.map((r, i) => (r ? w.tables[i].name : null)).filter(Boolean);
    state.source = { label: w.tables[0].name === 'objects.csv' ? 'Shipped extract' : 'Uploaded extract', files: used };
    recompute();
  }

  if (w.step === STEPS.length - 1) {
    state.hasRun = true;
    $('sec-evidence').hidden = false;
    renderCoverage();
    render();
    $('sec-evidence').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  w.step += 1;
  renderWizard();
}

// ---------------------------------------------------------------- helpers

function callTip(pack) {
  const call = callFor(pack);
  const base = `${DISPOSITION_LABEL[call]} — ${DISPOSITION_NOTE[call]}`;
  if (isOverridden(pack)) return `${base} Set by hand; the rules proposed ${DISPOSITION_LABEL[pack.proposed]}.`;
  const lens = lensEntryFor(pack);
  if (lens) return `${base} On a ${LENSES[state.lens].label.toLowerCase()} this reads differently from the neutral call, which is ${DISPOSITION_LABEL[pack.proposed]}.`;
  return base;
}

function callBadge(pack) {
  const call = callFor(pack);
  return `<span class="badge badge--${call}" tabindex="0" data-tip="${esc(callTip(pack))}">${esc(DISPOSITION_LABEL[call])}</span>` +
    (isOverridden(pack) ? `<span class="badge badge--edited" data-tip="Changed by hand. The rules proposed ${esc(DISPOSITION_LABEL[pack.proposed])}.">edited</span>` : '') +
    (lensEntryFor(pack) ? `<span class="badge badge--lens" data-tip="${esc(`This path changes the call. Without a path assumed the rules propose ${DISPOSITION_LABEL[pack.proposed]}. Open the decision for why.`)}">${esc(LENSES[state.lens].label.split(' ')[0].toLowerCase())}</span>` : '');
}

function orderedPackages({ filtered = true } = {}) {
  let list = sortForLens(state.packages, state.lens);
  if (filtered && state.filter !== 'all') list = list.filter((p) => callFor(p) === state.filter);
  const key = SORT_KEYS[state.sort.key];
  if (!key) return list;
  const sign = state.sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = key(a), vb = key(b);
    return va < vb ? -sign : va > vb ? sign : 0;
  });
}

function objectsByCall() {
  const by = Object.fromEntries(CALL_ORDER.map((c) => [c, 0]));
  for (const p of state.packages) by[callFor(p)] += p.count;
  return by;
}

// ---------------------------------------------------------------- coverage

function renderCoverage() {
  if (!state.graph) return;
  const order = [EVIDENCE.ACTIVE, EVIDENCE.DEAD, EVIDENCE.UNMEASURED, EVIDENCE.UNMEASURABLE];
  const cls = {
    [EVIDENCE.ACTIVE]: 'e-active',
    [EVIDENCE.DEAD]: 'e-dead',
    [EVIDENCE.UNMEASURED]: 'e-unmeasured',
    [EVIDENCE.UNMEASURABLE]: 'e-unmeasurable',
  };
  const all = [...state.graph.objects.values()];
  const bar = (set, total) => order.filter((k) => set[k] > 0)
    .map((k) => `<span class="${cls[k]}" style="width:${(set[k] / total) * 100}%" title="${esc(EVIDENCE_LABEL[k])}: ${set[k]}"></span>`).join('');
  // All four counts, always, in the same order as the bar and the legend —
  // including zeros. Position carries the meaning, so the numbers stay short
  // instead of repeating what the legend already says.
  const tally = (set) => order.map((k) => set[k]).join(' · ');
  const tallyOf = (list) => {
    const t = {};
    for (const k of order) t[k] = list.filter((o) => o.evidence === k).length;
    return t;
  };

  const totals = tallyOf(all);
  const custom = all.filter((o) => o.isCustom);
  const standard = all.filter((o) => !o.isCustom);

  // One estate-wide bar, with its two parts indented beneath it. The split that
  // carries the argument is custom against standard — 61% of SAP's own code is
  // unmeasured against 16% of the custom code — so nothing else competes with it.
  const layer = (name, note, set, total, child) => `<div class="coverage-row${child ? ' is-child' : ''}">
    <div class="name">${esc(name)}<small>${esc(note)}</small></div>
    <div class="bar">${bar(set, total)}</div>
    <div class="tally">${esc(tally(set))}</div>
  </div>`;

  $('coverage').innerHTML = `<div class="coverage">
    ${layer('Everything', `all ${all.length} objects in the export`, totals, all.length)}
    <div class="cov-group">
      ${layer('Custom code', `${custom.length} objects — what you decide about`, tallyOf(custom), custom.length, true)}
      ${layer('SAP standard', `${standard.length} objects — SAP's to decide about`, tallyOf(standard), standard.length, true)}
    </div>
    <div class="legend">${order.map((k) => `<div class="item"><span class="swatch ${cls[k]}"></span><span><b>${esc(EVIDENCE_LABEL[k])}</b>${esc(EVIDENCE_NOTE[k])}</span></div>`).join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------- position

function joinList(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The whole footprint in three sentences, rebuilt from the packages every
// time. Clauses drop out when they are zero rather than printing "0 remediated"
// — on a greenfield build there is nothing to remediate, and saying so with a
// zero would read as an oversight rather than a consequence.
function positionStatement() {
  const by = objectsByCall();
  const custom = [...state.graph.objects.values()].filter((o) => o.isCustom).length;
  const acting = by[DISPOSITION.RETIRE] + by[DISPOSITION.REMEDIATE] + by[DISPOSITION.REBUILD];

  const actions = joinList([
    by[DISPOSITION.RETIRE] && `<b>${by[DISPOSITION.RETIRE]}</b> retired`,
    by[DISPOSITION.REMEDIATE] && `<b>${by[DISPOSITION.REMEDIATE]}</b> remediated to clear the write paths into standard`,
    by[DISPOSITION.REBUILD] && `<b>${by[DISPOSITION.REBUILD]}</b> taken to a fit-to-standard workshop`,
  ].filter(Boolean));

  const held = by[DISPOSITION.INVESTIGATE]
    ? `<b>${by[DISPOSITION.INVESTIGATE]}</b> are held for a named piece of evidence rather than guessed at`
    : 'Nothing is held for want of evidence';
  const carry = by[DISPOSITION.RETAIN]
    ? `, and <b>${by[DISPOSITION.RETAIN]}</b> carry forward untouched.`
    : ' — and this path carries nothing forward at all.';

  const phantoms = state.graph.phantoms.length;

  // "of them" used to sit next to "11 decisions" and read as though 24 of the
  // eleven had an action. Naming the denominator is uglier and unambiguous.
  return `<b>${custom}</b> custom objects resolve into <b>${state.packages.length}</b> decisions.
    ${acting ? `<b>${acting}</b> of the ${custom} objects have an action against them today: ${actions}.` : `None of the ${custom} has an action against it on this path yet.`}
    ${held}${carry}
    ${phantoms ? `<span class="position-aside">${plural(phantoms, 'program')} behind live transaction codes ${phantoms === 1 ? 'is' : 'are'} missing from the inventory entirely — the first question for the Basis team.</span>` : ''}`;
}

function renderCallKey() {
  const by = objectsByCall();
  $('calls').innerHTML = CALL_ORDER.filter((c) => by[c] > 0).map((c) =>
    `<button class="k" data-call="${c}" data-tip="${esc(DISPOSITION_NOTE[c])}" aria-pressed="${state.filter === c}">
      <i class="s-${c}"></i>${esc(DISPOSITION_LABEL[c])} <b>${by[c]}</b>
    </button>`).join('');
}

// Under 720px a treemap of eleven tiles is unreadable, so it degrades to the
// stacked bar — same numbers, same colours, one dimension fewer.
function stackedBar() {
  const by = objectsByCall();
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  return `<div class="split" role="img" aria-label="The custom estate by call">${CALL_ORDER.filter((c) => by[c] > 0)
    .map((c) => `<span class="s-${c}" style="width:${(by[c] / total) * 100}%" title="${esc(DISPOSITION_LABEL[c])}: ${by[c]}"></span>`).join('')}</div>`;
}

function renderTreemapHost() {
  const host = $('treemap-host');
  if (!host || !state.hasRun) return;
  const width = Math.round(host.clientWidth);
  if (!width) return;
  if (width < 720) {
    host.classList.add('is-narrow');
    host.innerHTML = stackedBar();
    return;
  }
  host.classList.remove('is-narrow');
  const height = Math.round(Math.max(250, Math.min(340, width * 0.3)));
  host.innerHTML = renderTreemap(state.packages, callFor, (c) => DISPOSITION_LABEL[c], { width, height });
}

function renderPosition() {
  $('position-line').innerHTML = positionStatement();
  renderCallKey();
  renderTreemapHost();

  // What it would take to settle the held decisions, named. A recommendation
  // that cannot say what would change it is an opinion.
  const held = state.packages.filter((p) => callFor(p) === DISPOSITION.INVESTIGATE);
  const unlocks = [...new Set(held.flatMap((p) => p.objects.map((o) => o.nextEvidence)).filter(Boolean))];
  $('unlock').innerHTML = unlocks.length
    ? `<b>To settle what is held:</b> ${esc(unlocks.join('; '))}.`
    : '<b>Nothing is held.</b> Every decision here rests on evidence the extract already contains.';
}

function exportText() {
  const packs = orderedPackages({ filtered: false });
  const by = objectsByCall();
  const lines = ['LANDSCAPE FOOTPRINT — position'];
  lines.push(`Extract ${state.graph.observedAt} · ${state.source.label}`);
  lines.push(`Transition path: ${LENSES[state.lens].label}`);
  lines.push(`Usage evidence: a missing row means ${state.rules.unmeasuredMeans === 'dead' ? 'it never ran' : 'not measured'}`);
  lines.push(`${CALL_ORDER.filter((c) => by[c]).map((c) => `${DISPOSITION_LABEL[c]} ${by[c]}`).join(' · ')}`, '');
  for (const call of CALL_ORDER) {
    const group = packs.filter((p) => callFor(p) === call);
    if (!group.length) continue;
    lines.push(`${DISPOSITION_LABEL[call].toUpperCase()} — ${plural(group.reduce((s, p) => s + p.count, 0), 'object')}`);
    for (const p of group) {
      const marks = [
        isOverridden(p) ? `set by hand; rules proposed ${DISPOSITION_LABEL[p.proposed]}` : null,
        lensEntryFor(p) ? `${LENSES[state.lens].label.toLowerCase()}; neutral call would be ${DISPOSITION_LABEL[p.proposed]}` : null,
        `${p.confidence} confidence`,
      ].filter(Boolean);
      lines.push(`  · ${p.title} (${p.count})  [${marks.join('; ')}]`);
      if (p.decision) lines.push(`      ${p.decision}`);
    }
    lines.push('');
  }
  lines.push('INVENTORY INTEGRITY');
  for (const p of state.graph.phantoms) lines.push(`  · ${p.name} — referenced in ${p.sources.join(', ')}, absent from the inventory`);
  lines.push('', 'Every call comes from src/engine/rulepack.json and can be replayed.');
  lines.push('Nothing here is retired on evidence weaker than a measurement.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- scope

function renderTiles() {
  const g = state.graph;
  const all = [...g.objects.values()];
  const custom = all.filter((o) => o.isCustom);
  const measurable = custom.filter((o) => o.type !== 'Table');
  const measured = measurable.filter((o) => o.usage);
  const tcodeCustom = g.transactions.filter((t) => g.objects.get(t.program)?.isCustom);
  const writeEdges = g.edges.filter((e) => e.type === 'Write' && g.objects.get(e.from)?.isCustom && g.objects.get(e.to)?.namespace === 'Standard');
  const blockers = custom.filter((o) => o.writesStandard?.length);

  const tiles = [
    { id: 'custom', label: 'Custom objects', value: custom.length, sub: `of ${all.length} in the extract` },
    { id: 'tcodes', label: 'Entry points on custom code', value: tcodeCustom.length, sub: `of ${g.transactions.length} transaction codes` },
    { id: 'writes', label: 'Clean-core write paths', value: writeEdges.length, sub: `across ${plural(blockers.length, 'object')}`, alert: true },
    { id: 'decisions', label: 'Decisions to take', value: state.packages.length, sub: `covering all ${custom.length} custom objects` },
    { id: 'coverage', label: 'Custom code with usage evidence', value: `${Math.round((measured.length / measurable.length) * 100)}<small>%</small>`, sub: `${measured.length} of ${measurable.length} non-table` },
    { id: 'phantoms', label: 'Inventory exceptions', value: g.phantoms.length, sub: 'that this extract reveals — a floor', alert: g.phantoms.length > 0 },
  ];

  $('tiles').innerHTML = tiles.map((t) => `<button class="tile${t.alert ? ' tile--alert' : ''}" data-tile="${t.id}">
    <div class="label" title="${esc(t.label)}">${esc(t.label)}</div>
    <div class="value">${t.value}</div>
    <div class="sub">${esc(t.sub)}</div>
  </button>`).join('');
}

// ---------------------------------------------------------------- board

function renderFilters() {
  const counts = { all: state.packages.length };
  for (const p of state.packages) counts[callFor(p)] = (counts[callFor(p)] ?? 0) + 1;

  const options = [['all', 'All decisions'], ...CALL_ORDER.filter((c) => counts[c]).map((c) => [c, DISPOSITION_LABEL[c]])];
  $('filters').innerHTML = options.map(([key, label]) =>
    `<button class="pill" data-filter="${key}" aria-pressed="${state.filter === key}"
       ${key !== 'all' ? `data-tip="${esc(DISPOSITION_NOTE[key])}"` : ''}
     >${esc(label)} <span style="opacity:.6">${counts[key] ?? 0}</span></button>`).join('');
}

const COLUMNS = [
  { key: 'title', label: 'Decision' },
  { key: 'count', label: 'Objects', right: true },
  { key: 'call', label: 'Proposed call' },
  { key: 'basis', label: 'Confidence', tip: 'How much of the case rests on observation rather than inference. Derived from the evidence behind the objects, not from how strongly a rule fired.' },
  { key: 'blast', label: 'Blast radius', right: true, tip: 'How many other objects transitively depend on this decision — what else you would have to touch if you act on it.' },
];

function renderList(packages) {
  const head = COLUMNS.map((c) => {
    const active = state.sort.key === c.key;
    const arrow = active ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕';
    return `<th data-sort="${c.key}" class="${c.right ? 'right' : ''}" tabindex="0"
      ${c.tip ? `data-tip="${esc(c.tip)}"` : ''}
      ${active ? `aria-sort="${state.sort.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}
    >${esc(c.label)}<span class="arrow" aria-hidden="true">${arrow}</span></th>`;
  }).join('');

  const rows = packages.map((pack) => `<tr data-pack="${esc(pack.id)}" aria-selected="${state.modal?.id === pack.id}">
      <td class="title">${esc(pack.title)}</td>
      <td class="right n">${pack.count}</td>
      <td>${callBadge(pack)}</td>
      <td>${confidenceMark(pack.confidence)}</td>
      <td class="right n">${pack.blastRadius}</td>
    </tr>`).join('');

  $('board').innerHTML = `<div class="card" style="overflow-x:auto"><table class="dtable">
    <thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderBoard() {
  if (!state.hasRun) return;
  renderList(orderedPackages());
}

function renderIntegrity() {
  const usageByName = new Map(state.rawUsage.map((u) => [u.object_name, u]));
  const rows = state.graph.phantoms.map((p, i) => {
    const tx = state.graph.transactions.filter((t) => t.program === p.name);
    const usage = usageByName.get(p.name);
    const reads = state.graph.edges.filter((e) => e.from === p.name);
    const sources = p.sources.map((s) => ({ v: s, tone: 'warn' }));
    const sourceList = sources.flatMap((s, idx) => (idx === 0 ? [s] : [', ', s]));
    const detail = [];
    if (tx.length) detail.push('Transaction ', { v: tx.map((t) => t.code).join(', '), tone: 'risk' }, ` — "${tx[0].description}" — is live and points at it.`);
    if (usage) detail.push(' It runs ', { v: `${num(usage.avg_executions_per_month)}/mo`, tone: 'risk' },
      ' across ', { v: `${usage.distinct_users} users`, tone: 'risk' }, `, last on ${usage.last_executed_date}.`);
    if (reads.length) detail.push(` It reads ${reads.map((r) => r.to).join(' and ')}.`);
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="obj">${esc(p.name)}</td>
      <td class="why">Referenced in ${renderChips(sourceList)}, absent from the object inventory. ${renderChips(detail)}
        <div class="next">${esc(usage
          ? 'The busiest thing in this extract, and the inventory says it does not exist. Any scope built from objects.csv alone silently excludes it.'
          : 'Someone can still run this. Nobody can tell you what it does or who owns it.')}</div>
      </td>
    </tr>`;
  }).join('');
  $('integrity').innerHTML = `<table class="findings">
    <thead><tr><th></th><th>Object</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('sum-integrity').textContent = plural(state.graph.phantoms.length, 'exception');
}

// ---------------------------------------------------------------- render

// Built once. Deliberately not re-rendered on change: replacing the innerHTML
// would destroy the button under the user's cursor mid-click and drop focus,
// and the whole point of this control is that you click along it comparing
// paths. Only the selected state moves.
// Built once, same reasoning as the lens control below: this is a thing you
// click along comparing registers, so the buttons must survive a re-render.
function buildAudienceSeg() {
  $('ai-audience').innerHTML = AUDIENCES.map((a) =>
    `<button role="tab" data-audience="${esc(a.id)}" aria-selected="${state.ai.audience === a.id}">${esc(a.label)}</button>`).join('');
}

function buildLensSeg() {
  $('lens-seg').innerHTML = Object.values(LENSES).map((l) =>
    `<button role="tab" data-lens="${esc(l.id)}" aria-selected="${state.lens === l.id}"
       data-tip="${esc(l.blurb)}">${esc(l.label)}</button>`).join('');
}

function syncLensSeg() {
  for (const b of $('lens-seg').children) {
    b.setAttribute('aria-selected', String(b.dataset.lens === state.lens));
  }
  $('lens-note').textContent = LENSES[state.lens].note;
}

function render() {
  renderWizard();
  updateLoadCard();
  if (state.graph && state.hasRun) renderCoverage();

  $('empty-state').hidden = state.hasRun;
  $('footprint-body').hidden = !state.hasRun;
  // The assistant appears once there is something to talk about, and follows you
  // across both pages saying something different on each.
  $('ai-cta').hidden = !state.hasRun;
  if (!state.hasRun) return;

  syncLensSeg();
  renderPosition();
  renderTiles();
  renderFilters();
  renderBoard();
  renderIntegrity();
  if (state.modal) renderModal();
  if (state.ai.open) renderAssistantPanel();
}

function goto(page) {
  state.page = page;
  $('page-extract').hidden = page !== 'extract';
  $('page-footprint').hidden = page !== 'footprint';
  $('crumb-here').textContent = page === 'extract' ? 'Extract Wizard' : 'Landscape Footprint';
  for (const b of document.querySelectorAll('[data-page]')) {
    b.setAttribute('aria-current', String(b.dataset.page === page));
  }
  scrollTo(0, 0);
  // The treemap measures its container, which has no box at all while the page
  // is hidden. Called synchronously rather than on a frame: reading clientWidth
  // straight after the hidden flag flips forces layout and returns the real
  // width, and a ResizeObserver does not fire for a display:none -> visible
  // transition in WebKit — the element had no box to observe.
  if (page === 'footprint') renderTreemapHost();
}

// ---------------------------------------------------------------- modal

function tileDetail(id) {
  const g = state.graph;
  const all = [...g.objects.values()];
  const custom = all.filter((o) => o.isCustom);
  const table = (head, rows) => `<div class="card" style="overflow-x:auto"><table class="findings">
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;

  if (id === 'custom') {
    const byType = {};
    for (const o of custom) byType[o.type] = (byType[o.type] ?? 0) + 1;
    return { title: 'Custom objects',
      body: `<p>${custom.length} of ${all.length} objects carry a Custom namespace. Standard objects appear throughout for dependency context, but they are SAP's to decide about.</p>` +
        table(['Type', 'Custom', 'Standard'], Object.keys(byType).map((t) =>
          `<tr><td>${esc(t)}</td><td class="obj">${byType[t]}</td><td class="obj">${all.filter((o) => o.type === t && !o.isCustom).length}</td></tr>`).join('')) };
  }
  if (id === 'tcodes') {
    return { title: 'Transaction codes',
      body: `<p>Each transaction code is a way the business reaches the system. ${g.transactions.filter((t) => g.objects.get(t.program)?.isCustom).length} of ${g.transactions.length} land on custom code, which is what makes the custom estate a business conversation rather than an IT one.</p>` +
        table(['Code', 'Program', 'Description', 'Namespace'], g.transactions.map((t) => {
          const o = g.objects.get(t.program);
          return `<tr><td class="obj">${esc(t.code)}</td><td class="obj">${esc(t.program)}</td><td class="why">${esc(t.description)}</td>
            <td>${o ? (o.isCustom ? '<span class="badge badge--rebuild">Custom</span>' : '<span class="badge badge--retain">Standard</span>') : '<span class="badge badge--remediate">Not in inventory</span>'}</td></tr>`;
        }).join('')) };
  }
  if (id === 'writes') {
    return { title: 'Clean-core write paths',
      body: `<p>Custom code writing directly into standard objects. This holds whether or not anyone runs the code, which is why it is the only decision in the set that needs no usage evidence at all. The counts differ deliberately: seven write paths across six objects, because one object writes to two tables.</p>` +
        table(['Custom object', 'Writes into', 'Package · author'], g.edges
          .filter((e) => e.type === 'Write' && g.objects.get(e.from)?.isCustom && g.objects.get(e.to)?.namespace === 'Standard')
          .map((e) => `<tr><td class="obj">${esc(e.from)}</td><td class="obj">${esc(e.to)}</td><td class="why">${esc(g.objects.get(e.from).package)} · ${esc(g.objects.get(e.from).developerId)}</td></tr>`).join('')) };
  }
  if (id === 'decisions') {
    return { title: 'Decisions to take',
      body: `<p>Every custom object lands in exactly one decision, so the counts add up to the estate and nothing is funded twice. Assignment is priority-ordered and deterministic — the same extract gives the same eleven decisions every time.</p>` +
        table(['Decision', 'Objects', 'Call', 'Confidence'], state.packages.map((p) =>
          `<tr><td>${esc(p.title)}</td><td class="obj">${p.count}</td><td>${callBadge(p)}</td>
           <td class="why">${confidenceMark(p.confidence)} — rests on ${esc(p.basis)} evidence</td></tr>`).join('')) };
  }
  if (id === 'coverage') {
    const measurable = custom.filter((o) => o.type !== 'Table');
    const measured = measurable.filter((o) => o.usage);
    const tables = custom.filter((o) => o.type === 'Table').length;
    return { title: 'Usage evidence coverage',
      body: `<p>${all.filter((o) => !o.usage).length} objects across the whole extract have no usage row, which reads as a fatal gap until you split it by what you are actually deciding about.</p>
        <p>Tables cannot have execution semantics, so the ${tables} custom tables are excluded by construction rather than by omission. Of the remaining ${measurable.length} custom objects, <b>${measured.length} are measured</b> — ${Math.round((measured.length / measurable.length) * 100)}%. The blind spot is overwhelmingly SAP standard function modules, which nobody was deciding about.</p>` };
  }
  if (id === 'phantoms') {
    return { title: 'Inventory exceptions',
      body: `<p>Programs the other three files reference and the inventory does not contain. Read as data quality they are join failures; read as findings they are live transaction codes pointing at code with no inventory record and no owner.</p>
        <p><b>Treat this number as a floor, not a count.</b> The Basis team has said the extract may be incomplete, so these are the exceptions this export happens to reveal rather than the exceptions that exist. It is also the clearest argument for why nothing here is retired on evidence weaker than a measurement.</p>` +
        table(['Object', 'Seen in', 'Transaction'], state.graph.phantoms.map((p) => {
          const tx = state.graph.transactions.filter((t) => t.program === p.name);
          return `<tr><td class="obj">${esc(p.name)}</td><td class="why">${esc(p.sources.join(', '))}</td>
            <td class="why">${tx.map((t) => `${esc(t.code)} — ${esc(t.description)}`).join('<br>') || '—'}</td></tr>`;
        }).join('')) };
  }
  return { title: 'Detail', body: '' };
}

function renderModal() {
  const m = state.modal;
  if (!m) return;

  if (m.kind === 'tile') {
    const d = tileDetail(m.id);
    $('modal-title').textContent = d.title;
    $('modal-badges').innerHTML = '';
    $('modal-pos').textContent = '';
    $('prev').disabled = $('next').disabled = true;
    $('modal-body').innerHTML = d.body;
    $('modal').hidden = $('scrim').hidden = false;
    return;
  }

  const list = orderedPackages();
  const index = list.findIndex((p) => p.id === m.id);
  const pack = list[index] ?? state.packages.find((p) => p.id === m.id);
  if (!pack) return closeModal();

  const { role, note } = roleFor(state.lens, pack.id);
  const lens = lensEntryFor(pack);
  const graph = renderSubgraph(pack, state.graph);

  $('modal-title').textContent = pack.title;
  $('modal-badges').innerHTML = `${callBadge(pack)}<span class="badge badge--count">${plural(pack.count, 'object')}</span>${confidenceMark(pack.confidence)}`;
  $('modal-pos').textContent = index >= 0 ? `${index + 1} of ${list.length}` : '';
  $('prev').disabled = index <= 0;
  $('next').disabled = index < 0 || index >= list.length - 1;

  // Objects are plain here on purpose. This is the level at which the decision
  // is taken, and making each row openable invites re-litigating the grouping
  // one object at a time — which is exactly what grouping them was for. The
  // per-object view lives on the Objects tab.
  const rows = [...pack.objects].sort((a, b) => b.risk.score - a.risk.score).map((o, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="obj">${esc(o.name)}<div class="next" style="font-style:normal">${esc(o.type)} · ${esc(o.package)} · ${esc(o.developerId)}</div></td>
      <td class="why">${renderChips(o.rationale)}${o.nextEvidence ? `<div class="next">Would change this: ${esc(o.nextEvidence)}</div>` : ''}</td>
      <td style="width:132px">${callChip(o.proposed)}</td>
    </tr>`).join('');

  // The three sentences below are the only model-written text on this screen, so
  // they are fenced and labelled rather than blended into the rest. The package,
  // its members, its call and its confidence are not the model's.
  $('modal-body').innerHTML = `
    ${pack.headline || pack.decision || pack.watchOut ? `<div class="ai-block">
      <div class="ai-block-head">
        <span class="ai-mark"><i aria-hidden="true"></i>AI generated</span>
        <span class="ai-block-src">written from this decision's own rule output</span>
      </div>
      ${pack.headline ? `<p class="modal-lede">${esc(pack.headline)}</p>` : ''}
      ${pack.decision ? `<div class="callout callout--ok"><span class="i">→</span><span><b>Decision:</b> ${esc(pack.decision)}</span></div>` : ''}
      ${pack.watchOut ? `<div class="callout" style="margin-top:8px"><span class="i">!</span><span><b>Watch out:</b> ${esc(pack.watchOut)}</span></div>` : ''}
    </div>` : ''}
    ${role ? `<div class="callout" style="margin-top:8px"><span class="i">i</span><span><b>${esc(LENSES[state.lens].label)} — ${esc(ROLE_LABEL[role])}.</b> ${esc(note)}</span></div>` : ''}

    <div class="card override">
      <h4>The call</h4>
      ${lens ? `<div class="callout callout--lens">
        <span class="i" aria-hidden="true">↻</span>
        <span><b>This path changes the call.</b> With no path assumed the rules propose
        <b>${esc(DISPOSITION_LABEL[pack.proposed])}</b>. On a ${esc(LENSES[state.lens].label.toLowerCase())} they propose
        <b>${esc(DISPOSITION_LABEL[lens.call])}</b>. ${esc(lens.why)}</span>
      </div>` : ''}
      <p>${lens
        ? `Same objects, same evidence, different consequence. You can decide otherwise — every layer is kept, so the record shows what the evidence said, what the path implies, and what a person concluded.`
        : `The rules propose <b>${esc(DISPOSITION_LABEL[pack.proposed])}</b> from ${esc(pack.basis)} evidence. You can decide otherwise — the proposal is kept either way, so the record shows both what the evidence said and what a person concluded.`}</p>
      <div class="override-row">${CALL_ORDER.map((c) =>
        `<button class="btn" data-override="${c}" aria-pressed="${callFor(pack) === c}" data-tip="${esc(DISPOSITION_NOTE[c])}">${esc(DISPOSITION_LABEL[c])}</button>`).join('')}</div>
      ${isOverridden(pack) ? `<div class="override-note">
        <b>Set by hand.</b> ${callForLens(state.lens, pack.id)
          ? `On this path the rules proposed ${esc(DISPOSITION_LABEL[ruleCallFor(pack)])}; with no path assumed, ${esc(DISPOSITION_LABEL[pack.proposed])}.`
          : `The rules proposed ${esc(DISPOSITION_LABEL[pack.proposed])}.`}
        <button class="btn" id="revert">Reset to rule proposal</button></div>` : ''}
    </div>

    <div class="section">
      <h2>Blast radius</h2>
      <p class="section-note">${graph.isEmpty
        ? 'Nothing outside this decision depends on it, and it depends on nothing outside. That isolation is why it can be acted on independently.'
        : 'What moves if you act on this decision.'}</p>
      ${graph.svg}
      <p class="mini">${esc(graph.caption)}</p>
    </div>

    <div class="section">
      <h2>The objects behind it</h2>
      <p class="section-note">${esc(DISPOSITION_NOTE[pack.proposed] ?? '')}</p>
      <div class="card" style="overflow-x:auto"><table class="findings">
        <thead><tr><th></th><th>Object</th><th>Why</th><th>Rule's call</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;

  $('modal').hidden = $('scrim').hidden = false;
}

function openModal(kind, id) {
  state.modal = { kind, id };
  renderModal();
  renderBoard();
}
function closeModal() {
  state.modal = null;
  $('modal').hidden = $('scrim').hidden = true;
  if (state.hasRun) renderBoard();
}
function step(delta) {
  if (state.modal?.kind !== 'pack') return;
  const list = orderedPackages();
  const next = list[list.findIndex((p) => p.id === state.modal.id) + delta];
  if (next) openModal('pack', next.id);
}

// ---------------------------------------------------------------- assistant

// Composed from live state every time it opens, so it cannot describe a
// position the page is no longer showing. See src/workspace/assistant.js.
function renderAssistantPanel() {
  if (!state.ai.open) return;
  const view = renderAssistant(state.page, state.ai.audience, {
    graph: state.graph,
    packages: state.packages,
    rules: state.rules,
    lens: state.lens,
    callOf: callFor,
    lensEntryOf: lensEntryFor,
  });
  $('ai-title').textContent = view.title;
  $('ai-body').innerHTML = view.body;
  $('ai-body').scrollTop = 0;
  const current = AUDIENCES.find((a) => a.id === state.ai.audience);
  $('ai-aud-note').textContent = current ? current.note : '';
  for (const btn of $('ai-audience').children) {
    btn.setAttribute('aria-selected', String(btn.dataset.audience === state.ai.audience));
  }
}

function openAssistant() {
  state.returnFocus = document.activeElement;
  state.ai.open = true;
  renderAssistantPanel();
  $('ai-modal').hidden = $('ai-scrim').hidden = false;
  $('ai-close').focus();
}

function closeAssistant() {
  state.ai.open = false;
  $('ai-modal').hidden = $('ai-scrim').hidden = true;
  state.returnFocus?.focus?.();
  state.returnFocus = null;
}

// ---------------------------------------------------------------- controls

function applySort(key) {
  if (!SORT_KEYS[key]) return;
  const first = FIRST_DIR[key];
  if (state.sort.key === key) {
    state.sort = state.sort.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : { key: null, dir: 'desc' };
  } else state.sort = { key, dir: first };
  renderBoard();
}

function wireTooltip() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  const show = (el) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8)}px`;
    const above = r.top - t.height - 8;
    tip.style.top = `${above > 8 ? above : r.bottom + 8}px`;
  };
  const hide = () => { tip.hidden = true; };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); el ? show(el) : hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); el ? show(el) : hide(); });
  document.addEventListener('focusout', hide);
  addEventListener('scroll', hide, true);
}

function wire() {
  for (const b of document.querySelectorAll('[data-page]')) {
    b.addEventListener('click', () => goto(b.dataset.page));
  }
  document.querySelector('[data-page="extract"]').addEventListener('dblclick', clearAll);
  on('clear-all', 'click', clearAll);
  on('go-wizard', 'click', () => {
    goto('extract');
    state.wizard.open = true;
    renderWizard();
  });

  on('start-wizard', 'click', () => {
    state.wizard.open = true;
    renderWizard();
    $('sec-wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  on('wiz-back', 'click', () => {
    if (state.wizard.step > 0) { state.wizard.step -= 1; renderWizard(); }
  });
  on('wiz-next', 'click', wizardNext);

  on('wiz-body', 'click', (e) => {
    if (e.target.closest('#use-shipped')) return useShipped();
    if (e.target.closest('#dropzone')) $('file-input').click();
  });
  on('wiz-body', 'change', (e) => {
    const sel = e.target.closest('[data-map]');
    if (!sel) return;
    state.wizard.mapping[Number(sel.dataset.map)] = sel.value;
    renderWizard();
  });
  on('file-input', 'change', (e) => acceptFiles(e.target.files));

  const dz = () => $('dropzone');
  document.addEventListener('dragover', (e) => {
    if (!dz()) return;
    e.preventDefault();
    state.wizard.dragging = true;
    dz().classList.add('is-drop');
  });
  document.addEventListener('dragleave', () => dz()?.classList.remove('is-drop'));
  document.addEventListener('drop', (e) => {
    if (!dz()) return;
    e.preventDefault();
    dz().classList.remove('is-drop');
    acceptFiles(e.dataTransfer.files);
  });

  // The transition path. The one control on the page, and the only thing that
  // can change a call without a person typing.
  on('lens-seg', 'click', (e) => {
    const btn = e.target.closest('[data-lens]');
    if (!btn || btn.dataset.lens === state.lens) return;
    state.lens = btn.dataset.lens;
    render();
  });

  const integrity = $('sec-integrity');
  integrity.querySelector('.sec-head').addEventListener('click', () => {
    const collapsed = integrity.classList.toggle('is-collapsed');
    integrity.querySelector('.sec-head').setAttribute('aria-expanded', String(!collapsed));
  });

  on('filters', 'click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderFilters();
    renderBoard();
  });
  on('board', 'click', (e) => {
    const header = e.target.closest('[data-sort]');
    if (header) return applySort(header.dataset.sort);
    const row = e.target.closest('[data-pack]');
    if (row) openModal('pack', row.dataset.pack);
  });
  on('board', 'keydown', (e) => {
    const header = e.target.closest('[data-sort]');
    if (header && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); applySort(header.dataset.sort); }
  });
  on('tiles', 'click', (e) => {
    const tile = e.target.closest('[data-tile]');
    if (tile) openModal('tile', tile.dataset.tile);
  });
  // The treemap tiles are the decisions. Clicking one lands on the same modal
  // the list row does.
  on('position', 'click', (e) => {
    if (e.target.closest('#export')) return doExport();
    const call = e.target.closest('[data-call]');
    if (call) {
      state.filter = state.filter === call.dataset.call ? 'all' : call.dataset.call;
      renderCallKey();
      renderFilters();
      renderBoard();
      $('board').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const tile = e.target.closest('[data-pack]');
    if (tile) openModal('pack', tile.dataset.pack);
  });
  on('position', 'keydown', (e) => {
    const tile = e.target.closest('[data-pack]');
    if (tile && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openModal('pack', tile.dataset.pack); }
  });

  // Window resize is the reliable signal for a re-layout; the observer catches
  // the cases the window does not, such as the rail collapsing. The observer is
  // held in a variable on purpose — an unreferenced one can be collected.
  // Called straight through rather than deferred to a frame: laying out eleven
  // tiles is a few hundred microseconds, and requestAnimationFrame does not
  // fire while the tab is backgrounded — which would leave the treemap at the
  // old width the moment the window came back.
  addEventListener('resize', renderTreemapHost);
  treemapObserver = new ResizeObserver(renderTreemapHost);
  treemapObserver.observe($('treemap-host'));

  on('modal-body', 'click', (e) => {
    const set = e.target.closest('[data-override]');
    if (set) {
      const pack = state.packages.find((p) => p.id === state.modal?.id);
      if (!pack) return;
      const call = set.dataset.override;
      if (call === ruleCallFor(pack)) delete state.overrides[pack.id];
      else state.overrides[pack.id] = call;
      return render();
    }
    if (e.target.closest('#revert')) { delete state.overrides[state.modal.id]; render(); }
  });
  on('prev', 'click', () => step(-1));
  on('next', 'click', () => step(1));
  on('modal-close', 'click', closeModal);
  on('scrim', 'click', closeModal);

  on('ai-cta', 'click', openAssistant);
  on('ai-close', 'click', closeAssistant);
  on('ai-scrim', 'click', closeAssistant);
  on('ai-audience', 'click', (e) => {
    const btn = e.target.closest('[data-audience]');
    if (!btn || btn.dataset.audience === state.ai.audience) return;
    state.ai.audience = btn.dataset.audience;
    renderAssistantPanel();
  });

  document.addEventListener('keydown', (e) => {
    if (state.ai.open && e.key === 'Escape') return closeAssistant();
    if (!$('modal').hidden) {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    }
  });

  wireTooltip();
}

function doExport() {
  const text = exportText();
  navigator.clipboard?.writeText(text).catch(() => {});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'landscape-footprint-position.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- boot

async function boot() {
  const [extract, rules, narrative] = await Promise.all([
    loadExtract('data'),
    fetch('src/engine/rulepack.json').then((r) => r.json()),
    fetch('data/packages.json').then((r) => r.json()),
  ]);

  $('needs-server')?.remove();
  state.rules = rules;
  state.narrative = narrative;
  state.shipped = extract;

  // The graph is built at boot so the footprint has something to show the
  // moment the wizard finishes, but hasRun stays false: the wizard is the way
  // in, and an empty second page is the honest state until it has been run.
  runPipeline(extract);
  buildLensSeg();
  buildAudienceSeg();
  wire();
  goto('extract');
  recompute();
}

boot().catch((err) => {
  // Two very different failures used to print the same sentence. A fetch that
  // never landed really is the file:// problem; anything else is not, and
  // telling someone to start a server when the server is fine sends them a long
  // way in the wrong direction.
  const isFetch = err instanceof TypeError && /fetch|load|network/i.test(err.message)
    || /Could not load .*\.csv/.test(err.message);
  document.querySelector('#page-extract').innerHTML = isFetch
    ? `<div class="callout"><span class="i">!</span><span><b>Could not read the extract.</b> ${esc(err.message)}<br>
       This page reads the CSVs over <code>fetch</code>, which browsers block on a <code>file://</code> origin.
       Serve it instead: <code>python3 tools/serve.py 8010 .</code></span></div>`
    : `<div class="callout"><span class="i">!</span><span><b>The page failed to start.</b> ${esc(err.message)}<br>
       If this is a deployed copy, the most likely cause is a stale cached script sitting next to a newer page —
       reload with <b>\u2318\u21E7R</b> (or <b>Ctrl\u21E7R</b>) to force a fresh fetch.</span></div>`;
  console.error(err);
});
