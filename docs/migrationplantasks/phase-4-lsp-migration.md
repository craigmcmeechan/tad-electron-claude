# Phase 4: Advanced Language Server Implementation (Weeks 9-16)

## Overview

Phase 4 implements a comprehensive standalone Language Server Protocol (LSP) server for Nunjucks templating language within the Electron application. This phase delivers enterprise-grade language features including intelligent code completion, real-time diagnostics, go-to-definition, hover information, and advanced code formatting - all optimized for Nunjucks-specific syntax and patterns.

## Objectives

- Implement complete standalone LSP server with 15+ source files
- Create multi-process architecture with separate LSP server process
- Deliver advanced language features: completion, diagnostics, navigation, formatting
- Achieve performance targets: <100ms parsing, <50ms completion responses
- Provide comprehensive testing infrastructure and benchmarks
- Ensure seamless integration with Electron application architecture

## Timeline
**Duration:** 8 weeks (Weeks 9-16)
**Team:** Backend Developer (lead), LSP Specialist, Lead Developer
**Dependencies:** Phase 3 completion, LSP server documentation finalized

## Detailed Task Breakdown

### 4.1 LSP Core Infrastructure (Weeks 9-10)
**Priority:** High
**Effort:** 2 weeks
**Owner:** LSP Specialist

#### Tasks:
- [ ] Implement LanguageServerManager class for LSP orchestration
- [ ] Create Nunjucks language server with JSON-RPC communication
- [ ] Setup LSP message handling and protocol implementation
- [ ] Implement LSP server lifecycle management (start/stop/restart)
- [ ] Create LSP error handling and recovery mechanisms
- [ ] Setup LSP server configuration and workspace integration
- [ ] Integrate comprehensive LSP logging and performance monitoring
- [ ] Implement LSP server security logging and validation
- [ ] Setup LSP performance metrics collection and alerting
- [ ] Create LSP audit trail and error tracking system
- [ ] Implement LSP cross-process communication logging
- [ ] Integrate persistent store for LSP configuration persistence
- [ ] Implement store-based LSP server state management
- [ ] Setup store synchronization for LSP workspace data
- [ ] Configure store backup for critical LSP operations
- [ ] Implement store-based LSP performance metrics storage
- [ ] Setup store error correction for LSP data integrity

#### Deliverables:
- [ ] `src/main/LanguageServerManager.js` - LSP orchestration
- [ ] `src/main/lsp/NunjucksLanguageServer.js` - Language server implementation
- [ ] `src/main/lsp/LSPClient.js` - LSP client for communication
- [ ] LSP protocol message handlers
- [ ] LSP server configuration system

#### Success Criteria:
- [ ] LSP server starts successfully and communicates via JSON-RPC
- [ ] Basic LSP protocol messages are handled correctly
- [ ] LSP server integrates with workspace file system
- [ ] Error handling and recovery work properly
- [ ] LSP server responds to basic requests
- [ ] Comprehensive LSP logging captures all operations and errors
- [ ] LSP performance monitoring tracks response times and throughput
- [ ] LSP security logging validates requests and responses
- [ ] LSP metrics collection provides operational insights
- [ ] LSP error tracking enables effective debugging
- [ ] LSP configurations persist across application restarts
- [ ] LSP server state is synchronized between processes
- [ ] Store backups protect critical LSP operation data
- [ ] Store error correction maintains LSP data integrity

#### Technical Implementation:

