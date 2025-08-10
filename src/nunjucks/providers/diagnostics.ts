import * as vscode from 'vscode';
import { findIncludeLike, findRelationshipRefs } from '../parsers';
import { TemplateResolver } from '../resolver';

export class NunjucksDiagnostics {
  private collection = vscode.languages.createDiagnosticCollection('nunjucks');

  constructor(private resolver: TemplateResolver) {}

  dispose() { this.collection.dispose(); }

  async validateDocument(document: vscode.TextDocument) {
    if (document.languageId !== 'nunjucks') return;
    const text = document.getText();
    const refs = [...findIncludeLike(text), ...findRelationshipRefs(text)];
    const diagnostics: vscode.Diagnostic[] = [];
    for (const r of refs) {
      const target = await this.resolver.resolve(document, r.target);
      if (!target) {
        const start = typeof (r as any).pathStart === 'number' ? (r as any).pathStart : r.start;
        const end = typeof (r as any).pathEnd === 'number' ? (r as any).pathEnd : r.end;
        const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
        const d = new vscode.Diagnostic(range, `Cannot resolve ${r.kind} target: ${r.target}`, vscode.DiagnosticSeverity.Warning);
        diagnostics.push(d);
      }
    }
    this.collection.set(document.uri, diagnostics);
  }
}










