
# File System and Workspace API Migration

## Overview

This document outlines the migration strategy for replacing VS Code's workspace and file system APIs with native Node.js and Electron equivalents. The migration involves transforming the extension's file system abstractions into a robust, secure, and performant file management system suitable for a standalone desktop application.

## Current VS Code File System Architecture

### VS Code APIs Used

#### 1. Workspace Management
```typescript
// Current VS Code implementation
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
const config = vscode.workspace.getConfiguration('tad.nunjucks');

// File operations
await vscode.workspace.fs.writeFile(uri, content);
const files = await vscode.workspace.findFiles('**/*.njk');

// Configuration
vscode.workspace.onDidChangeConfiguration(event => {
  if (event.affectsConfiguration('tad')) {
    // Handle config change
  }
});
```

#### 2. File System Operations
```typescript
// File watching
const watcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(workspaceRoot, '**/*.njk')
);

// URI handling
const uri = vscode.Uri.file(filePath);
const relativePath = vscode.workspace.asRelativePath(uri);
```

#### 3. Template Index and Scanning
```typescript
// Template discovery and indexing
const index = new TemplateIndex();
await index.initialize(config);

// File system watching for live updates
watcher.onDidCreate(uri => index.addFile(uri));
watcher.onDidDelete(uri => index.removeFile(uri));
```

## Electron File System Architecture

### Core Components

#### 1. Workspace Manager
```typescript
// src/main/WorkspaceManager.js
const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const { ipcMain, dialog, BrowserWindow } = require('electron');

class WorkspaceManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.currentWorkspace = null;
    this.fileWatcher = null;
    this.templateIndex = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    // Load persisted workspace if available
    const persistedWorkspace = this.configManager.get('lastWorkspace');
    if (persistedWorkspace && await this.validateWorkspace(persistedWorkspace)) {
      await this.setWorkspace(persistedWorkspace);
    }
  }

  async selectWorkspace() {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      properties: ['openDirectory'],
      title: 'Select TAD Workspace'
    });

    if (!result.canceled) {
      await this.setWorkspace(result.filePaths[0]);
      return result.filePaths[0];
    }
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

      // Persist workspace choice
      this.configManager.set('lastWorkspace', workspacePath);

      // Notify all windows
      this.notifyWorkspaceChanged();

      this.isInitialized = true;

    } catch (error) {
      throw new Error(`Failed to set workspace: ${error.message}`);
    }
  }

  async validateWorkspace(workspacePath) {
    const stats = await fs.stat(workspacePath);
    if (!stats.isDirectory()) {
      throw new Error('Selected path is not a directory');
    }

    // Check for existing TAD structure or create it
    const tadDir = path.join(workspacePath, '.tad');
    try {
      await fs.access(tadDir);
    } catch {
      // Will create during initialization
    }

    return true;
  }

  async initializeWorkspaceStructure() {
    const tadDir = path.join(this.currentWorkspace, '.tad');
    const requiredDirs = [
      'templates',
      'templates/pages',
      'templates/components',
      'templates/elements',
      'dist',
      'dist/pages',
      'dist/components',
      'builder'
    ];

    // Create directory structure
    for (const dir of requiredDirs) {
      const fullPath = path.join(tadDir, dir);
      await fs.mkdir(fullPath, { recursive: true });
    }

    // Copy builder assets from application
    await this.copyBuilderAssets();

    // Create default configuration files
    await this.createDefaultConfigFiles();
  }

  async copyBuilderAssets() {
    const appPath = require('electron').app.getAppPath();
    const sourceDir = path.join(appPath, 'assets', 'builder');
    const targetDir = path.join(this.currentWorkspace, '.tad', 'builder');

    await this.copyDirectoryRecursive(sourceDir, targetDir);
  }

  async createDefaultConfigFiles() {
    const configFiles = {
      'spaces.json': {
        defaultSpace: 'main',
        spaces: [{
          name: 'main',
          templateRoot: '.tad/templates',
          distDir: '.tad/dist'
        }]
      },
      'templates/README.md': `# TAD Templates

This directory contains your Nunjucks templates.

