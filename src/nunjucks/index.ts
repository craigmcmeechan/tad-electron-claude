import * as vscode from 'vscode';
import { readConfig, nunjucksSelector } from './common';
import { TemplateIndex } from './indexer';
import { TemplateResolver } from './resolver';
import { NunjucksDefinitionProvider } from './providers/definition';
import { NunjucksDocumentSymbolProvider } from './providers/symbols';
import { NunjucksCompletionProvider } from './providers/completion';
import { NunjucksDiagnostics } from './providers/diagnostics';
import { NunjucksHoverProvider } from './providers/hover';
import { NunjucksRelationshipLinkProvider } from './providers/links';

export function activateNunjucks(context: vscode.ExtensionContext) {
  const config = readConfig();
  const index = new TemplateIndex();
  const resolver = new TemplateResolver(config);
  const diagnostics = new NunjucksDiagnostics(resolver);

  index.initialize(config).catch(() => {/* ignore */});

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(nunjucksSelector, new NunjucksDefinitionProvider(resolver)),
    vscode.languages.registerDocumentSymbolProvider(nunjucksSelector, new NunjucksDocumentSymbolProvider()),
    vscode.languages.registerCompletionItemProvider(nunjucksSelector, new NunjucksCompletionProvider(index), '"', '\''),
    vscode.languages.registerHoverProvider(nunjucksSelector, new NunjucksHoverProvider(resolver)),
    vscode.languages.registerDocumentLinkProvider(nunjucksSelector, new NunjucksRelationshipLinkProvider(resolver)),
    diagnostics
  );

  // Re-validate on open/change
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => diagnostics.validateDocument(doc)),
    vscode.workspace.onDidChangeTextDocument(e => diagnostics.validateDocument(e.document))
  );

  // React to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('superdesign.nunjucks')) {
        const cfg = readConfig();
        resolver.updateConfig(cfg);
        index.initialize(cfg);
        const editor = vscode.window.activeTextEditor;
        if (editor) diagnostics.validateDocument(editor.document);
      }
    })
  );
}










