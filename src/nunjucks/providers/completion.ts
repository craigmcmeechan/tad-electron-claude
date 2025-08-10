import * as vscode from 'vscode';
import { TemplateIndex } from '../indexer';
import * as path from 'path';
import { isStringPosition } from '../common';

export class NunjucksCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private index: TemplateIndex) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const line = document.lineAt(position.line).text;
    if (!/(include|extends|import)\s+["']?$/.test(line.slice(0, position.character)) && !isStringPosition(document, position)) {
      return undefined;
    }
    const ws = vscode.workspace.workspaceFolders?.[0];
    const items: vscode.CompletionItem[] = [];
    for (const fsPath of this.index.list()) {
      const label = ws ? path.relative(ws.uri.fsPath, fsPath).split(path.sep).join('/') : fsPath;
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.File);
      item.insertText = label;
      items.push(item);
    }
    return items;
  }
}