**LanguageServerManager Class:**
```javascript
// src/main/LanguageServerManager.js
const { spawn } = require('child_process');
const path = require('path');
const { ipcMain } = require('electron');
const Logger = require('./Logger');

class LanguageServerManager {
  constructor(workspaceManager, storeManager, logger) {
    this.workspaceManager = workspaceManager;
    this.storeManager = storeManager;
    this.serverProcess = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.logger = logger.child({
      component: 'LanguageServerManager',
      lspVersion: '1.0.0'
    });
    this.isRunning = false;
    this.performanceMonitor = {
      startOperation: (name) => this.logger.time(`lsp-${name}`),
      endOperation: (name) => this.logger.timeEnd(`lsp-${name}`)
    };
    this.metrics = {
      requestsProcessed: 0,
      errorsEncountered: 0,
      averageResponseTime: 0,
      uptime: 0
    };
  }

  async startServer() {
    const operationId = `lsp-start-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    if (this.isRunning) {
      this.logger.warn('LSP server is already running', { operationId });
      return;
    }

    try {
      this.logger.info('Starting Nunjucks language server', {
        operationId,
        workspacePath: this.workspaceManager.currentWorkspace,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      });

      // Start the language server process
      const serverPath = path.join(__dirname, 'lsp', 'nunjucks-language-server.js');
      this.serverProcess = spawn('node', [serverPath], {
        cwd: this.workspaceManager.currentWorkspace,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'production',
          WORKSPACE_PATH: this.workspaceManager.currentWorkspace,
          LOG_LEVEL: 'debug' // LSP server logging level
        }
      });

      // Setup communication with logging
      this.setupServerCommunication();

      // Load LSP configuration from persistent store
      await this.loadLSPConfiguration();

      // Setup IPC handlers
      this.setupIPCHandlers();

      // Wait for server to be ready
      await this.waitForServerReady();

      this.isRunning = true;
      this.metrics.uptime = Date.now();

      // Save LSP server state to persistent store
      await this.saveLSPState();

      this.performanceMonitor.endOperation(operationId);

      this.logger.info('Nunjucks language server started successfully', {
        operationId,
        duration: this.getLastOperationDuration(operationId),
        processId: this.serverProcess.pid,
        memoryUsage: process.memoryUsage()
      });

    } catch (error) {
      this.performanceMonitor.endOperation(operationId);
      this.metrics.errorsEncountered++;

      this.logger.error('Failed to start LSP server', {
        operationId,
        error: error.message,
        stack: error.stack,
        duration: this.getLastOperationDuration(operationId),
        workspacePath: this.workspaceManager.currentWorkspace
      });
      throw error;
    }
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
            this.logger.error('Failed to parse LSP server response:', error);
          }
        }
      }
    });

    this.serverProcess.stderr.on('data', (data) => {
      this.logger.error('LSP server error:', data.toString());
    });

    this.serverProcess.on('close', (code) => {
      this.logger.info(`LSP server exited with code ${code}`);
      this.isRunning = false;
      this.serverProcess = null;

      // Attempt to restart if unexpected exit
      if (code !== 0) {
        this.logger.warn('LSP server exited unexpectedly, attempting restart...');
        setTimeout(() => this.startServer(), 5000);
      }
    });
  }

  setupIPCHandlers() {
    ipcMain.handle('lsp-request', async (event, method, params) => {
      return this.sendRequest(method, params);
    });

    ipcMain.handle('lsp-initialize', async () => {
      return this.initializeLanguageServer();
    });

    ipcMain.handle('lsp-shutdown', async () => {
      return this.shutdownLanguageServer();
    });
  }

  async sendRequest(method, params) {
    const requestId = ++this.requestId;
    const operationId = `lsp-request-${requestId}`;
    this.performanceMonitor.startOperation(operationId);

    if (!this.isRunning) {
      this.logger.error('LSP request failed - server not running', {
        method,
        requestId,
        operationId
      });
      throw new Error('LSP server is not running');
    }

    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };

    this.logger.debug('Sending LSP request', {
      method,
      requestId,
      operationId,
      paramsSize: JSON.stringify(params).length,
      pendingRequests: this.pendingRequests.size
    });

    return new Promise((resolve, reject) => {
      // Set timeout for request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.metrics.errorsEncountered++;
        this.performanceMonitor.endOperation(operationId);

        this.logger.error('LSP request timeout', {
          method,
          requestId,
          operationId,
          timeout: 10000,
          duration: this.getLastOperationDuration(operationId)
        });

        reject(new Error(`LSP request timeout: ${method}`));
      }, 10000);

      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          this.metrics.requestsProcessed++;
          this.performanceMonitor.endOperation(operationId);

          this.logger.debug('LSP request completed successfully', {
            method,
            requestId,
            operationId,
            duration: this.getLastOperationDuration(operationId),
            resultSize: JSON.stringify(result).length
          });

          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.metrics.errorsEncountered++;
          this.performanceMonitor.endOperation(operationId);

          this.logger.error('LSP request failed', {
            method,
            requestId,
            operationId,
            error: error.message,
            duration: this.getLastOperationDuration(operationId)
          });

          reject(error);
        }
      });

      // Send request to server
      try {
        this.serverProcess.stdin.write(JSON.stringify(request) + '\n');
        this.logger.trace('LSP request sent to server process', {
          method,
          requestId,
          operationId,
          processId: this.serverProcess.pid
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        this.metrics.errorsEncountered++;
        this.performanceMonitor.endOperation(operationId);

        this.logger.error('Failed to send LSP request to server', {
          method,
          requestId,
          operationId,
          error: error.message,
          processId: this.serverProcess.pid
        });

        reject(new Error(`Failed to send LSP request: ${error.message}`));
      }
    });
  }

  handleServerResponse(response) {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }

    // Handle server notifications
    if (response.method && !response.id) {
      this.handleServerNotification(response.method, response.params);
    }
  }

  handleServerNotification(method, params) {
    switch (method) {
      case 'textDocument/publishDiagnostics':
        this.handleDiagnostics(params);
        break;
      case 'window/logMessage':
        this.logger.info('LSP:', params.message);
        break;
      default:
        this.logger.debug('Unhandled LSP notification:', method, params);
    }
  }

  handleDiagnostics(params) {
    // Send diagnostics to renderer process
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('lsp-diagnostics', params);
    });
  }

  async initializeLanguageServer() {
    const workspacePath = this.workspaceManager.currentWorkspace;
    const config = this.workspaceManager.getConfiguration();

    return this.sendRequest('initialize', {
      processId: process.pid,
      rootPath: workspacePath,
      rootUri: `file://${workspacePath}`,
      capabilities: {
        textDocument: {
          synchronization: {
            didSave: true,
            didChange: true,
            willSave: true
          },
          completion: {
            dynamicRegistration: true
          },
          hover: {
            dynamicRegistration: true
          },
          definition: {
            dynamicRegistration: true
          },
          references: {
            dynamicRegistration: true
          },
          documentSymbol: {
            dynamicRegistration: true
          }
        }
      },
      initializationOptions: {
        config: config.nunjucks
      }
    });
  }

  async shutdownLanguageServer() {
    if (!this.isRunning) return;

    try {
      await this.sendRequest('shutdown', {});
      this.sendRequest('exit', {});
    } catch (error) {
      this.logger.warn('Error during LSP shutdown:', error);
    }

    this.isRunning = false;
  }

  async waitForServerReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('LSP server startup timeout'));
      }, 10000);

      // Wait for initialize response
      const checkReady = () => {
        if (this.isRunning) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  async loadLSPConfiguration() {
    try {
      const storedConfig = await this.storeManager.get('lsp', {});

      // Apply stored LSP configuration
      if (storedConfig.settings) {
        this.logger.info('Loaded LSP configuration from store', {
          hasSettings: !!storedConfig.settings,
          lastStarted: storedConfig.lastStarted
        });
      }

      // Update last started timestamp
      await this.storeManager.set('lsp.lastStarted', new Date().toISOString());

    } catch (error) {
      this.logger.warn('Failed to load LSP configuration from store:', error);
    }
  }

  async saveLSPState() {
    try {
      const lspState = {
        isRunning: this.isRunning,
        uptime: this.metrics.uptime,
        requestsProcessed: this.metrics.requestsProcessed,
        errorsEncountered: this.metrics.errorsEncountered,
        lastStarted: new Date().toISOString(),
        processId: this.serverProcess?.pid || null
      };

      await this.storeManager.set('lsp.state', lspState);

      this.logger.debug('LSP server state saved to persistent store', {
        isRunning: this.isRunning,
        requestsProcessed: this.metrics.requestsProcessed
      });

    } catch (error) {
      this.logger.error('Failed to save LSP state to store:', error);
    }
  }

  dispose() {
    if (this.serverProcess) {
      this.shutdownLanguageServer();
    }
  }
}

