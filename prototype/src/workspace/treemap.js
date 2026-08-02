// The position, drawn.
//
// The estate is 106 custom objects in eleven decisions, and the two questions a
// transformation lead asks of that are "what is the split" and "which of these
// is big". A stacked bar answers the first and hides the second: it shows you
// 51 objects to carry without showing that 33 of them are one decision and 18
// are another with completely different evidence behind it.
//
// So: area is the number of objects in a decision, colour is the call, and
// every tile opens. Nothing here is decorative — the picture is the same eleven
// rows as the list below it, and clicking a tile lands on the same modal.
//
// Deterministic squarified layout (Bruls, Huizing, van Wijk), no library. Same
// input gives the same picture every time, which matters when you are demoing
// live and the audience has already seen it once.

const PAD = 1.5;          // gutter between tiles, halved on each side
const CHAR = 6.15;        // ~average advance of 12.5px Inter, for wrapping
const MONO = 6.4;         // ~advance of 11px SF Mono, for the footer line
const MIN_LABEL_W = 76;
const MIN_LABEL_H = 42;
const MIN_COUNT_W = 34;
const MIN_COUNT_H = 22;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Worst aspect ratio in a row, given the row's areas and the side it runs
// along. The whole algorithm is "keep adding to this row while that gets
// better, then start a new one".
function worstRatio(areas, sum, side) {
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

export function squarify(items, box) {
  let { x, y, w, h } = box;
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (!total || w <= 0 || h <= 0) return [];

  const scale = (w * h) / total;
  const queue = items.map((item) => ({ item, area: item.value * scale }));
  const out = [];

  while (queue.length) {
    const acrossWidth = w < h;
    const side = Math.min(w, h);
    const row = [];
    let rowArea = 0;
    let best = Infinity;

    while (queue.length) {
      const next = queue[0];
      const areas = [...row.map((r) => r.area), next.area];
      const ratio = worstRatio(areas, rowArea + next.area, side);
      if (row.length && ratio > best) break;
      best = ratio;
      rowArea += next.area;
      row.push(queue.shift());
    }

    const thickness = rowArea / side;
    let offset = 0;
    for (const entry of row) {
      const length = entry.area / thickness;
      out.push(acrossWidth
        ? { ...entry.item, x: x + offset, y, w: length, h: thickness }
        : { ...entry.item, x, y: y + offset, w: thickness, h: length });
      offset += length;
    }

    if (acrossWidth) { y += thickness; h -= thickness; } else { x += thickness; w -= thickness; }
    // Floating-point residue at the end of the last row would otherwise loop.
    if (w < 0.5 || h < 0.5) break;
  }

  return out;
}

// Greedy word wrap against an estimated advance width. Deliberately crude —
// SVG has no text metrics without measuring, and measuring means a reflow per
// tile. Overshooting by a character is invisible; the tile has a gutter.
function wrap(text, width, maxLines) {
  const limit = Math.max(4, Math.floor(width / CHAR));
  const lines = [];
  let line = '';
  for (const raw of String(text).split(' ')) {
    // A single word wider than the tile has to be cut, not pushed past the
    // edge. SAP names and "Business-critical" both hit this.
    const word = raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw;
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= limit) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && lines[maxLines - 1].length > limit) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, limit - 1)}…`;
  }
  return lines;
}

// Does this footer line fit the tile? Estimated, for the same reason wrap() is
// estimated — measuring SVG text means a reflow per tile. Erring towards the
// bare count is the safe direction: a clipped label is worse than a short one.
const fits = (text, width) => text.length * MONO <= width - 20;

/**
 * @param packages ordered decisions, each with { id, title, count, confidence }
 * @param callOf   pack -> call id, so the caller keeps ownership of overrides
 * @param labelOf  call id -> human label, for the tooltip
 */
export function renderTreemap(packages, callOf, labelOf, { width, height }) {
  // Biggest first. Squarified layout wants descending order for square-ish
  // tiles, and biggest-first also happens to be the reading order you want in
  // a hero. Ties break on the incoming order, so the picture never jitters.
  const items = packages
    .map((pack, i) => ({ pack, value: pack.count, seq: i }))
    .sort((a, b) => b.value - a.value || a.seq - b.seq);

  const tiles = squarify(items, { x: 0, y: 0, w: width, h: height });

  const body = tiles.map(({ pack, x, y, w, h }) => {
    const call = callOf(pack);
    const iw = Math.max(0, w - PAD * 2);
    const ih = Math.max(0, h - PAD * 2);
    const ix = x + PAD;
    const iy = y + PAD;

    const objects = `${pack.count} object${pack.count === 1 ? '' : 's'}`;
    let label = '';
    if (iw >= MIN_LABEL_W && ih >= MIN_LABEL_H) {
      const maxLines = ih >= 82 ? 3 : ih >= 62 ? 2 : 1;
      const lines = wrap(pack.title, iw - 20, maxLines);
      const titleSvg = lines
        .map((line, i) => `<tspan x="${(ix + 10).toFixed(1)}" dy="${i === 0 ? 0 : 14}">${esc(line)}</tspan>`)
        .join('');

      // A tile with room to spare gets the count at size — the decisions worth
      // the most area are the ones whose size is the point. Small tiles keep
      // the count in the footer, where it costs one line.
      const roomy = ih >= 112 && iw >= 128;
      const both = `${objects} · ${labelOf(call)}`;
      // Once the count is set large, the footer is only worth a line if it can
      // carry the call. Falling back to the number there would print it twice.
      const foot = roomy
        ? (fits(labelOf(call), iw) ? labelOf(call) : '')
        : (fits(both, iw) ? both : String(pack.count));

      label =
        `<text class="tm-title" x="${(ix + 10).toFixed(1)}" y="${(iy + 24).toFixed(1)}">${titleSvg}</text>` +
        (roomy ? `<text class="tm-big" x="${(ix + 10).toFixed(1)}" y="${(iy + ih - (foot ? 34 : 14)).toFixed(1)}">${pack.count}</text>` : '') +
        (foot ? `<text class="tm-foot" x="${(ix + 10).toFixed(1)}" y="${(iy + ih - 11).toFixed(1)}">${esc(foot)}</text>` : '');
    } else if (iw >= MIN_COUNT_W && ih >= MIN_COUNT_H) {
      label = `<text class="tm-foot tm-foot--only" x="${(ix + iw / 2).toFixed(1)}" y="${(iy + ih / 2 + 4).toFixed(1)}">${pack.count}</text>`;
    }

    const tip = `${pack.title} — ${objects} · ${labelOf(call)} · ${pack.confidence} confidence`;

    return `<g class="tm-tile c-${esc(call)}" data-pack="${esc(pack.id)}" role="button" tabindex="0" aria-label="${esc(tip)}">
      <title>${esc(tip)}</title>
      <rect class="tm-fill" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${iw.toFixed(1)}" height="${ih.toFixed(1)}" rx="4"></rect>
      ${label}
    </g>`;
  }).join('');

  return `<svg class="treemap" viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
    role="group" aria-label="The custom estate, by decision and by call">${body}</svg>`;
}
