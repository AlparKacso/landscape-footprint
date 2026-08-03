# Landscape Footprint

An opinionated, decision-oriented view of one ECC productive system, built from a four-file metadata extract.

Celonis product challenge — *Sr. Applications Product Manager, AI System Transformation*.
Alpár Kacsó, July 2026.

## Run it

Double-click `prototype/run.command`, or:

```bash
python3 prototype/tools/serve.py 8010 prototype
```

Use `serve.py` rather than `python3 -m http.server`: it sends `no-store` on every
response. The stock module sends no cache headers at all, so a browser can serve a
stale `app.js` or `rulepack.json` after an edit — which during a live demo looks
exactly like a change that did not work.

Then open <http://localhost:8010>. No install, no build step, no network.

**Opening `index.html` directly does not work**, and that is a browser rule rather than a bug here: on a `file://` origin browsers block both `fetch` and ES modules, so the page cannot read the CSVs or even run its own code. It will tell you so on screen if you try. `run.command` starts a static server, picks a free port if 8010 is taken, and opens the browser for you.

Verify the numbers independently:

```bash
node prototype/tools/check.mjs
```

The visual walkthrough — pipeline, evidence model, controls and stack — is `handbook.html`, at <http://localhost:8010/handbook.html> once the server is up. It opens standalone from the filesystem too.

## What it does

366 objects and 326 dependencies become **11 decisions** covering all 106 custom objects. A transformation lead cannot fund a list of 106 line items; they can fund eleven calls.

The position it arrives at: **24 of 106 custom objects have an action against them today** — 13 to retire, 6 to remediate, 5 into a fit-to-standard workshop. **31 are held** for a named piece of evidence rather than guessed at, and 51 carry forward untouched. Two numbers, not one: what you act on now, and what it costs to decide the rest.

The decision is the unit throughout. There is no per-object browser: a list of 106 rows is the thing this exists to replace, and putting one back beside the decisions invites re-litigating the grouping one object at a time. Every object is still reachable — inside the decision that funds it, where it has a reason attached.

The spine is an evidence model with **four states, not two**:

| State | Meaning |
|---|---|
| `measured-active` | Ran, with a number attached |
| `measured-dead` | Measured, and it did not run — an observation |
| `unmeasured` | No usage row — we do not know, and we can name what would tell us |
| `unmeasurable` | Tables: execution semantics do not apply at all |

Collapsing the last two into "unused" is the fastest way to produce a confident, wrong retirement list. 175 of 366 objects have no usage row; 32 more are tables that `usage.csv` cannot cover by construction. Both are shown on the face of the output rather than in a footnote.

## The Context Slice page

**Load → How this is computed → Coverage → Scope.**

- **Load** — files matched to adapters by column signature, not filename, as they arrive. What each file matched on and what it will be used as are both on the row, and either can be corrected there. The matching is not a judgement anyone needs to make twice, so there is no confirmation screen.
- **How this is computed** — the boundary, stated exhaustively: everything that decides is deterministic, and the Discovery Agent writes words in exactly three named places.
- **Coverage** — the four evidence states across the whole extract, the custom estate and the standard estate.
- **Scope** — six tiles, each opening onto the rows behind it.

This was a three-step wizard — load, then the rules deciding, then where the agent writes. It was the most-built and least-differentiating thing here: Celonis's ability to ingest and compute data is the one claim nobody in the room doubts, so walking it cost minutes from a ten-minute demo and bought nothing. What the middle steps showed is still reachable, in the place someone actually asks for it — every call carries its named rule and its rationale inside the decision modal.

## What it deliberately does not do

A risk dial, a per-object browser, on-screen risk scores, effort estimates in days, a picture of all
366 objects at once, and a walkthrough of the pipeline. Most were built and then
removed; each removal is recorded with its reason in
[`3_Build_Log.html`](../3_Build_Log.html) and in the handbook's *What it does not do*.

## Three components

Each runs standalone given correctly-shaped data.

```
src/core/      Adapters in, canonical Context Slice out.
               Nothing downstream sees a CSV row. This is the socket the
               Context Model plugs into: swap the adapter and the same
               pipeline runs on Readiness Check or Custom Code Migration
               output, or on the Context Model itself.

src/engine/    rulepack.json + scoring + dispositions. Runs headless.
               Every score carries the signals that produced it.

src/workspace/ The two pages. Renders engine output; holds no opinions.
               treemap.js draws the position, subgraph.js one blast radius,
               assistant.js the model-written explanation of either page.
```

