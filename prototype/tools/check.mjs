// Ground-truth assertions. Run: node tools/check.mjs
//
// These numbers were derived independently from the raw CSVs before the
// pipeline existed. If the pipeline drifts from them, something in the
// scoring or the graph is wrong and the demo would be quietly lying.
//
// Two of these are not arithmetic but promises. "Nothing is retired on weak
// evidence" is the one guarantee the engine makes, and "every path still
// covers all 106" is what stops the transition lens from quietly losing
// objects. Both are cheap to assert and expensive to discover in the room.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCsv } from '../src/core/parse.js';
import { buildGraph } from '../src/core/graph.js';
import { attachEvidence, EVIDENCE, coverageByType } from '../src/core/evidence.js';
import { scoreAll } from '../src/engine/score.js';
import { disposeAll, DISPOSITION, DISPOSITION_LABEL } from '../src/engine/dispose.js';
import { buildPackages } from '../src/engine/packages.js';
import { LENSES, callForLens } from '../src/workspace/lens.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => parseCsv(readFileSync(join(root, 'data', f), 'utf8'));

const extract = {
  objects: read('objects.csv'),
  usage: read('usage.csv'),
  dependencies: read('dependencies.csv'),
  transactions: read('transactions.csv'),
};

const rules = JSON.parse(readFileSync(join(root, 'src/engine/rulepack.json'), 'utf8'));
const narrative = JSON.parse(readFileSync(join(root, 'data/packages.json'), 'utf8'));

const graph = buildGraph(extract);
attachEvidence(graph, extract);
scoreAll(graph, rules);
disposeAll(graph, rules);

const all = [...graph.objects.values()];
const custom = all.filter((o) => o.isCustom);
const count = (pred) => all.filter(pred).length;

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

console.log('\nInventory');
check('objects', all.length, 366);
check('custom objects', custom.length, 106);
check('tables', count((o) => o.type === 'Table'), 32);

console.log('\nEvidence states');
check('measured-active', count((o) => o.evidence === EVIDENCE.ACTIVE), 142);
check('measured-dead', count((o) => o.evidence === EVIDENCE.DEAD), 17);
check('unmeasured', count((o) => o.evidence === EVIDENCE.UNMEASURED), 175);
check('unmeasurable (tables)', count((o) => o.evidence === EVIDENCE.UNMEASURABLE), 32);
check('evidence states sum to inventory',
  count((o) => o.evidence === EVIDENCE.ACTIVE) + count((o) => o.evidence === EVIDENCE.DEAD) +
  count((o) => o.evidence === EVIDENCE.UNMEASURED) + count((o) => o.evidence === EVIDENCE.UNMEASURABLE), 366);
check('custom non-table objects with usage evidence',
  custom.filter((o) => o.type !== 'Table' && o.usage).length, 71);

// The customer decides about their own code and nothing else. Asserted rather
// than trusted because it broke silently once: four rules were missing their
// isCustom guard, and since every reported number is custom-only, eight SAP
// objects carried a customer-facing call without moving a single headline.
console.log('\nOwnership boundary');
check('standard objects reaching a rule other than standard-object',
  all.filter((o) => !o.isCustom && o.rule !== 'standard-object').length, 0);

console.log('\nBusiness anchoring');
check('transaction codes', graph.transactions.length, 31);
check('tcodes on custom programs',
  graph.transactions.filter((t) => graph.objects.get(t.program)?.isCustom).length, 21);
check('custom reachable from a tcode', custom.filter((o) => o.tcodeReachable).length, 43);

console.log('\nEntanglement');
check('custom -> standard Write edges',
  graph.edges.filter((e) => e.type === 'Write' &&
    graph.objects.get(e.from)?.isCustom && graph.objects.get(e.to)?.namespace === 'Standard').length, 7);
check('standard -> custom edges',
  graph.edges.filter((e) => graph.objects.get(e.from)?.namespace === 'Standard' &&
    graph.objects.get(e.to)?.isCustom).length, 0);

console.log('\nIntegrity');
check('phantom objects (referenced, not in inventory)', graph.phantoms.length, 3);
for (const p of graph.phantoms) console.log(`        ${p.name} — seen in ${p.sources.join(', ')}`);

console.log('\nDispositions');
check('every custom object has a disposition',
  custom.filter((o) => o.disposition).length, custom.length);
// 7 write edges, but only 6 distinct objects: ZFI_MASS_REVERSAL writes to two
// standard tables. Worth keeping both numbers straight — "7 objects" would be
// wrong in the room.
check('remediate = distinct clean-core write blockers',
  custom.filter((o) => o.proposed === DISPOSITION.REMEDIATE).length, 6);
check('retire', custom.filter((o) => o.proposed === DISPOSITION.RETIRE).length, 13);
check('rebuild', custom.filter((o) => o.proposed === DISPOSITION.REBUILD).length, 5);
check('investigate', custom.filter((o) => o.proposed === DISPOSITION.INVESTIGATE).length, 34);
check('retain', custom.filter((o) => o.proposed === DISPOSITION.RETAIN).length, 48);

// The one promise this engine makes. disposeAll throws if a rule breaks it, so
// reaching this line already proves it — asserted anyway so the guarantee shows
// up in the output rather than being implied by the absence of a crash.
console.log('\nThe retirement guarantee');
check('nothing retired on inferred or unmeasured evidence',
  custom.filter((o) => o.proposed === DISPOSITION.RETIRE &&
    !['structural', 'measured'].includes(o.basis)).length, 0);
