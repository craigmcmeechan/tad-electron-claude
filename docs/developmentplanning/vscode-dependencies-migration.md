# VS Code Extension to Standalone Electron Migration: Dependencies Analysis

## Executive Summary

This document analyzes the VS Code extension dependencies in the TAD project and provides a comprehensive migration strategy to transform it into a standalone Electron application. The migration involves replacing VS Code-specific APIs with native Node.js and Electron equivalents while preserving core functionality.

## Current VS Code Extension Architecture

### Core Dependencies Analysis

#### 1. VS Code Extension APIs (`vscode` namespace)

**Primary APIs Used:**
- `vscode.ExtensionContext` - Extension lifecycle and state management
- `vscode.workspace` - File system operations and workspace management
- `vscode.window` - UI interactions (show messages, open editors, create panels)
- `vscode.commands` - Command registration and execution
- `vscode.languages` - Language server protocol integration
- `vscode.WebviewPanel` / `vscode.WebviewView` - Webview management
- `vscode.Uri` - URI handling and path manipulation
- `vscode.FileSystemWatcher` - File system monitoring

**Key Usage Patterns:**
```typescript
// Extension activation and context
export function activate(context: vscode.ExtensionContext) {
  // Command registration
  context.subscriptions.push(
    vscode.commands.registerCommand('tad.buildTemplates', buildHandler)
  );

  // Webview creation
  const panel = vscode.window.createWebviewPanel(
    'tadCanvas', 'TAD Canvas', vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [...] }
  );

  // File system operations
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, '**/*.njk')
  );
}
```

#### 2. Webview Architecture Dependencies

**Current Implementation:**
- Dual webview system (sidebar chat + canvas panel)
- Message passing protocol between extension and webviews
- Content Security Policy (CSP) management
- Resource loading restrictions

**Key Components:**
```typescript
// Webview message handling
webview.onDidReceiveMessage(async (message) => {
  switch (message.command) {
    case 'chatMessage': handleChat(message, webview); break;
    case 'loadDesignFiles': loadFiles(message.data); break;
  }
});

// Webview HTML generation with CSP
const html = `
  <!DOCTYPE html>
  <script src="${scriptUri}"></script>
  <meta http-equiv="Content-Security-Policy" content="...">
`;
```

#### 3. Language Server Protocol Dependencies

**Nunjucks LSP Integration:**
- Definition providers (`vscode.languages.registerDefinitionProvider`)
- Completion providers (`vscode.languages.registerCompletionItemProvider`)
- Hover providers (`vscode.languages.registerHoverProvider`)
- Document symbol providers
- Diagnostic collection and reporting

**Key Implementation:**
```typescript
// LSP provider registration
context.subscriptions.push(
  vscode.languages.registerDefinitionProvider(
    { language: 'nunjucks' },
    new NunjucksDefinitionProvider(resolver)
  ),
  vscode.languages.registerCompletionItemProvider(
    { language: 'nunjucks' },
    new NunjucksCompletionProvider(index)
  )
);
```

## Migration Strategy: VS Code APIs to Electron Equivalents

### Phase 1: Core Application Framework Migration

#### 1. Extension Context → Electron Main Process

**Current VS Code Implementation:**
```typescript
export function activate(context: vscode.ExtensionContext) {
  // Global state management
  const globalState = context.globalState;

  // Extension-specific storage
  const extensionPath = context.extensionPath;

  // Subscription management
  context.subscriptions.push(disposable);
}
```

**Electron Equivalent:**
```typescript
// main.js - Electron main process
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

class TADApplication {
  constructor() {
    this.mainWindow = null;
    this.userDataPath = app.getPath('userData');
    this.appPath = app.getAppPath();
  }

  async initialize() {
    // Create main window
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Load application
    await this.mainWindow.loadFile('src/index.html');

    // Setup IPC handlers
    this.setupIPCHandlers();
  }

  setupIPCHandlers() {
    ipcMain.handle('get-app-path', () => this.appPath);
    ipcMain.handle('get-user-data-path', () => this.userDataPath);
    ipcMain.handle('read-global-state', async (key) => {
      // Read from user data directory
    });
  }
}
```

#### 2. Workspace Management Migration

