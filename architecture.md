### Tad Architecture

#### Overview
Tad is a VS Code extension for authoring and navigating large Nunjucks template systems, with:
- Extension host that registers VS Code contributions, activates Nunjucks language features, hosts webviews, builds templates, and brokers AI/tooling
- React webviews for a Chat sidebar and a Canvas panel
- A toolbox of safe file/system tools for the AI agent
- A workspace folder `.tad/` holding design iterations, build outputs, spaces, prompts, and an optional builder

#### Key Packages and Runtime
- Language/runtime: TypeScript (Node 20+), ES2020
- VS Code API: `vscode` (externalized)
- Build: esbuild via `esbuild.js` (separate extension and webview bundles)
- UI: React 19 + ReactDOM; CSS strings inlined by esbuild loaders
- AI: `ai` SDK with `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`, and `@ai-sdk/anthropic`

---

### Extension Host

#### Entry and Activation
- Entry: `dist/extension.js` from `src/extension.ts`
- Activation events (`package.json`):
  - View: `onView:tad.chatView`
  - Language: `onLanguage:nunjucks` (activates Nunjucks features)
  - Commands: e.g. `tad.openCanvas`, `tad.buildTemplates`, `tad.syncBuilder`, `tad.createTemplateSpace`, `tad.initializeProject`, API key setup, etc.

#### Commands and Responsibilities
- `tad.showChatSidebar`: Reveals Chat view
- `tad.openCanvas`: Opens Canvas panel (`tadCanvasPanel`)
- `tad.buildTemplates`: Ensures/syncs builder, installs deps if needed, invokes build (via `pnpm|yarn|npm` or `node build.js`), refreshes Canvas
 - `tad.syncBuilder`: Copies packaged builder from extension assets to `.tad/builder`
 - `tad.createTemplateSpace`: Creates/updates `.tad/spaces.json`
 - `tad.initializeProject`: Scaffolds `.tad/design_iterations/` and seed files
- API key commands: `tad.configureApiKey`, `tad.configureOpenAIApiKey`, `tad.configureOpenRouterApiKey`, `tad.configureApiKeyQuick`

#### Nunjucks Language Features (`src/nunjucks/*`)
- Config (`src/nunjucks/common.ts`):
  - `readConfig()` reads `tad.nunjucks.*`
  - `nunjucksSelector` defines the language selector
  - Spaces helpers read `.tad/spaces.json` to scope resolution
- Indexer (`src/nunjucks/indexer.ts`):
  - `TemplateIndex.initialize(config)`: clears, scans roots, and starts watchers
  - Scans `templateRoots` for files with `defaultExtensions`, filtered by `ignore` globs
  - Keeps a normalized set of template file paths; updates on file create/delete
- Resolver (`src/nunjucks/resolver.ts`):
  - Resolves include/import/extends and relationship targets
  - Candidate order: relative-to-current-file → template roots (or current space’s `templateRoot` if active) → content dirs `pages|components|elements` → fallback basename search
  - Handles extension-less paths by trying `defaultExtensions`
- Parsers (`src/nunjucks/parsers.ts`):
  - `findIncludeLike()`: extracts `{% include|extends|import|from %}` with precise path ranges
  - `findDefinitions()`: finds `block`/`macro` start/end ranges
  - `findRelationshipRefs()`: parses Nunjucks comment annotations for `next|prev|parent|children|related` in YAML-like header or compact `@rel` form
- Providers (`src/nunjucks/providers/*`):
  - Definition: jumps to resolved targets based on cursor inside the path range
  - Completion: offers label-only and space/workspace-relative path suggestions; prefers space-relative when applicable
  - Symbols: emits document symbols for blocks and macros
  - Hover: shows target and resolved file path with a command link to open
  - Diagnostics: validates include/relationship targets and warns on unresolved ones
  - Relationship Links: clickable document links for relationship targets
- Activation (`src/nunjucks/index.ts`): registers all providers, initializes the index, and re-validates on open/change and on config changes; updates resolver/index when `tad.nunjucks` changes

#### Canvas, Builder, and Workspace
- Canvas panel (`tadCanvasPanel` in `src/extension.ts`):
  - Loads `dist/webview.js` with a per-render CSP nonce; `script-src 'nonce-…'`
