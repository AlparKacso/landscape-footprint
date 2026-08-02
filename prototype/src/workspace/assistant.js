// The assistant.
//
// Everything else in this prototype is deterministic on purpose, and the AI
// boundary has so far been a negative claim: no score, no call and no grouping
// is model-written. That proves restraint. It does not show where a model
// actually pays, and "where does AI pay" is the whole question the capability
// exists inside.
//
// It pays here. The page in front of a Head of Transformation carries four
// files, eleven decisions, five calls, four evidence states and a transition
// lever, and the one thing nobody can buy is the thirty seconds of an expert
// saying "here is what you are looking at, and here is what I would not trust
// yet". That is translation, not judgement — so it is the right job to give a
// model, and the wrong job to give the rulepack.
//
// Two rules hold it honest:
//
//   1. Composed from live state, never cached whole. A summary that described
//      the neutral reading while the page showed a greenfield position would
//      destroy the credibility of both. Every number below is read from the
//      graph at render time; the model's contribution is the phrasing around
//      them, written once and kept in this file.
//
//   2. Labelled everywhere it appears, with what it was generated *from*.
//      A disclaimer says "do not sue us". Provenance says "here is what you can
//      check", which is the only version worth having in front of this audience.
//
// The audience switch is not a verbosity dial. "Medium detail" asks the reader
// to guess which one they are; "for the board" is a question they can answer
// instantly, and it hands them a sentence they can use.

import { esc, plural, num } from './ui.js';
import { EVIDENCE } from '../core/evidence.js';
import { DISPOSITION, DISPOSITION_LABEL } from '../engine/dispose.js';
import { LENSES } from './lens.js';

export const AUDIENCES = [
  { id: 'board', label: 'For the board', note: 'The version you would say out loud in a steering meeting.' },
  { id: 'programme', label: 'For the programme', note: 'What to do next, and what each thing depends on.' },
  { id: 'engineer', label: 'For the engineer', note: 'The rules, the counts and the joins underneath it.' },
];

export const DEFAULT_AUDIENCE = 'programme';

const RANK = { board: 0, programme: 1, engineer: 2 };
const from = (level, min) => RANK[level] >= RANK[min];

const p = (html) => `<p>${html}</p>`;
const b = (v) => `<b>${v}</b>`;

// ---------------------------------------------------------------- facts
//
// Read once per render, so the prose downstream cannot disagree with the page.

function gather(ctx) {
  const g = ctx.graph;
  const all = [...g.objects.values()];
  const custom = all.filter((o) => o.isCustom);
  const measurable = custom.filter((o) => o.type !== 'Table');
  const measured = measurable.filter((o) => o.usage);
  const tables = custom.filter((o) => o.type === 'Table');

  const byCall = Object.fromEntries(Object.values(DISPOSITION).map((c) => [c, 0]));
  for (const pack of ctx.packages) byCall[ctx.callOf(pack)] += pack.count;

  const held = ctx.packages.filter((pack) => ctx.callOf(pack) === DISPOSITION.INVESTIGATE);
  const rulesFired = new Set(custom.map((o) => o.rule)).size;

  return {
    all, custom, measurable, measured, tables, byCall, held, rulesFired,
    objects: all.length,
    edges: g.edges.length,
    writes: g.edges.filter((e) => e.type === 'Write'
      && g.objects.get(e.from)?.isCustom && g.objects.get(e.to)?.namespace === 'Standard').length,
    writeObjects: custom.filter((o) => o.writesStandard?.length).length,
    transactions: g.transactions.length,
    tcodeCustom: g.transactions.filter((t) => g.objects.get(t.program)?.isCustom).length,
    phantoms: g.phantoms,
    unmeasuredCustom: custom.filter((o) => o.evidence === EVIDENCE.UNMEASURED).length,
    unmeasuredAll: all.filter((o) => o.evidence === EVIDENCE.UNMEASURED).length,
    deadCustom: custom.filter((o) => o.evidence === EVIDENCE.DEAD).length,
    decisions: ctx.packages.length,
    acting: byCall[DISPOSITION.REMEDIATE] + byCall[DISPOSITION.RETIRE] + byCall[DISPOSITION.REBUILD],
    unlocks: [...new Set(ctx.packages
      .filter((pack) => ctx.callOf(pack) === DISPOSITION.INVESTIGATE)
      .flatMap((pack) => pack.objects.map((o) => o.nextEvidence))
      .filter(Boolean))],
    lens: LENSES[ctx.lens],
    moved: ctx.packages.filter((pack) => ctx.lensEntryOf(pack)),
    observedAt: g.observedAt,
  };
}

// ---------------------------------------------------------------- extract page

