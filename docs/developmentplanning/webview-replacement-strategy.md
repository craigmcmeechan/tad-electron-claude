# Webview Replacement Strategy for Electron Migration

## Overview

This document outlines the strategy for replacing VS Code's webview system with Electron's native windowing and rendering capabilities. The migration involves transforming the current dual-webview architecture (sidebar chat + canvas panel) into a native Electron application with multiple windows and views.

## Current VS Code Webview Architecture

### Webview Components Analysis

#### 1. Sidebar Chat Webview
**Current Implementation:**
```typescript
// src/providers/chatSidebarProvider.ts
class ChatSidebarProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [extensionUri]
    };

    const html = generateWebviewHtml(webviewView.webview, extensionUri, {
      layout: 'sidebar',
      extensionUri: extensionUri.toString()
    });

    webviewView.webview.html = html;
    webviewView.webview.onDidReceiveMessage(handleChatMessage);
  }
}
```

**Key Characteristics:**
- Lightweight React application
- Persistent state with localStorage
- Streaming message handling
- Tool call visualization
- Compact sidebar layout

#### 2. Canvas Panel Webview
**Current Implementation:**
```typescript
// src/extension.ts - Canvas panel creation
const panel = vscode.window.createWebviewPanel(
  'tadCanvas',
  'TAD Canvas',
  vscode.ViewColumn.One,
  {
    enableScripts: true,
    localResourceRoots: [extensionUri],
    retainContextWhenHidden: true
  }
);
```

**Key Characteristics:**
- Full-featured React application
- Complex state management
- High-performance rendering
- Interactive drag-and-drop
- File system integration

### Message Passing Protocol
**Current VS Code Implementation:**
```typescript
// Extension ↔ Webview communication
webview.postMessage({ command: 'loadFiles', data: files });
vscode.postMessage({ command: 'chatMessage', message: text });

// Message handling
window.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.command) {
    case 'chatResponse': handleResponse(message); break;
  }
});
```

## Electron Webview Replacement Strategy

### Architecture Overview

#### Multi-Window Application Design
```
┌─────────────────────────────────────────────────┐
│ Main Window (TAD Interface)                     │
│ ┌─────────────────┬─────────────────────────┐ │
│ │ Chat Sidebar    │ Main Content Area        │ │
│ │ (BrowserView)   │                         │ │
│ │                 │ ┌─────────────────────┐ │ │
│ │                 │ │ Canvas Panel        │ │ │
│ │                 │ │ (Child Window)      │ │ │
│ └─────────────────┴─────────────────────┘ │ │
└─────────────────────────────────────────────┘ │
                                                │
┌─────────────────────────────────────────────────┘
│ Template Editor Window (Optional)
│ (Separate BrowserWindow)
└─────────────────────────────────────────────────
```

### Window Management Strategy

#### 1. Main Application Window
```typescript
// src/main/windows/MainWindow.js
const { BrowserWindow, BrowserView } = require('electron');
const path = require('path');

class MainWindow {
  constructor() {
    this.window = null;
    this.chatView = null;
    this.canvasPanel = null;
  }

  async create() {
    this.window = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      show: false
    });

    // Load main interface
    await this.window.loadFile(path.join(__dirname, 'renderer', 'main.html'));

    // Create chat sidebar
    await this.createChatSidebar();

    // Setup event handlers
    this.setupEventHandlers();

    return this.window;
  }

  async createChatSidebar() {
    this.chatView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'chat-preload.js')
      }
    });

    this.window.setBrowserView(this.chatView);

    // Position as sidebar
    this.updateChatSidebarBounds();

    // Load chat interface
    await this.chatView.webContents.loadFile(
      path.join(__dirname, 'renderer', 'chat.html')
    );

    // Setup chat communication
    this.setupChatCommunication();
  }

  updateChatSidebarBounds() {
    if (!this.chatView || !this.window) return;

    const [width, height] = this.window.getSize();
    const sidebarWidth = 320;

    this.chatView.setBounds({
      x: 0,
      y: 0,
      width: sidebarWidth,
      height: height
    });
  }

  setupEventHandlers() {
    // Handle window resize
    this.window.on('resize', () => {
      this.updateChatSidebarBounds();
    });

    // Handle window close
    this.window.on('closed', () => {
      if (this.chatView) {
        this.chatView.webContents.close();
      }
      this.window = null;
    });
  }

  setupChatCommunication() {
    // IPC communication setup
    const { ipcMain } = require('electron');

    ipcMain.on('chat-message', (event, message) => {
      if (event.sender === this.chatView.webContents) {
        this.handleChatMessage(message);
      }
    });
  }

  async openCanvasPanel() {
    if (this.canvasPanel && !this.canvasPanel.isDestroyed()) {
      this.canvasPanel.focus();
      return;
    }

    const CanvasPanel = require('./CanvasPanel');
    this.canvasPanel = new CanvasPanel(this.window);
    await this.canvasPanel.create();

    this.canvasPanel.on('closed', () => {
      this.canvasPanel = null;
    });
  }
}
```

