// The object drawer.
//
// The decision modal answers "what do we do about these eleven things". This
// answers "what is this one thing", which is a different question asked by
// different people — and it is the question that decides whether anyone in the
// room believes the eleven.
//
// It is deliberately not reachable from inside the decision modal. There the
// objects are grouped on purpose, and a drawer over the top of that invites
// exactly the per-object arguing the grouping exists to end. Here, on the
// inventory, it is the whole point.

import { esc, plural, num, renderChips, callChip, evidenceLine, EVIDENCE_CLASS } from './ui.js';
import { EVIDENCE, EVIDENCE_LABEL, EVIDENCE_NOTE } from '../core/evidence.js';
import { DISPOSITION_LABEL } from '../engine/dispose.js';

const row = (k, v) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`;

function accessChip(type) {
  return `<span class="at at-${esc(type)}">${esc(type)}</span>`;
}

function depList(edges, otherOf, ctx) {
  if (!edges.length) return '<p class="empty-row">Nothing in the extract.</p>';
  return `<div class="deplist">${edges.map((e) => {
    const other = otherOf(e);
    const object = ctx.graph.objects.get(other);
    const isStdWrite = e.type === 'Write' && object?.namespace === 'Standard';
    const pack = object?.packageId ? ctx.packById.get(object.packageId) : null;
    const call = pack ? ctx.callOf(pack) : null;
    return `<div class="depitem${isStdWrite ? ' is-stdwrite' : ''}">
      ${accessChip(e.type)}
      <button class="deplink" data-object="${esc(other)}">${esc(other)}</button>
      ${call ? callChip(call) : object
        ? '<span class="badge badge--muted">SAP standard</span>'
        : '<span class="badge badge--remediate">Not in inventory</span>'}
    </div>`;
  }).join('')}</div>`;
}

function phantomDrawer(name, ctx) {
  const phantom = ctx.graph.phantoms.find((p) => p.name === name);
  const tx = ctx.graph.transactions.filter((t) => t.program === name);
  const usage = ctx.rawUsage.find((u) => u.object_name === name);
  const callers = ctx.graph.edges.filter((e) => e.to === name);
  const targets = ctx.graph.edges.filter((e) => e.from === name);

  const evidence = usage
    ? `<p>It has a usage row: <b>${num(Number(usage.avg_executions_per_month))}</b> executions a month across
       <b>${plural(Number(usage.distinct_users), 'user')}</b>, last run ${esc(usage.last_executed_date)}.
       This is one of the busiest things in the extract, and the inventory says it does not exist.</p>`
    : '<p>No usage row either. Someone can still run this. Nobody can tell you what it does or who owns it.</p>';

  return {
    title: name,
    sub: `Referenced in ${phantom.sources.join(', ')} · absent from the object inventory`,
    body: `
      <div class="callout callout--bad">
        <span class="i" aria-hidden="true">!</span>
        <span><b>Not in the inventory.</b> Read as data quality this is a join failure. Read as a finding it is
        live code with no inventory record and no owner — and any scope built from objects.csv alone
        silently excludes it. The Basis team has said the extract may be incomplete, so this is one of
        an unknown number rather than one of three.</span>
      </div>
      <section class="dsec">
        <h4>What points at it</h4>
        ${tx.length ? `<div class="deplist">${tx.map((t) => `<div class="depitem">
          <span class="at at-Call">tcode</span><span class="depname">${esc(t.code)}</span>
          <span class="dep-note">${esc(t.description)}</span></div>`).join('')}</div>`
          : '<p class="empty-row">No transaction code.</p>'}
        ${evidence}
      </section>
      <section class="dsec">
        <h4>Called by <span class="n">${callers.length}</span></h4>
        ${depList(callers, (e) => e.from, ctx)}
      </section>
      <section class="dsec">
        <h4>Calls <span class="n">${targets.length}</span></h4>
        ${depList(targets, (e) => e.to, ctx)}
      </section>
      <div class="callout" style="margin-top:14px">
        <span class="i" aria-hidden="true">i</span>
        <span>Week-one question for the Basis team: is this decommissioned, living in another system,
        or missing from the export?</span>
      </div>`,
  };
}

export function renderDrawer(name, ctx) {
  if (!ctx.graph.objects.has(name)) return phantomDrawer(name, ctx);

  const o = ctx.graph.objects.get(name);
  const pack = o.packageId ? ctx.packById.get(o.packageId) : null;
  const call = pack ? ctx.callOf(pack) : null;
  const tx = ctx.graph.transactions.filter((t) => t.program === name);
  const callers = ctx.graph.edges.filter((e) => e.to === name);
  const targets = ctx.graph.edges.filter((e) => e.from === name);
  const blast = o.blastRadius.filter((n) => n !== name).length;

  // The only place the two units of decision can disagree. Three custom tables
  // with no recorded access sit inside a decision to carry the tables forward.
  // Saying so is cheaper than being caught not saying it.
  const divergent = pack && o.proposed !== call;

  const theCall = pack
    ? `<div class="dcall dcall--${esc(call)}">
        <div class="dcall-head">${callChip(call)}<span class="dcall-src">the call on this decision</span></div>
        <p class="dcall-why">${renderChips(o.rationale)}</p>
        ${o.nextEvidence ? `<p class="dcall-next"><b>What would change it:</b> ${esc(o.nextEvidence)}</p>` : ''}
        ${divergent ? `<p class="dcall-diverge"><b>Note.</b> The rule that caught this object proposed
          <b>${esc(DISPOSITION_LABEL[o.proposed])}</b> on its own. It is decided as part of
          <b>${esc(pack.title)}</b>, which is called ${esc(DISPOSITION_LABEL[call])} — decisions are taken
          per package, not per object, so this one follows the package.</p>` : ''}
      </div>`
    : `<div class="dcall dcall--retain">
        <div class="dcall-head"><span class="badge badge--muted">SAP standard</span></div>
        <p class="dcall-why">Not the customer's decision to make. Shown for dependency context — this is
        SAP's code, on SAP's upgrade path.</p>
      </div>`;

  const evidenceBlock = o.evidence === EVIDENCE.UNMEASURABLE
    ? `<p class="dnote">${esc(EVIDENCE_NOTE[EVIDENCE.UNMEASURABLE])}</p>
       <div class="kv">
         ${row('Read by', `${plural(o.accessEvidence?.readers.length ?? 0, 'object')}`)}
         ${row('Written by', `${plural(o.accessEvidence?.writers.length ?? 0, 'object')}`)}
       </div>`
    : `<div class="kv">
         ${row('Executions / month', o.usage ? `<span class="mono">${num(o.usage.executions)}</span>` : '<span class="none">no usage row</span>')}
         ${row('Distinct users', o.usage ? `<span class="mono">${num(o.usage.users)}</span>` : '<span class="none">—</span>')}
         ${row('Last executed', o.usage?.lastExecuted ? `<span class="mono">${esc(o.usage.lastExecuted)}</span>` : '<span class="none">—</span>')}
       </div>
       ${o.evidence === EVIDENCE.UNMEASURED ? `<p class="dnote">${esc(EVIDENCE_NOTE[EVIDENCE.UNMEASURED])}</p>` : ''}
       ${o.evidence === EVIDENCE.DEAD ? `<p class="dnote">${esc(EVIDENCE_NOTE[EVIDENCE.DEAD])}</p>` : ''}`;

  return {
    title: name,
    sub: `${o.type} · ${o.package} · ${o.isCustom ? 'Custom' : 'SAP standard'}`,
    body: `
      ${theCall}

      <section class="dsec">
        <h4>Evidence <span class="ev-tag ${EVIDENCE_CLASS[o.evidence]}">${esc(EVIDENCE_LABEL[o.evidence])}</span></h4>
        ${evidenceBlock}
      </section>

      <section class="dsec">
        <h4>Reach</h4>
        <div class="kv">
          ${row('Transaction code', tx.length
            ? tx.map((t) => `<span class="mono">${esc(t.code)}</span> ${esc(t.description)}`).join('<br>')
            : o.tcodeReachable ? '<span class="none">none directly — reachable from one</span>' : '<span class="none">none</span>')}
          ${row('Called by', `${plural(o.fanIn, 'object')}`)}
          ${row('Calls out to', `${plural(o.fanOut, 'object')}`)}
          ${row('Blast radius', blast
            ? `<b>${plural(blast, 'object')}</b> would be touched if this changed`
            : '<span class="none">nothing depends on it</span>')}
        </div>
      </section>

      <section class="dsec">
        <h4>Provenance</h4>
        <div class="kv">
          ${row('Owner', `${esc(o.developerId)}${o.developerId?.startsWith(ctx.rules.externalAuthorPrefix) ? ' <span class="flag flag--warn">external</span>' : ''}`)}
          ${row('Created', `<span class="mono">${esc(o.createdDate || '—')}</span>${o.ageYears != null ? ` · ${plural(o.ageYears, 'year')} old at the extract` : ''}`)}
          ${row('Last changed', `<span class="mono">${esc(o.lastChangedDate || '—')}</span>`)}
        </div>
      </section>

      <section class="dsec">
        <h4>Depends on this <span class="n">${callers.length}</span></h4>
        ${depList(callers, (e) => e.from, ctx)}
      </section>

      <section class="dsec">
        <h4>This object uses <span class="n">${targets.length}</span></h4>
        ${depList(targets, (e) => e.to, ctx)}
      </section>

      ${pack ? `<div class="dfoot">
        <div>
          <span class="dfoot-label">Decided as part of</span>
          <b>${esc(pack.title)}</b>
          <span class="dfoot-sub">${plural(pack.count, 'object')} · one call, taken once</span>
        </div>
        <button class="btn btn--primary" data-open-pack="${esc(pack.id)}">Open the decision</button>
      </div>` : ''}`,
  };
}

// Kept next to the renderer so the two cannot disagree about what a row means.
export function evidenceSummary(object) {
  return evidenceLine(object);
}
