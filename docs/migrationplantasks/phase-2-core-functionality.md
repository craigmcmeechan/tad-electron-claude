# Phase 2: Core Functionality Migration (Weeks 3-5)

## Overview

Phase 2 focuses on migrating the core functionality of TAD from the VS Code extension to the Electron application. This includes workspace management, file system operations, configuration handling, and the build system - the essential components that make TAD functional.

## Objectives

- Implement workspace and file system management
- Migrate configuration system from VS Code settings
- Port the build system to work within Electron
- Establish secure file operations and workspace boundaries

## Timeline
**Duration:** 3 weeks (Weeks 3-5)
**Team:** Backend Developer (lead), Lead Developer, DevOps Engineer
**Dependencies:** Phase 1 completion

## Detailed Task Breakdown

### 2.1 Workspace Management Migration
**Priority:** High
**Effort:** 4-5 days
**Owner:** Backend Developer

#### Tasks:
- [ ] Implement WorkspaceManager class with native file system operations
- [ ] Create workspace selection dialog using Electron dialogs
- [ ] Setup file system watching with chokidar (replacing VS Code watchers)
- [ ] Implement template indexing system for fast file lookups
- [ ] Create workspace configuration management and persistence
- [ ] Setup `.tad/` directory structure initialization and validation
- [ ] Implement workspace boundary validation and security

#### Deliverables:
- [ ] `src/main/WorkspaceManager.js` - Core workspace management
- [ ] `src/main/FileWatcher.js` - File system monitoring
- [ ] `src/main/TemplateIndexer.js` - Fast template file indexing
- [ ] `src/renderer/components/WorkspaceSelector.js` - UI for workspace selection
- [ ] Workspace configuration persistence system
- [ ] `.tad/` directory structure management

#### Success Criteria:
- [ ] Users can select and initialize workspaces through UI
- [ ] Template files are automatically indexed on workspace load
- [ ] File system changes are detected and handled in real-time
- [ ] Workspace configuration persists between application restarts
- [ ] Workspace boundaries are properly enforced for security

#### Technical Implementation:

