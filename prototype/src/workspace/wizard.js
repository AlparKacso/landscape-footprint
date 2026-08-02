// The Extract Wizard.
//
// Its job is to make the pipeline visible. A tool that swallows four CSVs and
// emits confident recommendations asks to be trusted; one that shows what it
// did at each step earns it. The steps deliberately separate the two halves of
// the argument: everything that decides anything is deterministic and comes
// from a rulepack, and the only thing a model touches is prose.
//
// It is also where a customer maps their own extract onto the adapters, which
// is what makes "composable" a thing you can watch rather than a claim.

import { EVIDENCE, EVIDENCE_LABEL } from '../core/evidence.js';
import { DISPOSITION_LABEL } from '../engine/dispose.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const b = (v) => `<b>${v}</b>`;

export const ROLES = ['objects', 'usage', 'dependencies', 'transactions'];

export const ROLE_INFO = {
  objects: { label: 'Objects', need: 'object_name, object_type, namespace', what: 'The inventory. One row per program, function module or table.' },
  usage: { label: 'Usage', need: 'object_name, avg_executions_per_month', what: 'Execution evidence. Absence of a row here is a gap, not a zero.' },
  dependencies: { label: 'Dependencies', need: 'caller_object, target_object', what: 'The call graph, typed Call / Read / Write.' },
  transactions: { label: 'Transactions', need: 'transaction_code, program_name', what: 'How the business reaches the system.' },
};

export const STEPS = [
  { id: 'load', label: 'Load', title: 'Load the extract' },
  // Labels name what is on the screen. Not "Context Model" — the context model
  // is the whole interpretation every screen downstream reads, not a page you
  // pass through. Not "Scoring" either: the scores are the one thing this step
  // deliberately does not show. What it shows is a rule deciding, so it is
  // called Rules.
  { id: 'rules', label: 'Rules', title: 'How every call is made' },
  { id: 'narrative', label: 'Narrative', title: 'Where the Discovery Agent writes, and where it does not' },
];

export function renderStepper(current) {
  return `<ol class="stepper">${STEPS.map((s, i) => {
    const state = i < current ? 'done' : i === current ? 'now' : 'todo';
    return `<li class="step is-${state}">
      <span class="step-n">${state === 'done' ? '✓' : i + 1}</span>
      <span class="step-l">${esc(s.label)}</span>
    </li>`;
  }).join('')}</ol>`;
}

// --- step 1 ------------------------------------------------------------------
//
// Loading and mapping are one step, not two. The mapping is not a decision the
// reader makes — it is made deterministically on the way in, by matching column
// signatures rather than filenames, because a Basis team exports
// ZOBJ_DUMP_PRD1_0714.CSV and never objects.csv. A whole step asking someone to
// confirm a conclusion the tool already reached is ceremony. What is worth
// keeping is the override, so it sits on the row it belongs to: every file
// shows what it matched on and what it will be used as, and either can be
// changed in place.

export function renderUpload(w) {
  const assigned = new Set(w.mapping.filter(Boolean));
  const missing = ROLES.filter((r) => !assigned.has(r));
  const dupes = w.mapping.filter(Boolean).filter((r, i, a) => a.indexOf(r) !== i);

  const files = w.tables.map((t, i) => {
    const options = ROLES.map(
      (r) => `<option value="${r}"${w.mapping[i] === r ? ' selected' : ''}>${ROLE_INFO[r].label}</option>`
    ).join('');
    const matched = t.detected
      ? `matched on <code>${esc(ROLE_INFO[t.detected].need)}</code>`
      : '<span class="fr-nomatch">no column signature matched &mdash; choose below</span>';
    return `<div class="filerow">
      <span class="fr-name">${esc(t.name)}</span>
      <span class="fr-rows">${plural(t.rows.length, 'row')}</span>
      <span class="fr-match">${matched}</span>
      <select class="sel sel--inline" data-map="${i}" aria-label="Adapter for ${esc(t.name)}">
        <option value="">— not used —</option>${options}
      </select>
    </div>`;
  }).join('');

  return `
    <p class="wiz-lede">Drop the extract your Basis team produced. Four tables are needed, and each is
      matched to an adapter by its <b>column signature rather than its filename</b> &mdash; which is the
      seam a different source plugs into: point these same four adapters at SAP Readiness Check or the
      Custom Code Migration app and nothing downstream changes. Nothing is cleaned on the way in either;
      the imperfections in an extract are findings, not defects to be tidied away before anyone sees them.</p>

    <div class="dropzone${w.dragging ? ' is-drop' : ''}" id="dropzone" tabindex="0" role="button">
      <div class="dz-main">Drop CSV files here, or <span class="link">browse</span></div>
      <div class="dz-sub">Filenames do not matter. Files are identified by their columns.</div>
    </div>

    <div class="wiz-or"><span>or</span></div>
    <button class="btn" id="use-shipped">Use the extract shipped with this prototype</button>

    ${w.tables.length ? `<div class="filelist">${files}</div>
      <div class="roles">${ROLES.map((r) => `
        <div class="role${assigned.has(r) ? ' is-set' : ''}">
          <b>${esc(ROLE_INFO[r].label)}</b>
          <span>${esc(ROLE_INFO[r].what)}</span>
        </div>`).join('')}</div>` : ''}

    ${w.error ? `<div class="wiz-error">${esc(w.error)}</div>` : ''}
    ${w.tables.length && missing.length ? `<div class="wiz-error">Still needed: ${missing.map((r) => ROLE_INFO[r].label).join(', ')}.</div>` : ''}
    ${dupes.length ? '<div class="wiz-error">Two files are mapped to the same adapter.</div>' : ''}`;
}

