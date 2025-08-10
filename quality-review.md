### Quality Review

#### Summary
Tad has been narrowed to focus on Nunjucks template workflows in VS Code. Current scope centers on:
- Nunjucks language features (definition, completion, symbols, diagnostics)
- Optional Canvas panel for previewing `.tad/dist` outputs (with CSS inlining, spaces, tags/relationships)
- Optional chat sidebar powered by the `ai` SDK with a small, scoped toolset

Build tooling (esbuild + TypeScript), structure, and messaging remain clean and maintainable.

Note on scope changes: legacy/experimental functionality outside this Nunjucks/builder/canvas/chat flow has been removed. The extension no longer ships large bundled frameworks from earlier iterations and keeps the surface area intentionally small.

---

### Strengths
- Nunjucks language support is practical and fast:
  - Cross-root indexing and watching via `TemplateIndex`
  - Target resolution via `TemplateResolver` for `{% include|import|extends %}`
  - Document symbols for blocks/macros; path completion; real-time diagnostics including relationship annotations
- Clear layering:
  - Extension host (commands, configuration, Nunjucks features, builder orchestration, AI tool broker)
  - Webviews (Chat sidebar, Canvas panel) sharing a single bundle
  - Explicit postMessage protocol with streaming support
- Canvas/builder integration is optional but useful:
  - Watches `.tad/dist` and `.tad/design_iterations`; inlines local CSS for fidelity
  - Optional manifest/metadata mapping for template→output and tags/relationships
- Lightweight AI integration via `ai` SDK with model selection; tool surface is constrained and auditable
- Developer ergonomics: `Logger` output channel, commands for syncing a packaged builder, creating template spaces, and initializing project scaffolding

### Weaknesses / Risks
- Secrets and network posture
  - API keys live in VS Code settings (not `SecretStorage`)
  - Hardcoded external keys/routes exist in source:
    - Supabase anon key in `src/extension.ts` (newsletter/email capture)
    - Helicone proxy headers in `CustomAgentService` for OpenAI routing
- Webview CSP
  - Chat HTML uses `'unsafe-inline'` in CSP; Canvas uses a stricter nonce-based policy
- Compliance
  - Outbound calls to Supabase and optional Helicone proxying may be unacceptable in some environments
- Testing/CI
  - No visible CI. Limited automated tests for providers, Canvas, or Nunjucks flows

### Immediate Remediations (High Priority)
- Secrets & endpoints
  - Migrate API keys to `vscode.SecretStorage`; do not log key prefixes
  - Remove hardcoded Helicone credentials and make proxy opt‑in via settings
  - Remove or gate Supabase email capture; externalize key to settings if retained
- Webview CSP
  - Drop `'unsafe-inline'` in chat webview; adopt nonce-based loading (Canvas pattern)
- Documentation
  - Document all third‑party endpoints and provide a global "disable external calls" setting

### Short-Term Improvements
- CI: type-check, ESLint, build on PR; basic webview and provider tests
- Tools hardening: tighten bash/read/write/edit constraints (path allowlists, file size caps)
- Nunjucks UX: offer completion inside relationship annotations; add quick‑fixes for unresolved targets
- Commands: add command to open `.tad/` and to purge `.tad/moodboard` safely

### Medium-Term Opportunities
- Configuration: workspace-level JSON for provider/model overrides; safer defaults
- Observability: structured event logs for tool calls (duration, success/error, file targets) with user consent
- Canvas performance: continue virtualization/culling improvements for very large graphs

### Executive View (Risk vs. Readiness)
- Feature set appropriate for a focused, template-centric extension
- Key risks: secret handling, CSP looseness, hardcoded external endpoints
- Remediation time for high‑priority items: ~2–3 engineering days
- After remediation: suitable for internal pilots; marketplace readiness pending security review