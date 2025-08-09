### Superdesign Architecture

#### Overview
Superdesign is a VS Code extension that embeds an AI-powered design/chat agent and a visual Canvas. It consists of:
- Extension host (Node/TypeScript) that registers commands, hosts webviews, mediates tool calls, and integrates AI providers
- React-based webviews for the sidebar Chat and the Canvas panel
- A small toolbox of file/system utilities exposed to the AI agent
- A local workspace directory, `.superdesign/`, for generated assets and design iterations

#### Key Packages and Runtime
- Language/runtime: TypeScript targeting Node 20+, ES2020
- VS Code API: `@types/vscode` and runtime `vscode` (externalized from bundle)
- Build: esbuild (custom `esbuild.js` for extension and webview)
- UI: React 19 + ReactDOM, CSS bundled as text by esbuild
- AI: `ai` SDK with providers `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@openrouter/ai-sdk-provider`

---

### Extension Host (Backend)

#### Entry and Activation
- Entry: `dist/extension.js` (built from `src/extension.ts`)
- Activation events (from `package.json`):
  - `onCommand:superdesign.helloWorld`
  - `onView:superdesign.chatView`
- Contributions (selected):
  - Commands: `superdesign.showChatSidebar`, `superdesign.openCanvas`, `superdesign.initializeProject`, API key configuration commands, etc.
  - Views: webview view `superdesign.chatView` in activity bar container `superdesign-sidebar`
  - Configuration: settings under `superdesign.*` (provider, model, API keys)

#### Services
- `CustomAgentService` (`src/services/customAgentService.ts`)
  - Central AI integration using `ai` SDK and provider factories (OpenAI/Anthropic/OpenRouter)
  - Streams assistant/tool messages to the webview
  - Provides tool suite to the model: read, write, edit, multiedit, ls, grep, glob, bash, generateTheme
  - Working directory: `.superdesign` (workspace root if available; OS temp folder otherwise)
  - Model/provider selection:
    - If `superdesign.aiModel` is set, infers provider from name (contains `/` → OpenRouter, else OpenAI)
    - Otherwise uses provider default model (`gpt-4o` or `openrouter/auto`)
 
- `ChatMessageService` (`src/services/chatMessageService.ts`)
  - Receives chat requests from webview, orchestrates streaming responses
  - Converts streaming chunks and tool calls into webview-friendly messages
  - Centralizes API key error handling with actionable fixes (open settings/commands)
- `Logger` (`src/services/logger.ts`)
  - Named output channel "Superdesign" with levels DEBUG/INFO/WARN/ERROR

#### Webview Providers and Panels
- `ChatSidebarProvider` (`src/providers/chatSidebarProvider.ts`)
  - Hosts the sidebar chat webview, sets initial HTML via `generateWebviewHtml`
  - Bridges messages between webview and `ChatMessageService`/extension commands
  - Handles provider/model selection via VS Code configuration
- `SuperdesignCanvasPanel` (class in `src/extension.ts`)
  - A standalone panel that renders the Canvas view (also React) via `dist/webview.js`
  - Watches `.superdesign/design_iterations/**/*.{html,svg,css}` and notifies the webview on create/change/delete
  - Inlines relative CSS `<link>` tags into HTML for preview fidelity inside the webview

#### Commands (selected)
- API key configuration: `superdesign.configureApiKey` (Anthropic), `superdesign.configureOpenAIApiKey`, `superdesign.configureOpenRouterApiKey`
- `superdesign.showChatSidebar` to reveal the sidebar
- `superdesign.openCanvas` to show the Canvas panel
- `superdesign.initializeProject` to scaffold `.superdesign/`, baseline CSS, and authoring rules for popular IDE agents
- `superdesign.clearChat` and `superdesign.resetWelcome` for UX controls

#### Local Project Scaffolding
- `initializeSuperdesignProject()` creates:
  - `.superdesign/design_iterations/`
  - A default CSS theme `default_ui_darkmode.css`
  - AI authoring rules in `.cursor/rules/design.mdc`, `CLAUDE.md`, `.windsurfrules`

---

