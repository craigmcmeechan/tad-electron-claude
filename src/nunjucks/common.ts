import * as vscode from 'vscode';
import * as path from 'path';

export type NunjucksConfig = {
  templateRoots: string[];
  defaultExtensions: string[];
  ignoreGlobs: string[];
};

export type TemplateSpace = {
  name: string;
  templateRoot: string; // may be absolute or workspace-relative
  distDir: string; // may be absolute or workspace-relative
};

export function readConfig(): NunjucksConfig {
  const cfg = vscode.workspace.getConfiguration('superdesign.nunjucks');
  const roots = cfg.get<string[]>('templateRoots') ?? ['.'];
  const exts = cfg.get<string[]>('defaultExtensions') ?? ['.njk', '.nunjucks', '.html'];
  const ignore = cfg.get<string[]>('ignore') ?? ['**/node_modules/**', '.superdesign/dist/**'];
  return { templateRoots: roots, defaultExtensions: exts, ignoreGlobs: ignore };
}

export function toAbsolute(workspaceFolder: vscode.WorkspaceFolder | undefined, maybeRelative: string): string | undefined {
  if (!workspaceFolder) return undefined;
  if (path.isAbsolute(maybeRelative)) return maybeRelative;
  return path.join(workspaceFolder.uri.fsPath, maybeRelative);
}

export function uriFromFsPath(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

export const nunjucksSelector: vscode.DocumentSelector = { language: 'nunjucks' };

export function isStringPosition(document: vscode.TextDocument, position: vscode.Position): boolean {
  const line = document.lineAt(position.line).text;
  // naive: if quotes around position
  const before = line.slice(0, position.character);
  const after = line.slice(position.character);
  const lastQuote = Math.max(before.lastIndexOf('"'), before.lastIndexOf('\''));
  const nextQuote = (() => {
    const dq = after.indexOf('"');
    const sq = after.indexOf('\'');
    const cands = [dq >= 0 ? position.character + dq : -1, sq >= 0 ? position.character + sq : -1].filter(n => n >= 0);
    return cands.length ? Math.min(...cands) : -1;
  })();
  return lastQuote >= 0 && nextQuote > lastQuote;
}

// Spaces helpers
export async function readSpacesConfig(): Promise<TemplateSpace[] | null> {
  try {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return null;
    const uri = vscode.Uri.joinPath(ws.uri, '.superdesign', 'spaces.json');
    const buf = await vscode.workspace.fs.readFile(uri);
    const json = JSON.parse(Buffer.from(buf).toString('utf8'));
    const rawSpaces = Array.isArray(json?.spaces) ? json.spaces : null;
    if (!rawSpaces) return [];
    return rawSpaces
      .map((s: any) => ({
        name: String(s?.name || ''),
        templateRoot: String(s?.templateRoot || ''),
        distDir: String(s?.distDir || ''),
      }))
      .filter((s: TemplateSpace) => s.name && s.templateRoot && s.distDir);
  } catch {
    return null;
  }
}

export function toAbsoluteOrUndefined(ws: vscode.WorkspaceFolder | undefined, p: string | undefined): string | undefined {
  if (!p) return undefined;
  return toAbsolute(ws, p);
}

export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function findSpaceForFile(fsPath: string, spaces: TemplateSpace[] | null | undefined): TemplateSpace | undefined {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws || !spaces || spaces.length === 0) return undefined;
  for (const s of spaces) {
    const absTpl = toAbsolute(ws, s.templateRoot);
    if (absTpl && isWithin(absTpl, fsPath)) return s;
    const absDist = toAbsolute(ws, s.distDir);
    if (absDist && isWithin(absDist, fsPath)) return s;
  }
  return undefined;
}










