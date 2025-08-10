import * as vscode from 'vscode';
import { findIncludeLike, findRelationshipRefs } from '../parsers';
import { TemplateResolver } from '../resolver';

export class NunjucksDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private resolver: TemplateResolver) {}

  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
    const text = document.getText();
    const refs = [...findIncludeLike(text), ...findRelationshipRefs(text)];
    const offset = document.offsetAt(position);
    for (const ref of refs) {
      // Prefer the precise path range if available
      const rangeStart = typeof (ref as any).pathStart === 'number' ? (ref as any).pathStart : ref.start;
      const rangeEnd = typeof (ref as any).pathEnd === 'number' ? (ref as any).pathEnd : ref.end;
      if (offset >= rangeStart && offset <= rangeEnd) {
        const uri = await this.resolver.resolve(document, ref.target);
        if (uri) {
          // go to top of file for now; future: consider symbol positions
          return new vscode.Location(uri, new vscode.Position(0, 0));
        }
      }
    }
    return undefined;
  }
}










