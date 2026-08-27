// Batch rename map. Frames tagged [#ID] anywhere in their Figma name export
// under the filename mapped to that ID. The map can be pasted as:
//   1. A JSON object:        { "123": "hero_banner_wk36", ... }
//   2. A JSON array of rows: [{ "id": "123", "filename": "..." }, ...]
//      (rows may also use deliverable_id / export_filename / name keys,
//      and the array may be wrapped as { "rows": [...] })
//   3. CSV lines:            123,hero_banner_wk36

export function parseRenameMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  const t = raw.trim();
  if (!t) return map;
  if (t[0] === '{' || t[0] === '[') {
    const parsed = JSON.parse(t);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : null;
    if (rows) {
      for (const r of rows) {
        const id = r.id != null ? r.id : r.deliverable_id;
        const name = r.filename || r.export_filename || r.name;
        if (id != null && name) map[String(id)] = String(name);
      }
    } else {
      for (const k of Object.keys(parsed)) map[k] = String(parsed[k]);
    }
  } else {
    for (const line of t.split(/\r?\n/)) {
      const i = line.indexOf(',');
      if (i > 0) {
        const id = line.slice(0, i).trim();
        const name = line.slice(i + 1).trim();
        if (id && name) map[id] = name;
      }
    }
  }
  return map;
}

export function exportName(figmaName: string, map: Record<string, string>): string {
  const m = figmaName.match(/\[#(\w+)\]/);
  if (m && map[m[1]]) return map[m[1]];
  return figmaName.replace(/[\\/:*?"<>|]/g, '_');
}
