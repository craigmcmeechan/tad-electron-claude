### Tad Template Engine and Builder

This document describes the behavior and conventions of the Tad template builder located at `.tad/builder/build.js`. It is intended for technical users and model agents who author templates, configure build spaces, and integrate outputs with the Tad Canvas.

---

### High-level Overview

The builder compiles Nunjucks-based template systems into browsable HTML outputs under one or more "spaces". Each space maps a specific `templateRoot` (source) to a `distDir` (output). The builder:

- Renders page templates (`pages/**/*.njk`) to `dist/{space}/pages/**/*.html`
- Generates preview pages for macro-based components (`components/**/*.njk`) under `dist/{space}/components/**/{state}.html`
- Preserves static HTML pages found under `pages/**` (copied and beautified)
- Copies a `design-system.css` to each space’s `distDir` and links it from generated HTML
- Emits a `manifest.json` (template → output mapping, dependencies, relationships, tags) and a `canvas-metadata.json` (tags only) per space, consumed by the Canvas

If `spaces.json` is missing, the builder defaults to a legacy single space rooted at `.tad/templates` with output at `.tad/dist` and mirrors `pages` into `.tad/design_iterations` to support older Canvas flows.

---

### Directory Conventions (per space)

Under a configured `templateRoot`:

- `pages/` — Page templates rendered to final pages
- `components/` — Macro-based components rendered to preview pages with states
- `elements/` — Lower-level include/import targets (atoms/partials)
- `styles/` — Optional styles; `design-system.css` is copied into the space’s `dist` root if found

Outputs under `distDir`:

- `pages/**/*.html` — Rendered page outputs
- `components/**/{state}.html` — Component state previews
- `components/index.html` and `components/index.json` — Convenience index for component previews
- `design-system.css` — Copied from `styles/design-system.css` or a fallback app-level stylesheet
- `manifest.json` — Rich mapping for Canvas (page/component → sources, dependencies, relationships, tags)
- `canvas-metadata.json` — Lightweight tags for Canvas badge rendering

---

### Nunjucks Environment & Rendering

- Engine: Nunjucks (`nunjucks@^3.2.x`)
- Search paths: `[pagesDir, componentsDir, elementsDir]`
- `autoescape: false` (author must be explicit about HTML-escaping where needed)
- Default template extensions recognized during reference resolution: `.njk`, `.nunjucks`, `.html`
- Global data injected into renders:
  - `titleSuffix: "— Wireframe"`
  - `designSystemCssHref: string` (relative href to the copied `design-system.css`)

Beautification: All HTML generated/copied is run through `js-beautify` with a conservative, readable profile (2-space indent, soft-wrap at ~120 columns, preserve newlines).

---

### Pages (pages/**/*.njk)

Builder behavior:

1. Glob `pages/**/*.njk`
2. Render each source file using the environment described above
3. Write to `dist/pages/{same relative path}.html`
4. Discover dependencies (see "Dependency Scan")
5. Extract tags and relationships (see below) and emit into `manifest.json` and `canvas-metadata.json`

Static HTML passthrough:

- Any `pages/**/*.html` that was not produced by the `.njk` render step is copied as-is (then beautified) to `dist/pages/**`.

---

### Components (components/**/*.njk) and States

Components are authored as Nunjucks macros (one macro per file is expected):

```nunjucks
{% macro Button(props) %}
  <button class="btn">{{ props.label }}</button>
{% endmacro %}
```

- For each `components/**/MyComponent.njk`, the builder looks up an optional sibling states file, `components/**/MyComponent.states.json`.
- If no states file is present, a default state is used: `{ "default": { "props": {} } }`.
- For each state, the builder generates a wrapper HTML page that imports the macro and invokes it with the state’s `props` object, writing files to:
  - `dist/components/**/MyComponent/{state}.html`
- An index is generated:
  - `dist/components/index.html` with links to all component states
  - `dist/components/index.json` metadata listing component IDs and state output paths

Example `MyComponent.states.json`:

```json
{
  "default": { "props": { "label": "Click me" } },
  "primary": { "props": { "label": "Continue", "color": "primary" } }
}
```