**WorkspaceManager Class:**
```javascript
// src/main/WorkspaceManager.js
const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const { ipcMain, dialog } = require('electron');
const Logger = require('./Logger');

class WorkspaceManager {
  constructor() {
    this.currentWorkspace = null;
    this.fileWatcher = null;
    this.templateIndex = new Map();
    this.logger = new Logger();
  }

  async selectWorkspace() {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select TAD Workspace'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      await this.setWorkspace(result.filePaths[0]);
      return result.filePaths[0];
    }

    return null;
  }

  async setWorkspace(workspacePath) {
    try {
      this.logger.info(`Setting workspace to: ${workspacePath}`);

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

      this.logger.info('Workspace set successfully');
    } catch (error) {
      this.logger.error('Failed to set workspace:', error);
      throw error;
    }
  }

  async validateWorkspace(workspacePath) {
    const stats = await fs.stat(workspacePath);
    if (!stats.isDirectory()) {
      throw new Error('Selected path is not a directory');
    }

    // Check for existing .tad directory or create it
    const tadDir = path.join(workspacePath, '.tad');
    try {
      await fs.access(tadDir);
    } catch {
      // .tad directory doesn't exist, will be created during initialization
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

    // Create default configuration files
    await this.createDefaultConfig();
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
      ignored: /(^|[\/\\])\../, // Ignore hidden files except .tad
      persistent: true,
      ignoreInitial: true,
      cwd: this.currentWorkspace
    });

    this.fileWatcher.on('add', (filePath) => this.handleFileAdded(filePath));
    this.fileWatcher.on('change', (filePath) => this.handleFileChanged(filePath));
    this.fileWatcher.on('unlink', (filePath) => this.handleFileRemoved(filePath));
  }

  async buildTemplateIndex() {
    const templatesDir = path.join(this.currentWorkspace, '.tad', 'templates');
    this.templateIndex.clear();

    this.logger.info('Building template index...');

    try {
      await this.scanTemplatesDirectory(templatesDir);
      this.logger.info(`Template index built with ${this.templateIndex.size} files`);
    } catch (error) {
      this.logger.error('Failed to build template index:', error);
    }
  }

  async scanTemplatesDirectory(dirPath, relativePath = '') {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        await this.scanTemplatesDirectory(fullPath, relPath);
      } else if (entry.isFile() && this.isTemplateFile(entry.name)) {
        const stats = await fs.stat(fullPath);
        this.templateIndex.set(relPath, {
          path: relPath,
          fullPath,
          type: this.getTemplateType(entry.name),
          lastModified: stats.mtime,
          size: stats.size
        });
      }
    }
  }

  isTemplateFile(filename) {
    const templateExtensions = ['.njk', '.nunjucks', '.html'];
    return templateExtensions.some(ext => filename.endsWith(ext));
  }

  getTemplateType(filename) {
    if (filename.includes('/pages/') || filename.startsWith('pages/')) {
      return 'page';
    } else if (filename.includes('/components/') || filename.startsWith('components/')) {
      return 'component';
    } else if (filename.includes('/elements/') || filename.startsWith('elements/')) {
      return 'element';
    }
    return 'template';
  }

  handleFileAdded(filePath) {
    this.logger.debug(`File added: ${filePath}`);
    // Rebuild index for affected files
    this.buildTemplateIndex();
  }

  handleFileChanged(filePath) {
    this.logger.debug(`File changed: ${filePath}`);
    // Update index for changed file
    this.updateFileInIndex(filePath);
  }

  handleFileRemoved(filePath) {
    this.logger.debug(`File removed: ${filePath}`);
    // Remove from index
    this.templateIndex.delete(filePath);
  }

  notifyWorkspaceChanged() {
    const workspaceInfo = {
      path: this.currentWorkspace,
      templateCount: this.templateIndex.size,
      directories: this.getWorkspaceDirectories(),
      lastScan: Date.now()
    };

    // Send to all renderer processes
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('workspace-changed', workspaceInfo);
    });
  }

  getWorkspaceDirectories() {
    const tadDir = path.join(this.currentWorkspace, '.tad');
    return {
      templates: path.join(tadDir, 'templates'),
      dist: path.join(tadDir, 'dist'),
      builder: path.join(tadDir, 'builder')
    };
  }

  setupIPCHandlers() {
    ipcMain.handle('select-workspace', () => this.selectWorkspace());
    ipcMain.handle('get-workspace-info', () => ({
      path: this.currentWorkspace,
      templateCount: this.templateIndex.size,
      directories: this.getWorkspaceDirectories()
    }));
    ipcMain.handle('list-templates', () => {
      return Array.from(this.templateIndex.values()).map(template => ({
        path: template.path,
        type: template.type,
        lastModified: template.lastModified,
        size: template.size
      }));
    });
  }

  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    this.templateIndex.clear();
  }
}

module.exports = WorkspaceManager;
```

### 2.2 Configuration System Migration
**Priority:** High
**Effort:** 2-3 days
**Owner:** Backend Developer

#### Tasks:
- [ ] Implement ConfigurationManager with electron-store
- [ ] Migrate VS Code settings to Electron format
- [ ] Create settings UI components in renderer
- [ ] Implement configuration validation and type checking
- [ ] Setup configuration change notifications and persistence
- [ ] Create migration utility for existing VS Code users

#### Deliverables:
- [ ] `src/main/ConfigurationManager.js` - Configuration management
- [ ] `src/renderer/components/Settings.js` - Settings UI
- [ ] Configuration migration utility
- [ ] Configuration validation system
- [ ] Settings persistence across restarts

#### Success Criteria:
- [ ] All VS Code settings successfully migrate to Electron format
- [ ] Configuration changes are persisted and restored
- [ ] Settings UI allows modification of all options
- [ ] Configuration validation prevents invalid settings
- [ ] Migration utility works for existing VS Code users

### 2.3 Build System Migration
**Priority:** High
**Effort:** 5-7 days
**Owner:** DevOps Engineer

#### Tasks:
- [ ] Copy build system assets to Electron app resources
- [ ] Implement BuildManager class with progress tracking
- [ ] Create build progress UI with real-time updates
- [ ] Setup build watching and auto-rebuild functionality
- [ ] Implement incremental build system for performance
- [ ] Create build error handling and user-friendly reporting
- [ ] Integrate build system with workspace management

