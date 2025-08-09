### Build Guide

#### Prerequisites
- Node.js 20+
- npm 10+ (or pnpm if preferred)
- VS Code 1.90+ (for running and testing the extension)

#### Install
```bash
npm ci
# or: pnpm install
```

#### Build (one-off)
```bash
npm run compile
```
- Runs type-checks, lints, and esbuild for both the extension and webview
- Outputs to `dist/extension.js` and `dist/webview.js`
- Copies `src/assets/` into `dist/src/assets/`
 

#### Watch (dev loop)
```bash
npm run watch
# runs esbuild in watch mode and tsc --watch in parallel
```

#### Package (production)
```bash
npm run package
```
- Same as compile but minifies and disables source content; suitable for publishing

#### Tests
The repo includes TypeScript-driven test entry points compiled to `dist-test`. To run individual suites:
```bash
npm run test:agent
npm run test:tools
npm run test:read
npm run test:write-edit
npm run test:ls-grep-glob
```
The `test` script invokes `vscode-test` runner setup.

#### Run and Debug in VS Code
1. Open this folder in VS Code/Cursor
2. Press F5 (Run Extension) or use the “Run and Debug” panel to launch an Extension Development Host
3. In the dev host:
   - Open the “Superdesign” activity bar icon
   - Use command palette to run `Superdesign: Show Chat Sidebar` or `Superdesign: Open Canvas View`

#### Configuration (API Keys and Model)
- Open VS Code Settings → search for "Superdesign"
  - `superdesign.aiModelProvider`: `openai` (default), `openrouter`
  - `superdesign.aiModel`: model id (e.g., `gpt-4o`, `openrouter/auto`)
  - `superdesign.openaiApiKey`, `superdesign.openrouterApiKey`
- Or run commands:
  - `Superdesign: Configure OpenAI API Key`
  - `Superdesign: Configure OpenRouter API Key`

#### Workspace Artifacts
- Generated assets live in `.superdesign/` at your workspace root:
  - `design_iterations/` for HTML/SVG/CSS outputs
  - `moodboard/` for uploaded images
  - `dist/` for compiled pages/components (produced by your app/site builder)

#### Build Manifest (for Canvas → Template Mapping)
If you want the Canvas to show which Page/Component/Element templates a compiled page uses and allow opening them, have your site/app builder emit a manifest at:

`.superdesign/dist/manifest.json`

Schema (per compiled file path relative to `.superdesign/dist/`):

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
  },
  "components/card.html": {
    "components": [ { "name": "Card", "path": "src/components/Card.tsx" } ],
    "elements":   [ { "name": "Badge", "path": "src/ui/Badge.tsx" } ]
  }
}
```

Notes:
- Keys must match file paths the Canvas loads (e.g., `pages/*.html`, `components/*.html`).
- `path` can be absolute or workspace-relative. If omitted, the Canvas will still display the name but cannot open the file.
- The extension automatically reads this manifest when viewing the `dist` source and surfaces the data per-frame via a Templates dropdown.

#### Notes
- Windows shells: the Bash tool uses `cmd.exe /c` under the hood; project watch/build works cross-platform via Node (Claude Code has been removed for Windows support)
- Ensure VS Code version matches `engines.vscode` in `package.json` (`^1.90.0`)
