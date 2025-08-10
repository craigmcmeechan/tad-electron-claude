import * as vscode from 'vscode';
import { findIncludeLike } from '../parsers';
import { TemplateResolver } from '../resolver';

export class NunjucksDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private resolver: TemplateResolver) {}

  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
    const text = document.getText();
    const refs = findIncludeLike(text);
    const offset = document.offsetAt(position);
    for (const ref of refs) {
      if (offset >= ref.start && offset <= ref.end) {
        const uri = await this.resolver.resolve(document, ref.target);
        if (uri) return new vscode.Location(uri, new vscode.Position(0, 0));
      }
    }
    return undefined;
  }
}










