## Template Compiler and VS Code Host Integration

This document describes the template compiler program, how the app initializes in the VS Code host, and how input events flow through the system. It includes practical code examples and references to source files in this repository.

### What the compiler does

The compiler lives at `.tad/builder/build.js`. It compiles a Nunjucks-based template system into browsable HTML with a manifest the Canvas can consume.

- Renders `pages/**/*.njk` to `dist/{space}/pages/**/*.html`
- Generates component preview pages for each state defined alongside `components/**/*.njk`
- Copies/uses a `design-system.css` at each space root
- Emits `manifest.json` (mappings, dependencies, relationships, tags) and `canvas-metadata.json` (tags)
- Supports multiple “spaces” via `.tad/spaces.json` or falls back to a legacy single-space if absent

Key entry and per-space build:

```1:32:src/assets/builder/build.js
const nunjucks = require('nunjucks');
const defaultTemplateExtensions = ['.njk', '.nunjucks', '.html'];

async function buildSingleSpace(params) {
  const { workspaceRoot, appDir, spaceName, templateRootAbs, distDirAbs } = params;
  // ... establishes dirs, configures Nunjucks env, prepares outputs ...
}
```

#### Nunjucks environment
- Loader search paths: `pages`, `components`, `elements`
- `autoescape: false` (templates must escape as needed)
- Global data: `{ titleSuffix: '— Wireframe', designSystemCssHref }`

```28:37:src/assets/builder/build.js
const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(searchPaths, { noCache: true }),
  { autoescape: false }
);
const globalData = { titleSuffix: '— Wireframe' };
```

#### Pages pipeline
1. Glob `pages/**/*.njk`
2. Render to `dist/pages/{same}.html`
3. Beautify HTML with `js-beautify`
4. Scan dependencies (`include`, `import`, `from`, `extends` → components/elements)
5. Extract tags and relationships for `manifest.json` and `canvas-metadata.json`

```264:299:src/assets/builder/build.js
const rendered = env.render(path.relative(pagesDir, src), { ...globalData, designSystemCssHref: cssHref });
await fs.writeFile(dest, prettyRendered, 'utf8');
// ... scanDependencies(src) → components/elements
// ... extractTagsFromSource(pageSrc)
// ... extractRelationshipsForPage(pageSrc, src)
```

#### Components pipeline and states
- Components are Nunjucks macros (one per file recommended)
- Optional `MyComponent.states.json` provides named `props` states; otherwise a default state is used
- For each state, the compiler renders a wrapper HTML page invoking the macro with the state props

```315:361:src/assets/builder/build.js
const macroMatch = compSource.match(/{%\s*macro\s+([A-Za-z_][\w]*)\s*\(/);
// ... load states from MyComponent.states.json or default
const wrapper = `<!doctype html>...{% from "${importTarget}" import ${macroName} as Comp %}\n{{ Comp(props) }}`;
const rendered = env.renderString(wrapper, { props });
```

#### Relationship annotations in templates
Put at the very top of a Nunjucks file inside a comment block. Both YAML-style and shorthand are supported.

```nunjucks
{#
relationships:
  next:
    - pages/2.studyview.0.home.njk
  related:
    - pages/3.library.overview.njk
#}
```

```nunjucks
{# @rel next: pages/2.studyview.0.home.njk #}
{# @rel related: pages/3.library.overview.njk, pages/4.notes.index.njk #}
```

Targets resolve against `pages/` only (for relationships), via configured roots and default extensions. Unresolved targets are logged during build.

Resolution and extraction implementation:

```151:261:src/assets/builder/build.js
const REL_KEYS = ['next', 'prev', 'parent', 'children', 'related'];
// extractTopNunjucksComment → extractRelationshipsFromYamlBlock / extractRelationshipsFromRelShorthand
// resolveRelationshipTarget(currentFile, target) → pages-relative .html outputs
```

#### Multi-space support and outputs
- If `.tad/spaces.json` exists, each `space` defines a `{ name, templateRoot, distDir }`
- Otherwise, legacy behavior builds `.tad/templates` → `.tad/dist` and mirrors pages to `.tad/design_iterations`

```405:445:src/assets/builder/build.js
async function main() {
  const spacesConfigPath = path.join(root, 'spaces.json');
  if (hasSpaces) { /* iterate spaces and buildSingleSpace */ }
  // Legacy single-space behavior
  await buildSingleSpace({ /* templateRootAbs: .tad/templates, distDirAbs: .tad/dist */ });
}
```

### How the extension initializes (VS Code host)

The extension entrypoint is `src/extension.ts` (`activate`). On activation it:

- Initializes logging and services (e.g., `CustomAgentService`)
- Activates Nunjucks language features (`activateNunjucks`) for definitions, hovers, completions, links, diagnostics
- Registers the sidebar webview (`ChatSidebarProvider`) and the canvas panel
- Registers commands, including the compiler command `tad.buildTemplates`