#### 2. Canvas Panel Window
```typescript
// src/main/windows/CanvasPanel.js
const { BrowserWindow } = require('electron');
const path = require('path');

class CanvasPanel {
  constructor(parentWindow) {
    this.parentWindow = parentWindow;
    this.window = null;
    this.isMaximized = false;
  }

  async create() {
    this.window = new BrowserWindow({
      parent: this.parentWindow,
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
      show: false,
      frame: true
    });

    // Load canvas interface
    await this.window.loadFile(path.join(__dirname, 'renderer', 'canvas.html'));

    // Setup communication
    this.setupCommunication();

    // Setup event handlers
    this.setupEventHandlers();

    // Show when ready
    this.window.once('ready-to-show', () => {
      this.window.show();
    });

    return this.window;
  }

  setupCommunication() {
    const { ipcMain } = require('electron');

    // Handle canvas-specific messages
    ipcMain.on('canvas-message', (event, message) => {
      if (event.sender === this.window.webContents) {
        this.handleCanvasMessage(message);
      }
    });

    // Forward messages from main process
    ipcMain.on('canvas-forward', (event, message) => {
      this.window.webContents.send('canvas-message', message);
    });
  }

  setupEventHandlers() {
    this.window.on('closed', () => {
      this.window = null;
      this.emit('closed');
    });

    this.window.on('maximize', () => {
      this.isMaximized = true;
    });

    this.window.on('unmaximize', () => {
      this.isMaximized = false;
    });

    // Handle parent window moving
    this.parentWindow.on('move', () => {
      if (this.window && !this.window.isDestroyed()) {
        // Optionally adjust position relative to parent
      }
    });
  }

  handleCanvasMessage(message) {
    switch (message.command) {
      case 'request-design-files':
        this.loadDesignFiles(message.data);
        break;
      case 'save-canvas-state':
        this.saveCanvasState(message.data);
        break;
      case 'open-template-editor':
        this.openTemplateEditor(message.data.templatePath);
        break;
    }
  }

  async loadDesignFiles(options) {
    // Load design files from workspace
    const designFiles = await this.getDesignFiles(options);

    // Send to canvas renderer
    this.window.webContents.send('design-files-loaded', {
      files: designFiles,
      options
    });
  }

  async openTemplateEditor(templatePath) {
    const TemplateEditor = require('./TemplateEditor');
    const editor = new TemplateEditor(this.window);
    await editor.open(templatePath);
  }

  close() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
  }

  focus() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus();
    }
  }
}
```

#### 3. Template Editor Window (Optional)
```typescript
// src/main/windows/TemplateEditor.js
const { BrowserWindow } = require('electron');
const path = require('path');

class TemplateEditor {
  constructor(parentWindow) {
    this.parentWindow = parentWindow;
    this.window = null;
    this.currentFile = null;
  }

  async open(filePath) {
    if (this.window && !this.window.isDestroyed()) {
      // Reuse existing window
      this.loadFile(filePath);
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      parent: this.parentWindow,
      modal: false,
      width: 900,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'editor-preload.js')
      },
      title: `TAD Editor - ${path.basename(filePath)}`,
      show: false
    });

    await this.window.loadFile(path.join(__dirname, 'renderer', 'editor.html'));
    await this.loadFile(filePath);

    this.setupEventHandlers();

    this.window.once('ready-to-show', () => {
      this.window.show();
    });
  }

  async loadFile(filePath) {
    this.currentFile = filePath;

    // Read file content
    const content = await this.readFile(filePath);

    // Send to editor
    this.window.webContents.send('file-loaded', {
      path: filePath,
      content: content,
      language: this.getLanguageFromPath(filePath)
    });

    // Update window title
    this.window.setTitle(`TAD Editor - ${path.basename(filePath)}`);
  }

  getLanguageFromPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.njk':
      case '.nunjucks':
        return 'nunjucks';
      case '.html':
        return 'html';
      case '.json':
        return 'json';
      default:
        return 'plaintext';
    }
  }

  setupEventHandlers() {
    const { ipcMain } = require('electron');

    ipcMain.on('editor-save', async (event, data) => {
      if (event.sender === this.window.webContents && this.currentFile) {
        await this.saveFile(this.currentFile, data.content);
        this.window.webContents.send('file-saved', { path: this.currentFile });
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });
  }
}
```