- Watches `.tad/design_iterations/**/*.{html,svg,css}` and `.tad/dist/**/*.{html,svg,css}`; posts `fileChanged` deltas
  - Listens for webview messages: `requestSpaces`, `loadDesignFiles`, `openTemplateFile`, `reloadDesignFile`, `setContextFromCanvas`, `setChatPrompt`, `selectFrame`
  - `loadDesignFiles` reads HTML/SVG files from design iterations or a selected space’s dist dir; inlines local CSS `<link>`s for high-fidelity preview
  - Reads optional `manifest.json` to map pages/components/elements and lift relationships; reads `canvas-metadata.json` to collect tags per output
- Sends `spaces:init` with available spaces from `.tad/spaces.json` and errors when missing/invalid
- Builder integration:
- `tad.syncBuilder`: copies a bundled builder into `.tad/builder`
- `tad.buildTemplates`: installs deps if needed, runs build via `execa` wrappers, surfaces errors, and refreshes Canvas
  - Expected outputs: `.tad/dist/pages/**` and `.tad/dist/components/**`, plus optional `manifest.json` and `canvas-metadata.json`
- Project initialization:
- `tad.initializeProject`: creates `.tad/design_iterations/` and writes starter files (rules, theme CSS, etc.)

#### Chat and Agent
- Chat host (`src/providers/chatSidebarProvider.ts`):
  - Creates a webview view for `tad.chatView`
  - Injects context via `generateWebviewHtml` and routes messages to `ChatMessageService`
  - Handles provider/model UX: `getCurrentProvider` and `changeProvider` (updates `tad.aiModelProvider/aiModel`, prompts to configure API keys)
- Agent service (`src/services/customAgentService.ts`):
  - Wraps the `ai` SDK; selects model/provider based on settings; supports streaming
  - System prompt encodes safe design workflow and tool usage
  - Exposes tools: read, write, edit, multiedit, glob, grep, ls, bash (guarded), theme generation; execution context defaults to `.tad/`
  - Streams assistant text, tool-call deltas, and tool results with per-message metadata
- Chat message pipeline (`src/services/chatMessageService.ts`):
  - Accepts chat messages (single prompt or full `CoreMessage[]` history)
  - Opens an `AbortController` to support stop; forwards stream chunks to the webview as `chatResponseChunk` and signals `chatStreamEnd`
  - Handles aborts and errors; logs via centralized `Logger`
- Logging (`src/services/logger.ts`):
  - Central output channel “tad” with levels DEBUG/INFO/WARN/ERROR

---

### Webviews (Frontend)

#### Bundles and Entrypoints
- Webview bundle: `dist/webview.js` from `src/webview/index.tsx`
- Root `#root` element `data-view` attribute selects Chat vs Canvas; `data-nonce` provides CSP nonce to Canvas
- App orchestrator: `src/webview/App.tsx` chooses view, injects CSS, passes nonce/context

#### Chat View
- Main component: `src/webview/components/Chat/ChatInterface.tsx`
- State hook: `src/webview/hooks/useChat.ts`
  - Persists history in `localStorage`
  - Sends `chatMessage` with the full `chatHistory` to the extension
  - Receives streamed chunks: `chatResponseChunk` (assistant or tool-call/result metadata) and `chatStreamEnd`
- Additional features:
- Template panel (reads `.tad/**/prompts*.md` via extension commands)
  - Image uploads/paste, stored to `.tad/moodboard/`

#### Canvas Panel
- Main component: `src/webview/components/CanvasView.tsx`
- Messages sent to extension: `requestSpaces`, `loadDesignFiles`, `openTemplateFile`, `reloadDesignFile`, `setContextFromCanvas`, `setChatPrompt`
- Messages received from extension: `spaces:init`, `designFilesLoaded`, `designFileRefreshed`, `fileChanged`, `error`
- Renders design files and build outputs; displays tags/relationships; can open source templates via `openTemplateFile`

#### Webview HTML and CSP
- Chat HTML (`src/templates/webviewTemplate.ts`):
  - CSP allows `script-src ${webview.cspSource} 'unsafe-inline'` (improvement: move to nonce-based)
  - Injects `window.__WEBVIEW_CONTEXT__` for the React app