## Structure
- \`pages/\` - Page templates
- \`components/\` - Reusable components
- \`elements/\` - Basic elements

## Getting Started
1. Create your first page in \`pages/home.njk\`
2. Add components in \`components/\`
3. Run "Build Templates" to compile
`
    };

    for (const [filePath, content] of Object.entries(configFiles)) {
      const fullPath = path.join(this.currentWorkspace, '.tad', filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
    }
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
      ignored: [
        /(^|[\/\\])\../, // Hidden files
        '**/.tad/dist/**', // Build output
        '**/node_modules/**'
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    this.fileWatcher.on('add', (filePath) => this.handleFileAdded(filePath));
    this.fileWatcher.on('change', (filePath) => this.handleFileChanged(filePath));
    this.fileWatcher.on('unlink', (filePath) => this.handleFileRemoved(filePath));
    this.fileWatcher.on('addDir', (dirPath) => this.handleDirectoryAdded(dirPath));
    this.fileWatcher.on('unlinkDir', (dirPath) => this.handleDirectoryRemoved(dirPath));
  }

  async buildTemplateIndex() {
    const templatesDir = path.join(this.currentWorkspace, '.tad', 'templates');
    this.templateIndex.clear();

    console.log('Building template index...');
    await this.scanTemplatesDirectory(templatesDir);
    console.log(`Indexed ${this.templateIndex.size} templates`);
  }

  async scanTemplatesDirectory(dirPath, relativeBase = '') {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(relativeBase, entry.name);

      if (entry.isDirectory()) {
        // Skip certain directories
        if (!this.shouldIndexDirectory(entry.name)) continue;
        await this.scanTemplatesDirectory(fullPath, relativePath);
      } else if (entry.isFile() && this.isTemplateFile(entry.name)) {
        const templateInfo = await this.createTemplateInfo(fullPath, relativePath);
        this.templateIndex.set(relativePath, templateInfo);
      }
    }
  }

  shouldIndexDirectory(dirName) {
    const skipDirs = ['node_modules', '.git', 'dist', 'build'];
    return !skipDirs.includes(dirName) && !dirName.startsWith('.');
  }

  isTemplateFile(fileName) {
    const templateExtensions = ['.njk', '.nunjucks', '.html'];
    const ext = path.extname(fileName).toLowerCase();
    return templateExtensions.includes(ext);
  }

  async createTemplateInfo(fullPath, relativePath) {
    const stats = await fs.stat(fullPath);
    const content = await fs.readFile(fullPath, 'utf8');

    return {
      path: relativePath,
      fullPath,
      type: this.determineTemplateType(relativePath),
      size: stats.size,
      lastModified: stats.mtime,
      dependencies: this.extractDependencies(content),
      tags: this.extractTags(content),
      relationships: this.extractRelationships(content)
    };
  }

  determineTemplateType(relativePath) {
    const parts = relativePath.split(path.sep);
    if (parts.includes('pages')) return 'page';
    if (parts.includes('components')) return 'component';
    if (parts.includes('elements')) return 'element';
    return 'template';
  }

  extractDependencies(content) {
    const dependencies = [];
    const includeRegex = /{%\s*(?:include|import|from)\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = includeRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  extractTags(content) {
    const tags = [];
    const tagRegex = /{#\s*tags?:\s*([^#]+)#}/g;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      const tagList = match[1].split(',').map(tag => tag.trim());
      tags.push(...tagList);
    }

    return [...new Set(tags)];
  }

  extractRelationships(content) {
    const relationships = { next: [], prev: [], parent: [], children: [], related: [] };
    const relRegex = /{#\s*@rel\s+(\w+):\s*([^#]+)#}/g;
    let match;

    while ((match = relRegex.exec(content)) !== null) {
      const type = match[1];
      const targets = match[2].split(',').map(target => target.trim());

      if (relationships[type]) {
        relationships[type].push(...targets);
      }
    }

    return relationships;
  }

  async handleFileAdded(filePath) {
    if (!this.isTemplateFile(filePath)) return;

    const relativePath = path.relative(
      path.join(this.currentWorkspace, '.tad', 'templates'),
      filePath
    );

    const templateInfo = await this.createTemplateInfo(filePath, relativePath);
    this.templateIndex.set(relativePath, templateInfo);

    this.notifyTemplatesChanged('added', relativePath);
  }

  async handleFileChanged(filePath) {
    if (!this.isTemplateFile(filePath)) return;

    const relativePath = path.relative(
      path.join(this.currentWorkspace, '.tad', 'templates'),
      filePath
    );

    if (this.templateIndex.has(relativePath)) {
      const templateInfo = await this.createTemplateInfo(filePath, relativePath);
      this.templateIndex.set(relativePath, templateInfo);

      this.notifyTemplatesChanged('changed', relativePath);
    }
  }

  handleFileRemoved(filePath) {
    if (!this.isTemplateFile(filePath)) return;

    const relativePath = path.relative(
      path.join(this.currentWorkspace, '.tad', 'templates'),
      filePath
    );

    if (this.templateIndex.has(relativePath)) {
      this.templateIndex.delete(relativePath);
      this.notifyTemplatesChanged('removed', relativePath);
    }
  }

  handleDirectoryAdded(dirPath) {
    // Could trigger re-indexing of the directory
    console.log('Directory added:', dirPath);
  }

  handleDirectoryRemoved(dirPath) {
    // Remove all templates in the directory from index
    const dirRelative = path.relative(
      path.join(this.currentWorkspace, '.tad', 'templates'),
      dirPath
    );

    for (const [key, value] of this.templateIndex) {
      if (key.startsWith(dirRelative)) {
        this.templateIndex.delete(key);
      }
    }

    this.notifyTemplatesChanged('directory-removed', dirRelative);
  }

  notifyWorkspaceChanged() {
    const workspaceInfo = {
      path: this.currentWorkspace,
      templateCount: this.templateIndex.size,
      directories: this.getWorkspaceDirectories(),
      lastScan: Date.now()
    };

    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('workspace-changed', workspaceInfo);
    });
  }

  notifyTemplatesChanged(action, path) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('templates-changed', { action, path });
    });
  }

  getWorkspaceDirectories() {
    const templatesDir = path.join(this.currentWorkspace, '.tad', 'templates');
    return {
      templates: templatesDir,
      pages: path.join(templatesDir, 'pages'),
      components: path.join(templatesDir, 'components'),
      elements: path.join(templatesDir, 'elements'),
      dist: path.join(this.currentWorkspace, '.tad', 'dist')
    };
  }

  getWorkspaceInfo() {
    if (!this.currentWorkspace) {
      return { initialized: false };
    }

    return {
      initialized: true,
      path: this.currentWorkspace,
      templateCount: this.templateIndex.size,
      directories: this.getWorkspaceDirectories(),
      lastScan: Date.now()
    };
  }

  async readFile(filePath) {
    const fullPath = this.resolveWorkspacePath(filePath);
    return await fs.readFile(fullPath, 'utf8');
  }

  async writeFile(filePath, content) {
    const fullPath = this.resolveWorkspacePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }

  async listDirectory(dirPath) {
    const fullPath = this.resolveWorkspacePath(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    return entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isFile() ? (fs.statSync(path.join(fullPath, entry.name))).size : 0,
      lastModified: entry.isFile() ? (fs.statSync(path.join(fullPath, entry.name))).mtime : null
    }));
  }

  async findFiles(pattern, options = {}) {
    const glob = require('glob-promise');
    const searchPath = options.cwd || this.currentWorkspace;

    return await glob(pattern, {
      cwd: searchPath,
      absolute: true,
      ...options
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

  async copyDirectoryRecursive(source, target) {
    const stats = await fs.stat(source);

    if (stats.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      const entries = await fs.readdir(source);

      for (const entry of entries) {
        const sourcePath = path.join(source, entry);
        const targetPath = path.join(target, entry);
        await this.copyDirectoryRecursive(sourcePath, targetPath);
      }
    } else {
      await fs.copyFile(source, target);
    }
  }

  setupIPCHandlers() {
    ipcMain.handle('select-workspace', () => this.selectWorkspace());
    ipcMain.handle('get-workspace-info', () => this.getWorkspaceInfo());
    ipcMain.handle('set-workspace', (event, workspacePath) => this.setWorkspace(workspacePath));

    ipcMain.handle('list-templates', () => {
      return Array.from(this.templateIndex.values()).map(template => ({
        path: template.path,
        type: template.type,
        size: template.size,
        lastModified: template.lastModified,
        dependencies: template.dependencies,
        tags: template.tags
      }));
    });

    ipcMain.handle('read-file', async (event, filePath) => {
      return await this.readFile(filePath);
    });

    ipcMain.handle('write-file', async (event, filePath, content) => {
      await this.writeFile(filePath, content);
    });

    ipcMain.handle('list-directory', async (event, dirPath) => {
      return await this.listDirectory(dirPath);
    });

    ipcMain.handle('find-files', async (event, pattern, options) => {
      return await this.findFiles(pattern, options);
    });

    ipcMain.handle('get-template-info', (event, templatePath) => {
      return this.templateIndex.get(templatePath);
    });
  }

  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }
}

module.exports = WorkspaceManager;
```

#### 2. File Operation Manager
```typescript
// src/main/FileOperationManager.js
const fs = require('fs').promises;
const path = require('path');
const { ipcMain } = require('electron');

class FileOperationManager {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
    this.operations = new Map();
    this.setupIPCHandlers();
  }

  async createFile(filePath, content = '') {
    const fullPath = this.workspaceManager.resolveWorkspacePath(filePath);

    // Check if file already exists
    try {
      await fs.access(fullPath);
      throw new Error('File already exists');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file
    await fs.writeFile(fullPath, content, 'utf8');

    return { success: true, path: filePath };
  }

  async readFile(filePath, options = {}) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(filePath);

    const content = await fs.readFile(fullPath, {
      encoding: options.encoding || 'utf8',
      flag: options.flag
    });

    const stats = await fs.stat(fullPath);

    return {
      content,
      size: stats.size,
      lastModified: stats.mtime,
      created: stats.birthtime
    };
  }

  async writeFile(filePath, content, options = {}) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(filePath);

    // Create backup if requested
    if (options.createBackup) {
      const backupPath = `${fullPath}.backup`;
      try {
        await fs.copyFile(fullPath, backupPath);
      } catch {
        // Ignore if original file doesn't exist
      }
    }

    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file
    await fs.writeFile(fullPath, content, {
      encoding: options.encoding || 'utf8',
      flag: options.flag
    });

    return { success: true, path: filePath };
  }

  async deleteFile(filePath, options = {}) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(filePath);

    if (options.createBackup) {
      const backupPath = `${fullPath}.backup`;
      await fs.copyFile(fullPath, backupPath);
    }

    await fs.unlink(fullPath);

    return { success: true, path: filePath };
  }

  async moveFile(sourcePath, targetPath, options = {}) {
    const sourceFullPath = this.workspaceManager.resolveWorkspacePath(sourcePath);
    const targetFullPath = this.workspaceManager.resolveWorkspacePath(targetPath);

    // Create target directory if it doesn't exist
    await fs.mkdir(path.dirname(targetFullPath), { recursive: true });

    if (options.copy) {
      await fs.copyFile(sourceFullPath, targetFullPath);
    } else {
      await fs.rename(sourceFullPath, targetFullPath);
    }

    return { success: true, source: sourcePath, target: targetPath };
  }

  async createDirectory(dirPath) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(dirPath);
    await fs.mkdir(fullPath, { recursive: true });

    return { success: true, path: dirPath };
  }

  async deleteDirectory(dirPath, options = {}) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(dirPath);

    if (options.recursive) {
      await fs.rm(fullPath, { recursive: true, force: options.force });
    } else {
      await fs.rmdir(fullPath);
    }

    return { success: true, path: dirPath };
  }

  async listDirectory(dirPath, options = {}) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(dirPath);

    const entries = await fs.readdir(fullPath, {
      withFileTypes: options.withFileTypes !== false
    });

    const results = [];

    for (const entry of entries) {
      if (options.filter && !options.filter(entry)) continue;

      const entryPath = path.join(fullPath, entry.name);
      let stats = null;

      if (options.includeStats) {
        stats = await fs.stat(entryPath);
      }

      results.push({
        name: entry.name,
        path: path.relative(this.workspaceManager.currentWorkspace, entryPath),
        type: entry.isDirectory() ? 'directory' : 'file',
        stats
      });
    }

    // Sort results
    if (options.sort) {
      results.sort(options.sort);
    } else {
      // Default: directories first, then files, alphabetical
      results.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    }

    return results;
  }

  async findFiles(pattern, options = {}) {
    const glob = require('glob-promise');
    const searchPath = options.cwd || this.workspaceManager.currentWorkspace;

    const files = await glob(pattern, {
      cwd: searchPath,
      absolute: true,
      ...options
    });

    // Convert to relative paths
    return files.map(file =>
      path.relative(this.workspaceManager.currentWorkspace, file)
    );
  }

  async getFileStats(filePath) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(filePath);
    const stats = await fs.stat(fullPath);

    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      permissions: stats.mode
    };
  }

  async watchFile(filePath, callback) {
    const fullPath = this.workspaceManager.resolveWorkspacePath(filePath);
    const watcher = fs.watch(fullPath);

    const operationId = `watch-${Date.now()}-${Math.random()}`;
    this.operations.set(operationId, { watcher, callback });

    watcher.on('change', (eventType, filename) => {
      callback({
        eventType,
        filename,
        path: filePath,
        fullPath
      });
    });

    watcher.on('error', (error) => {
      console.error('File watcher error:', error);
      this.operations.delete(operationId);
    });

    return operationId;
  }

  unwatchFile(operationId) {
    const operation = this.operations.get(operationId);
    if (operation) {
      operation.watcher.close();
      this.operations.delete(operationId);
    }
  }

  setupIPCHandlers() {
    ipcMain.handle('file-create', async (event, filePath, content) => {
      return await this.createFile(filePath, content);
    });

    ipcMain.handle('file-read', async (event, filePath, options) => {
      return await this.readFile(filePath, options);
    });

    ipcMain.handle('file-write', async (event, filePath, content, options) => {
      return await this.writeFile(filePath, content, options);
    });

    ipcMain.handle('file-delete', async (event, filePath, options) => {
      return await this.deleteFile(filePath, options);
    });

    ipcMain.handle('file-move', async (event, sourcePath, targetPath, options) => {
      return await this.moveFile(sourcePath, targetPath, options);
    });

    ipcMain.handle('directory-create', async (event, dirPath) => {
      return await this.createDirectory(dirPath);
    });

    ipcMain.handle('directory-delete', async (event, dirPath, options) => {
      return await this.deleteDirectory(dirPath, options);
    });

    ipcMain.handle('directory-list', async (event, dirPath, options) => {
      return await this.listDirectory(dirPath, options);
    });

    ipcMain.handle('files-find', async (event, pattern, options) => {
      return await this.findFiles(pattern, options);
    });

    ipcMain.handle('file-stats', async (event, filePath) => {
      return await this.getFileStats(filePath);
    });

    ipcMain.handle('file-watch', async (event, filePath) => {
      return new Promise((resolve) => {
        const operationId = this.watchFile(filePath, (change) => {
          event.sender.send('file-change', change);
        });
        resolve(operationId);
      });
    });

    ipcMain.handle('file-unwatch', (event, operationId) => {
      this.unwatchFile(operationId);
    });
  }
}