### Renderer Process Architecture

#### 1. Main Window Renderer
```html
<!-- src/renderer/main.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TAD - Template-Assisted Design</title>
    <link rel="stylesheet" href="main.css">
</head>
<body>
    <div id="app">
        <header class="title-bar">
            <div class="title">TAD</div>
            <div class="window-controls">
                <button id="minimize">-</button>
                <button id="maximize">□</button>
                <button id="close">×</button>
            </div>
        </header>

        <div class="main-content">
            <!-- Chat sidebar will be overlaid via BrowserView -->
            <div class="content-area">
                <div class="toolbar">
                    <button id="open-canvas">Open Canvas</button>
                    <button id="build-templates">Build Templates</button>
                    <select id="workspace-selector">
                        <option>Select Workspace...</option>
                    </select>
                </div>

                <div class="workspace-view">
                    <div id="template-tree"></div>
                    <div id="preview-area"></div>
                </div>
            </div>
        </div>
    </div>

    <script src="main.js"></script>
</body>
</html>
```

```typescript
// src/renderer/main.js
const { ipcRenderer } = require('electron');

// Initialize main interface
class MainInterface {
    constructor() {
        this.setupEventListeners();
        this.initializeWorkspace();
    }

    setupEventListeners() {
        // Window controls
        document.getElementById('minimize').addEventListener('click', () => {
            ipcRenderer.invoke('minimize-window');
        });

        document.getElementById('maximize').addEventListener('click', () => {
            ipcRenderer.invoke('maximize-window');
        });

        document.getElementById('close').addEventListener('click', () => {
            ipcRenderer.invoke('close-window');
        });

        // Application controls
        document.getElementById('open-canvas').addEventListener('click', () => {
            ipcRenderer.invoke('open-canvas');
        });

        document.getElementById('build-templates').addEventListener('click', () => {
            ipcRenderer.invoke('build-templates');
        });

        // Workspace selector
        const workspaceSelector = document.getElementById('workspace-selector');
        workspaceSelector.addEventListener('change', (event) => {
            if (event.target.value) {
                ipcRenderer.invoke('set-workspace', event.target.value);
            }
        });
    }

    async initializeWorkspace() {
        try {
            const workspaceInfo = await ipcRenderer.invoke('get-workspace-info');
            this.updateWorkspaceView(workspaceInfo);
        } catch (error) {
            console.error('Failed to initialize workspace:', error);
        }
    }

    updateWorkspaceView(workspaceInfo) {
        const templateTree = document.getElementById('template-tree');

        if (workspaceInfo.path) {
            templateTree.innerHTML = `
                <div class="workspace-header">
                    <h3>Workspace: ${workspaceInfo.path}</h3>
                    <span>${workspaceInfo.templateCount} templates</span>
                </div>
                <div class="template-list" id="template-list">
                    Loading templates...
                </div>
            `;

            this.loadTemplateList();
        } else {
            templateTree.innerHTML = `
                <div class="no-workspace">
                    <p>No workspace selected</p>
                    <button id="select-workspace">Select Workspace</button>
                </div>
            `;

            document.getElementById('select-workspace').addEventListener('click', () => {
                ipcRenderer.invoke('select-workspace');
            });
        }
    }

    async loadTemplateList() {
        try {
            const templates = await ipcRenderer.invoke('list-templates');
            const templateList = document.getElementById('template-list');

            templateList.innerHTML = templates.map(template => `
                <div class="template-item" data-path="${template.path}">
                    <span class="template-name">${template.path}</span>
                    <span class="template-type">${template.type}</span>
                </div>
            `).join('');

            // Add click handlers
            templateList.querySelectorAll('.template-item').forEach(item => {
                item.addEventListener('click', () => {
                    const templatePath = item.dataset.path;
                    ipcRenderer.invoke('open-template', templatePath);
                });
            });
        } catch (error) {
            console.error('Failed to load template list:', error);
        }
    }
}

// IPC event listeners
ipcRenderer.on('workspace-changed', (event, workspaceInfo) => {
    mainInterface.updateWorkspaceView(workspaceInfo);
});

ipcRenderer.on('templates-updated', () => {
    mainInterface.loadTemplateList();
});

// Initialize when DOM is ready
let mainInterface;
document.addEventListener('DOMContentLoaded', () => {
    mainInterface = new MainInterface();
});
```

