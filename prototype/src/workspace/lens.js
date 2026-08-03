// The transition lens — the one lever on the page.
//
// Working assumption 4: the transition type is not settled, and if a direction
// has been stated it was probably a partner's default rather than an
// evidence-based choice. So the footprint does not pick one. It shows the same
// evidence read three ways and lets the consequences of each argue.
//
// The lens does two things. It reorders — what the chosen path makes urgent
// floats up — and, where the path genuinely changes what you would do about a
// package, it changes the call. That second part matters: the clean-core write
// blockers are the hard gate of a brownfield conversion and, on a greenfield
// build, not a defect at all. Same six objects, same seven write paths, and on
// one path they are a remediation backlog while on the other they are a
// requirements list. A footprint that only reordered would have shown the same
// badge for both and hidden the more interesting half.
//
// Every override carries the sentence that justifies it. It appears in the
// modal at The call, never in the list — the badge changing is signal enough
// there, and the section note already names the active path.

export const LENSES = {
  undecided: {
    id: 'undecided',
    label: 'No path assumed',
    blurb: 'Everything the extract supports, unweighted by a transition decision.',
    note: 'The transition type is not settled. Until it is, this is the neutral reading — every decision sized on its own evidence.',
    roles: {},
    calls: {},
  },

  brownfield: {
    id: 'brownfield',
    label: 'Brownfield conversion',
    blurb: 'Convert the existing system in place.',
    note: 'Conversion carries the estate forward, so everything you do not retire, you convert and then own. Retirement is the cheapest work available and the write blockers are the hard gate.',
    calls: {
      workshop: {
        call: 'retain',
        why: 'Conversion carries these forward as they are. They still run on the other side, so the fit-to-standard question is real but it is not on the critical path — it waits until after go-live.',
      },
    },
    roles: {
      'clean-core': ['critical', 'Must be remediated before conversion. These write paths are what a clean core means in practice.'],
      'dead-clear': ['critical', 'Retire before conversion — every object removed here is one you never pay to convert, test or own.'],
      'fork-superseded': ['critical', 'Retire the predecessor now; converting both sides doubles the work for nothing.'],
      'fork-live': ['critical', 'Resolve first. Converting an unresolved fork carries it into S/4 permanently.'],
      'migration-residue': ['deferred', 'Measure during the conversion prep window; retire in the same wave.'],
      'workshop': ['deferred', 'Conversion carries these as-is. The fit-to-standard question can wait until after go-live.'],
      'tables': ['deferred', 'Converted with the system. Row counts still matter for the runtime, not for the decision.'],
      'carry': ['deferred', 'Converts with everything else. No action.'],
    },
  },

  greenfield: {
    id: 'greenfield',
    label: 'Greenfield build',
    blurb: 'Build new; nothing is converted.',
    note: 'Nothing is carried over, so anything unused dies for free — but everything the business genuinely relies on has to be rebuilt or replaced by standard. The write blockers stop being a problem and become a specification.',
    calls: {
      'clean-core': {
        call: 'rebuild',
        why: 'Nothing is converted, so there is no core to keep clean and nothing to remediate. But these seven write paths describe behaviour the business depends on today — read them as requirements for the build, not as defects.',
      },
      carry: {
        call: 'rebuild',
        why: 'Measurably used, and nothing carries it over for you. Every one of these is a build, buy or drop decision — which is what makes greenfield the path where unglamorous batch and interface code turns into scope.',
      },
      tables: {
        call: 'rebuild',
        why: 'Custom data structures have no home unless you build one. What each table is for has to be settled before anyone decides whether the data moves.',
      },
      'migration-residue': {
        call: 'retire',
        why: 'Dies with the old system at no cost. This is the one path where the measurement you do not have stops being needed — nobody has to fund SCMON to decide about it.',
      },
      'unmeasured-candidates': {
        call: 'retire',
        why: 'Dies with the old system at no cost. Not rebuilding something is free; deleting it from a converted system is not.',
      },
    },
    roles: {
      'clean-core': ['moot', 'Nothing is converted, so there is no core to keep clean. But these seven write paths describe behaviour the business depends on — read them as requirements, not defects.'],
      'workshop': ['critical', 'This is the real scope. Every one of these is behind a transaction code and must exist on the other side.'],
      'fork-live': ['critical', 'Decide which side of each fork is the requirement before anyone builds either.'],
      'carry': ['critical', 'Used, and nothing carries it over for you. Each one is build, buy or drop.'],
      'dead-clear': ['moot', 'Dies with the old system at no cost. No retirement project needed.'],
      'fork-superseded': ['moot', 'Dies with the old system.'],
      'migration-residue': ['moot', 'Dies with the old system — the cheapest possible outcome for it.'],
      'unmeasured-candidates': ['moot', 'Dies with the old system.'],
      'tables': ['critical', 'Custom data structures have no home unless you build one. Decide what the data is for before deciding whether it moves.'],
    },
  },

  selective: {
    id: 'selective',
    label: 'Selective data transition',
    blurb: 'Move chosen data slices into a new system.',
    note: 'The unit of decision is the data slice, not the object. Tables become the pivot — and they are precisely the objects usage.csv cannot see, so this path leans hardest on the evidence you do not yet have.',
    calls: {
      tables: {
        call: 'investigate',
        why: 'On this path the tables stop being infrastructure and become the decision. Eighteen custom tables determine what a slice actually contains, and not one of them has usage evidence — so the first move is measurement, not migration.',
      },
    },
    roles: {
      'tables': ['critical', 'The pivot. Eighteen custom tables decide what a slice actually contains, and none of them has usage evidence.'],
      'clean-core': ['critical', 'Objects writing into standard documents determine which slices can be cut apart at all.'],
      'carry': ['critical', 'Batch and interface code follows the data. Which slice each belongs to is the open question.'],
      'fork-live': ['deferred', 'Resolve per slice as each one is scoped.'],
      'dead-clear': ['deferred', 'Excluded from every slice by definition. Retire on the old system at leisure.'],
      'workshop': ['deferred', 'Scoped slice by slice rather than all at once.'],
      'migration-residue': ['deferred', 'Excluded from slices; retire in place.'],
    },
  },
};

