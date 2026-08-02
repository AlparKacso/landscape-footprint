// The evidence model — the spine of the whole footprint.
//
// The central claim: an object with no row in usage.csv and an object with a
// row saying zero executions are NOT the same finding. One is a measurement,
// the other is a gap in measurement. Collapsing them is the single easiest way
// to produce a confident, wrong retirement list.
//
// Four states, and only the first two are observations:
//   measured-active  — ran, with a number attached
//   measured-dead    — measured, and it did not run
//   unmeasured       — no row: we do not know, and we can say what would tell us
//   unmeasurable     — tables: execution semantics do not apply at all
//
// This module reports what the extract actually supports. What to *do* about
// each state is the rulepack's decision, not this module's.

export const EVIDENCE = {
  ACTIVE: 'measured-active',
  DEAD: 'measured-dead',
  UNMEASURED: 'unmeasured',
  UNMEASURABLE: 'unmeasurable',
};

export const EVIDENCE_LABEL = {
  [EVIDENCE.ACTIVE]: 'Running',
  [EVIDENCE.DEAD]: 'Measured, never ran',
  [EVIDENCE.UNMEASURED]: 'Not measured',
  [EVIDENCE.UNMEASURABLE]: 'Cannot be measured',
};

// Why each state is what it is, in the words we would use to a transformation
// lead. Shown on the coverage strip so no state is ever an unexplained bucket.
export const EVIDENCE_NOTE = {
  [EVIDENCE.ACTIVE]: 'We have a usage record and it shows real activity.',
  [EVIDENCE.DEAD]: 'We have a usage record and it shows zero. That is a finding, not a gap.',
  [EVIDENCE.UNMEASURED]: 'No usage record at all. We do not know — and we say what would tell us.',
  [EVIDENCE.UNMEASURABLE]: 'Tables do not “run”, so usage data cannot exist for them. Evidence comes from what reads and writes them instead.',
};

// What would resolve each state, named explicitly. A recommendation that
// cannot say what would change it is an opinion, not an assessment.
export const NEXT_EVIDENCE = {
  [EVIDENCE.UNMEASURED]: 'SCMON / UPL collection over a full business cycle, or the SAP Custom Code Migration app',
  [EVIDENCE.UNMEASURABLE]: 'Table row counts and last-change timestamps from the source system',
  [EVIDENCE.DEAD]: 'Confirm the extract covers a full business cycle — a quarter-end-only job can read as dead',
  [EVIDENCE.ACTIVE]: null,
};

const MS_PER_DAY = 86400000;

function monthsBetween(from, to) {
  if (!from || !to) return null;
  return Math.round((to - from) / MS_PER_DAY / 30.44);
}

export function attachEvidence(graph, extract) {
  const usage = new Map();
  for (const row of extract.usage) {
    usage.set(row.object_name, {
      executions: Number(row.avg_executions_per_month) || 0,
      users: Number(row.distinct_users) || 0,
      lastExecuted: row.last_executed_date || null,
    });
  }

  // The observation date is the latest execution in the extract, not today.
  // The extract is a snapshot; anchoring staleness to the wall clock would
  // make every number drift between now and the session.
  const dates = [...usage.values()].map((u) => u.lastExecuted).filter(Boolean).sort();
  const observedAt = dates.length ? dates[dates.length - 1] : null;
  const observedAtMs = observedAt ? Date.parse(observedAt) : null;

  for (const [name, object] of graph.objects) {
    const row = usage.get(name);
    object.usage = row ?? null;

    if (object.type === 'Table') {
      object.evidence = EVIDENCE.UNMEASURABLE;
      object.accessEvidence = {
        readers: object.readers ?? [],
        writers: object.writers ?? [],
      };
    } else if (!row) {
      object.evidence = EVIDENCE.UNMEASURED;
    } else if (row.executions > 0) {
      object.evidence = EVIDENCE.ACTIVE;
    } else {
      object.evidence = EVIDENCE.DEAD;
    }

    object.monthsSinceExecution =
      row?.lastExecuted && observedAtMs
        ? monthsBetween(Date.parse(row.lastExecuted), observedAtMs)
        : null;

    object.ageYears = object.createdDate
      ? Math.round((Date.parse(observedAt ?? Date.now()) - Date.parse(object.createdDate)) / MS_PER_DAY / 365.25)
      : null;

    object.nextEvidence = NEXT_EVIDENCE[object.evidence];
  }

  graph.observedAt = observedAt;
  return graph;
}

// Coverage per object type — kept as a first-class output because the
// credibility of the whole artifact comes from showing the blind spots on the
// face of it rather than burying them in a footnote.
export function coverageByType(graph, { customOnly = false } = {}) {
  const rows = new Map();
  for (const object of graph.objects.values()) {
    if (customOnly && !object.isCustom) continue;
    if (!rows.has(object.type)) {
      rows.set(object.type, {
        type: object.type,
        total: 0,
        [EVIDENCE.ACTIVE]: 0,
        [EVIDENCE.DEAD]: 0,
        [EVIDENCE.UNMEASURED]: 0,
        [EVIDENCE.UNMEASURABLE]: 0,
      });
    }
    const row = rows.get(object.type);
    row.total += 1;
    row[object.evidence] += 1;
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}