```1298:1356:src/extension.ts
export function activate(context: vscode.ExtensionContext) {
  Logger.initialize();
  const customAgent = new CustomAgentService(Logger.getOutputChannel());
  activateNunjucks(context);
  const sidebarProvider = new ChatSidebarProvider(context.extensionUri, customAgent, Logger.getOutputChannel());
  vscode.window.registerWebviewViewProvider(ChatSidebarProvider.VIEW_TYPE, sidebarProvider, { webviewOptions: { retainContextWhenHidden: true } });
  // ...commands registration...
}
```

#### Compiler command from VS Code
The `tad.buildTemplates` command ensures a workspace-local builder exists (seeding from bundled assets if needed), then runs the build using the detected package manager or falls back to `node build.js`. Output is streamed to the tad output channel with a progress notification.

```1581:1672:src/extension.ts
const buildTemplatesDisposable = vscode.commands.registerCommand('tad.buildTemplates', async () => {
  const ensured = await ensureWorkspaceBuilder(context, workspaceFolder.uri, Logger);
  await vscode.window.withProgress({ title: 'Building Tad templates', location: vscode.ProgressLocation.Notification }, async () => {
    // detect pnpm/yarn/npm; run `install` if needed, then `run build` or node build.js
    const child = execaNode('build.js', { cwd: builderFsPath });
    child.stdout?.on('data', (d: Buffer) => output.append(d.toString()));
  });
});
```

Seeding the workspace builder:

```1546:1579:src/extension.ts
const ensureWorkspaceBuilder = async (context, workspaceRoot, logger) => {
  const builderDir = vscode.Uri.joinPath(workspaceRoot, '.tad', 'builder');
  // copy from extension assets into .tad/builder if missing
  await copyDirectory(embeddedDir, builderDir);
  return { builderDir, buildJs: vscode.Uri.joinPath(builderDir, 'build.js'), seeded: true } as const;
};
```

### Extension ↔ Webview interaction

- Sidebar chat view (`ChatSidebarProvider`) hosts the React app in a `WebviewView`
- Canvas panel (`tadCanvasPanel`) hosts a full-page webview with file-watching helpers
- Message bridge: webview UI posts messages; the extension responds via `postMessage`

Sidebar message handling (chat and model control):

```57:93:src/providers/chatSidebarProvider.ts
webviewView.webview.onDidReceiveMessage(async (message) => {
  switch (message.command) {
    case 'chatMessage': await this.messageHandler.handleChatMessage(message, webviewView.webview); break;
    case 'stopChat':    await this.messageHandler.stopCurrentChat(webviewView.webview); break;
    case 'executeAction': await vscode.commands.executeCommand(message.actionCommand, message.actionArgs);
    case 'getCurrentProvider': await this.handleGetCurrentProvider(webviewView.webview); break;
    case 'changeProvider':    await this.handleChangeProvider(message.model, webviewView.webview); break;
  }
});
```

Canvas panel message handling (templates, spaces, file open):

```1958:1984:src/extension.ts
this._panel.webview.onDidReceiveMessage(message => {
  switch (message.command) {
    case 'requestSpaces': this._postSpacesInit(); break;
    case 'loadDesignFiles': this._loadDesignFiles(message.data); break;
    case 'openTemplateFile': /* resolve path and showTextDocument */ break;
  }
});
```

### Input event mechanisms

Inputs enter through these channels and drive the app/compiler:

- Command palette/keybindings (host): `tad.buildTemplates`, `tad.openTemplateView`, `tad.openCanvas`, `tad.clearChat`, etc.
- Webview UI events (frontend): React components post messages like `chatMessage`, `stopChat`, `changeProvider`, `autoOpenCanvas`, `requestSpaces`, `openTemplateFile`, `listTemplates`, `readTemplate`, `saveImageToMoodboard`, `getCssFileContent`
- Workspace/editor events (host): `onDidOpenTextDocument`, `onDidChangeTextDocument` trigger diagnostics; `onDidChangeConfiguration` re-initializes Nunjucks resolution; file system watchers index template changes
- Streaming control: `stopChat` signals an `AbortController` on the host to stop an in-flight chat stream

Webview → Extension example:

```tsx
// React webview: send an action
const vscode = acquireVsCodeApi();
vscode.postMessage({ command: 'autoOpenCanvas' });
```

Extension → Webview example:

```ts
// Host: notify sidebar to open the Template View tab
sidebarProvider.sendMessage({ command: 'openTemplateView' });
```

### Relationship authoring quick reference

- Place at the very top of the file in a Nunjucks comment block
- Use arrays for multiple targets; paths can omit extensions
- Keys: `next`, `prev`, `parent`, `children`, `related`

```nunjucks
{#
relationships:
  prev:
    - pages/1.home_dashboard.njk
  parent:
    - pages/2.studyview.index.njk
#}
```

### Example spaces.json

```json
{
  "spaces": [
    {
      "name": "web",
      "templateRoot": ".tad/templates",
      "distDir": ".tad/dist"
    }
  ]
}
```

### Running the compiler

From VS Code: run the command “Tad: Build Templates” (`tad.buildTemplates`). The extension seeds `.tad/builder` if needed and builds with your workspace-local builder, streaming logs to the Tad output channel.