// --- step 2 -----------------------------------------------------------------
//
// One picture instead of three stat cards and a table. The same 106 custom
// objects are counted at all four stages, so the strip reads as one population
// changing shape rather than four unrelated charts — and the derivation is on
// the face of it: the evidence decides which rule fires, the rule declares what
// it rests on, and that basis is what Confidence shows. Two real objects are
// then walked end to end, because a worked example convinces where a schematic
// does not.

// No bars. Four stacked bars of the same 106 objects side by side turned out to
// be four near-identical grey smears — the counts do the work, and the coloured
// dot beside each one is enough to tie a row back to its call or its state.
// The list scrolls rather than stretching the card, so all four stay level.
function stage(n, title, note, items, extra = '') {
  return `<div class="pipe-stage">
    <div class="pipe-head"><span class="pipe-n">${n}</span>${esc(title)}</div>
    <p class="pipe-note">${note}</p>
    <div class="pipe-key">${items.filter((i) => i.n)
      .map((i) => `<span><i class="${i.cls}"></i>${esc(i.label)} <b>${i.n}</b></span>`).join('')}</div>
    ${extra}
  </div>`;
}

export function renderModel(stats) {
  const total = stats.customObjects;
  const at = (map) => (k) => map[k] ?? 0;

  const evidence = [
    [EVIDENCE.ACTIVE, 'e-active', 'Running'],
    [EVIDENCE.DEAD, 'e-dead', 'Measured, never ran'],
    [EVIDENCE.UNMEASURED, 'e-unmeasured', 'Not measured'],
    [EVIDENCE.UNMEASURABLE, 'e-unmeasurable', 'Cannot be measured'],
  ].map(([k, cls, label]) => ({ cls, label, n: at(stats.customEvidence)(k) }));

  const basis = [
    ['structural', 'b-1', 'A structural fact'],
    ['measured', 'b-2', 'A measurement'],
    ['inferred', 'b-3', 'An inference'],
    ['unmeasured', 'b-4', 'An absence'],
  ].map(([k, cls, label]) => ({ cls, label, n: at(stats.customBasis)(k) }));

  const confidence = [
    ['high', 'b-2', 'High'],
    ['medium', 'b-3', 'Medium'],
    ['low', 'b-4', 'Low'],
  ].map(([k, cls, label]) => ({ cls, label, n: at(stats.customConfidence)(k) }));

  const calls = ['remediate', 'retire', 'rebuild', 'investigate', 'retain']
    .map((k) => ({ cls: `s-${k}`, label: DISPOSITION_LABEL[k], n: at(stats.customCalls)(k) }));

  const worked = stats.worked.map((o) => `<tr>
    <td class="obj">${esc(o.name)}</td>
    <td><span class="ev-pill ${o.evidence === 'measured-dead' ? 'e-dead' : 'e-unmeasured'}">${esc(EVIDENCE_LABEL[o.evidence])}</span></td>
    <td class="mono-sm">${esc(o.rule)}</td>
    <td class="mono-sm">${esc(o.basis)} &rarr; ${esc(o.confidence)}</td>
    <td><span class="badge badge--${esc(o.proposed)}">${esc(DISPOSITION_LABEL[o.proposed])}</span></td>
  </tr>`).join('');

  // The named rules are the load-bearing transparency in this step, so they stay
  // — folded into the stage they belong to rather than sitting underneath as a
  // section of their own. Closed by default; one click and the whole rulepack is
  // on screen, which is the question a sceptic asks and nobody else does.
  const rules = stats.rules.map((r) => `<div class="rulerow">
    <span class="rule-id">${esc(r.id)}</span>
    <span class="rule-basis">${esc(r.basis)}</span>
    <span class="rule-n">${r.count}</span>
    <span class="badge badge--${esc(r.disposition)}">${esc(DISPOSITION_LABEL[r.disposition])}</span>
  </div>`).join('');

  const rulesDisclosure = `<details class="rules-more">
    <summary>See all ${stats.rules.length} rules</summary>
    <div class="rulegrid">${rules}</div>
  </details>`;

  return `
    <p class="wiz-lede">One deterministic algorithm, and this is all of it &mdash; the same ${b(total)} custom
      objects, read left to right. <b>No model touches any of it.</b></p>

    <div class="pipe">
      ${stage(1, 'Evidence', 'Whether it runs. Only the first two are observations.', evidence)}
      <span class="pipe-arrow" aria-hidden="true">&rarr;</span>
      ${stage(2, 'Rule', 'First match wins. Each names what it rests on.', basis, rulesDisclosure)}
      <span class="pipe-arrow" aria-hidden="true">&rarr;</span>
      ${stage(3, 'Confidence', 'That basis, restated. Nothing else feeds it.', confidence)}
      <span class="pipe-arrow" aria-hidden="true">&rarr;</span>
      ${stage(4, 'The call', 'The only output. Each can name its rule.', calls)}
    </div>

    <div class="guarantee">
      <b>Retire is only reachable from the first two.</b> Anything resting on an inference or a missing
      record proposes Investigate and names what would settle it, so nothing is ever retired on evidence
      weaker than a measurement &mdash; the engine refuses to start if a rule breaks that. And no single
      signal decides anything: the obvious orphan test returns ${stats.orphanTrap} objects, of which
      ${stats.orphanTrapStandard} are SAP's own.
    </div>

    <h4 class="wiz-h">Two of your objects, end to end</h4>
    <div class="card" style="overflow-x:auto"><table class="findings worked">
      <thead><tr><th>Object</th><th>Evidence</th><th>Rule that fired</th><th>Basis &rarr; confidence</th><th>Call</th></tr></thead>
      <tbody>${worked}</tbody>
    </table></div>
    <p class="mini">Both look like retirements. Only the first was measured, so only the first is one.</p>`;
}

