import * as vscode from 'vscode';
import { findIncludeLike } from '../parsers';
import { TemplateResolver } from '../resolver';

export class NunjucksDiagnostics {
  private collection = vscode.languages.createDiagnosticCollection('nunjucks');

  constructor(private resolver: TemplateResolver) {}

  dispose() { this.collection.dispose(); }

  async validateDocument(document: vscode.TextDocument) {
    if (document.languageId !== 'nunjucks') return;
    const text = document.getText();
    const refs = findIncludeLike(text);
    const diagnostics: vscode.Diagnostic[] = [];
    for (const r of refs) {
      const target = await this.resolver.resolve(document, r.target);
      if (!target) {
        const range = new vscode.Range(document.positionAt(r.start), document.positionAt(r.end));
        const d = new vscode.Diagnostic(range, `Cannot resolve ${r.kind} target: ${r.target}`, vscode.DiagnosticSeverity.Warning);
        diagnostics.push(d);
      }
    }
    this.collection.set(document.uri, diagnostics);
  }
}










