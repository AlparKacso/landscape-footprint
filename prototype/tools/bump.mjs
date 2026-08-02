// Bump every module version in index.html. Run: node tools/bump.mjs
//
// Not a build step — the shipped artifact is still plain files a browser reads
// directly, and this changes one number in one file. It exists because that
// number now appears thirteen times (an import map entry per module, plus the
// entry script), and thirteen hand-edits that must agree is precisely the kind
// of thing that agrees twelve times out of thirteen at the worst moment.
//
// Why the versions matter at all: GitHub Pages caches each file for ten minutes
// independently. Without them a visitor can hold a new page beside a stale
// module — cosmetically that is yesterday's wording, and at worst it is a
// module missing an export the new code imports, which throws before any error
// handler exists and leaves a blank page.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const html = readFileSync(file, 'utf8');

const found = [...html.matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]));
if (!found.length) {
  console.error('No ?v= markers found in index.html — has the import map been removed?');
  process.exit(1);
}

const current = Math.max(...found);
const next = Number(process.argv[2]) || current + 1;

if (new Set(found).size > 1) {
  console.log(`  note: versions were out of step (${[...new Set(found)].join(', ')}) — realigning all of them.`);
}

writeFileSync(file, html.replace(/\?v=\d+/g, `?v=${next}`));
console.log(`  ${found.length} module versions: ${current} -> ${next}`);
console.log('  Commit and push; Pages rebuilds in about a minute.');