**Current VS Code Implementation:**
```typescript
// Workspace operations
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
const config = vscode.workspace.getConfiguration('tad');

// File operations
await vscode.workspace.fs.writeFile(uri, content);
const files = await vscode.workspace.findFiles('**/*.njk');
```

**Electron Equivalent:**
```typescript
// Native Node.js file system operations
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob-promise');

class WorkspaceManager {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
  }

  async initialize() {
    // Validate workspace
    await fs.access(this.workspacePath);

    // Setup file watchers
    this.setupFileWatchers();
  }

  async readFile(filePath) {
    const fullPath = path.resolve(this.workspacePath, filePath);
    return await fs.readFile(fullPath, 'utf8');
  }

  async writeFile(filePath, content) {
    const fullPath = path.resolve(this.workspacePath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }

  async findFiles(pattern) {
    return await glob(pattern, {
      cwd: this.workspacePath,
      absolute: true
    });
  }

  setupFileWatchers() {
    // Use chokidar for file watching
    const chokidar = require('chokidar');
    this.watcher = chokidar.watch('**/*.njk', {
      cwd: this.workspacePath,
      ignoreInitial: true
    });

    this.watcher.on('change', (filePath) => {
      this.mainWindow.webContents.send('file-changed', filePath);
    });
  }
}
```

#### 3. Window Management Migration

**Current VS Code Implementation:**
```typescript
// Panel creation
const panel = vscode.window.createWebviewPanel(
  'tadCanvas', 'TAD Canvas', vscode.ViewColumn.One,
  { enableScripts: true }
);

// Message handling
panel.webview.onDidReceiveMessage(message => {
  // Handle message
});
```

**Electron Equivalent:**
```typescript
// Electron window management
const { BrowserWindow } = require('electron');

class WindowManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.panels = new Map();
  }

  async createCanvasPanel() {
    const panelWindow = new BrowserWindow({
      parent: this.mainWindow,
      modal: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'canvas-preload.js')
      }
    });

    await panelWindow.loadFile('src/canvas.html');
    this.panels.set('canvas', panelWindow);

    // Setup IPC communication
    this.setupPanelCommunication(panelWindow);

    return panelWindow;
  }

  setupPanelCommunication(panelWindow) {
    // Handle messages from panel
    ipcMain.on('canvas-message', (event, message) => {
      this.handleCanvasMessage(message, panelWindow);
    });
  }
}
```

### Phase 2: Webview Architecture Migration

#### 1. Webview Replacement Strategy

**Current VS Code Webviews:**
- `WebviewView` for sidebar chat interface
- `WebviewPanel` for canvas visualization
- Message passing via `postMessage`
- CSP restrictions and resource loading controls

**Electron Equivalent:**
```typescript
// Electron webview replacement using BrowserView or iframe
const { BrowserView } = require('electron');

class WebviewManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.views = new Map();
  }

  createChatView() {
    const chatView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'chat-preload.js')
      }
    });

    this.mainWindow.setBrowserView(chatView);
    chatView.setBounds({ x: 0, y: 0, width: 300, height: 600 });

    // Load chat interface
    chatView.webContents.loadFile('src/chat.html');

    this.views.set('chat', chatView);
    return chatView;
  }

  createCanvasView() {
    const canvasView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'canvas-preload.js')
      }
    });

    // Load canvas interface
    canvasView.webContents.loadFile('src/canvas.html');

    this.views.set('canvas', canvasView);
    return canvasView;
  }
}
```

#### 2. Message Passing Protocol Migration

**Current VS Code Implementation:**
```typescript
// Extension to webview
webview.postMessage({ command: 'loadFiles', data: files });

// Webview to extension
vscode.postMessage({ command: 'chatMessage', message: text });
```

**Electron Equivalent:**
```typescript
// Main process to renderer
mainWindow.webContents.send('extension-message', {
  command: 'loadFiles',
  data: files
});

// Renderer to main process
const { ipcRenderer } = require('electron');
ipcRenderer.send('renderer-message', {
  command: 'chatMessage',
  message: text
});
```

### Phase 3: Language Server Protocol Migration

#### 1. LSP Provider Migration

**Current VS Code Implementation:**
```typescript
// Register LSP providers
vscode.languages.registerDefinitionProvider(selector, provider);
vscode.languages.registerCompletionItemProvider(selector, provider);
```

