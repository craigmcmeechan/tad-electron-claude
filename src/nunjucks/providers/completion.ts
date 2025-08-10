import * as vscode from 'vscode';
import { TemplateIndex } from '../indexer';
import * as path from 'path';
import { isStringPosition, readSpacesConfig, findSpaceForFile } from '../common';

export class NunjucksCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private index: TemplateIndex) {}

  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
    const line = document.lineAt(position.line).text;
    if (!/(include|extends|import|from)\s+["']?$/.test(line.slice(0, position.character)) && !isStringPosition(document, position)) {
      return undefined;
    }
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return undefined;

    // Detect space
    const spaces = await readSpacesConfig();
    const currentSpace = findSpaceForFile(document.uri.fsPath, spaces ?? undefined);
    const items: vscode.CompletionItem[] = [];

    const all = this.index.list();
    const slash = (p: string) => p.split(path.sep).join('/');
    const removeExt = (p: string) => p.replace(/\.[^.]+$/, '');

    const candidates: Array<{ fsPath: string; workspaceRel: string; spaceRel?: string }> = [];
    for (const fsPath of all) {
      const workspaceRel = slash(path.relative(ws.uri.fsPath, fsPath));
      if (currentSpace) {
        const absSpaceRoot = path.isAbsolute(currentSpace.templateRoot)
          ? currentSpace.templateRoot
          : path.join(ws.uri.fsPath, currentSpace.templateRoot);
        const relToSpace = path.relative(absSpaceRoot, fsPath);
        if (!relToSpace.startsWith('..') && !path.isAbsolute(relToSpace)) {
          candidates.push({ fsPath, workspaceRel, spaceRel: slash(relToSpace) });
        }
      } else {
        candidates.push({ fsPath, workspaceRel });
      }
    }

    // Build label suggestions from space pages/components/elements only
    const labelCounts = new Map<string, number>();
    for (const c of candidates) {
      const rel = c.spaceRel ?? c.workspaceRel;
      const isContentDir = /^([^/]+\/)?(pages|components|elements)\//.test(rel);
      if (!isContentDir) continue;
      const base = path.basename(removeExt(rel));
      labelCounts.set(base, (labelCounts.get(base) || 0) + 1);
    }

    const emittedLabels = new Set<string>();

    // Emit label items first (only if not ambiguous)
    for (const c of candidates) {
      const rel = c.spaceRel ?? c.workspaceRel;
      const isContentDir = /^([^/]+\/)?(pages|components|elements)\//.test(rel);
      if (!isContentDir) continue;
      const base = path.basename(removeExt(rel));
      if (labelCounts.get(base)! > 1) continue; // skip ambiguous label-only items
      if (emittedLabels.has(base)) continue;
      emittedLabels.add(base);
      const item = new vscode.CompletionItem(base, vscode.CompletionItemKind.File);
      item.insertText = base;
      item.detail = rel;
      item.sortText = `0_${base}`;
      item.filterText = `${base} ${rel}`;
      items.push(item);
    }

    // Emit space-relative path items (prefer space rel when available)
    for (const c of candidates) {
      const rel = c.spaceRel ?? c.workspaceRel;
      const item = new vscode.CompletionItem(rel, vscode.CompletionItemKind.File);
      item.insertText = rel;
      item.sortText = `1_${rel}`;
      items.push(item);
    }

    return items;
  }
}