module.exports = FileOperationManager;
```

#### 3. Configuration Manager
```typescript
// src/main/ConfigurationManager.js
const Store = require('electron-store');
const path = require('path');
const fs = require('fs').promises;
const { ipcMain, BrowserWindow } = require('electron');

class ConfigurationManager {
  constructor(userDataPath) {
    this.store = new Store({
      name: 'tad-config',
      cwd: userDataPath,
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
          framesPerRow: 10,
          zoom: { min: 0.1, max: 3.0, default: 1.0 }
        },
        editor: {
          theme: 'dark',
          fontSize: 14,
          tabSize: 2,
          wordWrap: true
        },
        build: {
          autoBuild: true,
          sourceMap: true,
          minify: false
        }
      }
    });

    this.changeListeners = new Set();
    this.workspaceConfigs = new Map();
  }

  get(key, defaultValue) {
    return this.store.get(key, defaultValue);
  }

  set(key, value) {
    const oldValue = this.get(key);
    this.store.set(key, value);

    // Notify listeners if value changed
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      this.notifyChangeListeners(key, value);
    }
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
    this.workspaceConfigs.clear();
  }

  resetSection(section) {
    const defaults = this.store.defaults;
    if (defaults[section]) {
      this.set(section, defaults[section]);
    }
  }

  // Workspace-specific configuration
  async loadWorkspaceConfig(workspacePath) {
    const configPath = path.join(workspacePath, '.tad', 'config.json');

    try {
      const configData = await fs.readFile(configPath, 'utf8');
      const workspaceConfig = JSON.parse(configData);
      this.workspaceConfigs.set(workspacePath, workspaceConfig);
      return workspaceConfig;
    } catch (error) {
      // Return default workspace config
      const defaultConfig = {
        spaces: [{
          name: 'main',
          templateRoot: '.tad/templates',
          distDir: '.tad/dist'
        }],
        build: {
          outputFormat: 'html',
          includeSourceMaps: true
        }
      };

      this.workspaceConfigs.set(workspacePath, defaultConfig);
      return defaultConfig;
    }
  }

  async saveWorkspaceConfig(workspacePath, config) {
    const configPath = path.join(workspacePath, '.tad', 'config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    this.workspaceConfigs.set(workspacePath, config);
  }

  getWorkspaceConfig(workspacePath, key = null) {
    const workspaceConfig = this.workspaceConfigs.get(workspacePath);
    if (!workspaceConfig) return null;

    return key ? workspaceConfig[key] : workspaceConfig;
  }

  // Migration from VS Code settings
  async migrateFromVSCode(vscodeSettings) {
    const migrated = {};

    // Migrate Nunjucks settings
    if (vscodeSettings['tad.nunjucks']) {
      migrated.nunjucks = {
        templateRoots: vscodeSettings['tad.nunjucks'].templateRoots || this.store.defaults.nunjucks.templateRoots,
        defaultExtensions: vscodeSettings['tad.nunjucks'].defaultExtensions || this.store.defaults.nunjucks.defaultExtensions,
        ignore: vscodeSettings['tad.nunjucks'].ignore || this.store.defaults.nunjucks.ignore
      };
    }

    // Migrate AI settings
    if (vscodeSettings['tad.ai']) {
      migrated.ai = {
        provider: vscodeSettings['tad.ai'].modelProvider || this.store.defaults.ai.provider,
        model: vscodeSettings['tad.ai'].model || this.store.defaults.ai.model,
        apiKey: vscodeSettings['tad.ai'].openaiApiKey || vscodeSettings['tad.ai'].anthropicApiKey || ''
      };
    }

    // Apply migrated settings
    for (const [key, value] of Object.entries(migrated)) {
      this.set(key, value);
    }

    return migrated;
  }

  // Configuration validation
  validateConfig(config) {
    const errors = [];

    // Validate Nunjucks settings
    if (config.nunjucks) {
      if (!Array.isArray(config.nunjucks.templateRoots)) {
        errors.push('nunjucks.templateRoots must be an array');
      }

      if (!Array.isArray(config.nunjucks.defaultExtensions)) {
        errors.push('nunjucks.defaultExtensions must be an array');
      }
    }

    // Validate AI settings
    if (config.ai) {
      const validProviders = ['openai', 'anthropic', 'openrouter'];
      if (!validProviders.includes(config.ai.provider)) {
        errors.push(`ai.provider must be one of: ${validProviders.join(', ')}`);
      }
    }

    // Validate canvas settings
    if (config.canvas) {
      if (config.canvas.framesPerRow < 1 || config.canvas.framesPerRow > 20) {
        errors.push('canvas.framesPerRow must be between 1 and 20');
      }
    }

    return errors;
  }

  // Export/Import configuration
  async exportConfig(filePath) {
    const config = this.getAll();
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
  }

  async importConfig(filePath) {
    const configData = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(configData);

    // Validate imported config
    const errors = this.validateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }

    // Apply imported config
    this.store.store = config;
    this.notifyChangeListeners(null, config);
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

    // Notify renderer processes
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('config-changed', { key, value });
    });
  }

  setupIPCHandlers() {
    ipcMain.handle('config-get', (event, key) => {
      return this.get(key);
    });

    ipcMain.handle('config-set', (event, key, value) => {
      this.set(key, value);
      return true;
    });

    ipcMain.handle('config-get-all', () => {
      return this.getAll();
    });

    ipcMain.handle('config-reset', () => {
      this.reset();
      return this.getAll();
    });

    ipcMain.handle('config-reset-section', (event, section) => {
      this.resetSection(section);
      return this.get(section);
    });

    ipcMain.handle('config-export', async (event, filePath) => {
      await this.exportConfig(filePath);
    });

    ipcMain.handle('config-import', async (event, filePath) => {
      await this.importConfig(filePath);
      return this.getAll();
    });

    ipcMain.handle('workspace-config-load', async (event, workspacePath) => {
      return await this.loadWorkspaceConfig(workspacePath);
    });

    ipcMain.handle('workspace-config-save', async (event, workspacePath, config) => {
      await this.saveWorkspaceConfig(workspacePath, config);
    });

    ipcMain.handle('workspace-config-get', (event, workspacePath, key) => {
      return this.getWorkspaceConfig(workspacePath, key);
    });
  }

  dispose() {
    this.changeListeners.clear();
    this.workspaceConfigs.clear();
  }
}

