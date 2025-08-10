import * as vscode from 'vscode';
import { findDefinitions } from '../parsers';

export class NunjucksDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const text = document.getText();
    const defs = findDefinitions(text);
    const symbols: vscode.DocumentSymbol[] = [];
    for (const d of defs) {
      const start = document.positionAt(d.start);
      const end = document.positionAt((d.end ?? d.start) + 1);
      const range = new vscode.Range(start, end);
      const detail = d.kind === 'block' ? 'block' : 'macro';
      const kind = d.kind === 'block' ? vscode.SymbolKind.Module : vscode.SymbolKind.Function;
      symbols.push(new vscode.DocumentSymbol(`${d.name}`, detail, kind, range, range));
    }
    return symbols;
  }
}










