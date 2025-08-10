import * as vscode from 'vscode';
import { findRelationshipRefs } from '../parsers';
import { TemplateResolver } from '../resolver';

export class NunjucksRelationshipLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private resolver: TemplateResolver) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    const text = document.getText();
    const rels = findRelationshipRefs(text);
    for (const r of rels) {
      const target = await this.resolver.resolve(document, r.target);
      const range = new vscode.Range(document.positionAt(r.pathStart), document.positionAt(r.pathEnd));
      const link = new vscode.DocumentLink(range, target);
      link.tooltip = target ? 'Open related template' : 'Unresolved related template';
      links.push(link);
    }
    return links;
  }
}








