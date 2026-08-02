// Scoring. Deterministic and fully attributable: every score comes back with
// the list of signals that produced it.
//
// The scores are deliberately not shown on screen. A number like "risk 72"
// invites "why 72?", and answering that costs five minutes of a ten-minute
// demo to arrive at a list of facts the rule's own rationale already states in
// sentences. So they stay internal, where they do the one job a number is
// better at than prose: ordering. Every claim the interface makes is a
// sentence built from the customer's own rows.
//
// No single signal decides anything. The extract's own shape forbids it: the
// obvious "orphan" test (no usage row, no callers, no callees) returns 105
// objects, of which 101 are SAP standard and 3 of the remaining 4 are tables
// that usage.csv cannot cover. Converging signals, or nothing.

import { EVIDENCE } from '../core/evidence.js';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

function ratioPoints(value, at, weight) {
  if (!value) return 0;
  return Math.min(weight, (value / at) * weight);
}

// How much the business demonstrably depends on this object.
export function businessScore(object, rules) {
  const r = rules.business;
  const parts = [];
  let total = 0;

  if (object.tcodeDirect) {
    total += r.tcodeDirect;
    parts.push({ points: r.tcodeDirect, label: 'Runs behind a transaction code' });
  } else if (object.tcodeReachable) {
    total += r.tcodeReachable;
    parts.push({ points: r.tcodeReachable, label: 'Reachable from a transaction code' });
  }

  const users = object.usage?.users ?? 0;
  if (users > 0) {
    const pts = ratioPoints(users, r.usersAt, r.usersWeight);
    total += pts;
    parts.push({ points: pts, label: `${users} distinct users` });
  }

  const execs = object.usage?.executions ?? 0;
  if (execs > 0) {
    const pts = ratioPoints(execs, r.executionsAt, r.executionsWeight);
    total += pts;
    parts.push({ points: pts, label: `${execs.toLocaleString()} executions/month` });
  }

  // A table has no executions, so its business weight comes from who reads and
  // writes it. Without this the 18 custom tables would score zero on every
  // axis and quietly fall off the bottom of the list.
  if (object.type === 'Table') {
    const readers = object.accessEvidence?.readers.length ?? 0;
    const writers = object.accessEvidence?.writers.length ?? 0;
    if (readers + writers > 0) {
      const pts = Math.min(35, (readers + writers) * 7);
      total += pts;
      parts.push({ points: pts, label: `${readers} readers, ${writers} writers` });
    }
  }

  return { score: clamp(total), parts: parts.sort((a, b) => b.points - a.points) };
}

// How much trouble this object creates for a transformation.
export function riskScore(object, rules) {
  const e = rules.entanglement;
  const d = rules.decay;
  const parts = [];
  let total = 0;

  if (object.writesStandard?.length) {
    total += e.writesStandard;
    parts.push({
      points: e.writesStandard,
      label: `Writes into standard objects: ${object.writesStandard.join(', ')}`,
      critical: true,
    });
  }

  if (object.fanIn > 0) {
    const pts = Math.min(e.fanInCap, object.fanIn * e.fanInPer);
    total += pts;
    parts.push({ points: pts, label: `${object.fanIn} object(s) call it directly` });
  }

  const blast = object.blastRadius?.length ?? 0;
  if (blast > 0) {
    const pts = Math.min(e.blastRadiusCap, blast * e.blastRadiusPer);
    total += pts;
    parts.push({ points: pts, label: `${blast} object(s) depend on it transitively` });
  }

  if (object.forkPartner) {
    total += e.versionFork;
    parts.push({ points: e.versionFork, label: `Version fork with ${object.forkPartner}` });
  }

  if (object.evidence === EVIDENCE.DEAD) {
    total += d.measuredDead;
    parts.push({ points: d.measuredDead, label: 'Measured at zero executions' });
  }

  if (object.evidence === EVIDENCE.UNMEASURED) {
    total += d.unmeasured;
    parts.push({ points: d.unmeasured, label: 'No usage evidence available' });
  }

  if (object.monthsSinceExecution !== null && object.monthsSinceExecution >= rules.staleMonths) {
    total += d.staleExecution;
    parts.push({
      points: d.staleExecution,
      label: `Last executed ${object.monthsSinceExecution} months before the extract`,
    });
  }

  if (object.ageYears !== null && object.ageYears >= d.ageOverYears) {
    total += d.ageWeight;
    parts.push({ points: d.ageWeight, label: `${object.ageYears} years old` });
  }

  if (rules.migrationEraPackages.includes(object.package)) {
    total += d.migrationEra;
    parts.push({ points: d.migrationEra, label: `Migration-era package ${object.package}` });
  }

  if (object.developerId?.startsWith(rules.externalAuthorPrefix)) {
    total += d.externalAuthor;
    parts.push({ points: d.externalAuthor, label: `Authored by ${object.developerId} — external` });
  }

  return { score: clamp(total), parts: parts.sort((a, b) => b.points - a.points) };
}

export function scoreAll(graph, rules) {
  for (const object of graph.objects.values()) {
    object.business = businessScore(object, rules);
    object.risk = riskScore(object, rules);
  }
  return graph;
}
