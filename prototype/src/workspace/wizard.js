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

export const ROLES = ['objects', 'usage', 'dependencies', 'transactions'];

export const ROLE_INFO = {
  objects: { label: 'Objects', need: 'object_name, object_type, namespace', what: 'The inventory. One row per program, function module or table.' },
  usage: { label: 'Usage', need: 'object_name, avg_executions_per_month', what: 'Execution evidence. Absence of a row here is a gap, not a zero.' },
  dependencies: { label: 'Dependencies', need: 'caller_object, target_object', what: 'The call graph, typed Call / Read / Write.' },
  transactions: { label: 'Transactions', need: 'transaction_code, program_name', what: 'How the business reaches the system.' },
};

export const STEPS = [
  { id: 'upload', label: 'Upload', title: 'Load the extract' },
  { id: 'map', label: 'Map', title: 'Map each file to an adapter' },
  { id: 'model', label: 'Context Model', title: 'Deterministic processing and scoring' },
  { id: 'narrative', label: 'Narrative', title: 'Where the model writes, and where it does not' },
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

// --- step 1 -----------------------------------------------------------------

export function renderUpload(w) {
  const loaded = w.tables.length;
  return `
    <p class="wiz-lede">Drop the extract your Basis team produced. Four tables are needed &mdash; an inventory, usage, dependencies and transaction codes. Nothing is cleaned or corrected on the way in: the imperfections in an extract are findings, not defects to be tidied away before anyone sees them.</p>

    <div class="dropzone${w.dragging ? ' is-drop' : ''}" id="dropzone" tabindex="0" role="button">
      <div class="dz-main">Drop CSV files here, or <span class="link">browse</span></div>
      <div class="dz-sub">Filenames do not matter. Files are identified by their columns.</div>
    </div>

    <div class="wiz-or"><span>or</span></div>
    <button class="btn" id="use-shipped">Use the extract shipped with this prototype</button>

    ${loaded ? `<div class="filelist">${w.tables.map((t) => `
      <div class="filerow">
        <span class="fr-name">${esc(t.name)}</span>
        <span class="fr-rows">${plural(t.rows.length, 'row')}</span>
        <span class="fr-cols">${esc(Object.keys(t.rows[0] ?? {}).slice(0, 4).join(', '))}${Object.keys(t.rows[0] ?? {}).length > 4 ? '…' : ''}</span>
      </div>`).join('')}</div>` : ''}

    ${w.error ? `<div class="wiz-error">${esc(w.error)}</div>` : ''}`;
}

// --- step 2 -----------------------------------------------------------------

export function renderMap(w) {
  const rows = w.tables.map((t, i) => {
    const options = ROLES.map(
      (r) => `<option value="${r}"${w.mapping[i] === r ? ' selected' : ''}>${ROLE_INFO[r].label}</option>`
    ).join('');
    const auto = t.detected ? `matched on <code>${esc(ROLE_INFO[t.detected].need)}</code>` : 'no signature matched — choose manually';
    return `<tr>
      <td class="obj">${esc(t.name)}</td>
      <td class="why">${plural(t.rows.length, 'row')} · ${auto}</td>
      <td><select class="sel" data-map="${i}"><option value="">— not used —</option>${options}</select></td>
    </tr>`;
  }).join('');

  const assigned = new Set(w.mapping.filter(Boolean));
  const missing = ROLES.filter((r) => !assigned.has(r));
  const dupes = w.mapping.filter(Boolean).filter((r, i, a) => a.indexOf(r) !== i);

  return `
    <p class="wiz-lede">Each file is matched to an adapter by its <b>column signature</b>, not its filename &mdash; a Basis team exports <code>ZOBJ_DUMP_PRD1_0714.CSV</code>, never <code>objects.csv</code>. This is the seam a different source plugs into: point the same four adapters at SAP Readiness Check or Custom Code Migration output and everything downstream is unchanged. Override any row if the guess is wrong.</p>

    <div class="card" style="overflow-x:auto"><table class="findings">
      <thead><tr><th>File</th><th>Detected</th><th style="width:200px">Maps to</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>

    <div class="roles">${ROLES.map((r) => `
      <div class="role${assigned.has(r) ? ' is-set' : ''}">
        <b>${esc(ROLE_INFO[r].label)}</b>
        <span>${esc(ROLE_INFO[r].what)}</span>
      </div>`).join('')}</div>

    ${missing.length ? `<div class="wiz-error">Still needed: ${missing.map((r) => ROLE_INFO[r].label).join(', ')}.</div>` : ''}
    ${dupes.length ? `<div class="wiz-error">Two files are mapped to the same adapter.</div>` : ''}`;
}

// --- step 3 -----------------------------------------------------------------

export function renderModel(stats) {
  const ev = stats.evidence;
  const evRows = [EVIDENCE.ACTIVE, EVIDENCE.DEAD, EVIDENCE.UNMEASURED, EVIDENCE.UNMEASURABLE]
    .map((k) => `<tr><td>${esc(EVIDENCE_LABEL[k])}</td><td class="obj">${ev[k]}</td></tr>`).join('');

  const ruleRows = stats.rules
    .map((r) => `<tr><td class="obj">${esc(r.id)}</td><td class="why">${esc(r.basis)}</td><td class="obj">${r.count}</td>
      <td>${r.disposition ? `<span class="badge badge--${r.disposition}">${esc(DISPOSITION_LABEL[r.disposition])}</span>` : ''}</td></tr>`)
    .join('');

  return `
    <p class="wiz-lede">From here it is one deterministic algorithm. The scoring, the call on each object and the grouping into decisions all come from rules in <code>src/engine/rulepack.json</code>. The same extract always produces the same answer, and every answer can name the rule that produced it. <b>No model is involved in any of it.</b></p>

    <div class="model-grid">
      <div class="mcard">
        <h4>1 · Context Slice</h4>
        <p>The four tables become one graph. Nothing downstream ever sees a CSV row again.</p>
        <dl>
          <div><dt>Entities</dt><dd>${stats.objects}</dd></div>
          <div><dt>Typed edges</dt><dd>${stats.edges}</dd></div>
          <div><dt>Entry points</dt><dd>${stats.transactions}</dd></div>
          <div><dt>Not in inventory</dt><dd class="bad">${stats.phantoms}</dd></div>
        </dl>
      </div>

      <div class="mcard">
        <h4>2 · Evidence state</h4>
        <p>Four states, and only the first two are observations. A missing usage row and a measured zero are different findings.</p>
        <table class="mini-table"><tbody>${evRows}</tbody></table>
      </div>

      <div class="mcard">
        <h4>3 · Derived signals</h4>
        <p>No single signal decides anything &mdash; the obvious orphan test returns ${stats.orphanTrap} objects, of which ${stats.orphanTrapStandard} are SAP standard.</p>
        <dl>
          <div><dt>Reachable from a t-code</dt><dd>${stats.reachable}</dd></div>
          <div><dt>Write into standard</dt><dd class="bad">${stats.writesStandard}</dd></div>
          <div><dt>Version forks</dt><dd>${stats.forks}</dd></div>
          <div><dt>Max blast radius</dt><dd>${stats.maxBlast}</dd></div>
        </dl>
      </div>
    </div>

    <h4 class="wiz-h">Rules that fired</h4>
    <p class="wiz-lede">Ordered, first match wins. Each rule declares the evidence it rests on, and that is load-bearing: <b>Retire is only reachable from a measurement or a structural fact</b>. Anything resting on inference or on a missing record proposes Investigate instead, and names what would settle it.</p>
    <div class="card" style="overflow-x:auto"><table class="findings">
      <thead><tr><th>Rule</th><th>Basis</th><th>Objects</th><th>Call</th></tr></thead>
      <tbody>${ruleRows}</tbody>
    </table></div>`;
}

// --- step 4 -----------------------------------------------------------------

export function renderNarrative(stats, sample) {
  return `
    <p class="wiz-lede">106 custom objects is a list, and nobody funds a list. The grouping into decisions is part of the same deterministic algorithm &mdash; priority-ordered and exclusive, so every object lands in exactly one decision and the counts add up to the estate. A model gets involved after that, and only to put it into words.</p>

    <div class="split-two">
      <div class="mcard">
        <h4>Deterministic — everything that decides</h4>
        <p>${stats.customObjects} custom objects sorted into ${stats.packages} decisions by rule, not by similarity. Every score, every call, every grouping. Reproducible: the same extract gives the same answer every time, and <code>tools/check.mjs</code> re-derives it from the raw files to prove it.</p>
      </div>
      <div class="mcard is-ai">
        <h4>Model-written — words only</h4>
        <p>Two things. A headline, decision and watch-out per decision, cached to <code>data/packages.json</code>. And the assistant, which explains either page at the register you pick &mdash; composed from live numbers at the moment you open it, so it can never describe a position the page is not showing.</p>
        <p style="margin-bottom:0">Both are labelled wherever they appear. The running page never calls an API, so no demo depends on a network.</p>
      </div>
    </div>

    ${sample ? `
    <h4 class="wiz-h">What that looks like</h4>
    <div class="card sample">
      <div class="sample-head">
        <span class="badge badge--count">${plural(sample.count, 'object')}</span>
        <b>${esc(sample.title)}</b>
        <span class="tag-det">grouped by rule</span>
      </div>
      <p class="sample-ai">${esc(sample.headline)}</p>
      <p class="sample-ai"><b>Decision:</b> ${esc(sample.decision)}</p>
      <div class="sample-note">The two lines above are the model's. The package, its members, its call and its confidence are not.</div>
    </div>` : ''}

    <div class="callout" style="margin-top:16px">
      <span class="i" aria-hidden="true">i</span>
      <span>If the model were doing the deciding, none of it could be audited &mdash; and the one question a Head of Transformation always asks is why. Keeping the model on the words, and labelling every word it wrote, is what keeps the answer defensible.</span>
    </div>`;
}
