import * as vscode from 'vscode';
import * as path from 'path';

export type NunjucksConfig = {
  templateRoots: string[];
  defaultExtensions: string[];
  ignoreGlobs: string[];
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










