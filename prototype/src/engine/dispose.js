// Dispositions. Ordered rules, first match wins, and every result carries the
// name of the rule that fired. Nothing here is a model output — a disposition
// can always be defended by pointing at the rule and the rows behind it.
//
// Each rule also declares its *basis*: how much of the case rests on
// observation versus inference. The basis is what Confidence is read from, and
// it enforces one hard invariant:
//
//   Nothing is ever retired on evidence weaker than a measurement.
//
// Retire is reachable only from a `structural` or `measured` rule. A rule
// resting on `inferred` or `unmeasured` evidence proposes Investigate and names
// what would settle it. An earlier version of this engine gated those rules
// behind a 0–100 risk-tolerance dial instead — same default output, but it made
// the safety a setting the customer had to find rather than a property of the
// tool. A dial you can turn up until it tells you to delete things is not a
// safeguard.

// One more invariant, weaker than the retire gate but easy to break: every rule
// above `standard-object` must test `o.isCustom`. Four of them did not, and
// because the fork rules sit near the top, eight SAP objects were being told to
// "resolve the fork before migrating either" — a call the customer cannot take
// on code they do not own, and a direct contradiction of what the Scope card
// says about the standard estate. No headline number moved, which is exactly
// why it survived: everything reported is custom-only, so the interface was
// the only place it showed.

import { EVIDENCE } from '../core/evidence.js';

export const DISPOSITION = {
  RETIRE: 'retire',
  RETAIN: 'retain',
  REBUILD: 'rebuild',
  REMEDIATE: 'remediate',
  INVESTIGATE: 'investigate',
};

export const DISPOSITION_LABEL = {
  [DISPOSITION.RETIRE]: 'Retire',
  [DISPOSITION.RETAIN]: 'Carry as-is',
  [DISPOSITION.REBUILD]: 'Fit-to-standard workshop',
  [DISPOSITION.REMEDIATE]: 'Remediate before conversion',
  [DISPOSITION.INVESTIGATE]: 'Investigate',
};

// Kept honest deliberately: metadata can tell you an object is business
// critical and custom. It cannot tell you whether S/4 standard covers it.
// That call is a workshop. What this tool does is scope the workshop.
export const DISPOSITION_NOTE = {
  [DISPOSITION.RETIRE]: 'Evidence supports removing it rather than carrying it forward.',
  [DISPOSITION.RETAIN]: 'Carry forward. No signal suggests otherwise.',
  [DISPOSITION.REBUILD]: 'Business-critical custom code. Whether S/4 standard covers it is a workshop decision — this scopes the workshop, it does not pre-empt it.',
  [DISPOSITION.REMEDIATE]: 'Writes into standard objects. Blocks a clean core until addressed, independent of usage.',
  [DISPOSITION.INVESTIGATE]: 'The signals disagree, or the evidence is not there yet.',
};

const chip = (v, tone = 'neutral') => ({ v: String(v), tone });

function effectiveEvidence(object, rules) {
  if (object.evidence === EVIDENCE.UNMEASURED && rules.unmeasuredMeans === 'dead') {
    return EVIDENCE.DEAD;
  }
  return object.evidence;
}