## What this is a slice of

The footprint runs on the Context Model. This prototype does not include one — it builds its own
minimal Context Slice from four CSVs, because at a net-new account there is no Celonis environment
to read from yet. That is the point rather than a limitation: **the technical layer of a Context
Model is the cheapest thing to seed first, and this is what you get the moment it exists.** The
analysis runs on an extract; the capability runs on the Context Model.

`src/core/` is where the two meet. Everything above it — the evidence model, the rulepack, the
decisions, the interface — is indifferent to which side is feeding it.

## Where the AI sits — and does not

Every score and disposition comes from `src/engine/rulepack.json`. They are deterministic and replayable, so "why does it say retire?" has an answer made of the customer's own rows.

A model writes words, and only words. Three places, all labelled wherever they appear:

- `data/packages.json` — the headline, decision and watch-out per decision. Cached to disk on purpose: a live API call inside a seven-minute pitch is a single point of failure for no benefit. Regenerate with `node tools/generate-packages.mjs`.
- `src/workspace/assistant.js` — the **Discovery Agent**, behind *Ask the Discovery Agent*. It reads either page back to you at the register you pick: for the board, for the programme, or for the engineer. Same content, different audience; it is not a verbosity dial, because nobody knows which verbosity they are. Each *what this did for you* closes on a highlighted line saying what it is worth in value-discovery terms.
- `positionStatement()` in `src/workspace/app.js` — the sentence at the top of the Position card. Clause structure and connective wording are the model's; the clauses drop out when a count is zero, and every figure is read from the graph. It carries the mark for the same reason the other two do: it is prose making a claim about the customer's estate.

The Discovery Agent is **composed from live state every time it opens**, never cached whole. A summary describing the neutral position while the page showed a greenfield reading would destroy the credibility of both — so the phrasing is model-written and kept in the file, and every number in it is read from the graph at the moment you open it.

Everything the agent wrote carries the mark **Discovery Agent generated insight**, plus a line saying what it was written *from*. A disclaimer says "do not sue us"; provenance says "here is what to check", which is the only version worth putting in front of someone about to fund something.

## The one control

**Transition type** shows the same evidence read four ways, and it is the only control on the page. It does two things: it reorders, and where the path genuinely changes what you would do, it changes the call — with the sentence that justifies the change shown in the decision.

| Path | Remediate | Retire | Workshop | Investigate | Carry |
|---|---|---|---|---|---|
| No path assumed | 6 | 13 | 5 | 31 | 51 |
| Brownfield conversion | 6 | 13 | 0 | 31 | 56 |
| Greenfield build | 0 | 23 | 62 | 21 | 0 |
| Selective data transition | 6 | 13 | 5 | 49 | 33 |

Same six objects writing into standard tables: the hard gate of a brownfield conversion, and on a greenfield build not a defect at all but a specification for the thing you are about to build. A footprint that had quietly assumed a path would have shown one of those answers and hidden the other. The transition type is not settled at this customer (working assumption 4), so the footprint does not assume one.

## Nothing is retired on weak evidence

Every rule declares the evidence **basis** it rests on, and **Retire is only reachable from a rule resting on a structural fact or an actual measurement**. A rule built on inference or on absence proposes Investigate instead, and names what would settle it. `disposeAll` throws if a rule breaks that, so it cannot be lost in a live edit.

That is a property of the tool rather than a setting to find. An earlier version gated the weak-evidence rules behind a 0–100 risk-tolerance dial — same default output, but it put a control in the room that could be turned up until the tool recommended deleting things nobody had measured. A dial like that is not a safeguard.

## Everything is a rulepack edit

`src/engine/rulepack.json` holds every weight, threshold and switch. Change a number, refresh the page. No rebuild.

`unmeasuredMeans` is the one that matters: flip it from `not_measured` to `dead` and the whole estate re-scores, and 11 decisions fold into 8. That is working assumption 5, still open with the customer, built as a switch rather than a branch so the answer costs a string change.

It is deliberately not a control in the interface. It is a question for the customer's team, not a setting for the reader to guess at — and the boundary card and the coverage strip both state the assumption on the face of the output.
