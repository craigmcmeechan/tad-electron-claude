import * as vscode from 'vscode';
import * as path from 'path';
import { NunjucksConfig, TemplateSpace, toAbsolute, readSpacesConfig, findSpaceForFile } from './common';

export class TemplateResolver {
  private spaces: TemplateSpace[] | null = null;
  constructor(private config: NunjucksConfig) {
    // lazy load spaces, ignore errors
    readSpacesConfig().then(s => { this.spaces = s; }).catch(() => {});
  }

  updateConfig(config: NunjucksConfig) { this.config = config; }

  async resolve(fromDoc: vscode.TextDocument, rawPath: string): Promise<vscode.Uri | undefined> {
    if (!rawPath || /[{}%]/.test(rawPath)) return undefined;
    const ws = vscode.workspace.workspaceFolders?.[0];
    const tryPaths: string[] = [];

    const hasExt = path.extname(rawPath) !== '';
    const candidates = hasExt ? [rawPath] : this.config.defaultExtensions.map(ext => rawPath + ext);

    // Determine space of current file (if any)
    const fileFsPath = fromDoc.uri.fsPath;
    const spaces = this.spaces ?? (await readSpacesConfig().catch(() => null));
    const currentSpace = findSpaceForFile(fileFsPath, spaces ?? undefined);

    // Relative to current file
    const fromDir = path.dirname(fromDoc.uri.fsPath);
    for (const cand of candidates) tryPaths.push(path.resolve(fromDir, cand));

    // Search roots: if space detected, scope to that space's templateRoot only; otherwise use configured roots
    if (ws) {
      const roots: string[] = [];
      if (currentSpace) {
        const scoped = toAbsolute(ws, currentSpace.templateRoot);
        if (scoped) roots.push(scoped);
      } else {
        roots.push(...this.config.templateRoots.map(r => toAbsolute(ws, r)).filter(Boolean) as string[]);
      }
      for (const absRoot of roots) {
        for (const cand of candidates) {
          tryPaths.push(path.join(absRoot, cand.replace(/^\//, '')));
          // Also try resolving against content directories within the space root
          const contentDirs = ['pages', 'components', 'elements'];
          for (const dir of contentDirs) {
            tryPaths.push(path.join(absRoot, dir, cand.replace(/^\//, '')));
          }
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

    // If still unresolved and we have a workspace+space root, perform a recursive basename search
    if (ws) {
      const roots: string[] = [];
      if (currentSpace) {
        const scoped = toAbsolute(ws, currentSpace.templateRoot);
        if (scoped) roots.push(scoped);
      } else {
        roots.push(...this.config.templateRoots.map(r => toAbsolute(ws, r)).filter(Boolean) as string[]);
      }
      const hasPathSep = /[\\/]/.test(rawPath);
      if (!hasPathSep) {
        const contentDirs = ['pages', 'components', 'elements'];
        for (const absRoot of roots) {
          for (const dir of contentDirs) {
            for (const cand of candidates) {
              const ext = path.extname(cand);
              const base = ext ? cand.slice(0, -ext.length) : cand;
              const pattern = new vscode.RelativePattern(absRoot, `${dir}/**/${base}` + (ext ? '' : ''));
              try {
                const exts = ext ? [ext] : this.config.defaultExtensions;
                for (const e of exts) {
                  const rp = new vscode.RelativePattern(absRoot, `${dir}/**/${base}${e.replace(/^\./, '.')}`);
                  const found = await vscode.workspace.findFiles(rp, undefined, 1);
                  if (found && found.length > 0) return found[0];
                }
              } catch {}
            }
          }
        }
      }
    }
    return undefined;
  }
}










