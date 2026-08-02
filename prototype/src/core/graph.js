// Builds the Context Slice: the canonical, source-agnostic graph that every
// downstream component reads. The CSV shapes stop here — engine/ and
// workspace/ never see a raw row, which is what lets a different adapter
// (Readiness Check, Custom Code Migration, another customer) feed the same
// pipeline, and what lets this later be replaced by a real Context Model.

const V2_SUFFIX = '_V2';

function reachableFrom(seeds, adjacency) {
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const node = stack.pop();
    for (const next of adjacency.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

export function buildGraph(extract) {
  const objects = new Map();
  for (const row of extract.objects) {
    objects.set(row.object_name, {
      name: row.object_name,
      type: row.object_type,
      package: row.package,
      namespace: row.namespace,
      isCustom: row.namespace === 'Custom',
      createdDate: row.created_date,
      lastChangedDate: row.last_changed_date,
      developerId: row.developer_id,
    });
  }

  // --- integrity: names the rest of the extract references but the inventory
  // does not contain. These are findings, not parse errors, so they are kept
  // as first-class output rather than silently dropped.
  const phantoms = new Map();
  const notePhantom = (name, source) => {
    if (!name || objects.has(name)) return;
    if (!phantoms.has(name)) phantoms.set(name, { name, sources: new Set() });
    phantoms.get(name).sources.add(source);
  };

  const edges = [];
  const forward = new Map();
  const reverse = new Map();
  const link = (map, from, to) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from).add(to);
  };

  for (const row of extract.dependencies) {
    const from = row.caller_object;
    const to = row.target_object;
    notePhantom(from, 'dependencies');
    notePhantom(to, 'dependencies');
    edges.push({ from, to, type: row.access_type });
    link(forward, from, to);
    link(reverse, to, from);
  }

  const transactions = extract.transactions.map((row) => {
    notePhantom(row.program_name, 'transactions');
    return {
      code: row.transaction_code,
      program: row.program_name,
      description: row.description,
    };
  });

  for (const row of extract.usage) notePhantom(row.object_name, 'usage');

  // --- business anchoring: which objects the business can actually reach.
  // Seeds are the programs behind transaction codes; everything transitively
  // touched from there is anchored to a business entry point.
  const entryPoints = new Set(
    transactions.map((t) => t.program).filter((p) => objects.has(p))
  );
  const tcodeReachable = reachableFrom(entryPoints, forward);
  for (const seed of entryPoints) tcodeReachable.add(seed);

  // --- per-object derived signals
  for (const [name, object] of objects) {
    const callers = [...(reverse.get(name) ?? [])];
    const targets = [...(forward.get(name) ?? [])];
    object.callers = callers;
    object.targets = targets;
    object.fanIn = callers.length;
    object.fanOut = targets.length;
    object.tcodeDirect = entryPoints.has(name);
    object.tcodeReachable = tcodeReachable.has(name);

    // Blast radius: everything that transitively depends on this object, i.e.
    // what you would have to touch if it changed or went away.
    object.blastRadius = [...reachableFrom([name], reverse)];

    // Tables carry no execution semantics, so their evidence comes from how
    // they are accessed instead. Collected here so evidence.js can route them.
    if (object.type === 'Table') {
      object.readers = edges.filter((e) => e.to === name && e.type === 'Read').map((e) => e.from);
      object.writers = edges.filter((e) => e.to === name && e.type === 'Write').map((e) => e.from);
    }

    // Clean-core blockers: custom code writing into standard objects.
    object.writesStandard = edges
      .filter((e) => e.from === name && e.type === 'Write')
      .map((e) => e.to)
      .filter((t) => objects.get(t)?.namespace === 'Standard');
  }

  // --- version forks. A _V2 alongside its base is a decision, not a detail:
  // both may still be live, and migrating either without resolving the fork
  // carries the fork into S/4.
  for (const [name, object] of objects) {
    if (!name.endsWith(V2_SUFFIX)) continue;
    const base = name.slice(0, -V2_SUFFIX.length);
    if (!objects.has(base)) continue;
    object.forkPartner = base;
    object.forkRole = 'successor';
    objects.get(base).forkPartner = name;
    objects.get(base).forkRole = 'predecessor';
  }

  const transactionsByProgram = new Map();
  for (const t of transactions) {
    if (!transactionsByProgram.has(t.program)) transactionsByProgram.set(t.program, []);
    transactionsByProgram.get(t.program).push(t);
  }

  return {
    objects,
    edges,
    transactions,
    transactionsByProgram,
    entryPoints,
    phantoms: [...phantoms.values()].map((p) => ({ ...p, sources: [...p.sources] })),
  };
}