**Electron Equivalent:**
```typescript
// Native LSP implementation using language server protocol
const { spawn } = require('child_process');

class LanguageServerManager {
  constructor() {
    this.serverProcess = null;
    this.requestId = 0;
  }

  async startServer() {
    // Start Nunjucks language server
    this.serverProcess = spawn('nunjucks-language-server', [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Setup JSON-RPC communication
    this.setupRPC();
  }

  async requestDefinition(filePath, position) {
    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method: 'textDocument/definition',
      params: {
        textDocument: { uri: `file://${filePath}` },
        position
      }
    };

    return this.sendRequest(request);
  }
}
```

#### 2. Diagnostic System Migration

**Current VS Code Implementation:**
```typescript
// Diagnostic collection
const diagnostics = vscode.languages.createDiagnosticCollection('nunjucks');
diagnostics.set(document.uri, [diagnostic]);
```

**Electron Equivalent:**
```typescript
class DiagnosticManager {
  constructor() {
    this.diagnostics = new Map();
  }

  async validateDocument(filePath, content) {
    // Run Nunjucks validation
    const issues = await this.validateNunjucks(content);

    // Store diagnostics
    this.diagnostics.set(filePath, issues);

    // Send to renderer for display
    this.mainWindow.webContents.send('diagnostics-update', {
      filePath,
      diagnostics: issues
    });
  }

  async validateNunjucks(content) {
    const diagnostics = [];

    // Parse Nunjucks syntax
    // Check for unresolved includes, extends, etc.
    // Return diagnostic objects

    return diagnostics;
  }
}
```

### Phase 4: Configuration and Settings Migration

#### 1. Settings Management

**Current VS Code Implementation:**
```typescript
// Read settings
const config = vscode.workspace.getConfiguration('tad.nunjucks');
const templateRoots = config.get('templateRoots', ['.']);

// Listen for changes
vscode.workspace.onDidChangeConfiguration(event => {
  if (event.affectsConfiguration('tad')) {
    // Reload configuration
  }
});
```

**Electron Equivalent:**
```typescript
const Store = require('electron-store');

class ConfigurationManager {
  constructor() {
    this.store = new Store({
      name: 'tad-config',
      defaults: {
        nunjucks: {
          templateRoots: ['.'],
          defaultExtensions: ['.njk', '.nunjucks', '.html']
        },
        ai: {
          provider: 'openai',
          model: 'gpt-4o'
        }
      }
    });
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    this.store.set(key, value);
    // Notify all windows of config change
    this.notifyConfigChange(key, value);
  }

  notifyConfigChange(key, value) {
    // Send to all renderer processes
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('config-changed', { key, value });
    });
  }
}
```

### Phase 5: Security and Sandboxing Migration

#### 1. Content Security Policy

**Current VS Code Implementation:**
```typescript
// Webview CSP
const csp = [
  "default-src 'none'",
  "script-src 'nonce-${nonce}'",
  "style-src 'unsafe-inline'",
  "connect-src 'none'"
].join('; ');
```

**Electron Equivalent:**
```typescript
// Electron CSP via meta tag or headers
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:"
].join('; ');

// Apply CSP in HTML
const html = `
  <!DOCTYPE html>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <!-- content -->
`;
```

#### 2. Preload Scripts for Secure Communication

**Electron Preload Script:**
```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message) => ipcRenderer.send('renderer-message', message),
  onMessage: (callback) => ipcRenderer.on('extension-message', callback),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content)
});
```

### Phase 6: Build System and Packaging Migration

#### 1. Extension Packaging → Electron Packaging

**Current VS Code Build:**
```json
// package.json scripts
{
  "scripts": {
    "compile": "tsc -p .",
    "package": "vsce package",
    "publish": "vsce publish"
  }
}
```

**Electron Build:**
```json
// package.json for Electron
{
  "scripts": {
    "build": "webpack --mode production",
    "dist": "electron-builder",
    "start": "electron ."
  },
  "build": {
    "appId": "com.tad.template-design",
    "productName": "TAD",
    "directories": {
      "output": "dist-electron"
    }
  }
}
```

#### 2. Asset Management Migration

**Current Extension Assets:**
- Bundled in `.vsix` package
- Accessed via `context.extensionPath`
- Copied to workspace on first use

**Electron Assets:**
```typescript
// Asset management in Electron
class AssetManager {
  constructor() {
    this.appPath = app.getAppPath();
    this.userDataPath = app.getPath('userData');
  }

