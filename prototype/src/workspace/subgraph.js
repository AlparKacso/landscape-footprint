// Blast-radius subgraph.
//
// The whole estate is 366 nodes and 326 edges. Drawn at once that is a
// hairball — pretty, inert, and exactly the "data mapping" picture this
// capability is meant to be distinguished from. So the graph is never the
// landing view. It appears only here, scoped to one decision, answering one
// question: if we act on this package, what else moves?
//
// Deterministic layered layout rather than a force simulation. Two reasons:
// no dependency to vendor, and no jitter — the picture is identical every time
// it opens, which matters when you are demoing it live.

// Wide enough that a 20-character ABAP name fits outside its column without
// clipping — SAP object names are long and a truncated one is useless.
const WIDTH = 880;
const PAD = 26;
const SIDE_INSET = 150;
const MEMBER_CAP = 16;
const SIDE_CAP = 9;
const ROW = 22;

export function renderSubgraph(pack, graph) {
  const members = pack.objects.map((o) => o.name);
  const memberSet = new Set(members);

  // Dependents (who calls into the package) and dependencies (what it touches).
  const dependents = new Set();
  const dependencies = new Set();
  for (const edge of graph.edges) {
    if (memberSet.has(edge.to) && !memberSet.has(edge.from)) dependents.add(edge.from);
    if (memberSet.has(edge.from) && !memberSet.has(edge.to)) dependencies.add(edge.to);
  }

  // Members are the decision; the side columns are context. When space runs
  // out it is the context that gets trimmed, never the thing being decided —
  // a picture that hides two of the six objects you are talking about is worse
  // than no picture.
  // Write edges are never trimmed. For the clean-core package they are the
  // entire finding — a picture that drops three of seven write paths would
  // understate the thing it exists to show.
  const writeLinked = new Set(
    graph.edges
      .filter((e) => e.type === 'Write' && (memberSet.has(e.from) || memberSet.has(e.to)))
      .flatMap((e) => [e.from, e.to])
      .filter((n) => !memberSet.has(n))
  );
  const rank = (name) =>
    (writeLinked.has(name) ? -1e6 : 0) - (graph.objects.get(name)?.blastRadius?.length ?? 0);
  const take = (set, n) =>
    [...set].sort((a, b) => rank(a) - rank(b)).slice(0, Math.max(n, [...set].filter((x) => writeLinked.has(x)).length));

  const shownMembers = members.slice(0, MEMBER_CAP);
  const shownIn = take(dependents, SIDE_CAP);
  const shownOut = take(dependencies, SIDE_CAP);
  const shownSet = new Set([...shownMembers, ...shownIn, ...shownOut]);

  const hidden = [
    members.length - shownMembers.length && `${members.length - shownMembers.length} member(s)`,
    dependents.size - shownIn.length && `${dependents.size - shownIn.length} caller(s)`,
    dependencies.size - shownOut.length && `${dependencies.size - shownOut.length} dependenc(ies)`,
  ].filter(Boolean);

  const HEIGHT = Math.min(
    520,
    Math.max(240, Math.max(shownMembers.length, shownIn.length, shownOut.length) * ROW + PAD * 2)
  );

  const columns = [
    { key: 'in', nodes: shownIn, x: SIDE_INSET },
    { key: 'mid', nodes: shownMembers, x: WIDTH / 2 },
    { key: 'out', nodes: shownOut, x: WIDTH - SIDE_INSET },
  ];

  const pos = new Map();
  for (const col of columns) {
    const n = col.nodes.length;
    col.nodes.forEach((name, i) => {
      const span = HEIGHT - PAD * 2;
      const y = n === 1 ? HEIGHT / 2 : PAD + (span * i) / (n - 1);
      pos.set(name, { x: col.x, y, col: col.key });
    });
  }

  const edges = graph.edges.filter((e) => shownSet.has(e.from) && shownSet.has(e.to));

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const edgeSvg = edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return '';
      const mx = (a.x + b.x) / 2;
      return `<path class="edge${e.type === 'Write' ? ' edge--write' : ''}" d="M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}"><title>${esc(e.from)} ${esc(e.type)} ${esc(e.to)}</title></path>`;
    })
    .join('');

  const nodeSvg = [...shownSet]
    .map((name) => {
      const p = pos.get(name);
      if (!p) return '';
      const object = graph.objects.get(name);
      const cls = memberSet.has(name) ? 'node--member' : object?.isCustom ? 'node--custom' : 'node--standard';
      const r = memberSet.has(name) ? 6 : 4.5;
      const anchor = p.col === 'in' ? 'end' : p.col === 'out' ? 'start' : 'middle';
      const dx = p.col === 'in' ? -9 : p.col === 'out' ? 9 : 0;
      const dy = p.col === 'mid' ? -10 : 3.5;
      return `<g><circle class="node ${cls}" cx="${p.x}" cy="${p.y}" r="${r}"><title>${esc(name)}${object ? ` — ${esc(object.type)}, ${esc(object.namespace)}` : ' — not in inventory'}</title></circle>` +
        `<text x="${p.x + dx}" y="${p.y + dy}" text-anchor="${anchor}">${esc(name)}</text></g>`;
    })
    .join('');

  const svg = `<svg class="subgraph" style="height:${HEIGHT}px" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Blast radius for ${esc(pack.title)}">${edgeSvg}${nodeSvg}</svg>`;

  const caption = [
    `${dependents.size} object(s) call into this package`,
    `${dependencies.size} object(s) it depends on`,
    hidden.length ? `not drawn: ${hidden.join(', ')}` : null,
    edges.some((e) => e.type === 'Write') ? 'red = write access' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return { svg, caption, isEmpty: dependents.size === 0 && dependencies.size === 0 };
}