module.exports = ConfigurationManager;
```

### Security and Path Validation

#### 1. Path Security Manager
```typescript
// src/main/PathSecurityManager.js
const path = require('path');

class PathSecurityManager {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
  }

  validatePath(filePath, operation = 'read') {
    const errors = [];

    // Check for null/undefined
    if (!filePath) {
      errors.push('Path cannot be null or undefined');
      return errors;
    }

    // Check for path traversal attempts
    if (this.containsPathTraversal(filePath)) {
      errors.push('Path contains illegal traversal sequences');
    }

    // Check for absolute paths outside workspace
    if (path.isAbsolute(filePath)) {
      const workspacePath = this.workspaceManager.currentWorkspace;
      if (!filePath.startsWith(workspacePath)) {
        errors.push('Absolute path is outside workspace boundaries');
      }
    }

    // Check for hidden files/directories (optional, based on configuration)
    if (this.isHiddenPath(filePath)) {
      const allowHidden = this.workspaceManager.configManager.get('security.allowHiddenFiles', false);
      if (!allowHidden) {
        errors.push('Hidden files are not allowed');
      }
    }

    // Check for dangerous file extensions
    if (this.isDangerousExtension(filePath)) {
      errors.push('File extension is not allowed');
    }

    // Check path length limits
    if (filePath.length > 4096) {
      errors.push('Path is too long');
    }

    return errors;
  }

  containsPathTraversal(filePath) {
    const normalized = path.normalize(filePath);

    // Check for .. sequences
    if (normalized.includes('..')) {
      // More sophisticated check - ensure .. doesn't escape workspace
      const workspacePath = this.workspaceManager.currentWorkspace;
      const resolved = path.resolve(workspacePath, filePath);

      if (!resolved.startsWith(workspacePath)) {
        return true;
      }
    }

    // Check for other traversal patterns
    const traversalPatterns = [
      /\.\.[\/\\]/,
      /[\/\\]\.\./,
      /^\.\.[\/\\]/,
      /[\/\\]\.\.$/
    ];

    return traversalPatterns.some(pattern => pattern.test(filePath));
  }

  isHiddenPath(filePath) {
    const parts = filePath.split(path.sep);
    return parts.some(part => part.startsWith('.'));
  }

  isDangerousExtension(filePath) {
    const dangerousExtensions = [
      '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs',
      '.jar', '.msi', '.deb', '.rpm', '.dmg', '.pkg'
    ];

    const ext = path.extname(filePath).toLowerCase();
    return dangerousExtensions.includes(ext);
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

  resolveSafePath(filePath) {
    // Sanitize first
    const sanitized = this.sanitizePath(filePath);

    // Resolve relative to workspace
    const workspacePath = this.workspaceManager.currentWorkspace;
    const resolved = path.resolve(workspacePath, sanitized);

    // Final security check
    if (!resolved.startsWith(workspacePath)) {
      throw new Error('Path resolution would escape workspace boundaries');
    }

    return resolved;
  }

  getPathInfo(filePath) {
    const resolved = this.resolveSafePath(filePath);

    return {
      original: filePath,
      resolved: resolved,
      relative: path.relative(this.workspaceManager.currentWorkspace, resolved),
      dirname: path.dirname(resolved),
      basename: path.basename(resolved),
      extname: path.extname(resolved),
      isAbsolute: path.isAbsolute(filePath),
      parts: filePath.split(path.sep).filter(part => part.length > 0)
    };
  }

  isWithinWorkspace(filePath) {
    try {
      const resolved = path.resolve(this.workspaceManager.currentWorkspace, filePath);
      return resolved.startsWith(this.workspaceManager.currentWorkspace);
    } catch {
      return false;
    }
  }

  generateSafePath(prefix = '', extension = '') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeName = `${prefix}${timestamp}-${random}${extension}`;

    return path.join(this.workspaceManager.currentWorkspace, '.tad', 'temp', safeName);
  }
}

