#
### New name required — Template Builder System Integration for VS Code

Superdesign now focuses on helping you build and navigate large Nunjucks-based template systems inside VS Code. It indexes your templates, provides smart navigation and completions, validates references, and exposes a simple "Build Templates" command to integrate with your site/app builder. Optional template-to-output mapping lets you jump from compiled files back to their source templates.

---

### Key features

- **Nunjucks language support**
  - Go to definition for `include`, `import`, and `extends` targets
  - Document symbols for blocks/macros to improve Outline/Go to Symbol
  - Filename/path completion across your configured template roots
  - Real-time diagnostics for unresolved/ignored template references

- **Cross-project template indexing**
  - Indexes templates across multiple roots via `superdesign.nunjucks.templateRoots`
  - Watches the workspace and updates suggestions as files change

- **Builder integration (optional)**
  - Command: "Superdesign: Build Templates" to trigger your build workflow
  - Supports an optional manifest at `.superdesign/dist/manifest.json` to map compiled outputs back to source templates and components

---

### Getting started

1. Configure template roots in VS Code Settings → search for "Superdesign":
   - `superdesign.nunjucks.templateRoots` (default: `.superdesign/templates`, `.`)
   - `superdesign.nunjucks.defaultExtensions` (default: `.njk`, `.nunjucks`, `.html`)
   - `superdesign.nunjucks.ignore` (default: ignores `node_modules` and `.superdesign/dist`)
2. Open any `.njk`/`.nunjucks`/`.html` template and use:
   - Go to Definition on include/import/extends targets
   - Symbols in the Outline view
   - Path completion when typing in quotes
3. Optional: wire up your build and emit a manifest for template mapping (see below).

---

### Template → Output manifest (optional)

If your builder emits a manifest at `.superdesign/dist/manifest.json`, Superdesign will use it to surface which templates and components produced each compiled file. This enables quick navigation from outputs back to sources during review.

Schema example (per compiled file path relative to `.superdesign/dist/`):

```json
{
  "pages/home.html": {
    "page": { "name": "HomePage", "path": "src/pages/HomePage.tsx" },
    "components": [
      { "name": "Header", "path": "src/components/Header.tsx" },
      { "name": "Hero",   "path": "src/components/Hero.tsx" }
    ],
    "elements": [
      { "name": "Button", "path": "src/ui/Button.tsx" }
    ]
  }
}
```

Notes:
- Keys must match file paths your preview or review flow loads (e.g., `pages/*.html`, `components/*.html`).
- `path` can be absolute or workspace-relative. If omitted, names are shown but files cannot be opened.

See more details in `build.md` under "Build Manifest (for Canvas → Template Mapping)".

### Canvas metadata for tags (optional)
If your builder emits tags per compiled output at `.superdesign/dist/canvas-metadata.json`, the Canvas will display tag badges and you can organize frames by logical collections.

Example:

```json
{
  "pages/home.html": { "tags": ["landing", "marketing", "v1"] },
  "components/card.html": { "tags": ["ui", "card", "atoms"] }
}
```

See `build.md` for the full schema.

---

### Commands

- "Superdesign: Build Templates" — run your template builder workflow.

---

### Configuration

- `superdesign.nunjucks.templateRoots`: directories to search for templates
- `superdesign.nunjucks.defaultExtensions`: extensions to resolve when no extension is provided
- `superdesign.nunjucks.ignore`: glob patterns to exclude from indexing

---

### Contributing & License

Contributions are welcome. See `build.md` for local build and development notes. Licensed under MIT.