#### 2. Chat Sidebar Renderer
```html
<!-- src/renderer/chat.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TAD Chat</title>
    <link rel="stylesheet" href="chat.css">
</head>
<body>
    <div id="chat-app">
        <div class="chat-header">
            <h3>AI Assistant</h3>
            <div class="chat-controls">
                <select id="model-selector">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="claude-3">Claude 3</option>
                </select>
            </div>
        </div>

        <div class="chat-messages" id="chat-messages">
            <div class="welcome-message">
                <p>Hello! I'm your TAD assistant. How can I help you with your templates today?</p>
            </div>
        </div>

        <div class="chat-input-area">
            <div class="input-container">
                <textarea
                    id="chat-input"
                    placeholder="Ask me anything about your templates..."
                    rows="1"
                ></textarea>
                <button id="send-button" disabled>Send</button>
            </div>
            <div class="input-controls">
                <button id="clear-chat">Clear</button>
                <button id="stop-chat" style="display: none;">Stop</button>
            </div>
        </div>
    </div>

    <script src="chat.js"></script>
</body>
</html>
```

```typescript
// src/renderer/chat.js
const { ipcRenderer } = require('electron');

class ChatInterface {
    constructor() {
        this.messages = [];
        this.isStreaming = false;
        this.currentMessageId = null;

        this.setupEventListeners();
        this.loadChatHistory();
    }

    setupEventListeners() {
        const chatInput = document.getElementById('chat-input');
        const sendButton = document.getElementById('send-button');
        const clearButton = document.getElementById('clear-chat');
        const stopButton = document.getElementById('stop-chat');
        const modelSelector = document.getElementById('model-selector');

        // Input handling
        chatInput.addEventListener('input', () => {
            sendButton.disabled = !chatInput.value.trim();
            this.adjustTextareaHeight(chatInput);
        });

        chatInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.sendMessage();
            }
        });

        // Send message
        sendButton.addEventListener('click', () => this.sendMessage());

        // Clear chat
        clearButton.addEventListener('click', () => this.clearChat());

        // Stop streaming
        stopButton.addEventListener('click', () => this.stopChat());

        // Model selection
        modelSelector.addEventListener('change', (event) => {
            ipcRenderer.invoke('change-model', event.target.value);
        });
    }

    adjustTextareaHeight(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    async sendMessage() {
        const chatInput = document.getElementById('chat-input');
        const message = chatInput.value.trim();

        if (!message || this.isStreaming) return;

        // Add user message
        this.addMessage('user', message);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        // Start streaming response
        this.startStreaming();

        try {
            // Send to main process
            await ipcRenderer.invoke('send-chat-message', {
                message,
                chatHistory: this.messages
            });
        } catch (error) {
            console.error('Failed to send message:', error);
            this.stopStreaming();
            this.addMessage('error', 'Failed to send message. Please try again.');
        }
    }

    startStreaming() {
        this.isStreaming = true;
        document.getElementById('stop-chat').style.display = 'inline-block';
        document.getElementById('send-button').disabled = true;
        document.getElementById('chat-input').disabled = true;

        // Add assistant message placeholder
        this.currentMessageId = Date.now().toString();
        this.addMessage('assistant', '', this.currentMessageId);
    }

    stopStreaming() {
        this.isStreaming = false;
        document.getElementById('stop-chat').style.display = 'none';
        document.getElementById('send-button').disabled = false;
        document.getElementById('chat-input').disabled = false;
    }

    addMessage(role, content, id = null) {
        const message = {
            id: id || Date.now().toString(),
            role,
            content,
            timestamp: new Date().toISOString()
        };

        this.messages.push(message);
        this.renderMessage(message);

        // Scroll to bottom
        this.scrollToBottom();
    }

    renderMessage(message) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.role}`;
        messageElement.dataset.id = message.id;

        messageElement.innerHTML = `
            <div class="message-avatar">
                ${message.role === 'user' ? '👤' : message.role === 'assistant' ? '🤖' : '⚠️'}
            </div>
            <div class="message-content">
                <div class="message-text">${this.formatMessage(message.content)}</div>
                <div class="message-time">${this.formatTime(message.timestamp)}</div>
            </div>
        `;

        messagesContainer.appendChild(messageElement);
    }

    formatMessage(content) {
        if (!content) return '<em>Thinking...</em>';

        // Basic markdown-like formatting
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async clearChat() {
        this.messages = [];
        document.getElementById('chat-messages').innerHTML = '';
        await ipcRenderer.invoke('clear-chat');
    }

    async stopChat() {
        await ipcRenderer.invoke('stop-chat');
        this.stopStreaming();
    }

    async loadChatHistory() {
        try {
            const history = await ipcRenderer.invoke('get-chat-history');
            this.messages = history;
            this.renderChatHistory();
        } catch (error) {
            console.error('Failed to load chat history:', error);
        }
    }

    renderChatHistory() {
        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.innerHTML = '';

        this.messages.forEach(message => {
            this.renderMessage(message);
        });

        this.scrollToBottom();
    }
}