module.exports = PathSecurityManager;
```

### Performance Optimizations

#### 1. File Watching Optimization
```typescript
// src/main/FileWatcherManager.js
const chokidar = require('chokidar');
const { EventEmitter } = require('events');

class FileWatcherManager extends EventEmitter {
  constructor(workspaceManager) {
    super();
    this.workspaceManager = workspaceManager;
    this.watchers = new Map();
    this.debounceTimers = new Map();
    this.debounceDelay = 100; // ms
  }

  watchDirectory(dirPath, options = {}) {
    const watcherId = `watcher-${Date.now()}-${Math.random()}`;

    const watcher = chokidar.watch(dirPath, {
      ignored: options.ignored || [
        /(^|[\/\\])\../,
        '**/node_modules/**',
        '**/.git/**'
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      },
      ...options
    });

    // Debounced event handlers
    const debouncedChange = this.debounce((path, stats) => {
      this.emit('file-changed', { path, stats, watcherId });
    }, this.debounceDelay);

    const debouncedAdd = this.debounce((path, stats) => {
      this.emit('file-added', { path, stats, watcherId });
    }, this.debounceDelay);

    const debouncedUnlink = this.debounce((path) => {
      this.emit('file-removed', { path, watcherId });
    }, this.debounceDelay);

    watcher.on('change', debouncedChange);
    watcher.on('add', debouncedAdd);
    watcher.on('unlink', debouncedUnlink);

    watcher.on('error', (error) => {
      this.emit('error', { error, watcherId });
    });

    this.watchers.set(watcherId, {
      watcher,
      path: dirPath,
      handlers: { debouncedChange, debouncedAdd, debouncedUnlink }
    });

    return watcherId;
  }

