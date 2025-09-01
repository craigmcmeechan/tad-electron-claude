# Security and Sandboxing Migration

## Overview

This document outlines the security and sandboxing changes required for migrating TAD from a VS Code extension to a standalone Electron application. The migration involves transitioning from VS Code's extension security model to Electron's multi-process security architecture while maintaining or improving the overall security posture.

## Current VS Code Extension Security Model

### VS Code Extension Security Features

#### 1. Webview Security
**Content Security Policy (CSP):**
```json
// VS Code webview CSP
{
  "default-src": "'none'",
  "script-src": "'nonce-${nonce}'",
  "style-src": "'unsafe-inline'",
  "img-src": "data: https:",
  "connect-src": "'none'"
}
```

**Resource Restrictions:**
- Limited to `localResourceRoots` defined by extension
- Automatic nonce injection for scripts
- Restricted access to VS Code APIs

#### 2. Extension Host Security
**Process Isolation:**
- Extensions run in separate process from VS Code
- Limited access to system resources
- Sandboxed file system operations

**API Access Control:**
- Granular permissions for VS Code APIs
- Restricted access to user data
- Controlled execution of external commands

#### 3. File System Security
**Workspace Boundaries:**
- Operations limited to workspace folders
- Path validation and normalization
- Prevention of directory traversal attacks

**Safe Command Execution:**
- Controlled execution of shell commands
- Timeout protection
- Command filtering

### Current Security Implementation

#### Webview Security Configuration
```typescript
// src/extension.ts - Webview security setup
const webview = vscode.window.createWebviewPanel('tadCanvas', 'TAD Canvas', column, {
  enableScripts: true,
  localResourceRoots: [
    vscode.Uri.joinPath(context.extensionUri, 'dist'),
    vscode.Uri.joinPath(context.extensionUri, 'assets')
  ]
});

// CSP generation
const nonce = getNonce();
const csp = [
  "default-src 'none'",
  `script-src 'nonce-${nonce}'`,
  "style-src 'unsafe-inline'",
  "img-src data: https:",
  "connect-src 'none'"
].join('; ');

// HTML generation with security
const html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <script nonce="${nonce}" src="${scriptUri}"></script>
</head>
<body>...</body>
</html>`;
```

#### File System Security
```typescript
// src/extension.ts - Path validation
function validateFileAccess(filePath: string): boolean {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const resolved = path.resolve(filePath);

  return resolved.startsWith(workspaceRoot) &&
         !resolved.includes('..') &&
         !isHiddenFile(resolved);
}
```

#### Tool Security
```typescript
// src/services/customAgentService.ts - Command filtering
const UNSAFE_COMMANDS = ['rm', 'del', 'format', 'fdisk'];

function isSafeCommand(command: string): boolean {
  return !UNSAFE_COMMANDS.some(unsafe =>
    command.toLowerCase().includes(unsafe)
  );
}
```

## Electron Security Architecture

### Multi-Process Security Model

#### 1. Process Isolation
**Main Process:**
- Full system access (Node.js APIs)
- Responsible for application lifecycle
- Manages renderer processes
- Handles system integration

**Renderer Processes:**
- Sandboxed browser environments
- Limited system access
- Communicate via IPC
- Isolated from each other

**Security Benefits:**
- Renderer compromise doesn't affect main process
- Controlled API exposure via preload scripts
- Process-level isolation

#### 2. Context Isolation
**Preload Scripts:**
```typescript
// src/main/preload/secure-preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Secure API exposure
contextBridge.exposeInMainWorld('tadAPI', {
  // Safe file operations
  readFile: (path) => ipcRenderer.invoke('secure-read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('secure-write-file', path, content),

  // Safe command execution
  executeCommand: (command, options) => ipcRenderer.invoke('secure-execute-command', command, options),

  // Configuration access
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value)
});

// Remove dangerous globals
delete window.require;
delete window.process;
delete window.module;
```

**Security Features:**
- No direct Node.js access from renderers
- Controlled API surface
- Input validation on main process
- Context isolation prevents prototype pollution

### Enhanced Security Implementation

#### 1. Secure File System Operations
```typescript
// src/main/security/FileSecurityManager.js
const path = require('path');
const fs = require('fs').promises;