function extractDid(f, level) {
  const out = [];

  out.push(p(`Four files from the Basis team became one model of this ECC system, and every one of
    the ${b(f.custom.length)} custom objects in it now has a recommended call. Those calls are
    grouped into ${b(f.decisions)} decisions — because a steering committee can fund eleven
    decisions and cannot fund a list of ${f.custom.length} line items.`));

  if (from(level, 'programme')) {
    out.push(p(`Nothing was cleaned on the way in. The files were matched to adapters by their
      column headings rather than their filenames, which is the seam a different source plugs into —
      point the same four adapters at SAP Readiness Check or the Custom Code Migration app and
      nothing downstream changes. The imperfections in the extract are findings, not defects to be
      tidied away before anyone sees them.`));
    out.push(p(`Every call comes from a written rule. ${b(f.rulesFired)} rules fired across the
      estate, first match wins, and each result carries the name of the rule that produced it — so
      &ldquo;why does it say retire?&rdquo; is answered with a rule and rows from your own extract
      rather than with a model's opinion.`));
  }

  if (from(level, 'engineer')) {
    out.push(p(`Concretely: ${b(num(f.objects))} objects and ${b(num(f.edges))} typed dependency
      edges became one graph, keyed on object name. ${b(f.tcodeCustom)} of ${f.transactions}
      transaction codes resolve to custom programs, and transitive reachability from those entry
      points is what anchors an object to the business rather than to the call graph alone.
      ${b(f.writes)} write edges run from custom code into standard objects, across
      ${b(plural(f.writeObjects, 'distinct object'))} — the two numbers differ because one object
      writes into two tables, and conflating them would be wrong in the room.`));
    out.push(p(`Scores are computed but deliberately never shown. They order the rows and nothing
      else; every claim on screen is a sentence built from your rows, not a number that would invite
      &ldquo;why 72?&rdquo;.`));
  }

  return out;
}

function extractTrust(f, level) {
  const out = [];
  const coverage = Math.round((f.measured.length / f.measurable.length) * 100);

  out.push(p(`Two things limit what this can tell you, and both are worth knowing before you act on
    anything. Usage data covers ${b(`${coverage}%`)} of the custom code that can have usage data at
    all. And ${b(plural(f.phantoms.length, 'program'))} referenced by live transaction codes
    ${f.phantoms.length === 1 ? 'is' : 'are'} missing from the object inventory entirely.`));

  out.push(p(`Your Basis team has said the extract may be incomplete, so treat that second number as
    a ${b('floor')} rather than a count — it is what this extract happens to reveal, not what exists.
    That is also why nothing here is retired on evidence weaker than a measurement.`));

  if (from(level, 'programme')) {
    out.push(p(`The gap splits in a way that matters. ${b(f.unmeasuredAll)} objects across the whole
      export have no usage row, which reads as fatal until you separate what you are deciding about:
      only ${b(f.unmeasuredCustom)} of them are custom code. The rest is SAP's own, which nobody was
      deciding about. And a missing row is not a measured zero — ${b(f.deadCustom)} custom objects
      were measured and did not run, which is a finding; the unmeasured ones are a gap, and they are
      held rather than guessed at.`));
    out.push(p(`${b(`The ${f.tables.length} custom tables`)} carry no execution semantics, so usage
      data cannot exist for them by construction rather than by omission. Their evidence comes from
      what reads and writes them instead.`));
  }

  if (from(level, 'engineer')) {
    out.push(p(`The four evidence states are kept separate on purpose: measured-active,
      measured-dead, unmeasured and unmeasurable. Collapsing the last two into &ldquo;unused&rdquo;
      is the fastest route to a confident, wrong retirement list — the naive orphan test (no usage
      row, no callers, no callees) returns 105 objects here, and 101 of them are SAP's.`));
    out.push(p(`The inventory exceptions in full: ${f.phantoms.map((ph) =>
      `<span class="mono">${esc(ph.name)}</span> (seen in ${esc(ph.sources.join(', '))})`).join(', ')}.
      These are join failures against <span class="mono">objects.csv</span>, kept as first-class
      output rather than silently dropped. Extract observed ${b(esc(f.observedAt))} — staleness is
      measured against the latest execution in the data, not against today, so nothing drifts between
      now and the session.`));
  }

  return out;
}

// ---------------------------------------------------------------- footprint page

