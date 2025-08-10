import * as vscode from 'vscode';
import * as path from 'path';
import { NunjucksConfig, toAbsolute } from './common';

export class TemplateResolver {
  constructor(private config: NunjucksConfig) {}

  updateConfig(config: NunjucksConfig) { this.config = config; }

  async resolve(fromDoc: vscode.TextDocument, rawPath: string): Promise<vscode.Uri | undefined> {
    if (!rawPath || /[{}%]/.test(rawPath)) return undefined;
    const ws = vscode.workspace.workspaceFolders?.[0];
    const tryPaths: string[] = [];

    const hasExt = path.extname(rawPath) !== '';
    const candidates = hasExt ? [rawPath] : this.config.defaultExtensions.map(ext => rawPath + ext);

    // Relative to current file
    const fromDir = path.dirname(fromDoc.uri.fsPath);
    for (const cand of candidates) tryPaths.push(path.resolve(fromDir, cand));

    // Search roots
    if (ws) {
      for (const root of this.config.templateRoots) {
        const absRoot = toAbsolute(ws, root);
        if (!absRoot) continue;
        for (const cand of candidates) {
          tryPaths.push(path.join(absRoot, cand.replace(/^\//, '')));
        }
      }
    }

    for (const p of tryPaths) {
      try {
        const uri = vscode.Uri.file(p);
        await vscode.workspace.fs.stat(uri);
        return uri;
      } catch {}
    }
    return undefined;
  }
}










