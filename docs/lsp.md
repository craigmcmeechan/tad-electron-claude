## Nunjucks LSP integration and syntax highlighting

This document explains how the extension integrates Language Server–like features for Nunjucks templates (navigation, completion, hover, diagnostics, symbols, links) and how syntax highlighting is provided. It references the implementation files and shows usage examples.

- Core entry: `src/extension.ts`
- Common utilities and config: `src/nunjucks/common.ts`
- Template indexing: `src/nunjucks/indexer.ts`
- Parsing helpers: `src/nunjucks/parsers.ts`
- Path resolution: `src/nunjucks/resolver.ts`
- Providers: `src/nunjucks/providers/*`
- Language configuration: `language-configuration.json`
- TextMate grammar: `syntaxes/nunjucks.tmLanguage.json`

Where helpful, file references use workspace links like [extension.ts](mdc:src/extension.ts) and [parsers.ts](mdc:src/nunjucks/parsers.ts).

### What the integration provides

- Definition: Go to included/extended/imported templates and relationship targets
- Completion: Smart suggestions for template paths and unambiguous labels
- Hover: Inspect references and see the resolved destination, with quick open
- Diagnostics: Warn on unresolved include/extends/import/from and relationship targets
- Document links: Clickable links for relationship annotations in comments
- Symbols: Outline for Nunjucks `block` and `macro`
- Syntax highlighting: Nunjucks blocks, expressions, keywords, filters, names, and relationship annotations inside comments
- Language config: Comments, pairs, auto-closing, folding markers, and word pattern

---

### Configuration

Nunjucks settings are read via `tad.nunjucks` in [common.ts](mdc:src/nunjucks/common.ts):

```json
{
  // Settings → Extensions → TAD → Nunjucks
  "tad.nunjucks.templateRoots": ["."],
  "tad.nunjucks.defaultExtensions": [".njk", ".nunjucks", ".html"],
  "tad.nunjucks.ignore": ["**/node_modules/**", ".tad/dist/**"]
}
```

- templateRoots: directories searched for templates
- defaultExtensions: appended when a reference omits extension
- ignore: micromatch patterns used by the indexer during scans

Optional spaces configuration `.tad/spaces.json` allows scoping resolution and completions to a “space” (e.g., a site or bundle):

```json
{
  "spaces": [
    {
      "name": "app",
      "templateRoot": "src/assets/sample-templates",
      "distDir": ".tad/dist"
    }
  ]
}
```

When the current file lives under a space’s `templateRoot` or `distDir`, that space constrains path resolution and completion results.

---

### Activation and provider registration

See [extension.ts](mdc:src/extension.ts):

```ts
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

  // Revalidate on open/change and refresh on config updates...
}
```

- Document selector: `{ language: 'nunjucks' }`
- Completion triggers on `"` and `'` inside relevant statements
- Diagnostics re-run on document open/change and when `tad.nunjucks` settings change

---

### Template indexing

The indexer in [indexer.ts](mdc:src/nunjucks/indexer.ts):

- Scans `templateRoots` for files matching `**/*.{defaultExtensions}`
- Skips paths matching `ignore`
- Tracks a Set of absolute, normalized file paths
- Watches for file creation/deletion via a `FileSystemWatcher` and updates the Set live

This powers completion candidates and fast lookups.

---

### Parsing helpers

In [parsers.ts](mdc:src/nunjucks/parsers.ts), three key extractors:

- `findIncludeLike(text)` detects `{% include %}`, `{% extends %}`, `{% import %}`, `{% from %}` and extracts:
  - kind: one of include|extends|import|from
  - statement and precise path spans for accurate ranges
- `findDefinitions(text)` finds `block` and `macro` starts and pairs them with naive `endblock`/`endmacro` to derive ranges
- `findRelationshipRefs(text)` recognizes relationship annotations placed at the very top Nunjucks comment block:
  - YAML-like block form, supporting `next`, `prev`, `parent`, `children`, `related`
  - Compact single-line form: `{# @rel next: pages/2.studyview.0.home.njk #}` (multiple comma-separated allowed)
  - Returns kind, target path, and precise ranges for link/definition/hover/diagnostics

Recommended annotation formats:

```nunjucks
{#
relationships:
  next:
    - pages/2.studyview.0.home.njk
  related:
    - pages/3.library.overview.njk
  children: []
#}
```

