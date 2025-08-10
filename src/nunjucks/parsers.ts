export type IncludeRef = { kind: 'include' | 'extends' | 'import'; target: string; start: number; end: number };
export type Definition = { kind: 'block' | 'macro'; name: string; start: number; end?: number };

const stmtRe = /\{%-?\s*(include|extends|import)\s+['"]([^'"\s]+)['"][^%]*%\}/g;
const blockStartRe = /\{%-?\s*block\s+(\w+)\s*-?%\}/g;
const blockEndRe = /\{%-?\s*endblock\s*-?%\}/g;
const macroStartRe = /\{%-?\s*macro\s+(\w+)\s*\([^)]*\)\s*-?%\}/g;
const macroEndRe = /\{%-?\s*endmacro\s*-?%\}/g;

export function findIncludeLike(text: string): IncludeRef[] {
  const out: IncludeRef[] = [];
  for (const m of text.matchAll(stmtRe)) {
    out.push({ kind: m[1] as IncludeRef['kind'], target: m[2], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

export function findDefinitions(text: string): Definition[] {
  const defs: Definition[] = [];
  for (const m of text.matchAll(blockStartRe)) {
    defs.push({ kind: 'block', name: m[1], start: m.index ?? 0 });
  }
  for (const m of text.matchAll(macroStartRe)) {
    defs.push({ kind: 'macro', name: m[1], start: m.index ?? 0 });
  }
  // naive pairing for end ranges
  const ends: Array<{ kind: 'block' | 'macro'; idx: number; pos: number }> = [];
  for (const m of text.matchAll(blockEndRe)) ends.push({ kind: 'block', idx: m.index ?? 0, pos: m.index ?? 0 });
  for (const m of text.matchAll(macroEndRe)) ends.push({ kind: 'macro', idx: m.index ?? 0, pos: m.index ?? 0 });
  defs.sort((a, b) => a.start - b.start);
  ends.sort((a, b) => a.pos - b.pos);
  for (const def of defs) {
    const matchEnd = ends.find(e => e.kind === def.kind && e.pos > def.start);
    if (matchEnd) def.end = matchEnd.pos;
  }
  return defs;
}










