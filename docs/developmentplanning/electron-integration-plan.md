# Electron Integration and Main Process Architecture

## Overview

This document outlines the integration of Electron as the runtime platform for TAD, replacing the VS Code extension host. It covers the main process architecture, window management, IPC communication patterns, and the transition from extension-based to application-based lifecycle management.

## Current VS Code Extension Lifecycle

### Extension Activation Pattern
```typescript
// src/extension.ts
export function activate(context: vscode.ExtensionContext) {
  // 1. Initialize services
  const logger = Logger.initialize();
  const customAgent = new CustomAgentService(logger);

  // 2. Register commands and providers
  registerCommands(context, customAgent);
  activateNunjucks(context);

  // 3. Create webview interfaces
  const sidebarProvider = new ChatSidebarProvider(context.extensionUri, customAgent, logger);
  vscode.window.registerWebviewViewProvider(ChatSidebarProvider.VIEW_TYPE, sidebarProvider);

  // 4. Setup event handlers
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(handleConfigChange),
    vscode.workspace.onDidOpenTextDocument(handleDocumentOpen)
  );
}

export function deactivate() {
  // Cleanup resources
}
```

### Key Extension Components
- **Extension Context**: Manages subscriptions, global state, and extension URI
- **Webview Providers**: Handle sidebar chat and canvas panel creation
- **Command Registration**: VS Code command palette integration
- **Configuration Management**: Workspace and global settings
- **File System Integration**: Workspace folder access and file watching

## Electron Main Process Architecture

### Main Process Entry Point
```typescript
// main.js
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const TADApplication = require('./src/main/TADApplication');

let mainApplication;

app.whenReady().then(() => {
  mainApplication = new TADApplication();
  mainApplication.initialize();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainApplication.createMainWindow();
  }
});
```

### TADApplication Class Design
```typescript
// src/main/TADApplication.js
const { BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const WorkspaceManager = require('./WorkspaceManager');
const WindowManager = require('./WindowManager');
const ConfigurationManager = require('./ConfigurationManager');
const LanguageServerManager = require('./LanguageServerManager');

class TADApplication {
  constructor() {
    this.mainWindow = null;
    this.workspaceManager = null;
    this.windowManager = null;
    this.configManager = null;
    this.languageServer = null;

    this.userDataPath = app.getPath('userData');
    this.appPath = app.getAppPath();
  }

  async initialize() {
    try {
      // Initialize core managers
      await this.initializeCoreManagers();

      // Create main window
      await this.createMainWindow();

      // Setup IPC handlers
      this.setupIPCHandlers();

      // Initialize language server
      await this.initializeLanguageServer();

      // Setup application menu
      this.setupApplicationMenu();

    } catch (error) {
      console.error('Failed to initialize TAD:', error);
      app.quit();
    }
  }

  async initializeCoreManagers() {
    this.configManager = new ConfigurationManager();
    this.workspaceManager = new WorkspaceManager(this.configManager);
    this.windowManager = new WindowManager(this.mainWindow);
  }

  async createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        spellcheck: false
      },
      icon: path.join(__dirname, 'assets', 'icon.png'),
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      show: false // Don't show until ready
    });

    // Load main interface
    await this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Show window when ready to prevent visual flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Setup window event handlers
    this.setupWindowEventHandlers();
  }

  setupIPCHandlers() {
    // Core application IPC handlers
    ipcMain.handle('get-app-info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      userDataPath: this.userDataPath
    }));

    ipcMain.handle('select-workspace', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory'],
        title: 'Select TAD Workspace'
      });

      if (!result.canceled) {
        await this.workspaceManager.setWorkspace(result.filePaths[0]);
        return result.filePaths[0];
      }
    });

    // Delegate to managers
    this.workspaceManager.setupIPCHandlers();
    this.windowManager.setupIPCHandlers();
    this.configManager.setupIPCHandlers();
  }

  setupWindowEventHandlers() {
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      // Cleanup managers
      this.workspaceManager?.dispose();
      this.windowManager?.dispose();
      this.languageServer?.dispose();
    });
  }

  setupApplicationMenu() {
    const template = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Workspace',
            accelerator: 'CmdOrCtrl+O',
            click: () => this.workspaceManager.selectWorkspace()
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => app.quit()
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectall' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forcereload' },
          { role: 'toggledevtools' },
          { type: 'separator' },
          { role: 'resetzoom' },
          { role: 'zoomin' },
          { role: 'zoomout' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
}

module.exports = TADApplication;
```