  unwatchDirectory(watcherId) {
    const watcherInfo = this.watchers.get(watcherId);
    if (watcherInfo) {
      watcherInfo.watcher.close();
      this.watchers.delete(watcherId);

      // Clear any pending debounced calls
      Object.values(watcherInfo.handlers).forEach(handler => {
        if (handler.cancel) handler.cancel();
      });
    }
  }

  debounce(func, delay) {
    let timeoutId;
    let lastArgs;
    let lastThis;

    const debounced = function(...args) {
      lastArgs = args;
      lastThis = this;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        func.apply(lastThis, lastArgs);
        timeoutId = null;
      }, delay);
    };

    debounced.cancel = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    return debounced;
  }

  watchTemplateFiles() {
    const templatesDir = path.join(this.workspaceManager.currentWorkspace, '.tad', 'templates');

    return this.watchDirectory(templatesDir, {
      ignored: [
        /(^|[\/\\])\../,
        '**/node_modules/**',
        '**/.tad/dist/**'
      ]
    });
  }

  watchConfigFiles() {
    const configFiles = [
      path.join(this.workspaceManager.currentWorkspace, '.tad', 'spaces.json'),
      path.join(this.workspaceManager.currentWorkspace, '.tad', 'config.json')
    ];

    const watcherIds = [];
    for (const configFile of configFiles) {
      watcherIds.push(this.watchDirectory(configFile, {
        depth: 0 // Only watch the specific file
      }));
    }

    return watcherIds;
  }

  getActiveWatchers() {
    return Array.from(this.watchers.keys());
  }

  dispose() {
    for (const [watcherId, watcherInfo] of this.watchers) {
      watcherInfo.watcher.close();
    }
    this.watchers.clear();
    this.debounceTimers.clear();
  }
}