// --- step 3 -----------------------------------------------------------------
//
// The shortest step, and the one that has to land hardest: everything that
// decided anything was deterministic, and here is the complete list of what a
// model wrote. Naming all three places is the point — a boundary you state
// exhaustively is checkable, and one you gesture at is not.

export function renderNarrative(stats, sample) {
  return `
    <p class="wiz-lede">${stats.customObjects} custom objects is a list, and nobody funds a list. Sorting
      them into ${stats.packages} decisions is part of the same deterministic algorithm &mdash;
      priority-ordered and exclusive, so every object lands in exactly one and the counts add up to the
      estate. A model gets involved only after that, and only to put it into words.</p>

    <div class="split-two">
      <div class="mcard">
        <h4>Deterministic &mdash; everything that decides</h4>
        <p style="margin-bottom:0">Every score, every call, every grouping. The same extract gives the same
          answer every time, and <code>tools/check.mjs</code> re-derives it from the raw files to prove it.</p>
      </div>
      <div class="mcard is-ai">
        <h4>The Discovery Agent &mdash; words, in three places</h4>
        <ol class="ai-places">
          <li>The headline, decision and watch-out on each of the ${stats.packages} decisions.</li>
          <li>The sentence at the top of the Landscape Footprint.</li>
          <li>The Discovery Agent, which explains either page at the register you pick.</li>
        </ol>
      </div>
    </div>

    ${sample ? `<div class="card sample">
      <div class="sample-head">
        <span class="badge badge--count">${plural(sample.count, 'object')}</span>
        <b>${esc(sample.title)}</b>
        <span class="tag-det">grouped by rule</span>
      </div>
      <p class="sample-ai">${esc(sample.decision)}</p>
      <div class="sample-note">That sentence is the model's. The decision, its members, its call and its
        confidence are not &mdash; and wherever a model wrote something, the page says so and says what it
        was written from.</div>
    </div>` : ''}`;
}