Dependencies of component wrapper outputs are also scanned (macro source, nested components, and included elements) and recorded into the `manifest.json` entry.

---

### Dependency Scan (include/import/from/extends)

For every rendered page or component source, builder scans the Nunjucks source using a regex for statements:

- `{% include "..." %}`
- `{% import "..." %}`
- `{% from "..." import ... %}`
- `{% extends "..." %}`

Resolution strategy:

1. Try path relative to the current file
2. Try under `pages/`, `components/`, and `elements/`
3. If the reference has no extension, test with extensions `['.njk','.nunjucks','.html']`

Dependencies are typed as:

- `components`: files resolved under the `components/` tree
- `elements`: files resolved under the `elements/` tree

The builder records these into the manifest entry to enable Canvas features like "open source template" lists.

---

### Tags Extraction

Tags are used by the Canvas for badges and grouping. Tags are collected from a page/component source using three heuristics (first match wins):

1. Frontmatter YAML block at the top of the file:

```nunjucks
---
tags: [marketing, v1, landing]
---
```

2. Inline Nunjucks comment directive:

```nunjucks
{# tags: marketing, v1, landing #}
```

3. Inline HTML comment directive:

```html
<!-- tags: marketing, v1, landing -->
```

Notes:

- Arrays and YAML-style lists are supported; values are trimmed and deduplicated
- Tags are emitted both in `manifest.json` (under the output key) and in `canvas-metadata.json`

---

### Relationships Extraction (Pages Only)

The builder supports two relationship annotation forms at the very top of page templates (not components):

1. YAML-in-comment form (recommended):

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

2. Compact shorthand:

```nunjucks
{# @rel next: pages/2.studyview.0.home.njk #}
{# @rel related: pages/3.library.overview.njk, pages/4.notes.index.njk #}
```

Resolution rules:

- Targets may be workspace-relative (`.tad/templates/pages/...`), template-root-relative (`pages/...`), or relative to the current file.
- Extensions can be omitted; the builder tries `['.njk','.nunjucks','.html']`.
- Only page targets are recorded (references under `components/` or `elements/` are ignored for relationships).
- On success, each target is normalized into an output-relative key like `pages/{relpath}.html`.
- Invalid/unresolved targets are logged as warnings and omitted.

Emitted data shape in `manifest.json` per page output key:

```json
{
  "pages/home.html": {
    "page": { "name": "home", "path": "/abs/path/to/pages/home.njk" },
    "components": [ { "name": "Header", "path": "/abs/.../components/header.njk" } ],
    "elements": [ { "name": "slot", "path": "/abs/.../elements/slot.njk" } ],
    "tags": ["landing","v1"],
    "relationships": {
      "next": ["pages/2.studyview.0.home.html"],
      "prev": [],
      "parent": [],
      "children": [],
      "related": ["pages/3.library.overview.html"]
    }
  }
}
```

The Canvas consumes these relationships to power navigation links and graph overlays.

---

### Spaces: Multi-root Build Configuration

Spaces enable multi-site or multi-output builds in a single workspace. Define `.tad/spaces.json`:

```json
{
  "defaultSpace": "docs",
  "spaces": [
    {
      "name": "docs",
      "templateRoot": "./.tad/templates",
      "distDir": "./.tad/dist"
    },
    {
      "name": "marketing",
      "templateRoot": "./marketing-site/templates",
      "distDir": "./marketing-site/.tad/dist"
    }
  ]
}
```

Builder behavior:

- Validates presence of `pages`, `components`, `elements`, and `styles` under each `templateRoot` (warns if missing)
- Builds spaces sequentially: for each space, renders pages, builds components, copies `design-system.css`, and writes `manifest.json` and `canvas-metadata.json` into the space’s `distDir`

Canvas integration of spaces:

- The extension reads `.tad/spaces.json` and exposes space choices to the Canvas, allowing switching between outputs and defaulting to `defaultSpace`.

Legacy mode (no `spaces.json`):

- Builds `.tad/templates` → `.tad/dist`
- Copies `dist/pages/**` into `.tad/design_iterations/**` for the older Canvas gallery view
- Copies `dist/design-system.css` to `.tad/design-system.css`