// IPC event listeners
ipcRenderer.on('chat-response-chunk', (event, data) => {
    chatInterface.handleResponseChunk(data);
});

ipcRenderer.on('chat-response-end', (event, data) => {
    chatInterface.handleResponseEnd(data);
});

ipcRenderer.on('chat-error', (event, error) => {
    chatInterface.handleChatError(error);
});

ipcRenderer.on('model-changed', (event, model) => {
    document.getElementById('model-selector').value = model;
});

// Initialize chat interface
let chatInterface;
document.addEventListener('DOMContentLoaded', () => {
    chatInterface = new ChatInterface();
});
```

#### 3. Canvas Renderer
```html
<!-- src/renderer/canvas.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TAD Canvas</title>
    <link rel="stylesheet" href="canvas.css">
</head>
<body>
    <div id="canvas-app">
        <div class="canvas-toolbar">
            <div class="toolbar-left">
                <select id="layout-mode">
                    <option value="grid">Grid Layout</option>
                    <option value="relationships">Relationship Layout</option>
                    <option value="tags">Tag-based Layout</option>
                </select>
                <select id="dist-mode">
                    <option value="pages">Pages</option>
                    <option value="components">Components</option>
                    <option value="groups">Groups</option>
                </select>
            </div>
            <div class="toolbar-center">
                <input type="text" id="search-input" placeholder="Search frames...">
                <button id="clear-search">×</button>
            </div>
            <div class="toolbar-right">
                <button id="zoom-out">-</button>
                <span id="zoom-level">100%</span>
                <button id="zoom-in">+</button>
                <button id="fit-view">Fit</button>
                <button id="reset-view">Reset</button>
            </div>
        </div>

        <div class="canvas-container" id="canvas-container">
            <div class="canvas-viewport" id="canvas-viewport">
                <div class="canvas-content" id="canvas-content">
                    <!-- Frames and connections will be rendered here -->
                </div>
            </div>
        </div>

        <div class="canvas-status">
            <span id="status-text">Ready</span>
            <span id="frame-count">0 frames</span>
        </div>
    </div>

    <script src="canvas.js"></script>
</body>
</html>
```

```typescript
// src/renderer/canvas.js
const { ipcRenderer } = require('electron');

class CanvasInterface {
    constructor() {
        this.designFiles = [];
        this.selectedFrames = new Set();
        this.transform = { x: 0, y: 0, scale: 1 };
        this.layoutMode = 'grid';
        this.distMode = 'pages';

        this.setupEventListeners();
        this.initializeCanvas();
    }

    setupEventListeners() {
        // Toolbar controls
        document.getElementById('layout-mode').addEventListener('change', (e) => {
            this.setLayoutMode(e.target.value);
        });

        document.getElementById('dist-mode').addEventListener('change', (e) => {
            this.setDistMode(e.target.value);
        });

        // Search
        const searchInput = document.getElementById('search-input');
        searchInput.addEventListener('input', () => {
            this.filterFrames(searchInput.value);
        });

        document.getElementById('clear-search').addEventListener('click', () => {
            searchInput.value = '';
            this.filterFrames('');
        });

        // Zoom controls
        document.getElementById('zoom-in').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoom-out').addEventListener('click', () => this.zoomOut());
        document.getElementById('fit-view').addEventListener('click', () => this.fitToView());
        document.getElementById('reset-view').addEventListener('click', () => this.resetView());

        // Canvas interactions
        this.setupCanvasInteractions();
    }

