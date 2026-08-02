// Decision packages.
//
// 106 custom objects is a list. A transformation lead cannot fund a list. The
// packages below are the unit a steering committee actually decides on: each
// one is a single call, taken once, executed as a batch.
//
// Assignment is priority-ordered and exclusive — every custom object lands in
// exactly one package, so the counts on the board add up to the estate and
// nothing is double-funded. Priority reflects how the work would actually be
// sequenced, not how the rules happen to be written: a measured-dead object
// inside the 2011 migration package belongs to the migration decision,
// because that is how it will be retired.

import { BASIS_RANK, BASIS_CONFIDENCE } from './dispose.js';

export const PACKAGE_DEFS = [
  {
    id: 'clean-core',
    title: 'Clean-core write blockers',
    match: (o, rules) => o.isCustom && o.writesStandard?.length > 0,
  },
  {
    id: 'fork-live',
    title: 'Version forks running in parallel',
    match: (o) => o.rule === 'fork-both-live',
  },
  {
    id: 'fork-superseded',
    title: 'Superseded predecessors',
    match: (o) => o.rule === 'fork-dead-side',
  },
  {
    id: 'dead-referenced',
    title: 'Dead code the business still points at',
    match: (o) => o.rule === 'measured-dead-referenced',
  },
  {
    id: 'dead-clear',
    title: 'Measured dead, nothing depends on it',
    match: (o) => o.rule === 'measured-dead-unreferenced',
  },
  {
    id: 'tables',
    title: 'Custom tables — the selective-transition pivot',
    match: (o) => o.isCustom && o.type === 'Table',
  },
  {
    // Deliberately narrow: only the part of the migration-era estate that has
    // no evidence of use. Actively-used objects that happen to live in these
    // packages are not residue and are decided on their own merits — calling
    // all 34 "residue" would be the kind of overreach that loses the room.
    id: 'migration-residue',
    title: 'Residue from the 2011 migration',
    match: (o, rules) =>
      o.isCustom &&
      rules.migrationEraPackages.includes(o.package) &&
      o.type !== 'Table' &&
      o.evidence !== 'measured-active',
  },
  {
    id: 'workshop',
    title: 'Business-critical custom — fit-to-standard workshop',
    match: (o) => o.proposed === 'rebuild',
  },
  {
    id: 'unmeasured-candidates',
    title: 'Retirement candidates pending measurement',
    match: (o) => o.rule === 'unmeasured-unreferenced-custom',
  },
  {
    id: 'unmeasured-referenced',
    title: 'Unmeasured but referenced',
    match: (o) => o.rule === 'unmeasured-referenced-custom',
  },
  {
    id: 'carry',
    title: 'Active supporting code — carry forward',
    match: (o) => o.rule === 'active-custom-supporting',
  },
];

export function buildPackages(graph, rules, narrative = {}) {
  const packages = PACKAGE_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    objects: [],
    ...(narrative[def.id] ?? {}),
  }));
  const index = new Map(packages.map((p) => [p.id, p]));

  for (const object of graph.objects.values()) {
    if (!object.isCustom) continue;
    const def = PACKAGE_DEFS.find((d) => d.match(object, rules));
    if (!def) continue;
    object.packageId = def.id;
    index.get(def.id).objects.push(object);
  }

  for (const pack of packages) {
    const objects = pack.objects;
    pack.count = objects.length;

    // Blast radius of the package as a whole: the union of what depends on
    // any member, minus the members themselves. Deduplicated, because the
    // overlap between members is exactly what makes it one decision.
    const blast = new Set();
    for (const o of objects) for (const n of o.blastRadius) blast.add(n);
    for (const o of objects) blast.delete(o.name);
    pack.blastRadius = blast.size;

    pack.tcodes = objects.filter((o) => o.tcodeDirect).length;
    pack.users = Math.max(0, ...objects.map((o) => o.usage?.users ?? 0));
    pack.executions = objects.reduce((sum, o) => sum + (o.usage?.executions ?? 0), 0);
    pack.maxRisk = Math.max(0, ...objects.map((o) => o.risk.score));
    pack.maxBusiness = Math.max(0, ...objects.map((o) => o.business.score));

    // A package inherits the weakest basis among its members: a decision is
    // only as defensible as its thinnest evidence.
    const order = Object.keys(BASIS_RANK);
    pack.basis = objects.length
      ? order[Math.max(...objects.map((o) => BASIS_RANK[o.basis]))]
      : 'structural';
    pack.evidenceRank = BASIS_RANK[pack.basis];
    pack.confidence = rules.confidence?.[pack.basis] ?? BASIS_CONFIDENCE[pack.basis];
    pack.proposed = objects.length ? mode(objects.map((o) => o.proposed)) : null;
  }

  // Strongest evidence first, then most entangled. This is the order the work
  // would actually be sequenced in: what holds regardless of usage, then what
  // was measured, then what is still inference.
  return packages
    .filter((p) => p.count > 0)
    .sort((a, b) => a.evidenceRank - b.evidenceRank || b.maxRisk - a.maxRisk);
}

function mode(values) {
  const counts = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