---

### CSS: `design-system.css`

Per-space, the builder attempts to copy a `design-system.css` into the `distDir` root from one of:

1. `{templateRoot}/styles/design-system.css`
2. `{appDir}/styles/design-system.css` (where `appDir` is `.tad/builder`)

If not found, a warning is logged and pages/component previews will still render (but without the shared stylesheet). Generated wrappers link this stylesheet via a relative href; page templates can reference the provided `designSystemCssHref` variable.

---

### Manifest and Canvas Metadata

Per space, two files are written at the `distDir` root:

- `manifest.json` — Rich mapping of outputs → sources and structure
  - Pages: `page` (name, absolute `path`), `components`, `elements`, optional `tags`, optional `relationships`
  - Component previews: `page: null`, `components` (first is the main macro file), `elements`, optional `tags`
  - Keys are paths relative to `distDir` (e.g., `pages/home.html`, `components/card/default.html`)

- `canvas-metadata.json` — `{ [outputPath]: { tags: string[] } }`

Canvas behavior:

- Consumes `manifest.json` to show "Produced from templates" lists and (for pages) relationships
- Consumes `canvas-metadata.json` to render tag badges
- The extension watches both `dist/**` and `design_iterations/**` and will refresh the Canvas view automatically when files change

---

### Build Entry Points

From VS Code (recommended):

- Command: "tad: Compile Templates" (`tad.buildTemplates`)
  - Ensures a builder exists in `.tad/builder` (syncs from packaged assets if necessary)
  - Detects package manager, installs dependencies on first run, and executes the build
  - Streams output to the Tad output channel and refreshes the Canvas on completion

From CLI (fallback):

```bash
node .tad/builder/build.js
```

Dependencies (as shipped in packaged assets):

- `nunjucks`, `fs-extra`, `glob`, `js-beautify`

---

### Authoring Guidance for Model Agents

- Pages:
  - Place relationship annotations at the very top of the file in a Nunjucks comment block. Prefer the YAML-in-comment form.
  - Use `pages/...` relative targets for relationships; omit extension when convenient (builder will resolve).
  - Add `tags` using frontmatter or inline comment directives.

- Components:
  - Ensure each `components/**/File.njk` defines a macro; the builder uses the first macro name for preview imports.
  - Provide a `File.states.json` to generate multiple preview states with `props`.
  - Add `tags` just like pages; these will appear on component preview outputs.

- Elements:
  - Use under `elements/` and include/import them from pages/components as partials. They show up in manifest dependency lists.

- CSS:
  - Provide a `styles/design-system.css` per space to ensure consistent visual rendering in Canvas and previews.

---

### Error Handling & Warnings

- Missing directories under a space are logged as warnings; build proceeds where possible
- Missing `design-system.css` is logged; outputs still render
- Unresolved relationship targets are logged and omitted
- Manifest/metadata write failures produce warnings; Canvas will still render outputs without enrichments

---

### Data Shapes (Reference)

Minimal `manifest.json` page entry:

```json
{
  "pages/home.html": {
    "page": { "name": "home", "path": "/abs/.../pages/home.njk" },
    "components": [],
    "elements": [],
    "tags": ["landing"],
    "relationships": { "next": [], "prev": [], "parent": [], "children": [], "related": [] }
  }
}
```

Minimal `manifest.json` component entry:

```json
{
  "components/card/default.html": {
    "page": null,
    "components": [
      { "name": "Card", "path": "/abs/.../components/card.njk" }
    ],
    "elements": [],
    "tags": ["ui","atoms"]
  }
}
```

Minimal `canvas-metadata.json`:

```json
{
  "pages/home.html": { "tags": ["landing","v1"] },
  "components/card/default.html": { "tags": ["ui","atoms"] }
}
```

---

### Legacy Behavior (No spaces.json)

- Source: `.tad/templates`
- Output: `.tad/dist`
 - Compatibility copies:
  - `dist/pages/**` → `.tad/design_iterations/**`
  - `dist/design-system.css` → `.tad/design-system.css`

This ensures older Canvas gallery behavior continues to function while you migrate to spaces.