## Window Management System

### Window Manager Architecture
```typescript
// src/main/WindowManager.js
const { BrowserWindow, BrowserView } = require('electron');
const path = require('path');

class WindowManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.windows = new Map();
    this.views = new Map();
  }

  async createCanvasWindow() {
    const canvasWindow = new BrowserWindow({
      parent: this.mainWindow,
      modal: false,
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'canvas-preload.js')
      },
      title: 'TAD Canvas',
      show: false
    });

    await canvasWindow.loadFile(path.join(__dirname, 'renderer', 'canvas.html'));

    canvasWindow.once('ready-to-show', () => {
      canvasWindow.show();
    });

    this.windows.set('canvas', canvasWindow);
    this.setupCanvasCommunication(canvasWindow);

    return canvasWindow;
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

    // Position chat view as sidebar
    const [width, height] = this.mainWindow.getSize();
    chatView.setBounds({
      x: 0,
      y: 0,
      width: 320,
      height: height
    });

    chatView.webContents.loadFile(path.join(__dirname, 'renderer', 'chat.html'));

    this.views.set('chat', chatView);
    this.setupChatCommunication(chatView);

    return chatView;
  }

  setupCanvasCommunication(canvasWindow) {
    // Handle canvas-specific IPC messages
    const canvasWebContents = canvasWindow.webContents;

    ipcMain.on('canvas-message', (event, message) => {
      if (event.sender === canvasWebContents) {
        this.handleCanvasMessage(message, canvasWindow);
      }
    });
  }

  setupChatCommunication(chatView) {
    const chatWebContents = chatView.webContents;

    ipcMain.on('chat-message', (event, message) => {
      if (event.sender === chatWebContents) {
        this.handleChatMessage(message, chatView);
      }
    });
  }

  handleCanvasMessage(message, canvasWindow) {
    switch (message.command) {
      case 'request-design-files':
        // Load design files for canvas
        this.loadDesignFiles(message.data, canvasWindow);
        break;
      case 'save-canvas-state':
        // Persist canvas state
        this.saveCanvasState(message.data);
        break;
    }
  }

  handleChatMessage(message, chatView) {
    switch (message.command) {
      case 'send-chat-message':
        // Process chat message
        this.processChatMessage(message.data, chatView);
        break;
      case 'stop-chat':
        // Stop current chat
        this.stopCurrentChat(chatView);
        break;
    }
  }

  dispose() {
    // Close all windows and cleanup
    this.windows.forEach(window => {
      if (!window.isDestroyed()) {
        window.close();
      }
    });
    this.views.forEach(view => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    });
  }
}
```

## IPC Communication Architecture

### Preload Script Design
```typescript
// src/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected APIs to renderer processes
contextBridge.exposeInMainWorld('tadAPI', {
  // Application info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // Workspace management
  selectWorkspace: () => ipcRenderer.invoke('select-workspace'),
  getWorkspaceInfo: () => ipcRenderer.invoke('get-workspace-info'),
  setWorkspacePath: (path) => ipcRenderer.invoke('set-workspace-path', path),

  // File operations
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  watchFiles: (pattern, callback) => {
    ipcRenderer.on('file-changed', callback);
    ipcRenderer.send('watch-files', pattern);
  },

  // Configuration
  getConfig: (key) => ipcRenderer.invoke('get-config', key),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  onConfigChange: (callback) => ipcRenderer.on('config-changed', callback),

  // Window management
  openCanvas: () => ipcRenderer.invoke('open-canvas'),
  closeCanvas: () => ipcRenderer.invoke('close-canvas'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),

  // Chat functionality
  sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
  stopChat: () => ipcRenderer.invoke('stop-chat'),
  onChatResponse: (callback) => ipcRenderer.on('chat-response', callback),

  // Language server
  requestDefinition: (filePath, position) => ipcRenderer.invoke('request-definition', { filePath, position }),
  requestCompletion: (filePath, position) => ipcRenderer.invoke('request-completion', { filePath, position }),
  onDiagnosticsUpdate: (callback) => ipcRenderer.on('diagnostics-update', callback),

  // Canvas operations
  loadDesignFiles: (options) => ipcRenderer.invoke('load-design-files', options),
  saveCanvasState: (state) => ipcRenderer.invoke('save-canvas-state', state),
  onDesignFilesLoaded: (callback) => ipcRenderer.on('design-files-loaded', callback)
});

// Handle application-level events
ipcRenderer.on('application-error', (event, error) => {
  console.error('TAD Application Error:', error);
  // Show user-friendly error dialog
});

ipcRenderer.on('workspace-changed', (event, workspaceInfo) => {
  // Update UI with new workspace information
  if (window.tadEventHandlers?.onWorkspaceChanged) {
    window.tadEventHandlers.onWorkspaceChanged(workspaceInfo);
  }
});
```

