import * as vscode from 'vscode';
import { findIncludeLike, findRelationshipRefs } from '../parsers';
import { TemplateResolver } from '../resolver';

export class NunjucksHoverProvider implements vscode.HoverProvider {
  constructor(private resolver: TemplateResolver) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const text = document.getText();
    const refs = [...findIncludeLike(text), ...findRelationshipRefs(text)];
    const offset = document.offsetAt(position);
    for (const ref of refs) {
      const start = (ref as any).pathStart ?? ref.start;
      const end = (ref as any).pathEnd ?? ref.end;
      if (offset >= start && offset <= end) {
        const uri = await this.resolver.resolve(document, ref.target);
        const ws = vscode.workspace.workspaceFolders?.[0];
        const rel = uri && ws ? vscode.workspace.asRelativePath(uri) : undefined;
        const kind = (ref as any).kind ?? 'ref';
        const md = new vscode.MarkdownString(undefined, true);
        md.isTrusted = true;
        md.appendMarkdown(`**${kind}**: \
\`${ref.target}\``);
        if (uri) {
          md.appendMarkdown(`\n\n**Resolved**: \`${rel || uri.fsPath}\``);
          md.appendMarkdown(`\n\n[Open file](command:vscode.open?${encodeURIComponent(JSON.stringify([uri.toString()]))})`);
        } else {
          md.appendMarkdown(`\n\n**Resolved**: Unresolved`);
        }
        const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
        return new vscode.Hover(md, range);
      }
    }
    return undefined;
  }
}