module.exports = LanguageServerManager;
```

**Nunjucks Language Server:**
```javascript
// src/main/lsp/nunjucks-language-server.js
const fs = require('fs').promises;
const path = require('path');

class NunjucksLanguageServer {
  constructor() {
    this.documents = new Map();
    this.templates = new Map();
    this.config = {};
  }

  async initialize(params) {
    this.config = params.initializationOptions?.config || {};

    // Scan workspace for templates
    await this.scanWorkspace(params.rootPath);

    return {
      capabilities: {
        textDocumentSync: 1, // Full document sync
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: ['{', '%', '"', "'"]
        },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        referencesProvider: true
      }
    };
  }

  async scanWorkspace(rootPath) {
    const scanDirectory = async (dirPath, relativePath = '') => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.join(relativePath, entry.name);

        if (entry.isDirectory() && !this.shouldIgnoreDirectory(entry.name)) {
          await scanDirectory(fullPath, relPath);
        } else if (entry.isFile() && this.isTemplateFile(entry.name)) {
          this.templates.set(relPath, {
            path: relPath,
            fullPath,
            type: this.getTemplateType(entry.name)
          });
        }
      }
    };

    await scanDirectory(rootPath);
  }

  shouldIgnoreDirectory(name) {
    const ignoreDirs = ['node_modules', '.git', 'dist', '.tad'];
    return ignoreDirs.includes(name);
  }

  isTemplateFile(filename) {
    const extensions = this.config.defaultExtensions || ['.njk', '.nunjucks', '.html'];
    return extensions.some(ext => filename.endsWith(ext));
  }

  getTemplateType(filename) {
    if (filename.includes('/pages/')) return 'page';
    if (filename.includes('/components/')) return 'component';
    if (filename.includes('/elements/')) return 'element';
    return 'template';
  }

  // Handle document open
  async onDidOpenTextDocument(params) {
    const { textDocument } = params;
    this.documents.set(textDocument.uri, {
      uri: textDocument.uri,
      languageId: textDocument.languageId,
      version: textDocument.version,
      content: textDocument.text
    });
  }

  // Handle document change
  async onDidChangeTextDocument(params) {
    const { textDocument, contentChanges } = params;
    const doc = this.documents.get(textDocument.uri);

    if (doc) {
      // Apply content changes
      let content = doc.content;
      for (const change of contentChanges) {
        if (change.range) {
          // Incremental change
          const lines = content.split('\n');
          const startLine = change.range.start.line;
          const endLine = change.range.end.line;
          const startChar = change.range.start.character;
          const endChar = change.range.end.character;

          const before = lines.slice(0, startLine).join('\n') +
                        (startLine > 0 ? '\n' : '') +
                        lines[startLine].substring(0, startChar);

          const after = lines[endLine].substring(endChar) +
                       (endLine < lines.length - 1 ? '\n' : '') +
                       lines.slice(endLine + 1).join('\n');

          content = before + change.text + after;
        } else {
          // Full content change
          content = change.text;
        }
      }

      doc.content = content;
      doc.version = textDocument.version;
    }
  }

  // Provide completion
  async onCompletion(params) {
    const { textDocument, position } = params;
    const doc = this.documents.get(textDocument.uri);

    if (!doc) return [];

    const completions = [];
    const line = doc.content.split('\n')[position.line];
    const linePrefix = line.substring(0, position.character);

    // Template path completions
    if (linePrefix.match(/{%\s*(?:include|import|extends)\s+["']([^"']*)$/)) {
      completions.push(...this.getTemplateCompletions());
    }

    // Variable completions
    if (linePrefix.match(/\{\{\s*([^}]*)$/)) {
      completions.push(...this.getVariableCompletions());
    }

    return completions;
  }

  getTemplateCompletions() {
    const completions = [];

    for (const [path, template] of this.templates) {
      completions.push({
        label: template.type === 'page' ? path.replace('.tad/templates/pages/', '') : path,
        kind: 17, // File
        detail: template.type,
        insertText: path,
        documentation: `Template: ${path}`
      });
    }

    return completions;
  }

  getVariableCompletions() {
    // Return common Nunjucks variables and functions
    return [
      {
        label: 'title',
        kind: 6, // Variable
        detail: 'Page title variable',
        insertText: 'title'
      },
      {
        label: 'content',
        kind: 6,
        detail: 'Page content variable',
        insertText: 'content'
      }
    ];
  }

  // Provide hover information
  async onHover(params) {
    const { textDocument, position } = params;
    const doc = this.documents.get(textDocument.uri);

    if (!doc) return null;

    // Find template reference under cursor
    const reference = this.findTemplateReference(doc.content, position);

    if (reference) {
      const template = this.templates.get(reference.path);
      if (template) {
        return {
          contents: {
            kind: 'markdown',
            value: `**Template:** ${reference.path}\n\n**Type:** ${template.type}\n\n**Path:** ${template.fullPath}`
          },
          range: reference.range
        };
      }
    }

    return null;
  }

  findTemplateReference(content, position) {
    const lines = content.split('\n');
    const line = lines[position.line];

    // Look for template references in the line
    const includeMatch = line.match(/{%\s*(?:include|import|extends)\s+["']([^"']*?)["']/);
    if (includeMatch) {
      const path = includeMatch[1];
      return {
        path,
        range: {
          start: { line: position.line, character: includeMatch.index },
          end: { line: position.line, character: includeMatch.index + includeMatch[0].length }
        }
      };
    }

    return null;
  }

  // Provide definition
  async onDefinition(params) {
    const { textDocument, position } = params;
    const doc = this.documents.get(textDocument.uri);

    if (!doc) return null;

    const reference = this.findTemplateReference(doc.content, position);

    if (reference) {
      const template = this.templates.get(reference.path);
      if (template) {
        return {
          uri: `file://${template.fullPath}`,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 }
          }
        };
      }
    }

    return null;
  }

  // Provide document symbols
  async onDocumentSymbol(params) {
    const { textDocument } = params;
    const doc = this.documents.get(textDocument.uri);

    if (!doc) return [];

    const symbols = [];
    const lines = doc.content.split('\n');

    lines.forEach((line, index) => {
      // Find blocks
      const blockMatch = line.match(/{%\s*block\s+([A-Za-z_][\w]*)\s*%}/);
      if (blockMatch) {
        symbols.push({
          name: blockMatch[1],
          kind: 2, // Class (representing a block)
          location: {
            uri: textDocument.uri,
            range: {
              start: { line: index, character: blockMatch.index },
              end: { line: index, character: blockMatch.index + blockMatch[0].length }
            }
          }
        });
      }

      // Find macros
      const macroMatch = line.match(/{%\s*macro\s+([A-Za-z_][\w]*)\s*\(/);
      if (macroMatch) {
        symbols.push({
          name: macroMatch[1],
          kind: 6, // Function (representing a macro)
          location: {
            uri: textDocument.uri,
            range: {
              start: { line: index, character: macroMatch.index },
              end: { line: index, character: macroMatch.index + macroMatch[0].length }
            }
          }
        });
      }
    });

    return symbols;
  }

  async shutdown() {
    this.documents.clear();
    this.templates.clear();
    return null;
  }
}

// Main server loop
const server = new NunjucksLanguageServer();
let buffer = '';

process.stdin.on('data', (data) => {
  buffer += data.toString();

  const messages = buffer.split('\n');
  buffer = messages.pop();

  for (const message of messages) {
    if (message.trim()) {
      try {
        const request = JSON.parse(message);

        if (request.method) {
          handleRequest(request);
        }
      } catch (error) {
        console.error('Failed to parse request:', error);
      }
    }
  }
});

async function handleRequest(request) {
  try {
    let result;

    switch (request.method) {
      case 'initialize':
        result = await server.initialize(request.params);
        break;
      case 'textDocument/didOpen':
        result = await server.onDidOpenTextDocument(request.params);
        break;
      case 'textDocument/didChange':
        result = await server.onDidChangeTextDocument(request.params);
        break;
      case 'textDocument/completion':
        result = await server.onCompletion(request.params);
        break;
      case 'textDocument/hover':
        result = await server.onHover(request.params);
        break;
      case 'textDocument/definition':
        result = await server.onDefinition(request.params);
        break;
      case 'textDocument/documentSymbol':
        result = await server.onDocumentSymbol(request.params);
        break;
      case 'shutdown':
        result = await server.shutdown();
        break;
      default:
        result = null;
    }

    // Send response
    const response = {
      jsonrpc: '2.0',
      id: request.id,
      result
    };

    process.stdout.write(JSON.stringify(response) + '\n');

  } catch (error) {
    // Send error response
    const response = {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: error.message
      }
    };

    process.stdout.write(JSON.stringify(response) + '\n');
  }
}
```

### 4.2 Parser and AST Implementation (Weeks 11-12)
**Priority:** High
**Effort:** 2 weeks
**Owner:** LSP Specialist

### 4.3 Language Features Implementation (Weeks 13-14)
**Priority:** High
**Effort:** 2 weeks
**Owner:** LSP Specialist

### 4.4 Workspace and Performance (Weeks 15-16)
**Priority:** High
**Effort:** 2 weeks
**Owner:** Backend Developer

#### Tasks:
- [ ] Implement definition provider with template navigation
- [ ] Create completion provider with intelligent suggestions
- [ ] Setup hover provider with template information
- [ ] Implement diagnostics for unresolved references
- [ ] Create document symbols for blocks and macros
- [ ] Setup document links for relationship annotations

#### Deliverables:
- [ ] LSP definition provider implementation
- [ ] LSP completion provider with context awareness
- [ ] LSP hover provider with rich information
- [ ] LSP diagnostics system
- [ ] LSP document symbols provider
- [ ] LSP document links provider

#### Success Criteria:
- [ ] Go-to-definition works for template references
- [ ] Auto-completion provides relevant suggestions
- [ ] Hover shows useful information about templates
- [ ] Diagnostics identify and report issues
- [ ] Document symbols work in outline views
- [ ] Document links are clickable and functional

## Quality Assurance

### Testing Requirements:
- [ ] Unit tests for LSP server functionality
- [ ] Integration tests for JSON-RPC communication
- [ ] End-to-end tests for LSP features
- [ ] Performance tests for LSP responsiveness
- [ ] Error handling and recovery tests

### Code Quality:
- [ ] LSP protocol compliance verification
- [ ] Error handling for malformed requests
- [ ] Memory leak prevention in document management
- [ ] Proper cleanup of resources
- [ ] Logging for debugging and monitoring

## Risks and Mitigations

### Technical Risks:
- **LSP Protocol Complexity:** JSON-RPC implementation challenges
  - *Mitigation:* Thorough testing, protocol validation, incremental implementation
- **Performance Impact:** LSP server resource usage
  - *Mitigation:* Efficient document management, background processing
- **Compatibility Issues:** Differences from VS Code LSP implementation
  - *Mitigation:* Feature parity testing, user feedback collection

### Schedule Risks:
- **Integration Complexity:** Coordinating LSP with existing systems
  - *Mitigation:* Start with basic features, expand incrementally
- **Debugging Challenges:** LSP protocol debugging difficulties
  - *Mitigation:* Comprehensive logging, testing infrastructure

## Success Criteria

### Functional Requirements:
- [ ] Complete standalone LSP server with 15+ source files implemented
- [ ] Multi-process architecture with separate LSP server process functional
- [ ] All advanced language features working: completion, diagnostics, navigation, formatting
- [ ] Performance targets achieved: <100ms parsing, <50ms completion responses
- [ ] Comprehensive testing infrastructure with unit and integration tests
- [ ] Seamless integration with Electron application architecture
- [ ] LSP logging system captures all server operations and client interactions
- [ ] LSP performance monitoring provides real-time metrics and alerts
- [ ] LSP security logging validates all requests and responses
- [ ] LSP error tracking enables comprehensive debugging and troubleshooting
- [ ] LSP configurations persist across application restarts
- [ ] LSP server state is synchronized between processes
- [ ] Store backups protect critical LSP operation data
- [ ] Store error correction maintains LSP data integrity

### Quality Requirements:
- [ ] LSP implementation follows protocol standards
- [ ] Error handling is robust and informative
- [ ] Code is maintainable and well-documented
- [ ] Integration with existing systems is seamless

### Integration Requirements:
- [ ] LSP works correctly with workspace file system
- [ ] UI components integrate properly with LSP features
- [ ] Error states are handled gracefully
- [ ] Performance impact is minimal

## Deliverables Summary

### Core LSP Components:
- [ ] LanguageServerManager for orchestration with logging
- [ ] NunjucksLanguageServer implementation with performance monitoring
- [ ] LSP client for renderer communication with security logging
- [ ] LSP protocol message handlers with audit trails
- [ ] LSP performance metrics collector
- [ ] LSP security validator and logger
- [ ] LSP error tracking and reporting system
- [ ] StoreLSPManager for persistent LSP configuration
- [ ] StoreLSPStateManager for LSP server state persistence
- [ ] StoreLSPMetrics for LSP performance metrics storage
- [ ] StoreLSPBackup for critical LSP operation backups

### LSP Features:
- [ ] Definition provider for template navigation
- [ ] Completion provider with intelligent suggestions
- [ ] Hover provider with rich information
- [ ] Diagnostics for error reporting
- [ ] Document symbols for outline views
- [ ] Document links for relationship navigation

### Integration:
- [ ] IPC communication with renderer processes
- [ ] Workspace integration for file operations
- [ ] UI integration for LSP features
- [ ] Error handling and user feedback

## Phase 4 Checklist

### Pre-Phase Preparation:
- [ ] Phase 3 deliverables reviewed and approved
- [ ] LSP requirements and specifications documented
- [ ] Development environment prepared for LSP development
- [ ] JSON-RPC knowledge and tools available

### During Phase Execution:
- [ ] Daily LSP functionality testing
- [ ] Regular performance monitoring
- [ ] Protocol compliance verification
- [ ] Integration testing with existing components

### Phase Completion:
- [ ] All LSP features functional and tested
- [ ] Performance requirements met
- [ ] Integration with UI components complete
- [ ] Documentation updated
- [ ] Ready for Phase 5 handoff

## Next Phase Dependencies

Phase 4 establishes the intelligent code editing capabilities that subsequent phases build upon:

- **Phase 5** depends on LSP infrastructure for security validation
- **Phase 6** requires LSP features for comprehensive testing
- **Phase 7** needs LSP for performance monitoring
- **All subsequent phases** depend on the established LSP framework

This phase transforms the Electron application from a basic editor to a fully-featured development environment with intelligent code assistance and navigation capabilities.