### Canvas-Specific Preload Script
```typescript
// src/main/canvas-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('canvasAPI', {
  // Canvas-specific operations
  loadDesignFiles: (options) => ipcRenderer.invoke('canvas-load-design-files', options),
  saveCanvasState: (state) => ipcRenderer.invoke('canvas-save-state', state),
  requestTemplatePreview: (templatePath) => ipcRenderer.invoke('canvas-request-preview', templatePath),

  // Canvas events
  onDesignFilesLoaded: (callback) => ipcRenderer.on('canvas-design-files-loaded', callback),
  onTemplatePreviewReady: (callback) => ipcRenderer.on('canvas-preview-ready', callback),
  onCanvasError: (callback) => ipcRenderer.on('canvas-error', callback),

  // Canvas interactions
  openTemplateInEditor: (templatePath) => ipcRenderer.invoke('canvas-open-template', templatePath),
  navigateToFrame: (frameId) => ipcRenderer.invoke('canvas-navigate-to-frame', frameId),
  updateFramePosition: (frameId, position) => ipcRenderer.invoke('canvas-update-position', { frameId, position })
});
```

## Workspace Management System

### Workspace Manager Implementation
```typescript
// src/main/WorkspaceManager.js
const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const { ipcMain, dialog } = require('electron');

class WorkspaceManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.currentWorkspace = null;
    this.fileWatcher = null;
    this.templateIndex = new Map();
  }

  async setWorkspace(workspacePath) {
    try {
      // Validate workspace
      await this.validateWorkspace(workspacePath);

      // Set current workspace
      this.currentWorkspace = workspacePath;

      // Initialize workspace structure
      await this.initializeWorkspaceStructure();

      // Setup file watching
      this.setupFileWatching();

      // Build template index
      await this.buildTemplateIndex();

      // Notify renderer
      this.notifyWorkspaceChanged();

    } catch (error) {
      throw new Error(`Failed to set workspace: ${error.message}`);
    }
  }

  async validateWorkspace(workspacePath) {
    const stats = await fs.stat(workspacePath);
    if (!stats.isDirectory()) {
      throw new Error('Selected path is not a directory');
    }

    // Check for TAD-specific files/directories
    const tadDir = path.join(workspacePath, '.tad');
    try {
      await fs.access(tadDir);
    } catch {
      // Initialize TAD directory if it doesn't exist
      await this.initializeTADDirectory(tadDir);
    }
  }

  async initializeWorkspaceStructure() {
    const tadDir = path.join(this.currentWorkspace, '.tad');
    const requiredDirs = [
      'templates',
      'templates/pages',
      'templates/components',
      'templates/elements',
      'dist',
      'builder'
    ];

    for (const dir of requiredDirs) {
      const fullPath = path.join(tadDir, dir);
      await fs.mkdir(fullPath, { recursive: true });
    }

    // Copy builder assets from application
    await this.copyBuilderAssets();
  }

  setupFileWatching() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }

    const watchPatterns = [
      path.join(this.currentWorkspace, '.tad', 'templates', '**', '*.{njk,nunjucks,html}'),
      path.join(this.currentWorkspace, '.tad', 'spaces.json'),
      path.join(this.currentWorkspace, '.tad', 'builder', 'build.js')
    ];

    this.fileWatcher = chokidar.watch(watchPatterns, {
      ignored: /(^|[\/\\])\../, // Ignore hidden files
      persistent: true,
      ignoreInitial: true
    });

    this.fileWatcher.on('add', (filePath) => this.handleFileAdded(filePath));
    this.fileWatcher.on('change', (filePath) => this.handleFileChanged(filePath));
    this.fileWatcher.on('unlink', (filePath) => this.handleFileRemoved(filePath));
  }

  async buildTemplateIndex() {
    const templatesDir = path.join(this.currentWorkspace, '.tad', 'templates');
    this.templateIndex.clear();

    // Recursively scan template directories
    await this.scanTemplatesDirectory(templatesDir);
  }

  async scanTemplatesDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.scanTemplatesDirectory(fullPath);
      } else if (entry.isFile() && this.isTemplateFile(entry.name)) {
        const relativePath = path.relative(this.currentWorkspace, fullPath);
        this.templateIndex.set(relativePath, {
          path: relativePath,
          fullPath,
          type: this.getTemplateType(entry.name),
          lastModified: (await fs.stat(fullPath)).mtime
        });
      }
    }
  }

  setupIPCHandlers() {
    ipcMain.handle('get-workspace-info', () => ({
      path: this.currentWorkspace,
      templateCount: this.templateIndex.size,
      lastScan: Date.now()
    }));

    ipcMain.handle('list-templates', () => {
      return Array.from(this.templateIndex.values()).map(template => ({
        path: template.path,
        type: template.type,
        lastModified: template.lastModified
      }));
    });

    ipcMain.handle('read-file', async (event, filePath) => {
      const fullPath = this.resolveWorkspacePath(filePath);
      return await fs.readFile(fullPath, 'utf8');
    });

    ipcMain.handle('write-file', async (event, filePath, content) => {
      const fullPath = this.resolveWorkspacePath(filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
    });
  }

  resolveWorkspacePath(filePath) {
    const fullPath = path.resolve(this.currentWorkspace, filePath);

    // Security check: ensure path is within workspace
    if (!fullPath.startsWith(this.currentWorkspace)) {
      throw new Error('Access denied: path outside workspace');
    }

    return fullPath;
  }

  notifyWorkspaceChanged() {
    const workspaceInfo = {
      path: this.currentWorkspace,
      templateCount: this.templateIndex.size,
      directories: this.getWorkspaceDirectories()
    };

    // Notify all windows
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('workspace-changed', workspaceInfo);
    });
  }

  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }
}
```