```nunjucks
{# @rel next: pages/2.studyview.0.home.njk #}
{# @rel related: pages/3.library.overview.njk, pages/4.notes.index.njk #}
``;

---

### Path resolution

The resolver in [resolver.ts](mdc:src/nunjucks/resolver.ts) implements layered strategies when resolving a raw path (with or without an extension):

1. Validate path token (rejects braces or template syntax)
2. If no extension, try appending each `defaultExtensions`
3. Try resolving relative to the current document’s directory
4. Determine the current space (from `.tad/spaces.json`), if any; choose roots
   - If in a space: search only that space’s `templateRoot`
   - Else: search all configured `templateRoots`
5. For each root, try:
   - Direct `root/<candidate>`
   - `root/pages/<candidate>`, `root/components/<candidate>`, `root/elements/<candidate>`
6. If still unresolved and the raw token contains no path separators, perform a basename search within `pages|components|elements` under roots to find the first matching file (trying each allowed extension)

Returns a `vscode.Uri` when found, `undefined` otherwise.

---

### Providers

#### Completion

[completion.ts](mdc:src/nunjucks/providers/completion.ts)

- Triggered in string positions of include-like statements or when typing right after the keyword plus opening quote
- Detects current space to prefer space-relative paths
- Uses the indexed templates, filters to `pages|components|elements`
- Emits two kinds of items:
  - Label-only suggestions using basename without extension when unambiguous
  - Path suggestions (space-relative if possible; otherwise workspace-relative)

Example:

```nunjucks
{% include "|" %}
{# placing the cursor at | shows labels like `hello-card` and paths like `pages/1.home.njk` #}
```

#### Definition

[definition.ts](mdc:src/nunjucks/providers/definition.ts)

- Click within the path span of `{% include "..." %}`, `{% extends "..." %}`, `{% import/from "..." %}` or a relationship target
- Navigates to the target file (top-of-file position)

#### Hover

[hover.ts](mdc:src/nunjucks/providers/hover.ts)

- Hover over a path within include-like statements or relationship targets shows:
  - The original token
  - Resolved destination (workspace-relative if available)
  - A command link to open the file

#### Diagnostics

[diagnostics.ts](mdc:src/nunjucks/providers/diagnostics.ts)

- On open/change, re-parses the document for include-like and relationship refs
- For each unresolved target, adds a Warning diagnostic over the path token: `Cannot resolve <kind> target: <path>`
- Diagnostics also refresh when `tad.nunjucks` config changes

#### Document links (relationships)

[links.ts](mdc:src/nunjucks/providers/links.ts)

- Creates `DocumentLink` objects for each relationship path span
- Tooltip indicates whether the target resolves

#### Symbols

[symbols.ts](mdc:src/nunjucks/providers/symbols.ts)

- Extracts document symbols for `block` and `macro` definitions
- Uses `Module` kind for blocks and `Function` kind for macros

---

### Language configuration

See [language-configuration.json](mdc:language-configuration.json):

- Block comments: `{# … #}`
- Auto-closing pairs: `{#/#}`, `{{/}}`, `{%/%}`, quotes and brackets
- Folding markers for `block|macro|if|for|raw … end(block|macro|if|for|raw)`
- Word pattern tuned for template identifiers

---

### Syntax highlighting (TextMate grammar)

See [nunjucks.tmLanguage.json](mdc:syntaxes/nunjucks.tmLanguage.json). Key scopes:

- `comment.block.nunjucks` for `{# … #}`
- Relationship hints inside comments: `meta.relationship.nunjucks` and `keyword.other.relationship.nunjucks`
- Output expressions: `{{ … }}` → `meta.output.nunjucks`
- Statements: `{% … %}` → `meta.statement.nunjucks`
  - Include/extends/import/from path strings: `string.other.path.nunjucks`
  - Block/macro name captures: `entity.name.section.block.nunjucks`, `entity.name.function.macro.nunjucks`
- Filters in pipelines: `support.function.filter.nunjucks`
- Keywords: control and structural (`if/for/block/extends/include/import/from/macro/set/filter/raw`)
- Strings and numbers with dedicated scopes
- HTML embedding via `text.html.basic`

Example tokens:

```nunjucks
{# @rel next: pages/2.studyview.0.home.njk #}
{% extends "layouts/base.njk" %}
{% block content %}
  {{ title | upper }} — count: {{ items.length }}
  {% for x in items %}
    {% include "components/item-card" %}
  {% endfor %}
{% endblock %}
{% macro greet(name) %}Hello, {{ name }}!{% endmacro %}
```

---

### End-to-end example

```nunjucks
{#
relationships:
  next:
    - pages/2.studyview.0.home.njk
  related: [pages/3.library.overview]
#}
{% extends "pages/layouts/shell" %}
{% from "components/format" import date as fmtDate %}

{% block content %}
  <h1>{{ page.title | upper }}</h1>
  <p>Published: {{ fmtDate(page.publishedAt) }}</p>
  {% include "components/hello-card" %}
{% endblock %}
```

What you get:

- Completion on quoted paths after `extends`, `from`, `include`
- Definition/hover on each referenced path, with quick open
- Relationship paths are linkified and navigable
- Symbols: `block content` appears in the outline; macros also appear if present
- Diagnostics warn if any of the referenced paths cannot be resolved

---

### Troubleshooting

- Ensure the file’s language mode is Nunjucks (`nunjucks`)
- Verify `tad.nunjucks.templateRoots` includes your templates directory
- If you omit extensions in references, ensure `tad.nunjucks.defaultExtensions` includes them
- Use `.tad/spaces.json` to scope resolution when working across multiple template roots
- Relationship annotations must be at the very top of the file inside `{# … #}`
- The indexer respects `tad.nunjucks.ignore`; adjust if files aren’t appearing in completions

---

### Notes on relationships annotations

- Directional keys: `next`, `prev`, `parent`, `children`, `related`
- Targets can be workspace-relative or space-relative paths; extensions are optional
- Unresolved targets surface as diagnostics and produce no navigation

Minimal forms:

```nunjucks
{# @rel next: pages/2.studyview.0.home.njk #}
{# @rel related: pages/3.library.overview.njk, pages/4.notes.index.njk #}
```

Preferred YAML block at the very top of the template:

```nunjucks
{#
relationships:
  next:
    - pages/2.studyview.0.home.njk
  parent:
    - pages/2.studyview.index.njk
#}
```

---

### API surface summary

- Definition: `NunjucksDefinitionProvider`
- Symbols: `NunjucksDocumentSymbolProvider`
- Completion: `NunjucksCompletionProvider`
- Diagnostics: `NunjucksDiagnostics`
- Hover: `NunjucksHoverProvider`
- Links: `NunjucksRelationshipLinkProvider`

All activated in `activateNunjucks` and bound to the `nunjucks` language selector.


