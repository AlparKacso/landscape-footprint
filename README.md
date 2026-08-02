# Landscape Footprint

An opinionated, decision-oriented view of one SAP ECC productive system, built from a four-file
metadata extract.

Celonis product challenge — *Sr. Applications Product Manager, AI System Transformation*.
Alpár Kacsó, July 2026.

**→ [alparkacso.github.io/landscape-footprint](https://alparkacso.github.io/landscape-footprint/)** — opens the prototype directly.

The four written deliverables are alongside it:
[Increment Breakdown](https://alparkacso.github.io/landscape-footprint/1_Increment_Breakdown.html) ·
[Deployment Design](https://alparkacso.github.io/landscape-footprint/2_Deployment_Design.html) ·
[Build Log](https://alparkacso.github.io/landscape-footprint/3_Build_Log.html) ·
[Handbook](https://alparkacso.github.io/landscape-footprint/4_Handbook.html)

## What it does

366 objects and 326 dependencies become **11 decisions** covering all 106 custom objects. A
transformation lead cannot fund a list of 106 line items; they can fund eleven calls.

The position it arrives at: **24 of 106 custom objects have an action against them today** — 13 to
retire, 6 to remediate, 5 into a fit-to-standard workshop. **34 are held** for a named piece of
evidence rather than guessed at. Two numbers, not one: what you act on now, and what it costs to
decide the rest.

The spine is an evidence model with **four states, not two** — ran, measured and did not run, never
measured, and cannot be measured. Collapsing the last two into "unused" is the fastest way to
produce a confident, wrong retirement list.

One guarantee holds the whole thing up: **nothing is ever retired on evidence weaker than a
measurement.** It is enforced at run time rather than left to the reader as a setting.

## Layout

```
index.html               redirect straight into the app
prototype/               the app — no build step, no dependencies, no network calls
  index.html app.css     Extract Wizard + Landscape Footprint
  handbook.html          visual walkthrough
  data/                  the four CSVs shipped with the challenge
  src/core/              adapters in, canonical Context Slice out
  src/engine/            rulepack + scoring + dispositions, runs headless
  src/workspace/         the two pages, the treemap, the inventory, the drawer, the assistant
  tools/check.mjs        re-derives every headline number from the raw files
1_Increment_Breakdown.html
2_Deployment_Design.html
3_Build_Log.html
4_Handbook.html
```

## Run it locally

```bash
python3 prototype/tools/serve.py 8010 prototype
```

Then open <http://localhost:8010>. Opening `prototype/index.html` from the filesystem does not work —
browsers block both `fetch` and ES modules on a `file://` origin — which is why it is served here.
On macOS, `prototype/run.command` starts a server and opens a browser for you.

Verify the numbers independently, without the interface:

```bash
node prototype/tools/check.mjs
```

More detail in [`prototype/README.md`](prototype/README.md).

## Where the AI sits, and where it does not

Every score, call and grouping comes from `prototype/src/engine/rulepack.json`. They are
deterministic and replayable, so "why does it say retire?" has an answer made of the customer's own
rows.

A model writes words, and only words: the headline and decision sentence per decision, and the
assistant that reads either page back to you at the register you choose. Everything it wrote is
marked with what it was written *from*, and the assistant is composed from live state each time it
opens rather than cached — so it can never describe a position the page is not showing.

## Deploying

Published with GitHub Pages from `main` at `/ (root)`. **Nothing is automatic** — there are no
hooks and no CI, so a local edit is not live until it is pushed. Only the Pages rebuild is
automatic, and it takes about a minute after a commit lands.

```bash
node prototype/tools/check.mjs        # must pass before anything ships
git add -A && git commit -m "…"
git push origin main
```

Then check the **live URL**, not localhost — `fetch` behaves differently on a `file://` origin, and
the "this page needs a local server" notice only removes itself when the CSVs actually load.

Two things worth knowing before touching the remote:

- The remote is **HTTPS on purpose**. This machine's SSH key authenticates as a different GitHub
  account, so an SSH remote would be rejected. The macOS keychain holds the right HTTPS credential.
- Git identity is set **per-repo**, not globally.

## Not in this repo

The candidate brief and the screenshots of the Celonis tenant used to sample the design tokens are
deliberately excluded — the tokens live in `prototype/app.css`, which is the only part of them that
needed to survive. The four CSVs are the synthetic, anonymised extract provided with the challenge.