class FileSecurityManager {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
    this.allowedExtensions = [
      '.njk', '.nunjucks', '.html', '.css', '.js', '.json',
      '.md', '.txt', '.yaml', '.yml'
    ];
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
  }

  async validateFileAccess(filePath, operation = 'read') {
    const errors = [];

    // Path traversal check
    if (this.containsPathTraversal(filePath)) {
      errors.push('Path contains illegal traversal sequences');
    }

    // Workspace boundary check
    if (!this.isWithinWorkspace(filePath)) {
      errors.push('File access outside workspace boundaries');
    }

    // File extension validation
    if (!this.isAllowedExtension(filePath)) {
      errors.push('File extension not allowed');
    }

    // File size check (for read operations)
    if (operation === 'read') {
      const size = await this.getFileSize(filePath);
      if (size > this.maxFileSize) {
        errors.push(`File too large: ${size} bytes (max: ${this.maxFileSize})`);
      }
    }

    // Hidden file check
    if (this.isHiddenFile(filePath)) {
      errors.push('Hidden files are not allowed');
    }

    return errors;
  }

  containsPathTraversal(filePath) {
    const normalized = path.normalize(filePath);

    // Check for .. sequences that escape workspace
    if (normalized.includes('..')) {
      const workspacePath = this.workspaceManager.currentWorkspace;
      const resolved = path.resolve(workspacePath, filePath);

      if (!resolved.startsWith(workspacePath)) {
        return true;
      }
    }

    return false;
  }

  isWithinWorkspace(filePath) {
    try {
      const workspacePath = this.workspaceManager.currentWorkspace;
      const resolved = path.resolve(workspacePath, filePath);
      return resolved.startsWith(workspacePath);
    } catch {
      return false;
    }
  }

  isAllowedExtension(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.allowedExtensions.includes(ext);
  }

  isHiddenFile(filePath) {
    const basename = path.basename(filePath);
    return basename.startsWith('.');
  }

  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  sanitizePath(filePath) {
    // Normalize path separators
    let sanitized = filePath.replace(/\\/g, '/');

    // Remove redundant separators
    sanitized = sanitized.replace(/\/+/g, '/');

    // Remove leading/trailing whitespace
    sanitized = sanitized.trim();

    // Normalize the path
    sanitized = path.normalize(sanitized);

    return sanitized;
  }

  async secureReadFile(filePath) {
    const errors = await this.validateFileAccess(filePath, 'read');
    if (errors.length > 0) {
      throw new Error(`File access denied: ${errors.join(', ')}`);
    }

    const resolvedPath = path.resolve(this.workspaceManager.currentWorkspace, filePath);
    return await fs.readFile(resolvedPath, 'utf8');
  }

  async secureWriteFile(filePath, content) {
    const errors = await this.validateFileAccess(filePath, 'write');
    if (errors.length > 0) {
      throw new Error(`File write denied: ${errors.join(', ')}`);
    }

    const resolvedPath = path.resolve(this.workspaceManager.currentWorkspace, filePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    // Write file with size limit check
    if (Buffer.byteLength(content, 'utf8') > this.maxFileSize) {
      throw new Error(`Content too large: ${Buffer.byteLength(content, 'utf8')} bytes`);
    }

    await fs.writeFile(resolvedPath, content, 'utf8');
  }
}

module.exports = FileSecurityManager;
```

#### 2. Secure Command Execution
```typescript
// src/main/security/CommandSecurityManager.js
const { spawn } = require('child_process');
const path = require('path');

class CommandSecurityManager {
  constructor() {
    this.allowedCommands = [
      'npm', 'yarn', 'pnpm', 'node', 'npx',
      'git', 'python', 'python3', 'pip', 'pip3'
    ];

    this.dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /del\s+\/s\s+\/q\s+c:\\.*/,
      /format\s+c:/,
      /fdisk/,
      /mkfs/,
      /dd\s+if=/
    ];