check('no object without a usage row is ever retired',
  custom.filter((o) => o.proposed === DISPOSITION.RETIRE &&
    o.evidence === EVIDENCE.UNMEASURED).length, 0);

console.log('\nDecision packages');
const packs = buildPackages(graph, rules, narrative);
for (const p of packs) {
  console.log(`        ${p.id.padEnd(23)} ${String(p.count).padStart(3)} objects · ${p.basis.padEnd(10)} · ${p.confidence.padEnd(6)} confidence · ${DISPOSITION_LABEL[p.proposed]}`);
}
check('decisions', packs.length, 11);
check('every custom object lands in exactly one package',
  packs.reduce((sum, p) => sum + p.count, 0), custom.length);
check('every package has narrative', packs.filter((p) => p.headline && p.decision).length, packs.length);
check('all 18 custom tables stay in the tables package',
  packs.find((p) => p.id === 'tables').count, 18);
check('clean-core rests on structural evidence',
  packs.find((p) => p.id === 'clean-core').basis, 'structural');

// The transition type is the only control on the page, so what it is allowed to
// do is asserted rather than trusted: it may re-call a decision, but it may not
// invent a disposition, name a package that does not exist, change a call
// without saying why, or lose an object on the way.
console.log('\nTransition lens');
const callFor = (pack, lens) => callForLens(lens, pack.id)?.call ?? pack.proposed;
const packageIds = new Set(packs.map((p) => p.id));
const dispositions = new Set(Object.values(DISPOSITION));
let badOverrides = 0;
let overrideCount = 0;
for (const lens of Object.values(LENSES)) {
  for (const [id, entry] of Object.entries(lens.calls ?? {})) {
    overrideCount += 1;
    if (!packageIds.has(id)) { badOverrides += 1; console.log(`        unknown package "${id}" in ${lens.id}`); }
    if (!dispositions.has(entry.call)) { badOverrides += 1; console.log(`        invalid call "${entry.call}" in ${lens.id}`); }
    if (!entry.why || entry.why.length < 40) { badOverrides += 1; console.log(`        missing or thin reason in ${lens.id}/${id}`); }
  }
}
check('every override names a real package, a real call and a reason', badOverrides, 0);
check('overrides across all four paths', overrideCount, 7);

const CALL_ORDER = [DISPOSITION.REMEDIATE, DISPOSITION.RETIRE, DISPOSITION.REBUILD, DISPOSITION.INVESTIGATE, DISPOSITION.RETAIN];
const EXPECTED = {
  undecided: { remediate: 6, retire: 13, rebuild: 5, investigate: 31, retain: 51 },
  brownfield: { remediate: 6, retire: 13, rebuild: 0, investigate: 31, retain: 56 },
  greenfield: { remediate: 0, retire: 23, rebuild: 62, investigate: 21, retain: 0 },
  selective: { remediate: 6, retire: 13, rebuild: 5, investigate: 49, retain: 33 },
};

console.log(`\n        ${'path'.padEnd(26)}${CALL_ORDER.map((c) => c.padStart(13)).join('')}${'total'.padStart(8)}`);
for (const lens of Object.keys(LENSES)) {
  const tally = Object.fromEntries(CALL_ORDER.map((c) => [c, 0]));
  for (const p of packs) tally[callFor(p, lens)] += p.count;
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  console.log(`        ${LENSES[lens].label.padEnd(26)}${CALL_ORDER.map((c) => String(tally[c]).padStart(13)).join('')}${String(total).padStart(8)}`);
}
for (const lens of Object.keys(LENSES)) {
  const tally = Object.fromEntries(CALL_ORDER.map((c) => [c, 0]));
  for (const p of packs) tally[callFor(p, lens)] += p.count;
  for (const c of CALL_ORDER) check(`${lens} · ${c}`, tally[c], EXPECTED[lens][c]);
  check(`${lens} · covers the whole custom estate`,
    Object.values(tally).reduce((a, b) => a + b, 0), custom.length);
}

// Assumption 5 is a switch, not a branch: flipping it must re-score without
// touching code. If this ever needs an edit elsewhere, the seam has leaked.
console.log('\nAssumption 5 switch');
const asDead = { ...rules, unmeasuredMeans: 'dead' };
disposeAll(graph, asDead);
const deadPacks = buildPackages(graph, asDead, narrative);
console.log(`        not_measured: ${packs.length} decisions · dead: ${deadPacks.length} decisions`);
check('flipping the switch changes the packaging', deadPacks.length !== packs.length, true);
check('still covers every custom object',
  deadPacks.reduce((sum, p) => sum + p.count, 0), custom.length);
check('and still retires nothing on unmeasured evidence',
  custom.filter((o) => o.proposed === DISPOSITION.RETIRE &&
    !['structural', 'measured'].includes(o.basis)).length, 0);
disposeAll(graph, rules);

console.log('\nCoverage by type (custom only)');
for (const row of coverageByType(graph, { customOnly: true })) {
  console.log(`        ${row.type.padEnd(18)} ${row.total} total · ${row[EVIDENCE.ACTIVE]} active · ${row[EVIDENCE.DEAD]} dead · ${row[EVIDENCE.UNMEASURED]} unmeasured · ${row[EVIDENCE.UNMEASURABLE]} unmeasurable`);
}

console.log(`\nobserved at: ${graph.observedAt}`);
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
