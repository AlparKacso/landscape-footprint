// Regenerates data/packages.json — the narrative layer, and the only
// AI-authored artifact in this prototype.
//
// Run: ANTHROPIC_API_KEY=... node tools/generate-packages.mjs
//
// What the model is and is not allowed to do here matters more than the code.
// It receives packages that have ALREADY been formed and scored by the
// rulepack, together with the facts behind them, and it writes prose. It does
// not decide membership, it does not score, and it does not choose a
// disposition. If it did, no one in a steering room could audit the result —
// and "why does it say retire?" would have no answer except "the model said so".
//
// Output is written to disk and committed. The running prototype reads the
// cached file and never calls an API, so the demo cannot be broken by a
// network failure or a rate limit.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCsv } from '../src/core/parse.js';
import { buildGraph } from '../src/core/graph.js';
import { attachEvidence } from '../src/core/evidence.js';
import { scoreAll } from '../src/engine/score.js';
import { disposeAll } from '../src/engine/dispose.js';
import { buildPackages } from '../src/engine/packages.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => parseCsv(readFileSync(join(root, 'data', f), 'utf8'));

const extract = {
  objects: read('objects.csv'),
  usage: read('usage.csv'),
  dependencies: read('dependencies.csv'),
  transactions: read('transactions.csv'),
};
const rules = JSON.parse(readFileSync(join(root, 'src/engine/rulepack.json'), 'utf8'));

const graph = buildGraph(extract);
attachEvidence(graph, extract);
scoreAll(graph, rules);
disposeAll(graph, rules);
const packages = buildPackages(graph, rules);

// Only the facts. No hints about what we would like it to conclude.
const brief = packages.map((p) => ({
  id: p.id,
  title: p.title,
  count: p.count,
  proposedDisposition: p.proposed,
  evidenceBasis: p.basis,
  objectsBehindTransactionCodes: p.tcodes,
  transitiveDependents: p.blastRadius,
  members: p.objects.map((o) => ({
    name: o.name,
    type: o.type,
    package: o.package,
    evidence: o.evidence,
    executionsPerMonth: o.usage?.executions ?? null,
    distinctUsers: o.usage?.users ?? null,
    behindTransactionCode: o.tcodeDirect,
    writesToStandard: o.writesStandard,
    versionForkPartner: o.forkPartner ?? null,
    rule: o.rule,
  })),
}));

const SYSTEM = `You write for a Head of Transformation opening an S/4HANA programme.

For each decision package you are given, return three fields:
- headline: what is true, with the specific numbers from the data. Two sentences at most.
- decision: what they are being asked to decide. One sentence, imperative.
- watchOut: the thing that would make this conclusion wrong, or the second-order consequence a technical read would miss. One or two sentences.

Rules you must not break:
- Use only the numbers provided. Never estimate, round misleadingly, or invent a figure.
- Never state or imply a disposition other than the proposedDisposition given.
- Where evidence is thin, say so plainly. Confidence you have not earned is the fastest way to lose the room.
- No vendor language. No "solution". No "leverage". Short sentences.

Return a JSON object keyed by package id, each value having exactly the keys headline, decision, watchOut, urgency. urgency is one of "Act now", "Now", "Next", "Later".`;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. The cached data/packages.json is already valid —');
  console.error('regeneration is only needed if the packages themselves changed.');
  process.exit(1);
}

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-opus-5',
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(brief, null, 2) }],
  }),
});

if (!res.ok) {
  console.error(`API returned ${res.status}. Cached narrative left untouched.`);
  process.exit(1);
}

const body = await res.json();
const text = body.content.map((c) => c.text ?? '').join('');
const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

const existing = JSON.parse(readFileSync(join(root, 'data/packages.json'), 'utf8'));
writeFileSync(
  join(root, 'data/packages.json'),
  JSON.stringify({ ...existing, ...json, _meta: { ...existing._meta, generatedAt: new Date().toISOString().slice(0, 10) } }, null, 2)
);
console.log(`Rewrote narrative for ${Object.keys(json).length} packages.`);