### Tools Exposed to the Agent (`src/tools/*`)
- `read-tool`, `write-tool`, `edit-tool`, `multiedit-tool`: file I/O and editing primitives with guardrails
- `glob-tool`, `grep-tool`, `ls-tool`: discovery and content search
- `bash-tool`: executes shell commands with timeouts, unsafe-command checks, and Windows-aware shell selection (`cmd.exe /c`)
- `theme-tool`: writes CSS themes to disk for preview/use
- All tools validate workspace paths and return structured results suitable for streaming to the chat UI

---

### Webviews (Frontend)

#### Build Outputs
- Single JS bundle for webview: `dist/webview.js` (ESM, JSX automatic)
- Assets from `src/assets` are referenced via `webview.asWebviewUri`

#### Sidebar Chat
- HTML template: `src/templates/webviewTemplate.ts`
  - Injects `window.__WEBVIEW_CONTEXT__` (layout, extension URIs, logo URIs)
  - CSP: restricts default-src, allows inline style and images from webview origin; currently allows `'unsafe-inline'` script in chat view
- React entry: `src/webview/index.tsx`
  - Renders `ChatInterface` for sidebar, `App` for panel when appropriate
- App and components: `src/webview/App.tsx`, `src/webview/components/*`
  - `ChatInterface` handles:
    - Conversation UI with streaming assistant and tool messages
    - Model selection (delegated to extension via `postMessage`)
    - Drag-and-drop and paste of images → saved by extension into `.superdesign/moodboard/` and then referenced or converted to base64 for vision models
    - Welcome flow and Canvas auto-open handshakes (`checkCanvasStatus`/`autoOpenCanvas`)

#### Canvas Panel
- Created from `src/extension.ts` (class `SuperdesignCanvasPanel`)
- HTML is directly constructed with a nonce and loads `dist/webview.js`
- Provides `window.__WEBVIEW_CONTEXT__` with logo URIs for in-webview rendering
- Receives file watcher events to update the gallery of design outputs

---

### Build System (`esbuild.js`)
- Produces two contexts:
  - Extension bundle: CJS, `src/extension.ts` → `dist/extension.js`, externalizes `vscode`
  - Webview bundle: ESM, `src/webview/index.tsx` → `dist/webview.js`, loaders for `.css/.png/.jpg/.svg`
- `--watch` mode builds both contexts and logs problem-matcher friendly output
- Post-build steps:
 
  - Copies `src/assets` into `dist/src/assets`

---

### Configuration and State
- VS Code Settings (`superdesign.*`):
  - `aiModelProvider`: `openai` | `anthropic` | `openrouter` (default `anthropic`)
  - `aiModel`: model ID (e.g., `gpt-4o`, `openrouter/auto`)
  - `anthropicApiKey`, `openaiApiKey`, `openrouterApiKey`: currently stored in VS Code settings scope
- Working directory: `.superdesign/` in the active workspace (fallback to temp dir)
- Generated outputs: `.superdesign/design_iterations/*.{html,svg,css}` and `.superdesign/moodboard/*` for images

---

### Data Flow (Typical Chat Round Trip)
- Webview posts `chatMessage` with conversation or prompt → `ChatMessageService`
- `CustomAgentService.query` calls `ai` SDK with tools and system prompt → streams chunks
- For assistant text chunks: forwarded to webview as `chatResponseChunk`
- For tool calls: forwarded as `tool-call` with streaming updates; tool executes; tool results forwarded as `tool-result`
- On finish: `chatStreamEnd` sent to webview

---

### Security and Privacy Notes (as-implemented)
- API keys are stored in VS Code settings, not in secret storage (recommendation: migrate to `vscode.SecretStorage`)
- CSP for chat webview allows `'unsafe-inline'` scripts; Canvas uses a nonce. Recommend using nonce in both and removing `'unsafe-inline'`
- A Supabase anon key and Helicone proxy keys are currently hardcoded in source (see quality-review.md)
- Uploaded images are written to the workspace under `.superdesign/moodboard/` after size checks; extensions infer MIME by filename and content type for base64 conversion

---

### Notable Dependencies and Versions
- React 19 (`react`, `react-dom`), `highlight.js`, `react-markdown`, `rehype-highlight`, `remark-gfm`, `lucide-react`
- `ai` SDK 4.x with provider factories
- Tooling: `esbuild` 0.25, ESLint 9.x with `@typescript-eslint`
- TypeScript 5.8, Node types 20.x