// Each label carries a verb and a direction, because the reader is deciding
// what to do next rather than classifying anything. "Deferred" was the weak
// one — an adjective with no time and no action in it, which left a Head of
// Transformation reading a status instead of an instruction. The arrow says
// which way the route moved this decision; the word says what to do about it.
// "Falls away" takes a different mark on purpose: it is not lower priority,
// it is gone.
export const ROLE_LABEL = {
  critical: '↑ Do first',
  deferred: '↓ Later',
  moot: '⊘ Falls away',
};

export function roleFor(lens, packageId) {
  const entry = LENSES[lens]?.roles?.[packageId];
  if (!entry) return { role: null, note: null };
  return { role: entry[0], note: entry[1] };
}

// What this path does to the call, if anything. Returns null when the path
// leaves the rules' proposal standing, which is the common case — only seven
// of the forty-four package/path combinations move.
export function callForLens(lens, packageId) {
  return LENSES[lens]?.calls?.[packageId] ?? null;
}

// Ordering follows the lens: what the chosen path makes urgent floats up.
export function sortForLens(packages, lens) {
  const rank = { critical: 0, deferred: 2, moot: 3 };
  return [...packages].sort((a, b) => {
    const ra = rank[roleFor(lens, a.id).role] ?? 1;
    const rb = rank[roleFor(lens, b.id).role] ?? 1;
    if (ra !== rb) return ra - rb;
    if (a.evidenceRank !== b.evidenceRank) return a.evidenceRank - b.evidenceRank;
    return b.maxRisk - a.maxRisk;
  });
}
