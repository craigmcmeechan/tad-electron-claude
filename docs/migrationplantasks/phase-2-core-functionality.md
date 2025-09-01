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
- [ ] Integrate comprehensive logging throughout workspace operations
- [ ] Add performance monitoring for file system operations
- [ ] Implement security logging for file access attempts
- [ ] Setup workspace-specific logging configuration
- [ ] Integrate persistent store for workspace configuration persistence
- [ ] Implement store-based workspace settings management
- [ ] Setup store synchronization for workspace metadata
- [ ] Configure store backup for critical workspace operations
- [ ] Implement store-based template index caching
- [ ] Setup store error correction for workspace data integrity

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
- [ ] Comprehensive logging captures all workspace operations
- [ ] Security events are logged for file access attempts
- [ ] Performance metrics are tracked for file operations
- [ ] Error conditions are logged with full context
- [ ] Workspace configurations persist across application restarts
- [ ] Template index is cached in persistent store for performance
- [ ] Workspace settings are synchronized between processes
- [ ] Store backups are created for critical workspace operations
- [ ] Store error correction maintains workspace data integrity

#### Technical Implementation:

**WorkspaceManager Class:**
```javascript
// src/main/WorkspaceManager.js
const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const { ipcMain, dialog } = require('electron');
const { MainLogger } = require('./logger/MainLogger');
const { SecurityFilter } = require('./logger/SecurityFilter');

class WorkspaceManager {
  constructor(logger, storeManager) {
    this.currentWorkspace = null;
    this.fileWatcher = null;
    this.templateIndex = new Map();
    this.storeManager = storeManager;
    this.logger = logger.child({
      component: 'WorkspaceManager',
      workspaceId: null
    });
    this.securityFilter = new SecurityFilter();
    this.performanceMonitor = {
      startOperation: (name) => this.logger.time(`workspace-${name}`),
      endOperation: (name) => this.logger.timeEnd(`workspace-${name}`)
    };
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
    const operationId = `set-workspace-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    try {
      // Sanitize and validate workspace path
      const sanitizedPath = this.securityFilter.sanitizePath(workspacePath);
      this.logger.info('Setting workspace', {
        requestedPath: workspacePath,
        sanitizedPath,
        operationId,
        userId: process.env.USER || 'unknown',
        platform: process.platform
      });

      // Security validation
      if (sanitizedPath !== workspacePath) {
        this.logger.warn('Workspace path sanitized for security', {
          originalPath: workspacePath,
          sanitizedPath,
          operationId
        });
      }

      // Validate workspace
      await this.validateWorkspace(sanitizedPath);

      // Set current workspace
      this.currentWorkspace = sanitizedPath;

      // Update logger context
      this.logger = this.logger.child({
        component: 'WorkspaceManager',
        workspaceId: path.basename(sanitizedPath),
        workspacePath: sanitizedPath
      });

      // Load workspace configuration from persistent store
      await this.loadWorkspaceConfiguration();

      // Initialize workspace structure
      await this.initializeWorkspaceStructure();

      // Setup file watching
      this.setupFileWatching();

      // Build template index
      await this.buildTemplateIndex();

      // Save workspace state to persistent store
      await this.saveWorkspaceState();

      // Notify renderer
      this.notifyWorkspaceChanged();

      this.performanceMonitor.endOperation(operationId);
      this.logger.info('Workspace set successfully', {
        templateCount: this.templateIndex.size,
        operationId,
        duration: this.getLastOperationDuration(operationId)
      });

    } catch (error) {
      this.performanceMonitor.endOperation(operationId);
      this.logger.error('Failed to set workspace', {
        error: error.message,
        stack: error.stack,
        workspacePath,
        operationId,
        duration: this.getLastOperationDuration(operationId)
      });
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
    const operationId = `file-add-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    this.logger.info('File added to workspace', {
      filePath: this.securityFilter.sanitizePath(filePath),
      relativePath: path.relative(this.currentWorkspace, filePath),
      operationId,
      fileType: this.getFileType(filePath),
      fileSize: this.getFileSize(filePath)
    });

    try {
      // Security validation
      if (!this.securityFilter.validateFileAccess(filePath, 'read')) {
        this.logger.warn('File access denied', {
          filePath: this.securityFilter.sanitizePath(filePath),
          operationId,
          reason: 'security policy violation'
        });
        return;
      }

      // Rebuild index for affected files
      await this.buildTemplateIndex();

      this.performanceMonitor.endOperation(operationId);
      this.logger.debug('File addition processed successfully', {
        operationId,
        duration: this.getLastOperationDuration(operationId)
      });

    } catch (error) {
      this.performanceMonitor.endOperation(operationId);
      this.logger.error('Failed to process file addition', {
        filePath: this.securityFilter.sanitizePath(filePath),
        operationId,
        error: error.message,
        duration: this.getLastOperationDuration(operationId)
      });
    }
  }

  handleFileChanged(filePath) {
    const operationId = `file-change-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    this.logger.debug('File changed in workspace', {
      filePath: this.securityFilter.sanitizePath(filePath),
      relativePath: path.relative(this.currentWorkspace, filePath),
      operationId,
      fileType: this.getFileType(filePath),
      isTemplate: this.isTemplateFile(filePath)
    });

    try {
      // Update index for changed file
      await this.updateFileInIndex(filePath);

      this.performanceMonitor.endOperation(operationId);
      this.logger.trace('File change processed', {
        operationId,
        duration: this.getLastOperationDuration(operationId)
      });

    } catch (error) {
      this.performanceMonitor.endOperation(operationId);
      this.logger.error('Failed to process file change', {
        filePath: this.securityFilter.sanitizePath(filePath),
        operationId,
        error: error.message,
        duration: this.getLastOperationDuration(operationId)
      });
    }
  }

  handleFileRemoved(filePath) {
    const operationId = `file-remove-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    this.logger.info('File removed from workspace', {
      filePath: this.securityFilter.sanitizePath(filePath),
      relativePath: path.relative(this.currentWorkspace, filePath),
      operationId,
      wasTemplate: this.templateIndex.has(filePath)
    });

    try {
      // Remove from index
      const wasRemoved = this.templateIndex.delete(filePath);

      this.performanceMonitor.endOperation(operationId);
      this.logger.debug('File removal processed', {
        operationId,
        wasRemoved,
        duration: this.getLastOperationDuration(operationId)
      });

    } catch (error) {
      this.performanceMonitor.endOperation(operationId);
      this.logger.error('Failed to process file removal', {
        filePath: this.securityFilter.sanitizePath(filePath),
        operationId,
        error: error.message,
        duration: this.getLastOperationDuration(operationId)
      });
    }
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

  async loadWorkspaceConfiguration() {
    try {
      const workspaceId = path.basename(this.currentWorkspace);
      const storedConfig = await this.storeManager.get(`workspaces.${workspaceId}`, {});

      // Apply stored configuration
      if (storedConfig.settings) {
        // Apply workspace-specific settings
        this.logger.info('Loaded workspace configuration from store', {
          workspaceId,
          hasSettings: !!storedConfig.settings,
          lastOpened: storedConfig.lastOpened
        });
      }

      // Update last opened timestamp
      await this.storeManager.set(`workspaces.${workspaceId}.lastOpened`, new Date().toISOString());

    } catch (error) {
      this.logger.warn('Failed to load workspace configuration from store:', error);
    }
  }

  async saveWorkspaceState() {
    try {
      const workspaceId = path.basename(this.currentWorkspace);
      const workspaceState = {
        path: this.currentWorkspace,
        name: workspaceId,
        settings: {
          templateCount: this.templateIndex.size,
          lastScan: Date.now(),
          watcherActive: !!this.fileWatcher
        },
        lastOpened: new Date().toISOString()
      };

      await this.storeManager.set(`workspaces.${workspaceId}`, workspaceState);

      this.logger.debug('Workspace state saved to persistent store', {
        workspaceId,
        templateCount: this.templateIndex.size
      });

    } catch (error) {
      this.logger.error('Failed to save workspace state to store:', error);
    }
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
- [ ] Add comprehensive logging to build operations
- [ ] Implement build performance monitoring and metrics
- [ ] Setup build security logging and validation
- [ ] Create build audit trail and error tracking
- [ ] Integrate persistent store for build configuration persistence
- [ ] Implement store-based build history and caching
- [ ] Setup store synchronization for build state management
- [ ] Configure store backup for critical build operations
- [ ] Implement store-based build metrics collection
- [ ] Setup store error correction for build data integrity

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
- [ ] Build operations are comprehensively logged
- [ ] Build performance metrics are tracked and logged
- [ ] Build security events are monitored and logged
- [ ] Build errors include full context and debugging information
- [ ] Build configurations persist across application restarts
- [ ] Build history and metrics are stored in persistent store
- [ ] Build state is synchronized between processes
- [ ] Store backups are created for critical build operations
- [ ] Store error correction maintains build data integrity

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
- [ ] Comprehensive logging system integrated throughout
- [ ] Security monitoring and logging operational
- [ ] Performance metrics collection working
- [ ] Error tracking and reporting functional
- [ ] Persistent store system fully integrated with workspace management
- [ ] Workspace configurations persist across application restarts
- [ ] Template index caching improves performance
- [ ] Store synchronization works between main and renderer processes
- [ ] Store backups protect critical workspace data
- [ ] Store error correction maintains data integrity

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
- [ ] WorkspaceManager with full file system integration and logging
- [ ] ConfigurationManager with VS Code migration
- [ ] BuildManager with progress tracking and logging
- [ ] TemplateIndexer for fast file lookups
- [ ] FileWatcher for real-time updates with security logging
- [ ] SecurityFilter for file access validation
- [ ] PerformanceMonitor for operation timing
- [ ] AuditLogger for security and compliance events
- [ ] StoreWorkspaceManager for persistent workspace configuration
- [ ] StoreTemplateIndexer for cached template indexing
- [ ] StoreWorkspaceSettings for workspace-specific settings persistence
- [ ] StoreWorkspaceBackup for critical workspace operation backups

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