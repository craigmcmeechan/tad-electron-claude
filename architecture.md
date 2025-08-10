### Superdesign Architecture

#### Overview
Superdesign is a VS Code extension for building and navigating large Nunjucks-based template systems, with an integrated Canvas viewer and an optional AI-powered chat. The system comprises:
- Extension host (TypeScript/Node) that registers VS Code contributions, activates Nunjucks language features, hosts webviews, syncs/builds a template builder, and brokers AI/tooling
- React webviews for a sidebar Chat and a Canvas panel
- A toolbox of safe file/system tools available to the AI agent
- A workspace folder `.superdesign/` that holds design iterations, build outputs, prompts, and an optional builder

#### Key Packages and Runtime
- Language/runtime: TypeScript (Node 20+), ES2020
- VS Code API: `vscode` (externalized from the extension bundle)
- Build: esbuild via `esbuild.js` (separate extension and webview builds)
- UI: React 19 + ReactDOM; CSS inlined as text by esbuild
- AI: `ai` SDK with providers `@ai-sdk/openai` and `@openrouter/ai-sdk-provider`

---

### Extension Host

#### Entry and Activation
- Entry: `dist/extension.js` built from `src/extension.ts`
- Activation events (`package.json`):
  - `onView:superdesign.chatView`
  - `onCommand:superdesign.buildTemplates`, `onCommand:superdesign.syncBuilder`, `onCommand:superdesign.openCanvas`, etc.
  - `onLanguage:nunjucks` (activates the Nunjucks features)

#### Nunjucks Language Features (`src/nunjucks/*`)
- Config reader: `readConfig()` reads `superdesign.nunjucks.*` settings with sensible defaults
- Indexer: `TemplateIndex` scans configured roots, tracks templates, and watches for changes
- Resolver: `TemplateResolver` resolves include/import/extends targets across relative paths and roots with default extensions fallback
- Providers:
  - Definition: jump to targets in `{% include|import|extends %}`
  - Completion: filename/path completion scoped to indexed templates
  - Document symbols: block/macro symbols via lightweight regex parsing
  - Diagnostics: unresolved include/import/extends surfaced as warnings

Key files:
- `src/nunjucks/index.ts` activates providers and revalidates on config changes
- `src/nunjucks/indexer.ts`, `src/nunjucks/resolver.ts`, `src/nunjucks/providers/*`, `src/nunjucks/parsers.ts`

#### Canvas, Builder, and Workspace
- Canvas panel: `SuperdesignCanvasPanel` (in `src/extension.ts`)
  - Renders `dist/webview.js` with a strict CSP nonce
  - Watches `.superdesign/design_iterations/**/*.{html,svg,css}` and `.superdesign/dist/**/*.{html,svg,css}` and posts deltas to the webview
  - Inlines local CSS `<link>` tags into HTML during preview for fidelity
  - Supports optional spaces via `.superdesign/spaces.json` to switch among multiple build outputs
  - Reads optional `.superdesign/dist/manifest.json` to map outputs back to source templates/components and lift relationships/tags into the Canvas model
  - Reads optional `.superdesign/dist/canvas-metadata.json` for per-output tags

- Builder integration:
  - `superdesign.syncBuilder`: copies a packaged builder (from extension assets) into `.superdesign/builder`
  - `superdesign.buildTemplates`: ensures a builder exists, installs deps if needed, then runs via pnpm/yarn/npm, or `node build.js`, and refreshes Canvas
  - Output shape expected under `.superdesign/dist/{pages|components}/**/*.html` plus optional manifest/metadata described above

- Project initialization: `superdesign.initializeProject` scaffolds `.superdesign/design_iterations/` and seeds authoring rules and a default theme CSS

#### Chat and Agent
- `ChatSidebarProvider` hosts the sidebar Chat, bridges messages to `ChatMessageService`, and supports provider/model selection based on configuration
- `CustomAgentService` integrates the `ai` SDK and exposes safe tools:
  - File I/O: read, write, edit, multiedit
  - Discovery: ls, grep, glob
  - Shell: bash (with guardrails)
  - Theme generation: writes CSS themes
  - Working directory defaults to `.superdesign/` in the current workspace