const RULES = [
  {
    id: 'clean-core-write',
    basis: 'structural',
    test: (o) => o.isCustom && o.writesStandard?.length > 0,
    result: (o) => ({
      disposition: DISPOSITION.REMEDIATE,
      rationale: [
        'Writes directly into ',
        chip(o.writesStandard.length, 'risk'),
        ` standard object${o.writesStandard.length > 1 ? 's' : ''} (`,
        chip(o.writesStandard.join(', '), 'risk'),
        '). This holds whether or not the object is still used, so it is a decision you can take today.',
      ],
    }),
  },
  {
    id: 'fork-both-live',
    basis: 'measured',
    test: (o, ev, g) => {
      const partner = g.objects.get(o.forkPartner);
      return o.isCustom && partner && ev === EVIDENCE.ACTIVE && partner.evidence === EVIDENCE.ACTIVE;
    },
    result: (o, ev, g) => {
      const partner = g.objects.get(o.forkPartner);
      return {
        disposition: DISPOSITION.INVESTIGATE,
        rationale: [
          'Running in parallel with ',
          chip(o.forkPartner, 'risk'),
          '. Both are live: ',
          chip(`${o.usage.executions.toLocaleString()}/mo, ${o.usage.users} users`),
          ' against ',
          chip(`${partner.usage.executions.toLocaleString()}/mo, ${partner.usage.users} users`),
          '. Resolve the fork before migrating either, or it goes into S/4 twice.',
        ],
      };
    },
  },
  {
    id: 'fork-dead-side',
    basis: 'measured',
    test: (o, ev, g) => {
      const partner = g.objects.get(o.forkPartner);
      return o.isCustom && partner && ev === EVIDENCE.DEAD && partner.evidence === EVIDENCE.ACTIVE;
    },
    result: (o) => ({
      disposition: DISPOSITION.RETIRE,
      rationale: [
        'Superseded by ',
        chip(o.forkPartner, 'ok'),
        ', which is measurably live while this one records ',
        chip('0 executions', 'ok'),
        '. The successor carries the function forward.',
      ],
    }),
  },
  {
    id: 'measured-dead-referenced',
    basis: 'measured',
    test: (o, ev) => o.isCustom && ev === EVIDENCE.DEAD && (o.tcodeDirect || o.fanIn > 0),
    result: (o) => ({
      disposition: DISPOSITION.INVESTIGATE,
      rationale: [
        'Measured at ',
        chip('0 executions', 'warn'),
        ' but still referenced — ',
        chip(o.tcodeDirect ? 'a transaction code points at it' : `${o.fanIn} caller(s)`, 'warn'),
        '. Something is pointing users at code that does not run.',
      ],
    }),
  },
  {
    id: 'measured-dead-unreferenced',
    basis: 'measured',
    test: (o, ev) => o.isCustom && ev === EVIDENCE.DEAD && !o.tcodeDirect && o.fanIn === 0,
    result: () => ({
      disposition: DISPOSITION.RETIRE,
      rationale: [
        'Measured at ',
        chip('0 executions', 'ok'),
        ', no transaction code, nothing calls it. This is an observation, not a gap — the strongest retirement case in the extract.',
      ],
    }),
  },
  {
    id: 'table-no-access',
    basis: 'inferred',
    test: (o) => o.type === 'Table' && o.isCustom && !o.accessEvidence?.readers.length && !o.accessEvidence?.writers.length,
    result: () => ({
      disposition: DISPOSITION.INVESTIGATE,
      rationale: [
        'Custom table with ',
        chip('no recorded reads or writes', 'warn'),
        '. usage.csv covers no tables at all, so this rests on the dependency extract alone. It looks like a retirement, but nothing here is a measurement — get row counts before acting.',
      ],
    }),
  },
  {
    id: 'table-accessed',
    basis: 'structural',
    test: (o) => o.type === 'Table' && o.isCustom,
    result: (o) => ({
      disposition: DISPOSITION.RETAIN,
      rationale: [
        'Custom table read by ',
        chip(o.accessEvidence.readers.length),
        ' and written by ',
        chip(o.accessEvidence.writers.length),
        ' object(s). It holds data, so it follows the data slice in a selective transition.',
      ],
    }),
  },
  {
    id: 'business-critical-custom',
    basis: 'measured',
    test: (o, ev) => o.isCustom && o.tcodeDirect && ev === EVIDENCE.ACTIVE,
    result: (o) => ({
      disposition: DISPOSITION.REBUILD,
      rationale: [
        'A transaction code runs on it, ',
        chip(`${o.usage.executions.toLocaleString()} executions/mo`, 'ok'),
        ' across ',
        chip(`${o.usage.users} users`, 'ok'),
        '. The business reaches this directly, so it must exist on the other side in some form.',
      ],
    }),
  },
  {
    id: 'active-custom-supporting',
    basis: 'measured',
    test: (o, ev) => o.isCustom && ev === EVIDENCE.ACTIVE,
    result: (o) => ({
      disposition: DISPOSITION.RETAIN,
      rationale: [
        'Runs ',
        chip(`${o.usage.executions.toLocaleString()}/mo`, 'ok'),
        ' with no transaction code — reached by batch, interface or RFC. Used, but not a business entry point.',
      ],
    }),
  },
  {
    id: 'unmeasured-unreferenced-custom',
    basis: 'unmeasured',
    test: (o, ev) => o.isCustom && ev === EVIDENCE.UNMEASURED && o.fanIn === 0 && !o.tcodeReachable,
    result: () => ({
      disposition: DISPOSITION.INVESTIGATE,
      rationale: [
        chip('No usage row', 'warn'),
        ', nothing calls it, no path from any transaction code. Three weak signals agreeing is not the same as one strong one — this is the strongest retirement candidate the extract supports, and still not a finding until usage is actually measured.',
      ],
    }),
  },
  {
    id: 'unmeasured-referenced-custom',
    basis: 'unmeasured',
    test: (o, ev) => o.isCustom && ev === EVIDENCE.UNMEASURED,
    result: (o) => ({
      disposition: DISPOSITION.INVESTIGATE,
      rationale: [
        chip('No usage row', 'warn'),
        ', but ',
        chip(o.tcodeReachable ? 'reachable from a transaction code' : `${o.fanIn} caller(s)`, 'warn'),
        '. Absence of measurement, not absence of use.',
      ],
    }),
  },
  {
    id: 'standard-object',
    basis: 'structural',
    test: (o) => !o.isCustom,
    result: () => ({
      disposition: DISPOSITION.RETAIN,
      rationale: ['SAP standard. Not the customer\'s decision to make — shown for dependency context only.'],
    }),
  },
];

// How solid the case behind a call is. Read straight off the rule's basis, so
// it is a statement about the evidence rather than about how strongly a rule
// fired. Never colour alone on screen — colour carries the call.
export const BASIS_CONFIDENCE = {
  structural: 'high',
  measured: 'high',
  inferred: 'medium',
  unmeasured: 'low',
};

// Weakest first is the order work actually gets sequenced in: act on what is
// true regardless of usage, then on what was measured, then on what is still
// inference. Replaces the old commit-threshold ordering with the same result.
export const BASIS_RANK = { structural: 0, measured: 1, inferred: 2, unmeasured: 3 };

// Retire may only be proposed by a rule that rests on an observation. Enforced
// at run time rather than trusted, because it is the one promise this engine
// makes and a rule edit during a live session must not be able to break it
// silently. A rule's result depends on the object, so it is checked per call.
const RETIRE_SAFE_BASIS = new Set(['structural', 'measured']);

export function disposeAll(graph, rules) {
  for (const object of graph.objects.values()) {
    const ev = effectiveEvidence(object, rules);
    const rule = RULES.find((r) => r.test(object, ev, graph));
    const { disposition, rationale } = rule.result(object, ev, graph);

    if (disposition === DISPOSITION.RETIRE && !RETIRE_SAFE_BASIS.has(rule.basis)) {
      throw new Error(`Rule ${rule.id} proposes Retire on ${rule.basis} evidence. Retire requires an observation.`);
    }

    object.proposed = disposition;
    object.disposition = disposition;
    object.rule = rule.id;
    object.basis = rule.basis;
    object.confidence = rules.confidence?.[rule.basis] ?? BASIS_CONFIDENCE[rule.basis];
    object.rationale = rationale;
  }
  return graph;
}