    setupCanvasInteractions() {
        const canvasContainer = document.getElementById('canvas-container');
        let isDragging = false;
        let lastMousePos = { x: 0, y: 0 };

        canvasContainer.addEventListener('mousedown', (e) => {
            if (e.button === 1 || (e.button === 0 && e.altKey)) { // Middle mouse or Alt+left
                isDragging = true;
                lastMousePos = { x: e.clientX, y: e.clientY };
                canvasContainer.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        canvasContainer.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const deltaX = e.clientX - lastMousePos.x;
                const deltaY = e.clientY - lastMousePos.y;

                this.transform.x += deltaX;
                this.transform.y += deltaY;

                this.updateCanvasTransform();
                this.updateZoomLevel();

                lastMousePos = { x: e.clientX, y: e.clientY };
            }
        });

        canvasContainer.addEventListener('mouseup', () => {
            isDragging = false;
            canvasContainer.style.cursor = 'default';
        });

        // Wheel zoom
        canvasContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                this.zoomBy(zoomFactor, e.clientX, e.clientY);
            }
        });
    }

    async initializeCanvas() {
        try {
            // Request design files
            await ipcRenderer.invoke('load-design-files', {
                distMode: this.distMode,
                layoutMode: this.layoutMode
            });
        } catch (error) {
            console.error('Failed to initialize canvas:', error);
            this.showStatus('Failed to load design files');
        }
    }

    async setLayoutMode(mode) {
        this.layoutMode = mode;
        await this.reloadDesignFiles();
    }

    async setDistMode(mode) {
        this.distMode = mode;
        await this.reloadDesignFiles();
    }

    async reloadDesignFiles() {
        try {
            this.showStatus('Loading...');
            await ipcRenderer.invoke('load-design-files', {
                distMode: this.distMode,
                layoutMode: this.layoutMode
            });
        } catch (error) {
            console.error('Failed to reload design files:', error);
            this.showStatus('Failed to reload');
        }
    }

    zoomIn() {
        this.zoomBy(1.2);
    }

    zoomOut() {
        this.zoomBy(0.8);
    }

    zoomBy(factor, centerX, centerY) {
        const oldScale = this.transform.scale;
        const newScale = Math.max(0.1, Math.min(3.0, oldScale * factor));

        if (centerX !== undefined && centerY !== undefined) {
            // Zoom towards mouse position
            const canvasRect = document.getElementById('canvas-container').getBoundingClientRect();
            const canvasCenterX = canvasRect.left + canvasRect.width / 2;
            const canvasCenterY = canvasRect.top + canvasRect.height / 2;

            const mouseX = centerX - canvasCenterX;
            const mouseY = centerY - canvasCenterY;

            this.transform.x -= mouseX * (newScale / oldScale - 1);
            this.transform.y -= mouseY * (newScale / oldScale - 1);
        }

        this.transform.scale = newScale;
        this.updateCanvasTransform();
        this.updateZoomLevel();
    }

    fitToView() {
        if (this.designFiles.length === 0) return;

        const canvasContainer = document.getElementById('canvas-container');
        const containerRect = canvasContainer.getBoundingClientRect();

        // Calculate bounds of all frames
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        this.designFiles.forEach(file => {
            if (file.position) {
                minX = Math.min(minX, file.position.x);
                minY = Math.min(minY, file.position.y);
                maxX = Math.max(maxX, file.position.x + (file.dimensions?.width || 300));
                maxY = Math.max(maxY, file.position.y + (file.dimensions?.height || 200));
            }
        });

        if (minX === Infinity) return; // No positioned frames

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        // Calculate scale to fit
        const scaleX = containerRect.width / contentWidth;
        const scaleY = containerRect.height / contentHeight;
        const scale = Math.min(scaleX, scaleY, 1) * 0.9; // 90% to add padding

        // Center content
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        this.transform.x = containerRect.width / 2 - centerX * scale;
        this.transform.y = containerRect.height / 2 - centerY * scale;
        this.transform.scale = scale;

        this.updateCanvasTransform();
        this.updateZoomLevel();
    }

    resetView() {
        this.transform = { x: 0, y: 0, scale: 1 };
        this.updateCanvasTransform();
        this.updateZoomLevel();
    }

    updateCanvasTransform() {
        const canvasContent = document.getElementById('canvas-content');
        canvasContent.style.transform = `translate(${this.transform.x}px, ${this.transform.y}px) scale(${this.transform.scale})`;
    }

    updateZoomLevel() {
        const zoomLevel = document.getElementById('zoom-level');
        zoomLevel.textContent = Math.round(this.transform.scale * 100) + '%';
    }

    filterFrames(searchTerm) {
        const frames = document.querySelectorAll('.design-frame');

        frames.forEach(frame => {
            const frameName = frame.dataset.name || '';
            const isVisible = !searchTerm ||
                frameName.toLowerCase().includes(searchTerm.toLowerCase());

            frame.style.display = isVisible ? 'block' : 'none';
        });
    }

    showStatus(text) {
        document.getElementById('status-text').textContent = text;
    }

    updateFrameCount() {
        const visibleFrames = document.querySelectorAll('.design-frame:not([style*="display: none"])');
        document.getElementById('frame-count').textContent = `${visibleFrames.length} frames`;
    }
}

// IPC event listeners
ipcRenderer.on('design-files-loaded', (event, data) => {
    canvasInterface.handleDesignFilesLoaded(data);
});