- `ChatMessageService` streams assistant text, tool calls (with deltas), and tool results back to the webview using CoreMessage-like payloads

Related files: `src/services/customAgentService.ts`, `src/services/chatMessageService.ts`, `src/providers/chatSidebarProvider.ts`, `src/services/logger.ts`

---

### Webviews (Frontend)

#### Bundles and Entrypoints
- Webview bundle: `dist/webview.js` built from `src/webview/index.tsx`
- Entrypoint chooses Chat vs Canvas by `data-view` attribute
- React application `src/webview/App.tsx`; Chat UI in `src/webview/components/Chat/*`; Canvas UI in `src/webview/components/CanvasView.tsx`

#### Chat View
- Renders rich streaming responses, tool-call progress, and tool results
- Persists history (localStorage) and supports image uploads/paste → saved to `.superdesign/moodboard/` via extension
- Provides a lightweight Template panel to read `.superdesign/**/prompts*.md`

#### Canvas Panel
- Shows design iterations and built outputs
- Displays tags and relationships (from manifest/metadata) and supports opening source templates/files

---

### Build System
- `esbuild.js` builds two outputs:
  - Extension: CJS, `src/extension.ts` → `dist/extension.js`, externalizes `vscode`
  - Webview: ESM, `src/webview/index.tsx` → `dist/webview.js`, with loaders for `.css/.png/.jpg/.svg`
- Copies `src/assets` → `dist/src/assets`
- In production, minifies and disables source content embedding

---

### Configuration
- Nunjucks (`resource` scoped):
  - `superdesign.nunjucks.templateRoots`: defaults to `[".superdesign/templates", "."]`
  - `superdesign.nunjucks.defaultExtensions`: defaults to `[".njk", ".nunjucks", ".html"]`
  - `superdesign.nunjucks.ignore`: defaults to `["**/node_modules/**", ".superdesign/dist/**"]`
- AI (`application` scoped):
  - `superdesign.aiModelProvider`: `openai` | `openrouter` (default `openai`)
  - `superdesign.aiModel`: e.g. `gpt-4o`, `openrouter/auto` (model name infers provider when set)
  - API keys: `superdesign.openaiApiKey`, `superdesign.openrouterApiKey`

Workspace conventions:
- Working dir: `.superdesign/`
- Design drafts: `.superdesign/design_iterations/**/*`
- Build outputs: `.superdesign/dist/{pages,components}/**/*`
- Optional: `.superdesign/dist/manifest.json`, `.superdesign/dist/canvas-metadata.json`, `.superdesign/spaces.json`

---

### Core Flows
- Nunjucks navigation: editor position in `{% include|import|extends %}` → parse → resolve via roots+extensions → open target; unresolved targets emit diagnostics
- Build & preview: run "Build Templates (Superdesign)" → ensure/copy builder → install deps if missing → run build → Canvas watches outputs and renders; CSS is inlined for local links
- Chat tool streaming: Chat sends `CoreMessage[]` → AI SDK streams text/tool-call deltas → tools execute in `.superdesign/` → results stream to UI with progress and structured payloads

---

### Security Notes (current state)
- API keys are stored in VS Code settings, not SecretStorage
- Chat webview previously allowed `'unsafe-inline'` in CSP; Canvas uses a nonce. Prefer nonced scripts for both
- Hardcoded keys exist for Supabase and Helicone routing in the codebase; these should be externalized
- Image uploads are saved under `.superdesign/moodboard/` after size/type checks; base64 conversion happens in the extension for vision prompts

---

### Notable Dependencies
- Runtime: TypeScript 5.8, Node types 20.x
- Frontend: React 19, `react-markdown`, `rehype-highlight`, `remark-gfm`, `highlight.js`, `lucide-react`
- Build: `esbuild` 0.25
- AI: `ai` SDK 4.x, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`