#### Deliverables:
- [ ] `src/main/BuildManager.js` - Build orchestration
- [ ] `src/renderer/components/BuildPanel.js` - Build UI
- [ ] Build progress tracking system
- [ ] Auto-rebuild functionality
- [ ] Build error reporting and handling
- [ ] Incremental build optimization

#### Success Criteria:
- [ ] Build system executes successfully from within Electron
- [ ] Build progress displays clearly in the UI
- [ ] Auto-rebuild works when template files change
- [ ] Build errors are reported clearly with actionable information
- [ ] Incremental builds improve performance for large projects

## Quality Assurance

### Testing Requirements:
- [ ] Unit tests for WorkspaceManager, ConfigurationManager, and BuildManager
- [ ] Integration tests for workspace file operations
- [ ] UI tests for workspace selection and settings
- [ ] Performance tests for template indexing and file watching
- [ ] Security tests for file system boundary validation

### Code Quality:
- [ ] Comprehensive error handling in all classes
- [ ] Input validation for all user-provided paths
- [ ] Memory leak prevention in file watchers
- [ ] Proper cleanup in dispose methods
- [ ] Security validation for file operations

## Risks and Mitigations

### Technical Risks:
- **File System Complexity:** Native file operations vs VS Code APIs
  - *Mitigation:* Comprehensive testing, error handling, security validation
- **Performance Impact:** File watching and indexing on large workspaces
  - *Mitigation:* Incremental updates, background processing, user feedback
- **Configuration Migration:** Complex migration from VS Code settings
  - *Mitigation:* Automated migration utility, fallback defaults, user guidance

### Schedule Risks:
- **Integration Complexity:** Multiple components need to work together
  - *Mitigation:* Start with individual components, integrate incrementally
- **Testing Overhead:** Complex integration testing requirements
  - *Mitigation:* Automated testing, parallel development streams

## Success Criteria

### Functional Requirements:
- [ ] Workspace selection and management fully functional
- [ ] File system operations secure and performant
- [ ] Configuration system migrates and persists correctly
- [ ] Build system executes templates successfully
- [ ] All core TAD functionality available in Electron

### Quality Requirements:
- [ ] No security vulnerabilities in file operations
- [ ] Comprehensive error handling and user feedback
- [ ] Performance meets or exceeds VS Code extension
- [ ] Code follows Electron best practices

### Integration Requirements:
- [ ] IPC communication works between all components
- [ ] UI updates correctly reflect backend state
- [ ] Error states handled gracefully
- [ ] Loading states provide user feedback

## Deliverables Summary

### Core Components:
- [ ] WorkspaceManager with full file system integration
- [ ] ConfigurationManager with VS Code migration
- [ ] BuildManager with progress tracking
- [ ] TemplateIndexer for fast file lookups
- [ ] FileWatcher for real-time updates

### User Interface:
- [ ] Workspace selection dialog
- [ ] Settings panel with all configuration options
- [ ] Build panel with progress and controls
- [ ] Template browser with search and filtering

### Infrastructure:
- [ ] IPC handlers for all new functionality
- [ ] Error handling and logging integration
- [ ] Security validation for file operations
- [ ] Performance monitoring and optimization

## Phase 2 Checklist

### Pre-Phase Preparation:
- [ ] Phase 1 deliverables reviewed and approved
- [ ] Development environment ready for Phase 2 work
- [ ] Team has access to VS Code extension source code
- [ ] Testing infrastructure prepared

### During Phase Execution:
- [ ] Daily progress updates and integration testing
- [ ] Regular security reviews of file operations
- [ ] Performance monitoring during development
- [ ] User experience testing with sample workspaces

### Phase Completion:
- [ ] All success criteria verified
- [ ] Integration testing completed
- [ ] Security audit passed
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Ready for Phase 3 handoff

## Next Phase Dependencies

Phase 2 establishes the core functionality that Phase 3 builds upon:

- **Phase 3** depends on working workspace and file system
- **Phase 4** requires the configuration system
- **Phase 5** needs the build system foundation
- **All subsequent phases** depend on the IPC infrastructure

This phase transforms the Electron application from a basic window into a fully functional TAD environment, ready for UI and advanced feature development.