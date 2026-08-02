// CSV parsing. Deliberately minimal: the four extracts are well-formed comma
// separated files with no embedded quotes. If a future adapter needs RFC 4180
// quoting, replace this module — nothing downstream depends on how it works.

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((key, i) => {
      row[key] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

const FILES = {
  objects: 'objects.csv',
  usage: 'usage.csv',
  dependencies: 'dependencies.csv',
  transactions: 'transactions.csv',
};

// Loads the raw extract. Returns the four tables untouched — every
// interpretation happens downstream in graph.js / evidence.js, so the raw
// extract stays inspectable and any claim can be traced back to a source row.
export async function loadExtract(base = 'data') {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const res = await fetch(`${base}/${file}`);
      if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
      return [key, parseCsv(await res.text())];
    })
  );
  return Object.fromEntries(entries);
}

// --- adapter: what kind of table is this? -----------------------------------
//
// Classified by column signature rather than filename. A real Basis team does
// not export files called objects.csv — they export ZOBJ_DUMP_PRD1_0714.CSV.
// Matching on structure is what makes this an adapter rather than a loader,
// and it is the seam a different source (Readiness Check, Custom Code
// Migration) would plug into.

const SIGNATURES = {
  objects: ['object_name', 'object_type', 'namespace'],
  usage: ['object_name', 'avg_executions_per_month'],
  dependencies: ['caller_object', 'target_object'],
  transactions: ['transaction_code', 'program_name'],
};

export function classifyTable(rows) {
  if (!rows.length) return null;
  const columns = new Set(Object.keys(rows[0]));
  for (const [kind, required] of Object.entries(SIGNATURES)) {
    if (required.every((c) => columns.has(c))) return kind;
  }
  return null;
}

// Reads dropped or picked files into the same shape loadExtract returns.
// Reports what it recognised and what it could not, rather than failing
// silently on a file it did not understand.
export async function readExtractFiles(files) {
  const extract = {};
  const recognised = [];
  const unknown = [];

  for (const file of files) {
    const rows = parseCsv(await file.text());
    const kind = classifyTable(rows);
    if (!kind) {
      unknown.push(file.name);
      continue;
    }
    extract[kind] = rows;
    recognised.push({ kind, name: file.name, rows: rows.length });
  }

  const missing = Object.keys(SIGNATURES).filter((k) => !extract[k]);
  return { extract, recognised, unknown, missing };
}