  async ensureWorkspaceAssets(workspacePath) {
    const tadDir = path.join(workspacePath, '.tad');
    const builderDir = path.join(tadDir, 'builder');

    // Copy builder assets from app resources
    await this.copyAssets(
      path.join(this.appPath, 'assets', 'builder'),
      builderDir
    );
  }
}
```

## Migration Implementation Plan

### Step 1: Project Structure Setup
```
tad-electron/
├── main.js              # Electron main process
├── preload.js           # Secure API bridge
├── src/
│   ├── index.html       # Main window
│   ├── chat.html        # Chat interface
│   ├── canvas.html      # Canvas interface
│   ├── main.js          # Renderer entry
│   ├── chat.js          # Chat renderer
│   └── canvas.js        # Canvas renderer
├── assets/
│   └── builder/         # Build tools
├── package.json
└── build.js             # Build configuration
```

### Step 2: Core Module Migration Priority

1. **High Priority (Core Functionality):**
   - Extension context → Main process setup
   - Workspace management → Native file operations
   - Webview system → BrowserView/iframes
   - Message passing → IPC communication

2. **Medium Priority (Enhanced Features):**
   - LSP integration → Native language server
   - Configuration → Electron-store
   - File watching → Chokidar
   - Command system → IPC-based commands

3. **Low Priority (Polish):**
   - Settings UI → Native preferences
   - Theme integration → Electron theming
   - Extension marketplace → Built-in update system

### Step 3: Testing and Validation Strategy

#### Unit Testing Migration
```typescript
// VS Code extension tests
import * as vscode from 'vscode';
import { activate } from '../src/extension';

// Electron equivalent
import { app } from 'electron';
import TADApplication from '../src/main/TADApplication';
```

#### Integration Testing
- File system operations
- IPC communication
- Webview rendering
- LSP functionality

#### End-to-End Testing
- Complete workflow testing
- Performance benchmarking
- Memory usage monitoring

## Risk Assessment and Mitigation

### High-Risk Areas

1. **Webview Security:**
   - **Risk:** CSP bypass, script injection
   - **Mitigation:** Strict CSP, context isolation, preload scripts

2. **File System Access:**
   - **Risk:** Unauthorized file access, path traversal
   - **Mitigation:** Path validation, workspace boundaries, permission checks

3. **Performance:**
   - **Risk:** Memory leaks, slow startup
   - **Mitigation:** Proper cleanup, lazy loading, performance monitoring

4. **Platform Compatibility:**
   - **Risk:** Windows/macOS/Linux differences
   - **Mitigation:** Cross-platform testing, conditional code paths

### Success Metrics

- **Functional Completeness:** All VS Code features working in Electron
- **Performance:** Startup time < 5 seconds, memory usage < 200MB
- **Security:** No CSP violations, secure file operations
- **User Experience:** Seamless transition from extension to standalone app

## Conclusion

The migration from VS Code extension to Electron application is technically feasible but requires careful planning and implementation. The key challenges involve:

1. **API Translation:** Replacing VS Code APIs with native Node.js/Electron equivalents
2. **Security Model:** Implementing proper sandboxing and CSP in Electron
3. **Architecture Changes:** Adapting from extension-host model to main/renderer process model
4. **Build System:** Migrating from VS Code packaging to Electron distribution

The phased approach outlined above provides a structured path to successfully transform TAD into a standalone, cross-platform desktop application while preserving all core functionality.

## Next Steps

1. **Prototype Core Migration:** Implement main process and basic window management
2. **Webview Migration:** Convert VS Code webviews to Electron BrowserViews
3. **File System Migration:** Replace VS Code workspace APIs with native operations
4. **LSP Integration:** Implement native language server communication
5. **Testing and Validation:** Comprehensive testing of migrated functionality
6. **Packaging and Distribution:** Set up Electron Builder for cross-platform distribution

This migration will enable TAD to run independently of VS Code while maintaining its powerful template development capabilities.