## Configuration Management System

### Configuration Manager Implementation
```typescript
// src/main/ConfigurationManager.js
const Store = require('electron-store');
const { ipcMain } = require('electron');

class ConfigurationManager {
  constructor() {
    this.store = new Store({
      name: 'tad-config',
      defaults: {
        nunjucks: {
          templateRoots: ['.tad/templates'],
          defaultExtensions: ['.njk', '.nunjucks', '.html'],
          ignore: ['**/node_modules/**', '.tad/dist/**']
        },
        ai: {
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: ''
        },
        canvas: {
          defaultLayout: 'grid',
          showDebug: false,
          framesPerRow: 10
        },
        editor: {
          theme: 'dark',
          fontSize: 14,
          tabSize: 2
        }
      }
    });

    this.changeListeners = new Set();
  }

  get(key, defaultValue) {
    return this.store.get(key, defaultValue);
  }

  set(key, value) {
    this.store.set(key, value);
    this.notifyChangeListeners(key, value);
  }

  delete(key) {
    this.store.delete(key);
    this.notifyChangeListeners(key, null);
  }

  getAll() {
    return this.store.store;
  }

  reset() {
    this.store.clear();
  }

  setupIPCHandlers() {
    ipcMain.handle('get-config', (event, key) => {
      return key ? this.get(key) : this.getAll();
    });

    ipcMain.handle('set-config', (event, key, value) => {
      this.set(key, value);
      return true;
    });

    ipcMain.handle('reset-config', () => {
      this.reset();
      return this.getAll();
    });
  }

  onChange(callback) {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  notifyChangeListeners(key, value) {
    this.changeListeners.forEach(callback => {
      try {
        callback(key, value);
      } catch (error) {
        console.error('Configuration change listener error:', error);
      }
    });
  }

  // Migration from VS Code settings
  async migrateFromVSCode(vscodeSettings) {
    // Convert VS Code settings format to Electron format
    const migrated = {
      nunjucks: {
        templateRoots: vscodeSettings['tad.nunjucks']?.templateRoots || this.store.defaults.nunjucks.templateRoots,
        defaultExtensions: vscodeSettings['tad.nunjucks']?.defaultExtensions || this.store.defaults.nunjucks.defaultExtensions,
        ignore: vscodeSettings['tad.nunjucks']?.ignore || this.store.defaults.nunjucks.ignore
      },
      ai: {
        provider: vscodeSettings['tad.ai']?.modelProvider || this.store.defaults.ai.provider,
        model: vscodeSettings['tad.ai']?.model || this.store.defaults.ai.model,
        apiKey: vscodeSettings['tad.ai']?.openaiApiKey || vscodeSettings['tad.ai']?.anthropicApiKey || ''
      }
    };

    // Merge with existing config
    const current = this.getAll();
    const merged = this.deepMerge(current, migrated);

    this.store.store = merged;
    this.notifyChangeListeners(null, merged);
  }

  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}
```

