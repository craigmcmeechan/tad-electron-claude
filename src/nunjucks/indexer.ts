import * as vscode from 'vscode';
import * as path from 'path';
import micromatch from 'micromatch';
import { NunjucksConfig, toAbsolute } from './common';

export class TemplateIndex {
  private templates = new Set<string>();
  private watchers: vscode.FileSystemWatcher[] = [];
  private disposables: vscode.Disposable[] = [];

  async initialize(config: NunjucksConfig): Promise<void> {
    this.dispose();
    await this.scan(config);
    this.watch(config);
  }

  list(): string[] { return Array.from(this.templates); }

  has(fsPath: string): boolean { return this.templates.has(path.normalize(fsPath)); }

  private async scan(config: NunjucksConfig) {
    this.templates.clear();
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return;
    const rootsAbs = (config.templateRoots.map(r => toAbsolute(ws, r)).filter(Boolean) as string[]);
    const globExt = `{${config.defaultExtensions.map(e => e.replace(/^\./, '')).join(',')}}`;
    for (const root of rootsAbs) {
      const pattern = new vscode.RelativePattern(root, `**/*.${globExt}`);
      const uris = await vscode.workspace.findFiles(pattern);
      for (const uri of uris) {
        if (this.isIgnored(uri.fsPath, config)) continue;
        this.templates.add(path.normalize(uri.fsPath));
      }
    }
  }

  private isIgnored(fsPathStr: string, config: NunjucksConfig): boolean {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const rel = ws ? path.relative(ws.uri.fsPath, fsPathStr) : fsPathStr;
    return micromatch.isMatch(rel, config.ignoreGlobs);
  }

  private watch(config: NunjucksConfig) {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return;
    const glob = `**/*.{${config.defaultExtensions.map(e => e.replace(/^\./, '')).join(',')}}`;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(ws, glob));
    this.watchers.push(watcher);
    watcher.onDidCreate(uri => {
      if (!this.isIgnored(uri.fsPath, config)) this.templates.add(path.normalize(uri.fsPath));
    });
    watcher.onDidDelete(uri => this.templates.delete(path.normalize(uri.fsPath)));
    watcher.onDidChange(() => {/* no-op */});
    this.disposables.push(watcher);
  }

  dispose() {
    this.watchers.forEach(w => w.dispose());
    this.watchers = [];
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}










