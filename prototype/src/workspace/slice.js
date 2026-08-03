// The Context Slice page — loading, and the boundary statement.
//
// This was a three-step wizard that walked the pipeline: load, then the rules
// deciding, then where the Discovery Agent writes. It was the most-built and
// least-differentiating thing in the prototype. Celonis's ability to ingest and
// compute data is the one claim nobody in the room doubts, so proving it cost
// minutes from a ten-minute demo and bought nothing.
//
// What survives is the half that is actually load-bearing. The adapters stay,
// because matching on column signature rather than filename is what makes
// "composable" watchable instead of asserted. And the boundary statement stays,
// because "everything that decides is deterministic, and a model only writes
// prose" is the answer to the question this whole capability exists inside — a
// boundary you state exhaustively is checkable, one you gesture at is not.
//
// The steps in between are gone. What they showed is still reachable: every
// call carries its named rule and its rationale in the decision modal, which is
// where someone actually asks "why does it say retire?".

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const ROLES = ['objects', 'usage', 'dependencies', 'transactions'];

export const ROLE_INFO = {
  objects: { label: 'Objects', need: 'object_name, object_type, namespace', what: 'The inventory. One row per program, function module or table.' },
  usage: { label: 'Usage', need: 'object_name, avg_executions_per_month', what: 'Execution evidence. Absence of a row here is a gap, not a zero.' },
  dependencies: { label: 'Dependencies', need: 'caller_object, target_object', what: 'The call graph, typed Call / Read / Write.' },
  transactions: { label: 'Transactions', need: 'transaction_code, program_name', what: 'How the business reaches the system.' },
};

// --- loading -----------------------------------------------------------------
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

// --- the boundary ------------------------------------------------------------
//
// The one thing the deleted wizard steps said that nothing else says. It is a
// negative claim and a positive one in the same breath: everything that decides
// anything is deterministic and replayable, and a model writes prose in exactly
// three places — named, so the boundary can be checked rather than trusted.
//
// Stated once, on the page that establishes what the extract supports, rather
// than walked through over three screens. The counts are read from the run so
// the card cannot describe a pipeline that did not happen.

export function renderBoundary(stats) {
  return `
    <p class="wiz-lede">${stats.objects} objects arrive as four tables and leave as
      ${stats.packages} decisions. Everything in between is one sequential, deterministic pass:
      evidence state per object, then the first rule that fits, then the call it proposes, then
      grouping into decisions. Same extract, same answer, every time &mdash;
      <code>tools/check.mjs</code> re-derives every number below from the raw files to prove it.</p>

    <div class="split-two">
      <div class="mcard">
        <h4>Deterministic &mdash; everything that decides</h4>
        <p style="margin-bottom:0">Every score, every call, every grouping. Twelve ordered rules,
          first match wins, and each one declares whether it rests on a fact, a measurement, an
          inference or a gap. Nothing is ever retired on evidence weaker than a measurement, and the
          engine refuses to start if a rule breaks that.</p>
      </div>
      <div class="mcard is-ai">
        <h4>The Discovery Agent &mdash; words, in three places</h4>
        <ol class="ai-places">
          <li>The headline, decision and watch-out on each of the ${stats.packages} decisions.</li>
          <li>The sentence at the top of the Landscape Footprint.</li>
          <li>The Discovery Agent itself, which explains either page at the register you pick.</li>
        </ol>
        <p style="margin:8px 0 0">Wherever a model wrote something the page says so, and says what it
          was written <i>from</i>. The number of figures written by a model is zero.</p>
      </div>
    </div>`;
}