## Language Server Integration

### Language Server Manager
```typescript
// src/main/LanguageServerManager.js
const { spawn } = require('child_process');
const path = require('path');
const { ipcMain } = require('electron');

class LanguageServerManager {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
    this.serverProcess = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
  }

  async startServer() {
    const serverPath = path.join(__dirname, 'language-server', 'bin', 'nunjucks-language-server');

    this.serverProcess = spawn(serverPath, [], {
      cwd: this.workspaceManager.currentWorkspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' }
    });

    this.setupServerCommunication();
    this.setupIPCHandlers();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Language server startup timeout'));
      }, 10000);

      this.serverProcess.on('spawn', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  setupServerCommunication() {
    let buffer = '';

    this.serverProcess.stdout.on('data', (data) => {
      buffer += data.toString();

      // Process complete JSON-RPC messages
      const messages = buffer.split('\n');
      buffer = messages.pop(); // Keep incomplete message

      for (const message of messages) {
        if (message.trim()) {
          try {
            const parsed = JSON.parse(message);
            this.handleServerResponse(parsed);
          } catch (error) {
            console.error('Failed to parse language server response:', error);
          }
        }
      }
    });

    this.serverProcess.stderr.on('data', (data) => {
      console.error('Language server error:', data.toString());
    });

    this.serverProcess.on('close', (code) => {
      console.log(`Language server exited with code ${code}`);
      this.serverProcess = null;
    });
  }

  setupIPCHandlers() {
    ipcMain.handle('request-definition', async (event, params) => {
      return this.sendRequest('textDocument/definition', {
        textDocument: { uri: `file://${params.filePath}` },
        position: params.position
      });
    });

    ipcMain.handle('request-completion', async (event, params) => {
      return this.sendRequest('textDocument/completion', {
        textDocument: { uri: `file://${params.filePath}` },
        position: params.position
      });
    });

    ipcMain.handle('request-hover', async (event, params) => {
      return this.sendRequest('textDocument/hover', {
        textDocument: { uri: `file://${params.filePath}` },
        position: params.position
      });
    });
  }

  sendRequest(method, params) {
    if (!this.serverProcess) {
      throw new Error('Language server not running');
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, timeout: setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 5000) });

      this.serverProcess.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  handleServerResponse(response) {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  dispose() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }

    // Clear pending requests
    for (const [id, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('Language server disposed'));
    }
    this.pendingRequests.clear();
  }
}
```

## Application Lifecycle Management

### Application State Persistence
```typescript
// src/main/ApplicationState.js
const fs = require('fs').promises;
const path = require('path');

class ApplicationState {
  constructor(userDataPath) {
    this.stateFile = path.join(userDataPath, 'application-state.json');
    this.state = {};
    this.loaded = false;
  }

  async load() {
    try {
      const data = await fs.readFile(this.stateFile, 'utf8');
      this.state = JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is corrupted, use defaults
      this.state = {
        recentWorkspaces: [],
        windowBounds: { width: 1400, height: 900 },
        lastWorkspace: null,
        preferences: {}
      };
    }
    this.loaded = true;
    return this.state;
  }