- Canvas HTML (`tadCanvasPanel._getHtmlForWebview`):
  - Uses a randomly generated nonce; `script-src 'nonce-…'` only for scripts
  - Injects context and early error handlers that report back to the extension

---

### Tools (Agent-Accessible)
- Common traits:
  - All tools validate paths against workspace (`.tad/` by default) and handle errors with structured responses
  - File content I/O normalizes line endings and newlines where appropriate
- File I/O:
  - `read`: text ranges, images (metadata), PDFs
  - `write`: creates parents, reports bytes written
  - `edit`: exact string replacement with safety checks; can create new files
  - `multiedit`: sequential find-and-replace with per-edit outcomes and fail-fast
- Discovery:
  - `glob`: fast filename/path matching with sorting and limits
  - `grep`: regex search across files with match metadata
  - `ls`: directory listings with filters/sorting
- Shell:
  - `bash`: platform-aware shell with unsafe-command checks, timeouts, output capture; validates working directory is inside the workspace
- Theme:
  - `generateTheme`: writes CSS theme files for design iterations

---

### Build System
- `esbuild.js`
  - Extension bundle: CJS, entry `src/extension.ts` → `dist/extension.js` (externalizes `vscode`)
  - Webview bundle: ESM, entry `src/webview/index.tsx` → `dist/webview.js` (loaders for `.css/.png/.jpg/.svg`)
  - Copies `src/assets` → `dist/src/assets`
  - Production: minification and content embedding disabled

---

### Configuration and Conventions
- Settings:
  - Nunjucks (resource scope):
    - `tad.nunjucks.templateRoots` (default: `[".tad/templates", "."]`)
    - `tad.nunjucks.defaultExtensions` (default: `[".njk", ".nunjucks", ".html"]`)
    - `tad.nunjucks.ignore` (default: `["**/node_modules/**", ".tad/dist/**"]`)
  - AI (application scope):
    - `tad.aiModelProvider` = `openai` | `openrouter` | `anthropic`
    - `tad.aiModel` (e.g., `gpt-4o`, `openrouter/auto`)
    - API keys: `tad.openaiApiKey`, `tad.openrouterApiKey`
- Workspace layout:
  - Working dir: `.tad/`
  - Design drafts: `.tad/design_iterations/**/*`
  - Build outputs: `.tad/dist/{pages,components}/**/*`
  - Spaces config: `.tad/spaces.json`
  - Optional: `.tad/dist/{manifest.json,canvas-metadata.json}`

---

### Core Flows (End-to-End)
- Nunjucks navigation:
  - Cursor inside include/relationship path → parse ranges → resolver tries relative, roots/space, content dirs, then basename search → open target; unresolved targets surface diagnostics and hover/link tooltips
- Build & preview:
  - Run “Compile Templates (tad)” → ensure/sync builder → install deps if needed → run build → Canvas watches dist folders and posts updates → when opening files, Canvas inlines local CSS for accurate preview
- Chat streaming and tool calls:
  - Webview sends `chatMessage` with `CoreMessage[]` → agent streams assistant/tool-call deltas → tools operate inside `.tad/` and stream results → UI reflects progress and actions → `chatStreamEnd`
- Canvas ↔ Chat bridging:
  - Canvas can post `setContextFromCanvas` and `setChatPrompt` → sidebar receives and updates prompt/context, enabling design-centric chat workflows

---

### Security Notes (Current State)
- API keys stored in VS Code settings (not SecretStorage)
- Chat webview CSP allows `'unsafe-inline'` scripts (improvement: unify on nonced scripts like Canvas)
- Some provider routing constants should be externalized
- Image uploads are saved under `.tad/moodboard/` with basic checks; base64 conversion happens in the extension

---

### Notable Dependencies
- Runtime: TypeScript 5.8, Node 20 types
- Frontend: React 19, `react-markdown`, `remark-gfm`, `rehype-highlight`, `highlight.js`, `lucide-react`
- Build: `esbuild` 0.25
- AI: `ai` SDK 4.x, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`, `@ai-sdk/anthropic`