ipcRenderer.on('design-file-updated', (event, data) => {
    canvasInterface.handleDesignFileUpdated(data);
});

ipcRenderer.on('canvas-error', (event, error) => {
    canvasInterface.showStatus(`Error: ${error.message}`);
});

// Initialize canvas interface
let canvasInterface;
document.addEventListener('DOMContentLoaded', () => {
    canvasInterface = new CanvasInterface();
});
```

### Inter-Process Communication Protocol

#### Main Process IPC Handlers
```typescript
// src/main/ipc-handlers.js
const { ipcMain, dialog, BrowserWindow } = require('electron');

class IPCHandlers {
    constructor(mainWindow, workspaceManager, canvasManager) {
        this.mainWindow = mainWindow;
        this.workspaceManager = workspaceManager;
        this.canvasManager = canvasManager;
        this.setupHandlers();
    }

    setupHandlers() {
        // Application lifecycle
        ipcMain.handle('get-app-info', () => ({
            version: require('../package.json').version,
            platform: process.platform
        }));

        // Window management
        ipcMain.handle('minimize-window', () => {
            this.mainWindow.minimize();
        });

        ipcMain.handle('maximize-window', () => {
            if (this.mainWindow.isMaximized()) {
                this.mainWindow.unmaximize();
            } else {
                this.mainWindow.maximize();
            }
        });

        ipcMain.handle('close-window', () => {
            this.mainWindow.close();
        });

        // Workspace management
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

        ipcMain.handle('get-workspace-info', () => {
            return this.workspaceManager.getWorkspaceInfo();
        });

        ipcMain.handle('set-workspace', async (event, workspacePath) => {
            await this.workspaceManager.setWorkspace(workspacePath);
        });

        // File operations
        ipcMain.handle('list-templates', () => {
            return this.workspaceManager.listTemplates();
        });

        ipcMain.handle('read-file', async (event, filePath) => {
            return await this.workspaceManager.readFile(filePath);
        });

        ipcMain.handle('write-file', async (event, filePath, content) => {
            await this.workspaceManager.writeFile(filePath, content);
        });

        // Canvas operations
        ipcMain.handle('load-design-files', async (event, options) => {
            return await this.canvasManager.loadDesignFiles(options);
        });

        ipcMain.handle('open-canvas', () => {
            this.canvasManager.openCanvasPanel();
        });

        // Template operations
        ipcMain.handle('open-template', async (event, templatePath) => {
            await this.templateManager.openTemplate(templatePath);
        });

        // Chat operations
        ipcMain.handle('send-chat-message', async (event, data) => {
            return await this.chatManager.sendMessage(data);
        });

        ipcMain.handle('clear-chat', () => {
            this.chatManager.clearChat();
        });

        ipcMain.handle('stop-chat', () => {
            this.chatManager.stopChat();
        });

        ipcMain.handle('get-chat-history', () => {
            return this.chatManager.getChatHistory();
        });

        // Configuration
        ipcMain.handle('get-config', (event, key) => {
            return this.configManager.get(key);
        });

        ipcMain.handle('set-config', (event, key, value) => {
            this.configManager.set(key, value);
        });

        // Build operations
        ipcMain.handle('build-templates', async () => {
            return await this.buildManager.buildTemplates();
        });
    }
}

module.exports = IPCHandlers;
```

### Security and Context Isolation

#### Preload Scripts Architecture
```typescript
// src/main/preload/main-preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Application API
contextBridge.exposeInMainWorld('tadAPI', {
    // Application info
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),

    // Window management
    minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
    closeWindow: () => ipcRenderer.invoke('close-window'),

    // Workspace
    selectWorkspace: () => ipcRenderer.invoke('select-workspace'),
    getWorkspaceInfo: () => ipcRenderer.invoke('get-workspace-info'),
    setWorkspace: (path) => ipcRenderer.invoke('set-workspace', path),

    // Files
    listTemplates: () => ipcRenderer.invoke('list-templates'),
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),

    // Canvas
    loadDesignFiles: (options) => ipcRenderer.invoke('load-design-files', options),
    openCanvas: () => ipcRenderer.invoke('open-canvas'),

    // Templates
    openTemplate: (path) => ipcRenderer.invoke('open-template', path),

    // Chat
    sendChatMessage: (data) => ipcRenderer.invoke('send-chat-message', data),
    clearChat: () => ipcRenderer.invoke('clear-chat'),
    stopChat: () => ipcRenderer.invoke('stop-chat'),
    getChatHistory: () => ipcRenderer.invoke('get-chat-history'),

    // Configuration
    getConfig: (key) => ipcRenderer.invoke('get-config', key),
    setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

    // Build
    buildTemplates: () => ipcRenderer.invoke('build-templates'),

    // Events
    onWorkspaceChanged: (callback) => ipcRenderer.on('workspace-changed', callback),
    onTemplatesUpdated: (callback) => ipcRenderer.on('templates-updated', callback),
    onConfigChanged: (callback) => ipcRenderer.on('config-changed', callback)
});