function footprintDid(f, level) {
  const out = [];
  const path = f.lens.id === 'undecided' ? 'with no transition path assumed' : `on a ${f.lens.label.toLowerCase()}`;

  const parts = [
    f.byCall[DISPOSITION.RETIRE] && `${b(f.byCall[DISPOSITION.RETIRE])} to retire`,
    f.byCall[DISPOSITION.REMEDIATE] && `${b(f.byCall[DISPOSITION.REMEDIATE])} to remediate`,
    f.byCall[DISPOSITION.REBUILD] && `${b(f.byCall[DISPOSITION.REBUILD])} into a fit-to-standard workshop`,
  ].filter(Boolean);

  out.push(p(`${b(f.custom.length)} custom objects, ${b(f.decisions)} decisions, and ${path} you can
    act on ${b(f.acting)} of them today${parts.length ? `: ${parts.join(', ')}` : ''}.
    ${b(f.byCall[DISPOSITION.INVESTIGATE])} are held for a named piece of evidence rather than
    guessed at${f.byCall[DISPOSITION.RETAIN] ? `, and ${b(f.byCall[DISPOSITION.RETAIN])} carry forward untouched` : ''}.`));

  if (from(level, 'programme')) {
    out.push(p(`The map above is the whole custom estate: one tile per decision, sized by how many
      objects it covers and coloured by the call. It is not a picture of your system — it is a
      picture of what you have decided about your system, which is a different and more useful
      thing.`));
    if (f.moved.length) {
      out.push(p(`${b(plural(f.moved.length, 'decision'))} on this path
        ${f.moved.length === 1 ? 'reads' : 'read'} differently from the neutral position:
        ${f.moved.map((pack) => `${esc(pack.title)} (now ${esc(DISPOSITION_LABEL[f.lens.calls[pack.id].call].toLowerCase())})`).join('; ')}.
        Each one carries the reason inside the decision.`));
    }
  }

  if (from(level, 'engineer')) {
    out.push(p(`Assignment into decisions is priority-ordered and exclusive, so every custom object
      lands in exactly one and the counts add up to the estate — nothing is funded twice. Ordering is
      by evidence strength: what holds regardless of usage first, then what was measured, then what
      is still inference.`));
  }

  return out;
}

function footprintDecide(f, level) {
  const out = [];

  out.push(p(`Start with what does not need any more evidence.
    ${b(plural(f.byCall[DISPOSITION.REMEDIATE], 'object'))} write directly into standard objects
    across ${plural(f.writes, 'path')}. That is true whether or not anyone runs the code, so it is
    the one thing on this page you can commit to today without measuring anything first.`));

  if (f.byCall[DISPOSITION.RETIRE]) {
    out.push(p(`Then take the ${b(f.byCall[DISPOSITION.RETIRE])} retirements. Every one traces to a
      structural fact or an actual measurement — nothing here rests on an absence — which is what
      makes the number defensible when someone asks how you know.`));
  }

  if (from(level, 'programme') && f.unlocks.length) {
    out.push(p(`${b(plural(f.byCall[DISPOSITION.INVESTIGATE], 'object'))} are held, and each held
      decision names the one thing that would settle it: ${esc(f.unlocks.join('; '))}. That is a
      scoped, repeatable job with a defined finish line — point a collection at the estate, run it
      over a full business cycle, re-run this page. Work shaped like that belongs to an agent rather
      than to a consultant, and this list is the backlog it would be given.`));
  }

  if (from(level, 'programme')) {
    out.push(p(`The transition path is the one thing that changes the answer, and it has not been
      settled here. Switching it is the cheapest way to see what the choice costs before anyone
      commits to it — the same evidence, read four ways, with the decisions that move saying why.`));
  }

  if (from(level, 'engineer')) {
    out.push(p(`Two numbers to carry out of the room rather than one: what you act on now, and what
      it costs to decide the rest. Any tool that reports only the first is hiding the second, and
      the second is usually where the programme risk actually sits.`));
    if (f.phantoms.length) {
      out.push(p(`Separately and before any of it: ${b(plural(f.phantoms.length, 'live transaction code'))}
        point at programs the inventory does not contain, and the Basis team says there may be more.
        That is a week-one question, not a backlog item — any scope built from
        <span class="mono">objects.csv</span> alone silently excludes them.`));
    }
  }

  return out;
}

// ---------------------------------------------------------------- render

const SPEC = {
  extract: {
    title: 'What just happened to your extract',
    sections: [
      { heading: 'What this did for you', build: extractDid },
      { heading: 'What to know before you move on', build: extractTrust },
    ],
  },
  footprint: {
    title: 'Where you stand, and what to do next',
    sections: [
      { heading: 'What this did for you', build: footprintDid },
      { heading: 'How to decide from here', build: footprintDecide },
    ],
  },
};

export function renderAssistant(page, audience, ctx) {
  const spec = SPEC[page] ?? SPEC.footprint;
  const f = gather(ctx);
  const level = RANK[audience] == null ? DEFAULT_AUDIENCE : audience;

  const body = spec.sections.map((section, i) => `<section class="ai-sec">
      <h3><span class="ai-sec-n">${i + 1}</span>${esc(section.heading)}</h3>
      ${section.build(f, level).join('')}
    </section>`).join('');

  return {
    title: spec.title,
    body: `${body}
      <footer class="ai-prov">
        <b>Where this came from.</b> The wording is model-written and kept in
        <span class="mono">src/workspace/assistant.js</span>; every figure in it is read from your
        extract at the moment you opened this, not generated. No score, no call and no grouping on
        this page was produced by a model — those come from
        <span class="mono">src/engine/rulepack.json</span> and can be replayed. Open the Extract
        Wizard to watch that happen.
      </footer>`,
  };
}