    this.timeout = 30000; // 30 seconds
  }

  async validateCommand(command, args = [], options = {}) {
    const errors = [];

    // Command validation
    if (!this.allowedCommands.includes(command)) {
      errors.push(`Command not allowed: ${command}`);
    }

    // Argument validation
    const fullCommand = [command, ...args].join(' ');
    if (this.containsDangerousPatterns(fullCommand)) {
      errors.push('Command contains dangerous patterns');
    }

    // Path validation for arguments
    for (const arg of args) {
      if (this.isPathArgument(arg)) {
        if (!this.isSafePath(arg, options.cwd)) {
          errors.push(`Unsafe path in arguments: ${arg}`);
        }
      }
    }

    // Working directory validation
    if (options.cwd && !this.isSafeWorkingDirectory(options.cwd)) {
      errors.push(`Unsafe working directory: ${options.cwd}`);
    }

    return errors;
  }

  containsDangerousPatterns(command) {
    return this.dangerousPatterns.some(pattern => pattern.test(command));
  }

  isPathArgument(arg) {
    // Check if argument looks like a file path
    return arg.includes('/') || arg.includes('\\') || arg.includes('.');
  }

  isSafePath(filePath, workingDir = process.cwd()) {
    try {
      const resolved = path.resolve(workingDir, filePath);
      // Ensure path doesn't escape common system directories
      const dangerousDirs = [
        '/bin', '/sbin', '/usr', '/etc', '/var', '/root', '/home',
        'C:\\Windows', 'C:\\Program Files', 'C:\\Users'
      ];

      return !dangerousDirs.some(dir => resolved.startsWith(dir));
    } catch {
      return false;
    }
  }

  isSafeWorkingDirectory(cwd) {
    // Allow workspace directories and temp directories
    const allowedPatterns = [
      /^\/tmp\//,
      /^\/var\/tmp\//,
      /^C:\\Temp\\/,
      /^C:\\Users\\[^\\]+\\AppData\\Local\\Temp\\/
    ];

    return allowedPatterns.some(pattern => pattern.test(cwd)) ||
           cwd.startsWith(this.workspaceManager?.currentWorkspace || '');
  }

  async executeSecureCommand(command, args = [], options = {}) {
    const errors = await this.validateCommand(command, args, options);
    if (errors.length > 0) {
      throw new Error(`Command execution denied: ${errors.join(', ')}`);
    }

    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.getSafeEnvironment(),
        timeout: this.timeout,
        killSignal: 'SIGTERM'
      });

      let stdout = '';
      let stderr = '';

      // Collect output
      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      childProcess.on('error', (error) => {
        reject(new Error(`Command execution error: ${error.message}`));
      });

      // Timeout protection
      setTimeout(() => {
        childProcess.kill('SIGTERM');
        reject(new Error('Command execution timeout'));
      }, this.timeout);
    });
  }

  getSafeEnvironment() {
    // Create a safe environment with minimal variables
    const safeEnv = {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HOME: process.env.HOME || process.env.USERPROFILE,
      USER: process.env.USER,
      SHELL: process.env.SHELL,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL
    };

    // Remove potentially dangerous environment variables
    const dangerousVars = [
      'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES', 'DYLD_FORCE_FLAT_NAMESPACE'
    ];

    dangerousVars.forEach(varName => {
      delete safeEnv[varName];
    });

    return safeEnv;
  }

  // Specialized command execution for build operations
  async executeBuildCommand(buildScript, workspacePath) {
    return this.executeSecureCommand('node', [buildScript], {
      cwd: workspacePath,
      timeout: 120000 // 2 minutes for builds
    });
  }

  // Specialized command execution for package management
  async executePackageCommand(manager, command, workspacePath) {
    const allowedManagers = ['npm', 'yarn', 'pnpm'];
    const allowedCommands = ['install', 'ci', 'update'];

    if (!allowedManagers.includes(manager)) {
      throw new Error(`Package manager not allowed: ${manager}`);
    }

    if (!allowedCommands.includes(command)) {
      throw new Error(`Package command not allowed: ${command}`);
    }

    return this.executeSecureCommand(manager, [command], {
      cwd: workspacePath,
      timeout: 300000 // 5 minutes for package operations
    });
  }
}

module.exports = CommandSecurityManager;
```

#### 3. Network Security
```typescript
// src/main/security/NetworkSecurityManager.js
const https = require('https');
const http = require('http');