  async save() {
    if (!this.loaded) return;

    try {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to save application state:', error);
    }
  }

  get(key, defaultValue) {
    return this.state[key] !== undefined ? this.state[key] : defaultValue;
  }

  set(key, value) {
    this.state[key] = value;
    this.save(); // Auto-save on changes
  }

  update(updates) {
    Object.assign(this.state, updates);
    this.save();
  }

  addRecentWorkspace(workspacePath) {
    const recent = this.state.recentWorkspaces || [];
    const filtered = recent.filter(path => path !== workspacePath);
    filtered.unshift(workspacePath);

    // Keep only last 10 workspaces
    this.state.recentWorkspaces = filtered.slice(0, 10);
    this.save();
  }
}
```

## Error Handling and Recovery

### Global Error Handler
```typescript
// src/main/ErrorHandler.js
const { dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');

class ErrorHandler {
  constructor(userDataPath) {
    this.logFile = path.join(userDataPath, 'error.log');
    this.errorQueue = [];
    this.flushInterval = setInterval(() => this.flushErrors(), 5000);
  }

  handleError(error, context = {}) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context,
      process: {
        pid: process.pid,
        platform: process.platform,
        versions: process.versions
      }
    };

    console.error('TAD Error:', errorInfo);
    this.errorQueue.push(errorInfo);

    // Show user-friendly error dialog for critical errors
    if (this.isCriticalError(error)) {
      this.showErrorDialog(error);
    }
  }

  isCriticalError(error) {
    // Define what constitutes a critical error
    const criticalErrors = [
      'EACCES', 'EPERM', // Permission errors
      'ENOTFOUND', 'ECONNREFUSED', // Network errors
      'MODULE_NOT_FOUND' // Missing dependencies
    ];

    return criticalErrors.includes(error.code) ||
           error.message.includes('Cannot find module');
  }

  showErrorDialog(error) {
    dialog.showErrorBox(
      'TAD Error',
      `An error occurred: ${error.message}\n\nPlease check the error log for more details.`
    );
  }

  async flushErrors() {
    if (this.errorQueue.length === 0) return;

    try {
      const logData = this.errorQueue.map(err => JSON.stringify(err)).join('\n') + '\n';
      await fs.appendFile(this.logFile, logData);
      this.errorQueue = [];
    } catch (error) {
      console.error('Failed to write error log:', error);
    }
  }

  dispose() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushErrors(); // Final flush
  }
}
```

## Performance Optimization

### Memory Management
```typescript
// src/main/MemoryManager.js
const { app } = require('electron');

class MemoryManager {
  constructor() {
    this.memoryThreshold = 500 * 1024 * 1024; // 500MB
    this.checkInterval = setInterval(() => this.checkMemoryUsage(), 30000);
  }

  checkMemoryUsage() {
    const usage = process.memoryUsage();

    if (usage.heapUsed > this.memoryThreshold) {
      console.warn(`High memory usage detected: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);

      // Trigger garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Notify renderer processes to cleanup
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('memory-warning', {
          heapUsed: usage.heapUsed,
          heapTotal: usage.heapTotal
        });
      });
    }
  }

  optimizeForLowMemory() {
    // Reduce cache sizes
    // Close unused windows
    // Disable expensive features
  }

  dispose() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}
```

## Security Considerations

### Process Isolation
- Main process handles all file system operations
- Renderer processes are sandboxed with context isolation
- Preload scripts provide controlled API access
- All IPC messages are validated

### File System Security
- Path traversal protection in workspace resolution
- File operation permissions based on workspace boundaries
- Safe command execution with argument validation

## Conclusion

The Electron integration provides a solid foundation for migrating TAD from a VS Code extension to a standalone desktop application. The main process architecture maintains clear separation of concerns while providing robust IPC communication, comprehensive error handling, and performance optimization.

Key benefits of this approach:
- **Native Desktop Experience**: Full control over application lifecycle and UI
- **Cross-Platform Compatibility**: Single codebase for Windows, macOS, and Linux
- **Enhanced Security**: Process isolation and controlled API access
- **Better Performance**: Direct file system access and optimized memory management
- **Extensibility**: Plugin architecture for future enhancements

The modular design allows for incremental migration and testing, ensuring a smooth transition while preserving all core TAD functionality.