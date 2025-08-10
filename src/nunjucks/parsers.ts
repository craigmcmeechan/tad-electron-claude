export type IncludeRef = {
  kind: 'include' | 'extends' | 'import' | 'from';
  target: string;
  // full statement range
  start: number;
  end: number;
  // precise path string range (inside quotes)
  pathStart: number;
  pathEnd: number;
};
export type Definition = { kind: 'block' | 'macro'; name: string; start: number; end?: number };
export type RelationshipKind = 'next' | 'prev' | 'parent' | 'children' | 'related';
export type RelationshipRef = {
  kind: RelationshipKind;
  target: string;
  start: number; // full comment block start of token
  end: number;   // end of token
  pathStart: number; // precise path range
  pathEnd: number;
};

const stmtRe = /\{%-?\s*(include|extends|import|from)\s+['"]([^'"\s]+)['"][^%]*%\}/g;
const blockStartRe = /\{%-?\s*block\s+(\w+)\s*-?%\}/g;
const blockEndRe = /\{%-?\s*endblock\s*-?%\}/g;
const macroStartRe = /\{%-?\s*macro\s+(\w+)\s*\([^)]*\)\s*-?%\}/g;
const macroEndRe = /\{%-?\s*endmacro\s*-?%\}/g;

export function findIncludeLike(text: string): IncludeRef[] {
  const out: IncludeRef[] = [];
  for (const m of text.matchAll(stmtRe)) {
    const stmtStart = m.index ?? 0;
    const stmtEnd = stmtStart + m[0].length;
    // Find the first quote after the keyword within the statement
    const afterKeyword = m[0].replace(/^\{%-?\s*(include|extends|import|from)\s+/, '');
    const firstQuoteIdxLocal = afterKeyword.search(/["']/);
    let pathStart = stmtStart;
    let pathEnd = stmtStart;
    if (firstQuoteIdxLocal >= 0) {
      const quoteChar = afterKeyword[firstQuoteIdxLocal];
      const rest = afterKeyword.slice(firstQuoteIdxLocal + 1);
      const closeIdxLocal = rest.indexOf(quoteChar);
      if (closeIdxLocal >= 0) {
        pathStart = stmtStart + (m[0].length - afterKeyword.length) + firstQuoteIdxLocal + 1;
        pathEnd = pathStart + closeIdxLocal;
      }
    }
    out.push({
      kind: m[1] as IncludeRef['kind'],
      target: m[2],
      start: stmtStart,
      end: stmtEnd,
      pathStart,
      pathEnd,
    });
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

// Parse relationship annotations from the top-of-file Nunjucks comment block
export function findRelationshipRefs(text: string): RelationshipRef[] {
  const results: RelationshipRef[] = [];
  const headerMatch = text.match(/^\s*\{#([\s\S]*?)#\}/);
  if (!headerMatch) return results;
  const headerContent = headerMatch[1];
  const headerStart = (headerMatch.index ?? 0) + 2; // after '{#'
  const lineStarts: number[] = [];
  {
    let acc = 0;
    for (const part of headerContent.split(/\n/)) {
      lineStarts.push(acc);
      acc += part.length + 1; // include newline
    }
  }
  const keys = ['next','prev','parent','children','related'] as RelationshipKind[];
  const keyRe = /^\s*(next|prev|parent|children|related)\s*:\s*(.*)$/;
  let currentKey: RelationshipKind | undefined;
  const lines = headerContent.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(keyRe);
    if (m) {
      currentKey = m[1] as RelationshipKind;
      const rest = m[2] || '';
      const lineOffset = headerStart + lineStarts[i];
      // Array form: [a, b]
      const arrayMatch = rest.match(/\[([^\]]+)\]/);
      if (arrayMatch) {
        const arrContent = arrayMatch[1];
        let scanIdx = 0;
        for (const raw of arrContent.split(',').map(s => s.trim()).filter(Boolean)) {
          const unquoted = raw.replace(/^['"]|['"]$/g, '');
          const localIdx = arrContent.indexOf(raw, scanIdx);
          if (localIdx >= 0) {
            const pathLocalStart = rest.indexOf(arrContent) + localIdx + (raw.startsWith('"') || raw.startsWith('\'') ? 1 : 0);
            const absStart = lineOffset + rest.indexOf('[') + 1 + localIdx + (raw.startsWith('"') || raw.startsWith('\'') ? 1 : 0);
            const absEnd = absStart + unquoted.length;
            results.push({ kind: currentKey, target: unquoted, start: lineOffset, end: lineOffset + line.length, pathStart: absStart, pathEnd: absEnd });
            scanIdx = localIdx + raw.length;
          }
        }
        continue;
      }
      // Inline single form: key: pages/foo
      const singlePath = rest.match(/(['"]?)([^'"\s]+)\1/);
      if (singlePath) {
        const token = singlePath[2];
        const before = rest.indexOf(singlePath[0]);
        const quoteOffset = singlePath[1] ? 1 : 0;
        const absStart = lineOffset + before + quoteOffset + (m[0].length - rest.length);
        const absEnd = absStart + token.length;
        results.push({ kind: currentKey, target: token, start: lineOffset, end: lineOffset + line.length, pathStart: absStart, pathEnd: absEnd });
      }
      continue;
    }
    // YAML list item under current key: - pages/foo
    if (currentKey) {
      const dash = line.match(/^\s*-\s*(['"]?)([^'"\s]+)\1/);
      if (dash) {
        const token = dash[2];
        const lineOffset = headerStart + lineStarts[i];
        const before = line.indexOf(dash[0]);
        const quoteOffset = dash[1] ? 1 : 0;
        const absStart = lineOffset + before + dash[0].indexOf(dash[1] + token) + quoteOffset;
        const absEnd = absStart + token.length;
        results.push({ kind: currentKey, target: token, start: lineOffset, end: lineOffset + line.length, pathStart: absStart, pathEnd: absEnd });
      }
    }
  }
  // Compact @rel form
  const compactRe = /\{#\s*@rel\s+(next|prev|parent|children|related)\s*:\s*([^#]+?)#\}/g;
  for (const m2 of text.matchAll(compactRe)) {
    const kind = m2[1] as RelationshipKind;
    const body = m2[2];
    const stmtStart = m2.index ?? 0;
    const stmtEnd = stmtStart + m2[0].length;
    let cursor = 0;
    for (const raw of body.split(',').map(s => s.trim()).filter(Boolean)) {
      const unquoted = raw.replace(/^['"]|['"]$/g, '');
      const localIdx = body.indexOf(raw, cursor);
      if (localIdx >= 0) {
        const quoteOffset = raw.startsWith('"') || raw.startsWith('\'') ? 1 : 0;
        const absStart = stmtStart + m2[0].indexOf(body) + localIdx + quoteOffset;
        const absEnd = absStart + unquoted.length;
        results.push({ kind, target: unquoted, start: stmtStart, end: stmtEnd, pathStart: absStart, pathEnd: absEnd });
        cursor = localIdx + raw.length;
      }
    }
  }
  return results;
}