module.exports = FileWatcherManager;
```

### Migration Benefits and Testing

#### Benefits of the New Architecture

1. **Enhanced Security**: Path validation and workspace boundary enforcement
2. **Better Performance**: Optimized file watching and debounced events
3. **Improved Reliability**: Comprehensive error handling and recovery
4. **Greater Flexibility**: Support for multiple workspaces and configurations
5. **Cross-Platform Compatibility**: Native Node.js file operations
6. **Advanced Features**: File metadata, dependency tracking, and change notifications

#### Testing Strategy

```typescript
// tests/file-system-migration.test.js
const { WorkspaceManager } = require('../src/main/WorkspaceManager');
const { FileOperationManager } = require('../src/main/FileOperationManager');
const { ConfigurationManager } = require('../src/main/ConfigurationManager');

describe('File System Migration', () => {
  let workspaceManager;
  let fileManager;
  let configManager;

  beforeEach(async () => {
    // Setup test environment
    configManager = new ConfigurationManager(tempDir);
    workspaceManager = new WorkspaceManager(configManager);
    fileManager = new FileOperationManager(workspaceManager);

    await workspaceManager.setWorkspace(testWorkspacePath);
  });

  describe('Workspace Management', () => {
    test('should initialize workspace structure', async () => {
      const workspaceInfo = workspaceManager.getWorkspaceInfo();
      expect(workspaceInfo.initialized).toBe(true);
      expect(workspaceInfo.templateCount).toBeGreaterThan(0);
    });

    test('should validate workspace paths', async () => {
      const invalidPath = '../outside-workspace';
      await expect(workspaceManager.validateWorkspace(invalidPath))
        .rejects.toThrow('outside workspace');
    });
  });

  describe('File Operations', () => {
    test('should read and write files securely', async () => {
      const testContent = 'Hello, TAD!';
      const testPath = '.tad/templates/test.njk';

      await fileManager.writeFile(testPath, testContent);
      const result = await fileManager.readFile(testPath);

      expect(result.content).toBe(testContent);
    });

    test('should prevent path traversal attacks', async () => {
      const maliciousPath = '../../../etc/passwd';

      await expect(fileManager.readFile(maliciousPath))
        .rejects.toThrow('outside workspace');
    });
  });

  describe('Configuration Management', () => {
    test('should migrate VS Code settings', async () => {
      const vscodeSettings = {
        'tad.nunjucks': {
          templateRoots: ['src/templates'],
          defaultExtensions: ['.njk', '.html']
        },
        'tad.ai': {
          modelProvider: 'anthropic',
          model: 'claude-3'
        }
      };

      await configManager.migrateFromVSCode(vscodeSettings);
      const migrated = configManager.getAll();

      expect(migrated.nunjucks.templateRoots).toEqual(['src/templates']);
      expect(migrated.ai.provider).toBe('anthropic');
    });
  });
});
```

## Conclusion

The migration from VS Code's file system APIs to native Node.js operations provides a robust, secure, and performant foundation for the standalone TAD application. The new architecture offers:

- **Comprehensive Security**: Path validation, workspace boundary enforcement, and safe file operations
- **Enhanced Performance**: Optimized file watching, debounced events, and efficient caching
-