// Handle application-level events
ipcRenderer.on('application-error', (event, error) => {
  console.error('TAD Application Error:', error);
  // Could show user notification here
});
```

#### Canvas-Specific Preload
```typescript
// src/main/preload/canvas-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('canvasAPI', {
    // Canvas-specific operations
    loadDesignFiles: (options) => ipcRenderer.invoke('load-design-files', options),
    saveCanvasState: (state) => ipcRenderer.invoke('save-canvas-state', state),
    requestTemplatePreview: (path) => ipcRenderer.invoke('request-template-preview', path),

    // Frame operations
    selectFrame: (frameId) => ipcRenderer.invoke('select-frame', frameId),
    updateFramePosition: (frameId, position) => ipcRenderer.invoke('update-frame-position', { frameId, position }),
    openFrameInEditor: (frameId) => ipcRenderer.invoke('open-frame-in-editor', frameId),

    // Canvas interactions
    zoomIn: () => ipcRenderer.invoke('canvas-zoom-in'),
    zoomOut: () => ipcRenderer.invoke('canvas-zoom-out'),
    fitToView: () => ipcRenderer.invoke('canvas-fit-to-view'),
    resetView: () => ipcRenderer.invoke('canvas-reset-view'),

    // Events
    onDesignFilesLoaded: (callback) => ipcRenderer.on('design-files-loaded', callback),
    onDesignFileUpdated: (callback) => ipcRenderer.on('design-file-updated', callback),
    onCanvasError: (callback) => ipcRenderer.on('canvas-error', callback),
    onFrameSelected: (callback) => ipcRenderer.on('frame-selected', callback)
});
```

### Migration Benefits and Challenges

#### Benefits of This Approach

1. **Native Desktop Experience**
   - Full control over application windows and UI
   - Native window management and controls
   - Better integration with host OS

2. **Improved Performance**
   - Direct access to system resources
   - No webview overhead for main interface
   - Better memory management

3. **Enhanced Security**
   - Context isolation between processes
   - Controlled API exposure via preload scripts
   - Process-level sandboxing

4. **Better User Experience**
   - Native window behaviors
   - Proper application lifecycle
   - System integration (dock, taskbar, etc.)

#### Challenges and Solutions

1. **Process Management Complexity**
   - **Challenge**: Managing multiple renderer processes
   - **Solution**: Centralized window management with proper cleanup

2. **IPC Communication Overhead**
   - **Challenge**: Synchronous IPC can block UI
   - **Solution**: Async IPC with proper error handling and timeouts

3. **State Synchronization**
   - **Challenge**: Keeping state consistent across windows
   - **Solution**: Centralized state management with event-driven updates

4. **Build and Packaging Complexity**
   - **Challenge**: More complex build process than VS Code extension
   - **Solution**: Use Electron Builder with proper configuration

### Implementation Roadmap

#### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Set up Electron project structure
- [ ] Implement main process with basic window management
- [ ] Create preload scripts for secure API exposure
- [ ] Set up IPC communication infrastructure

#### Phase 2: Main Interface Migration (Week 3-4)
- [ ] Migrate main window renderer from webview to native
- [ ] Implement workspace management UI
- [ ] Add template tree and file operations
- [ ] Integrate build system

#### Phase 3: Chat Interface Migration (Week 5-6)
- [ ] Convert chat sidebar from webview to BrowserView
- [ ] Implement chat message handling and streaming
- [ ] Add model selection and configuration
- [ ] Preserve chat history and state

#### Phase 4: Canvas Migration (Week 7-8)
- [ ] Create dedicated canvas window
- [ ] Implement canvas rendering and interactions
- [ ] Add layout modes and frame management
- [ ] Integrate with design file loading

#### Phase 5: Advanced Features (Week 9-10)
- [ ] Implement template editor window
- [ ] Add language server integration
- [ ] Integrate AI provider management
- [ ] Add comprehensive error handling

#### Phase 6: Testing and Polish (Week 11-12)
- [ ] Comprehensive testing across platforms
- [ ] Performance optimization
- [ ] Security audit and hardening
- [ ] Documentation and packaging

This migration strategy provides a clear path from VS Code extension to standalone Electron application while maintaining all core TAD functionality and improving the overall user experience.