class NetworkSecurityManager {
  constructor() {
    this.allowedHosts = [
      'api.openai.com',
      'api.anthropic.com',
      'openrouter.ai',
      'registry.npmjs.org',
      'github.com',
      'raw.githubusercontent.com'
    ];

    this.allowedPorts = [80, 443, 22]; // HTTP, HTTPS, SSH
    this.maxResponseSize = 50 * 1024 * 1024; // 50MB
    this.timeout = 30000; // 30 seconds
  }

  validateUrl(url) {
    try {
      const parsedUrl = new URL(url);
      const errors = [];

      // Host validation
      if (!this.allowedHosts.includes(parsedUrl.hostname)) {
        errors.push(`Host not allowed: ${parsedUrl.hostname}`);
      }

      // Port validation
      if (parsedUrl.port && !this.allowedPorts.includes(parseInt(parsedUrl.port))) {
        errors.push(`Port not allowed: ${parsedUrl.port}`);
      }

      // Protocol validation
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        errors.push(`Protocol not allowed: ${parsedUrl.protocol}`);
      }

      return errors;
    } catch (error) {
      return [`Invalid URL: ${error.message}`];
    }
  }

  async makeSecureRequest(url, options = {}) {
    const errors = this.validateUrl(url);
    if (errors.length > 0) {
      throw new Error(`Request denied: ${errors.join(', ')}`);
    }

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'TAD/1.0.0',
        ...options.headers
      },
      timeout: this.timeout,
      rejectUnauthorized: true // Enforce SSL certificate validation
    };

    return new Promise((resolve, reject) => {
      const client = isHttps ? https : http;
      const req = client.request(requestOptions, (res) => {
        let data = '';
        let responseSize = 0;

        res.on('data', (chunk) => {
          responseSize += chunk.length;
          if (responseSize > this.maxResponseSize) {
            req.destroy();
            reject(new Error('Response size limit exceeded'));
            return;
          }
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  // Specialized method for AI API calls
  async makeAIRequest(provider, endpoint, data, apiKey) {
    const baseUrls = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      openrouter: 'https://openrouter.ai/api/v1'
    };

    if (!baseUrls[provider]) {
      throw new Error(`Unknown AI provider: ${provider}`);
    }

    const url = `${baseUrls[provider]}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    // Add provider-specific headers
    if (provider === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
    }

    return this.makeSecureRequest(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
  }
}

module.exports = NetworkSecurityManager;
```

### Content Security Policy Implementation

#### 1. Dynamic CSP Generation
```typescript
// src/main/security/CSPManager.js
class CSPManager {
  constructor() {
    this.nonce = this.generateNonce();
    this.directives = {
      'default-src': ["'self'"],
      'script-src': ["'self'", `'nonce-${this.nonce}'`],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'", 'https:'],
      'connect-src': ["'self'"],
      'media-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"]
    };
  }

  generateNonce() {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('base64');
  }

  generateCSP() {
    const csp = Object.entries(this.directives)
      .map(([directive, values]) => `${directive} ${values.join(' ')}`)
      .join('; ');

    return csp;
  }

  updateDirective(directive, values) {
    if (this.directives[directive]) {
      this.directives[directive] = values;
    }
  }

  addSource(directive, source) {
    if (this.directives[directive]) {
      if (!this.directives[directive].includes(source)) {
        this.directives[directive].push(source);
      }
    }
  }

  removeSource(directive, source) {
    if (this.directives[directive]) {
      this.directives[directive] = this.directives[directive]
        .filter(s => s !== source);
    }
  }

  // Specialized CSP for different contexts
  getCanvasCSP() {
    const canvasCSP = new CSPManager();

    // Allow data URLs for canvas previews
    canvasCSP.addSource('img-src', 'data:');
    canvasCSP.addSource('img-src', 'blob:');

    // Allow inline styles for dynamic styling
    canvasCSP.addSource('style-src', "'unsafe-inline'");

    return canvasCSP.generateCSP();
  }

  getChatCSP() {
    const chatCSP = new CSPManager();

    // Allow inline styles for chat messages
    chatCSP.addSource('style-src', "'unsafe-inline'");

    return chatCSP.generateCSP();
  }

  getMainCSP() {
    // Stricter CSP for main window
    const mainCSP = new CSPManager();

    // Remove unsafe-inline for styles in main window
    mainCSP.removeSource('style-src', "'unsafe-inline'");

    return mainCSP.generateCSP();
  }
}

module.exports = CSPManager;
```

#### 2. HTML Security Sanitization
```typescript
// src/main/security/HTMLSanitizer.js
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

class HTMLSanitizer {
  constructor() {
    // Create a DOMPurify instance with custom window
    const window = new JSDOM('').window;
    this.DOMPurify = DOMPurify(window);

    // Configure allowed tags and attributes
    this.allowedTags = [
      'html', 'head', 'body', 'title', 'meta', 'link', 'script',
      'style', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'form', 'input', 'button', 'textarea', 'select', 'option'
    ];

    this.allowedAttributes = [
      'id', 'class', 'style', 'href', 'src', 'alt', 'title',
      'type', 'name', 'value', 'placeholder', 'required', 'disabled',
      'colspan', 'rowspan', 'target', 'rel'
    ];
  }

  sanitize(html, options = {}) {
    const config = {
      ALLOWED_TAGS: options.allowedTags || this.allowedTags,
      ALLOWED_ATTR: options.allowedAttributes || this.allowedAttributes,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
      SANITIZE_DOM: true,
      KEEP_CONTENT: true
    };

    return this.DOMPurify.sanitize(html, config);
  }

  sanitizeTemplateOutput(html) {
    // Allow more tags for template output
    const templateConfig = {
      allowedTags: [
        ...this.allowedTags,
        'header', 'footer', 'nav', 'main', 'section', 'article', 'aside'
      ],
      allowedAttributes: [
        ...this.allowedAttributes,
        'data-*' // Allow data attributes
      ]
    };

    return this.sanitize(html, templateConfig);
  }

  sanitizeUserInput(html) {
    // Very restrictive for user-generated content
    const userConfig = {
      allowedTags: ['p', 'br', 'strong', 'em', 'a'],
      allowedAttributes: ['href', 'target', 'rel']
    };

    return this.sanitize(html, userConfig);
  }

  validateCSPCompliant(html, csp) {
    // Check if HTML contains elements that would violate CSP
    const violations = [];

    // Check for inline scripts
    if (html.includes('<script>') && !html.includes('nonce=')) {
      violations.push('Inline scripts without nonce');
    }

    // Check for inline styles if not allowed
    if (html.includes('<style>') && !csp.includes("'unsafe-inline'")) {
      violations.push('Inline styles not allowed by CSP');
    }

    // Check for external resources
    const externalResources = html.match(/src=["']https?:\/\/[^"']+["']/g);
    if (externalResources) {
      violations.push('External resources detected');
    }

    return violations;
  }
}

module.exports = HTMLSanitizer;
```

### Security Monitoring and Auditing

#### 1. Security Event Logger
```typescript
// src/main/security/SecurityLogger.js
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class SecurityLogger {
  constructor() {
    this.logFile = path.join(app.getPath('userData'), 'security.log');
    this.maxLogSize = 10 * 1024 * 1024; // 10MB
    this.maxLogFiles = 5;
  }

  async logSecurityEvent(event) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: event.level || 'info',
      type: event.type,
      message: event.message,
      details: event.details || {},
      process: {
        type: event.processType || 'main',
        pid: process.pid,
        platform: process.platform
      }
    };

    await this.writeLogEntry(logEntry);

    // Handle critical security events
    if (event.level === 'critical') {
      await this.handleCriticalEvent(logEntry);
    }
  }

  async writeLogEntry(entry) {
    const logLine = JSON.stringify(entry) + '\n';

    try {
      // Check log file size
      const stats = await fs.stat(this.logFile).catch(() => null);
      if (stats && stats.size > this.maxLogSize) {
        await this.rotateLogFile();
      }

      await fs.appendFile(this.logFile, logLine);
    } catch (error) {
      console.error('Failed to write security log:', error);
    }
  }

  async rotateLogFile() {
    // Move current log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveName = `security-${timestamp}.log`;

    try {
      await fs.rename(this.logFile, path.join(path.dirname(this.logFile), archiveName));

      // Clean up old log files
      await this.cleanupOldLogs();
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  async cleanupOldLogs() {
    try {
      const logDir = path.dirname(this.logFile);
      const files = await fs.readdir(logDir);

      const logFiles = files
        .filter(file => file.startsWith('security-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(logDir, file),
          stats: fs.stat(path.join(logDir, file))
        }));

      // Sort by modification time, keep newest
      const sortedFiles = await Promise.all(logFiles);
      sortedFiles.sort((a, b) => b.stats.mtime - a.stats.mtime);

      // Remove excess files
      for (let i = this.maxLogFiles; i < sortedFiles.length; i++) {
        await fs.unlink(sortedFiles[i].path);
      }
    } catch (error) {
      console.error('Failed to cleanup old logs:', error);
    }
  }

  async handleCriticalEvent(event) {
    // Send notification to user
    const { dialog } = require('electron');
    const BrowserWindow = require('electron').BrowserWindow;

    const message = `Critical security event detected: ${event.message}`;

    dialog.showErrorBox('Security Alert', message);

    // Log to system console
    console.error('CRITICAL SECURITY EVENT:', event);
  }

  // Predefined security event types
  async logFileAccess(filePath, operation, allowed = true) {
    await this.logSecurityEvent({
      level: allowed ? 'info' : 'warning',
      type: 'file_access',
      message: `File ${operation}: ${filePath}`,
      details: { filePath, operation, allowed }
    });
  }

  async logCommandExecution(command, args, allowed = true) {
    await this.logSecurityEvent({
      level: allowed ? 'info' : 'warning',
      type: 'command_execution',
      message: `Command execution: ${command} ${args.join(' ')}`,
      details: { command, args, allowed }
    });
  }

  async logNetworkRequest(url, allowed = true) {
    await this.logSecurityEvent({
      level: allowed ? 'info' : 'warning',
      type: 'network_request',
      message: `Network request: ${url}`,
      details: { url, allowed }
    });
  }

  async logAuthenticationEvent(user, success = true) {
    await this.logSecurityEvent({
      level: success ? 'info' : 'warning',
      type: 'authentication',
      message: `Authentication ${success ? 'successful' : 'failed'} for user: ${user}`,
      details: { user, success }
    });
  }

  async getSecurityEvents(options = {}) {
    try {
      const logContent = await fs.readFile(this.logFile, 'utf8');
      const events = logContent
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(event => this.matchesFilter(event, options));

      return events;
    } catch (error) {
      console.error('Failed to read security events:', error);
      return [];
    }
  }

  matchesFilter(event, filter) {
    if (filter.level && event.level !== filter.level) return false;
    if (filter.type && event.type !== filter.type) return false;
    if (filter.fromDate && new Date(event.timestamp) < filter.fromDate) return false;
    if (filter.toDate && new Date(event.timestamp) > filter.toDate) return false;

    return true;
  }
}

module.exports = SecurityLogger;
```

### Security Testing Framework

#### 1. Security Test Suite
```typescript
// tests/security/security-tests.js
const { FileSecurityManager } = require('../../src/main/security/FileSecurityManager');
const { CommandSecurityManager } = require('../../src/main/security/CommandSecurityManager');
const { NetworkSecurityManager } = require('../../src/main/security/NetworkSecurityManager');

describe('Security Framework', () => {
  let fileSecurity;
  let commandSecurity;
  let networkSecurity;

  beforeEach(() => {
    // Mock workspace manager
    const mockWorkspace = {
      currentWorkspace: '/tmp/test-workspace'
    };

    fileSecurity = new FileSecurityManager(mockWorkspace);
    commandSecurity = new CommandSecurityManager();
    networkSecurity = new NetworkSecurityManager();
  });

  describe('File Security', () => {
    test('should allow safe file paths', async () => {
      const errors = await fileSecurity.validateFileAccess('templates/index.njk');
      expect(errors).toHaveLength(0);
    });

    test('should block path traversal attacks', async () => {
      const errors = await fileSecurity.validateFileAccess('../../../etc/passwd');
      expect(errors).toContain('Path contains illegal traversal sequences');
    });

    test('should block dangerous file extensions', async () => {
      const errors = await fileSecurity.validateFileAccess('malicious.exe');
      expect(errors).toContain('File extension not allowed');
    });

    test('should block hidden files', async () => {
      const errors = await fileSecurity.validateFileAccess('.hidden.txt');
      expect(errors).toContain('Hidden files are not allowed');
    });
  });

  describe('Command Security', () => {
    test('should allow safe commands', async () => {
      const errors = await commandSecurity.validateCommand('npm', ['install']);
      expect(errors).toHaveLength(0);
    });

    test('should block dangerous commands', async () => {
      const errors = await commandSecurity.validateCommand('rm', ['-rf', '/']);
      expect(errors).toContain('Command contains dangerous patterns');
    });

    test('should block unauthorized commands', async () => {
      const errors = await commandSecurity.validateCommand('curl', ['http://evil.com']);
      expect(errors).toContain('Command not allowed: curl');
    });
  });

  describe('Network Security', () => {
    test('should allow safe URLs', () => {
      const errors = networkSecurity.validateUrl('https://api.openai.com/v1/chat/completions');
      expect(errors).toHaveLength(0);
    });

    test('should block dangerous URLs', () => {
      const errors = networkSecurity.validateUrl('http://evil.com/malware.exe');
      expect(errors).toContain('Host not allowed: evil.com');
    });

    test('should block dangerous protocols', () => {
      const errors = networkSecurity.validateUrl('file:///etc/passwd');
      expect(errors).toContain('Protocol not allowed: file:');
    });
  });

  describe('Integration Tests', () => {
    test('should handle complex security scenarios', async () => {
      // Test file access with command execution
      const filePath = 'templates/safe.njk';
      const fileErrors = await fileSecurity.validateFileAccess(filePath);
      expect(fileErrors).toHaveLength(0);

      // Test command execution with file path
      const commandErrors = await commandSecurity.validateCommand('node', [filePath]);
      expect(commandErrors).toHaveLength(0);
    });

    test('should prevent privilege escalation attempts', async () => {
      // Test various privilege escalation patterns
      const patterns = [
        '../../../etc/passwd',
        '/etc/passwd',
        'C:\\Windows\\System32\\cmd.exe',
        '/bin/sh'
      ];

      for (const pattern of patterns) {
        const errors = await fileSecurity.validateFileAccess(pattern);
        expect(errors.length).toBeGreaterThan(0);
      }
    });
  });
});
```

## Migration Security Checklist

### Pre-Migration Security Assessment
- [ ] Audit current VS Code extension permissions
- [ ] Review webview CSP implementation
- [ ] Document file system access patterns
- [ ] Identify external command usage
- [ ] Assess network communication requirements

### Migration Security Implementation
- [ ] Implement context isolation in Electron
- [ ] Create secure preload scripts
- [ ] Setup file system security manager
- [ ] Implement command execution security
- [ ] Configure network security policies
- [ ] Setup CSP for all windows
- [ ] Implement HTML sanitization
- [ ] Create security event logging
- [ ] Setup security monitoring

### Post-Migration Security Validation
- [ ] Run security test suite
- [ ] Perform penetration testing
- [ ] Validate CSP compliance
- [ ] Test file system boundary enforcement
- [ ] Verify command execution safety
- [ ] Check network request filtering
- [ ] Review security event logs
- [ ] Perform dependency vulnerability scan

## Security Maintenance Plan

### Ongoing Security Practices
1. **Regular Security Audits**: Quarterly security reviews
2. **Dependency Updates**: Monthly dependency vulnerability scans
3. **Security Monitoring**: Continuous security event monitoring
4. **Incident Response**: Documented security incident procedures
5. **User Education**: Security best practices for users

### Security Metrics
- Number of security events logged
- Average response time to security incidents
- Percentage of automated security controls
- Security test coverage
- User-reported security issues

This comprehensive security framework ensures that the Electron version of TAD maintains or exceeds the security posture of the VS Code extension while providing a robust, standalone desktop application experience.