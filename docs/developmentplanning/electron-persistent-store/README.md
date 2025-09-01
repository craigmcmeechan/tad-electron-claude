# Electron Persistent Store Implementation Plan

## Overview

This document outlines the implementation of persistent data storage for the TAD Electron application using the `electron-store` package. The implementation will provide cross-process synchronization of application settings and user preferences, ensuring that runtime changes persist across application restarts and are synchronized between the main Electron process and renderer processes.

## Architecture Overview

### Core Components

1. **Store Manager** - Main process singleton managing the electron-store instance
2. **Error Correction System** - Validates changes and creates rollback diffs
3. **IPC Bridge** - Secure communication layer between processes
4. **Renderer API** - Context-isolated API for renderer processes
5. **Migration System** - Handles schema updates and data migration
6. **Backup System** - Automatic backup and recovery mechanisms

### Data Flow Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Renderer      │    │   Main Process  │    │ Error Correction│    │   File System   │
│   Process       │◄──►│   Store Manager │◄──►│     System      │◄──►│   JSON File     │
│                 │    │                 │    │                 │    │                 │
│ • Settings UI   │    │ • IPC Handlers  │    │ • Validation    │    │ • app.getPath   │
│ • Live Updates  │    │ • Data Sync     │    │ • Diff Creation │    │ • userData dir  │
│ • Validation    │    │ • Schema Mgmt   │    │ • Rollback      │    │ • Atomic writes │
│                 │    │                 │    │ • Migration     │    │ • storeHistory/ │
│                 │    │                 │    │   Backups       │    │   folder        │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Implementation Strategy

### Phase 1: Core Store Infrastructure

#### 1. Store Manager Implementation

```typescript
// src/main/store/StoreManager.js
const Store = require('electron-store');
const path = require('path');
const fs = require('fs').promises;
const { app, BrowserWindow } = require('electron');

class StoreManager {
  constructor() {
    this.store = null;
    this.isInitialized = false;
    this.changeListeners = new Map();
    this.backupManager = new BackupManager();
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Configure electron-store
      const storeOptions = {
        name: 'tad-config',
        cwd: app.getPath('userData'),
        fileExtension: 'json',
        clearInvalidConfig: false,
        serialize: JSON.stringify,
        deserialize: JSON.parse,
        watch: true
      };

      this.store = new Store(storeOptions);

      // Setup file watching for external changes
      await this.setupFileWatching();

      // Initialize backup system
      await this.backupManager.initialize(this.store.path);

      // Load and validate existing data
      await this.validateAndMigrateData();

      this.isInitialized = true;

      console.log('Store Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Store Manager:', error);
      throw error;
    }
  }

  async setupFileWatching() {
    const storePath = this.store.path;

    // Watch for external file changes
    const chokidar = require('chokidar');
    this.fileWatcher = chokidar.watch(storePath, {
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    this.fileWatcher.on('change', async () => {
      console.log('Store file changed externally, reloading...');
      await this.reloadStore();
    });
  }

  async validateAndMigrateData() {
    const currentVersion = this.store.get('version', '1.0.0');
    const targetVersion = require('../../../package.json').version;

    if (currentVersion !== targetVersion) {
      console.log(`Migrating store from ${currentVersion} to ${targetVersion}`);
      await this.migrateData(currentVersion, targetVersion);
      this.store.set('version', targetVersion);
    }
  }

  async migrateData(fromVersion, toVersion) {
    const migrations = this.getMigrations(fromVersion, toVersion);

    for (const migration of migrations) {
      try {
        await migration();
        console.log(`Applied migration: ${migration.name}`);
      } catch (error) {
        console.error(`Migration failed: ${migration.name}`, error);
        // Attempt rollback if critical
        await this.rollbackMigration(migration);
      }
    }
  }

  getMigrations(fromVersion, toVersion) {
    // Define migration functions based on version changes
    const migrations = [];

    // Example migration: Add new setting with default value
    if (this.compareVersions(fromVersion, '1.1.0') < 0) {
      migrations.push(async () => {
        const currentSettings = this.store.get('settings', {});
        currentSettings.newFeature = {
          enabled: true,
          value: 'default'
        };
        this.store.set('settings', currentSettings);
      });
    }

    return migrations;
  }

  compareVersions(version1, version2) {
    const v1 = version1.split('.').map(Number);
    const v2 = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const part1 = v1[i] || 0;
      const part2 = v2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

  // Core store operations
  get(key, defaultValue) {
    this.ensureInitialized();
    return this.store.get(key, defaultValue);
  }

  set(key, value) {
    this.ensureInitialized();

    const oldValue = this.get(key);
    this.store.set(key, value);

    // Notify listeners
    this.notifyChangeListeners(key, value, oldValue);

    // Trigger backup if critical data changed
    if (this.isCriticalKey(key)) {
      this.backupManager.createBackup();
    }
  }

  delete(key) {
    this.ensureInitialized();

    const oldValue = this.get(key);
    this.store.delete(key);

    this.notifyChangeListeners(key, undefined, oldValue);
  }

  has(key) {
    this.ensureInitialized();
    return this.store.has(key);
  }

  clear() {
    this.ensureInitialized();

    // Create backup before clearing
    this.backupManager.createBackup();

    this.store.clear();
    this.notifyChangeListeners(null, null, null);
  }

  // Bulk operations
  getAll() {
    this.ensureInitialized();
    return this.store.store;
  }

  setMultiple(data) {
    this.ensureInitialized();

    const oldData = this.getAll();
    this.store.set(data);

    // Notify for each changed key
    for (const [key, value] of Object.entries(data)) {
      const oldValue = oldData[key];
      if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
        this.notifyChangeListeners(key, value, oldValue);
      }
    }
  }

  // Change listeners
  onChange(key, callback) {
    if (!this.changeListeners.has(key)) {
      this.changeListeners.set(key, new Set());
    }

    this.changeListeners.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.changeListeners.get(key);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.changeListeners.delete(key);
        }
      }
    };
  }

  notifyChangeListeners(key, newValue, oldValue) {
    // Notify specific key listeners
    if (this.changeListeners.has(key)) {
      this.changeListeners.get(key).forEach(callback => {
        try {
          callback(newValue, oldValue, key);
        } catch (error) {
          console.error('Store change listener error:', error);
        }
      });
    }

    // Notify global listeners
    if (this.changeListeners.has('*')) {
      this.changeListeners.get('*').forEach(callback => {
        try {
          callback(newValue, oldValue, key);
        } catch (error) {
          console.error('Global store change listener error:', error);
        }
      });
    }

    // Send to renderer processes
    this.broadcastToRenderers(key, newValue, oldValue);
  }

  broadcastToRenderers(key, newValue, oldValue) {
    const changeData = {
      key,
      newValue,
      oldValue,
      timestamp: Date.now()
    };

    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('store-changed', changeData);
      }
    });
  }

  isCriticalKey(key) {
    const criticalKeys = [
      'settings',
      'workspaces',
      'user',
      'ai.apiKey'
    ];

    return criticalKeys.some(criticalKey =>
      key === criticalKey || key.startsWith(criticalKey + '.')
    );
  }

  async reloadStore() {
    try {
      // Force reload from disk
      this.store = new Store({
        name: 'tad-config',
        cwd: app.getPath('userData'),
        fileExtension: 'json'
      });

      // Notify all listeners
      this.notifyChangeListeners('*', this.getAll(), null);
    } catch (error) {
      console.error('Failed to reload store:', error);
    }
  }

  ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error('Store Manager not initialized. Call initialize() first.');
    }
  }

  getStoreInfo() {
    return {
      path: this.store.path,
      size: this.store.size,
      keys: Object.keys(this.store.store),
      version: this.store.get('version', '1.0.0')
    };
  }

  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }

    this.changeListeners.clear();
    this.backupManager.dispose();
  }
}

module.exports = StoreManager;
```

#### 2. Backup Manager Implementation

```typescript
// src/main/store/BackupManager.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class BackupManager {
  constructor() {
    this.backupDir = null;
    this.maxBackups = 10;
    this.backupInterval = 24 * 60 * 60 * 1000; // 24 hours
  }

  async initialize(storePath) {
    this.storePath = storePath;
    this.backupDir = path.join(path.dirname(storePath), 'backups');

    // Create backup directory
    await fs.mkdir(this.backupDir, { recursive: true });

    // Setup automatic backup schedule
    this.scheduleBackups();

    // Cleanup old backups
    await this.cleanupOldBackups();
  }

  async createBackup(reason = 'manual') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const hash = await this.getFileHash(this.storePath);
      const backupName = `backup-${timestamp}-${hash.substring(0, 8)}.json`;
      const backupPath = path.join(this.backupDir, backupName);

      // Copy current store file
      await fs.copyFile(this.storePath, backupPath);

      // Create metadata
      const metadata = {
        originalFile: path.basename(this.storePath),
        backupTime: new Date().toISOString(),
        reason: reason,
        hash: hash,
        size: (await fs.stat(this.storePath)).size
      };

      await fs.writeFile(
        backupPath + '.meta.json',
        JSON.stringify(metadata, null, 2)
      );

      console.log(`Backup created: ${backupName}`);

      // Cleanup old backups
      await this.cleanupOldBackups();

      return backupPath;
    } catch (error) {
      console.error('Failed to create backup:', error);
      throw error;
    }
  }

  async getFileHash(filePath) {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async scheduleBackups() {
    // Create backup on application start
    await this.createBackup('application-start');

    // Schedule periodic backups
    this.backupTimer = setInterval(async () => {
      await this.createBackup('scheduled');
    }, this.backupInterval);
  }

  async cleanupOldBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('backup-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          stat: fs.stat(path.join(this.backupDir, file))
        }));

      // Wait for all stat operations
      const backups = await Promise.all(
        backupFiles.map(async item => ({
          ...item,
          stat: await item.stat
        }))
      );

      // Sort by modification time (newest first)
      backups.sort((a, b) => b.stat.mtime - a.stat.mtime);

      // Remove excess backups
      for (let i = this.maxBackups; i < backups.length; i++) {
        await fs.unlink(backups[i].path);
        // Also remove metadata file
        const metaPath = backups[i].path + '.meta.json';
        try {
          await fs.unlink(metaPath);
        } catch {
          // Ignore if metadata file doesn't exist
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old backups:', error);
    }
  }

  async listBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];

      for (const file of files) {
        if (file.startsWith('backup-') && file.endsWith('.json')) {
          const metaFile = file + '.meta.json';
          const metaPath = path.join(this.backupDir, metaFile);

          try {
            const metaContent = await fs.readFile(metaPath, 'utf8');
            const metadata = JSON.parse(metaContent);
            backups.push({
              file: file,
              path: path.join(this.backupDir, file),
              metadata: metadata
            });
          } catch {
            // Metadata missing or corrupted
            backups.push({
              file: file,
              path: path.join(this.backupDir, file),
              metadata: null
            });
          }
        }
      }

      // Sort by backup time (newest first)
      backups.sort((a, b) => {
        const timeA = a.metadata?.backupTime || '1970-01-01T00:00:00.000Z';
        const timeB = b.metadata?.backupTime || '1970-01-01T00:00:00.000Z';
        return new Date(timeB) - new Date(timeA);
      });

      return backups;
    } catch (error) {
      console.error('Failed to list backups:', error);
      return [];
    }
  }

  async restoreBackup(backupPath) {
    try {
      // Create backup of current state before restore
      await this.createBackup('before-restore');

      // Copy backup to current store location
      await fs.copyFile(backupPath, this.storePath);

      console.log(`Restored backup: ${path.basename(backupPath)}`);

      return true;
    } catch (error) {
      console.error('Failed to restore backup:', error);
      throw error;
    }
  }

  dispose() {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }
  }
}

module.exports = BackupManager;
```

### Phase 2: IPC Communication Layer

#### 1. Main Process IPC Handlers

```typescript
// src/main/ipc/store-handlers.js
const { ipcMain } = require('electron');

class StoreIPCHandlers {
  constructor(storeManager) {
    this.storeManager = storeManager;
    this.setupHandlers();
  }

  setupHandlers() {
    // Basic CRUD operations
    ipcMain.handle('store-get', async (event, key, defaultValue) => {
      try {
        return this.storeManager.get(key, defaultValue);
      } catch (error) {
        console.error('Store get error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-set', async (event, key, value) => {
      try {
        this.storeManager.set(key, value);
        return true;
      } catch (error) {
        console.error('Store set error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-delete', async (event, key) => {
      try {
        this.storeManager.delete(key);
        return true;
      } catch (error) {
        console.error('Store delete error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-has', async (event, key) => {
      try {
        return this.storeManager.has(key);
      } catch (error) {
        console.error('Store has error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-clear', async (event) => {
      try {
        this.storeManager.clear();
        return true;
      } catch (error) {
        console.error('Store clear error:', error);
        throw error;
      }
    });

    // Bulk operations
    ipcMain.handle('store-get-all', async (event) => {
      try {
        return this.storeManager.getAll();
      } catch (error) {
        console.error('Store get-all error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-set-multiple', async (event, data) => {
      try {
        this.storeManager.setMultiple(data);
        return true;
      } catch (error) {
        console.error('Store set-multiple error:', error);
        throw error;
      }
    });

    // Advanced operations
    ipcMain.handle('store-info', async (event) => {
      try {
        return this.storeManager.getStoreInfo();
      } catch (error) {
        console.error('Store info error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-reload', async (event) => {
      try {
        await this.storeManager.reloadStore();
        return true;
      } catch (error) {
        console.error('Store reload error:', error);
        throw error;
      }
    });

    // Backup operations
    ipcMain.handle('store-create-backup', async (event, reason) => {
      try {
        return await this.storeManager.backupManager.createBackup(reason);
      } catch (error) {
        console.error('Store backup error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-list-backups', async (event) => {
      try {
        return await this.storeManager.backupManager.listBackups();
      } catch (error) {
        console.error('Store list backups error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-restore-backup', async (event, backupPath) => {
      try {
        return await this.storeManager.backupManager.restoreBackup(backupPath);
      } catch (error) {
        console.error('Store restore backup error:', error);
        throw error;
      }
    });

    // Change listeners (for renderer processes)
    ipcMain.handle('store-on-change', (event, key) => {
      const unsubscribe = this.storeManager.onChange(key, (newValue, oldValue, changedKey) => {
        // Send change notification to the requesting renderer
        event.sender.send('store-changed', {
          key: changedKey,
          newValue,
          oldValue,
          timestamp: Date.now()
        });
      });

      // Store unsubscribe function for cleanup
      if (!event.sender.storeUnsubscribers) {
        event.sender.storeUnsubscribers = new Set();
      }
      event.sender.storeUnsubscribers.add(unsubscribe);

      // Return a handle for cleanup
      return 'listener-registered';
    });

    ipcMain.handle('store-off-change', (event, key) => {
      // Cleanup listeners when renderer disconnects
      if (event.sender.storeUnsubscribers) {
        event.sender.storeUnsubscribers.forEach(unsubscribe => {
          try {
            unsubscribe();
          } catch (error) {
            console.error('Error unsubscribing store listener:', error);
          }
        });
        event.sender.storeUnsubscribers.clear();
      }

      return 'listeners-cleaned';
    });
  }
}

module.exports = StoreIPCHandlers;
```

#### 2. Preload Script for Secure API Exposure

```typescript
// src/main/preload/store-preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Secure store API for renderer processes
contextBridge.exposeInMainWorld('storeAPI', {
  // Basic operations
  get: (key, defaultValue) => ipcRenderer.invoke('store-get', key, defaultValue),
  set: (key, value) => ipcRenderer.invoke('store-set', key, value),
  delete: (key) => ipcRenderer.invoke('store-delete', key),
  has: (key) => ipcRenderer.invoke('store-has', key),
  clear: () => ipcRenderer.invoke('store-clear'),

  // Bulk operations
  getAll: () => ipcRenderer.invoke('store-get-all'),
  setMultiple: (data) => ipcRenderer.invoke('store-set-multiple', data),

  // Advanced operations
  getInfo: () => ipcRenderer.invoke('store-info'),
  reload: () => ipcRenderer.invoke('store-reload'),

  // Backup operations
  createBackup: (reason) => ipcRenderer.invoke('store-create-backup', reason),
  listBackups: () => ipcRenderer.invoke('store-list-backups'),
  restoreBackup: (backupPath) => ipcRenderer.invoke('store-restore-backup', backupPath),

  // Change listeners
  onChange: (key, callback) => {
    // Register listener with main process
    ipcRenderer.invoke('store-on-change', key);

    // Listen for change events
    const eventHandler = (event, changeData) => {
      if (!key || changeData.key === key || key === '*') {
        callback(changeData.newValue, changeData.oldValue, changeData.key);
      }
    };

    ipcRenderer.on('store-changed', eventHandler);

    // Return cleanup function
    return () => {
      ipcRenderer.invoke('store-off-change', key);
      ipcRenderer.removeListener('store-changed', eventHandler);
    };
  },

  // Utility functions
  getKey: (path) => {
    // Navigate nested object with dot notation
    const keys = path.split('.');
    return keys.reduce((obj, key) => obj?.[key], window.storeCache || {});
  },

  setKey: (path, value) => {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {};
      return obj[key];
    }, window.storeCache || {});

    target[lastKey] = value;
    return window.storeAPI.set(path, value);
  }
});

// Initialize store cache for performance
let storeCache = {};
ipcRenderer.invoke('store-get-all').then(data => {
  storeCache = data;
  window.storeCache = storeCache;
});

// Keep cache in sync
ipcRenderer.on('store-changed', (event, changeData) => {
  if (changeData.key) {
    const keys = changeData.key.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {};
      return obj[key];
    }, storeCache);

    if (changeData.newValue === undefined) {
      delete target[lastKey];
    } else {
      target[lastKey] = changeData.newValue;
    }
  } else {
    // Full reload
    ipcRenderer.invoke('store-get-all').then(data => {
      storeCache = data;
      window.storeCache = storeCache;
    });
  }
});
```

### Phase 3: Renderer Process Integration

#### 1. Store Service for React Components

```typescript
// src/renderer/services/StoreService.js
class StoreService {
  constructor() {
    this.listeners = new Map();
    this.isInitialized = false;
    this.cache = {};
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Load initial data
      this.cache = await window.storeAPI.getAll();

      // Setup change listeners
      this.setupChangeListeners();

      this.isInitialized = true;
      console.log('Store Service initialized');
    } catch (error) {
      console.error('Failed to initialize Store Service:', error);
      throw error;
    }
  }

  setupChangeListeners() {
    // Listen for all store changes
    this.unsubscribeGlobal = window.storeAPI.onChange('*', (newValue, oldValue, key) => {
      this.updateCache(key, newValue);
      this.notifyListeners(key, newValue, oldValue);
    });
  }

  updateCache(key, value) {
    if (key.includes('.')) {
      // Handle nested keys
      const keys = key.split('.');
      const lastKey = keys.pop();
      let target = this.cache;

      for (const k of keys) {
        if (!target[k]) target[k] = {};
        target = target[k];
      }

      if (value === undefined) {
        delete target[lastKey];
      } else {
        target[lastKey] = value;
      }
    } else {
      if (value === undefined) {
        delete this.cache[key];
      } else {
        this.cache[key] = value;
      }
    }
  }

  // Core store operations
  async get(key, defaultValue) {
    this.ensureInitialized();

    if (this.cache.hasOwnProperty(key)) {
      return this.cache[key];
    }

    const value = await window.storeAPI.get(key, defaultValue);
    this.cache[key] = value;
    return value;
  }

  async set(key, value) {
    this.ensureInitialized();

    await window.storeAPI.set(key, value);
    // Cache will be updated via change listener
  }

  async delete(key) {
    this.ensureInitialized();

    await window.storeAPI.delete(key);
    // Cache will be updated via change listener
  }

  async has(key) {
    this.ensureInitialized();
    return await window.storeAPI.has(key);
  }

  async clear() {
    this.ensureInitialized();

    await window.storeAPI.clear();
    this.cache = {};
  }

  // Bulk operations
  async getAll() {
    this.ensureInitialized();
    return { ...this.cache };
  }

  async setMultiple(data) {
    this.ensureInitialized();

    await window.storeAPI.setMultiple(data);
    // Cache will be updated via change listeners
  }

  // Reactive API for components
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }

    this.listeners.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(key);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  notifyListeners(key, newValue, oldValue) {
    // Notify specific key listeners
    if (this.listeners.has(key)) {
      this.listeners.get(key).forEach(callback => {
        try {
          callback(newValue, oldValue, key);
        } catch (error) {
          console.error('Store listener error:', error);
        }
      });
    }

    // Notify global listeners
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(callback => {
        try {
          callback(newValue, oldValue, key);
        } catch (error) {
          console.error('Global store listener error:', error);
        }
      });
    }
  }

  // Utility methods for common patterns
  async getSettings() {
    return await this.get('settings', {});
  }

  async updateSettings(updates) {
    const currentSettings = await this.getSettings();
    const newSettings = { ...currentSettings, ...updates };
    await this.set('settings', newSettings);
  }

  async getUserPreferences() {
    return await this.get('user.preferences', {});
  }

  async updateUserPreferences(updates) {
    const currentPrefs = await this.getUserPreferences();
    const newPrefs = { ...currentPrefs, ...updates };
    await this.set('user.preferences', newPrefs);
  }

  // Workspace-specific operations
  async getWorkspaceSettings(workspaceId) {
    return await this.get(`workspaces.${workspaceId}.settings`, {});
  }

  async updateWorkspaceSettings(workspaceId, updates) {
    const currentSettings = await this.getWorkspaceSettings(workspaceId);
    const newSettings = { ...currentSettings, ...updates };
    await this.set(`workspaces.${workspaceId}.settings`, newSettings);
  }

  // AI-specific operations
  async getAIConfig() {
    return await this.get('ai', {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: ''
    });
  }

  async updateAIConfig(updates) {
    const currentConfig = await this.getAIConfig();
    const newConfig = { ...currentConfig, ...updates };
    await this.set('ai', newConfig);
  }

  ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error('Store Service not initialized. Call initialize() first.');
    }
  }

  dispose() {
    if (this.unsubscribeGlobal) {
      this.unsubscribeGlobal();
    }

    this.listeners.clear();
    this.cache = {};
    this.isInitialized = false;
  }
}

// Create singleton instance
const storeService = new StoreService();

module.exports = storeService;
```

#### 2. React Hook for Store Integration

```typescript
// src/renderer/hooks/useStore.js
import { useState, useEffect, useCallback } from 'react';
import storeService from '../services/StoreService';

export function useStore(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadValue = async () => {
      try {
        setLoading(true);
        const storedValue = await storeService.get(key, defaultValue);
        if (mounted) {
          setValue(storedValue);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err);
          setLoading(false);
        }
      }
    };

    loadValue();

    // Subscribe to changes
    const unsubscribe = storeService.subscribe(key, (newValue) => {
      if (mounted) {
        setValue(newValue);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [key, defaultValue]);

  const updateValue = useCallback(async (newValue) => {
    try {
      setError(null);
      await storeService.set(key, newValue);
      // Value will be updated via subscription
    } catch (err) {
      setError(err);
    }
  }, [key]);

  return {
    value,
    loading,
    error,
    updateValue,
    setValue: updateValue
  };
}

export function useStoreSettings() {
  return useStore('settings', {});
}

export function useStoreUserPrefs() {
  return useStore('user.preferences', {});
}

export function useStoreAIConfig() {
  return useStore('ai', {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: ''
  });
}

export function useStoreWorkspaceSettings(workspaceId) {
  return useStore(`workspaces.${workspaceId}.settings`, {});
}

// Hook for bulk operations
export function useStoreBulk() {
  const [storeData, setStoreData] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const data = await storeService.getAll();
        if (mounted) {
          setStoreData(data);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to load store data:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    // Subscribe to all changes
    const unsubscribe = storeService.subscribe('*', () => {
      loadData(); // Reload all data on any change
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const updateMultiple = useCallback(async (updates) => {
    await storeService.setMultiple(updates);
  }, []);

  return {
    data: storeData,
    loading,
    updateMultiple
  };
}
```

### Phase 4: Data Schema and Migration

#### 1. Schema Definition

```typescript
// src/main/store/schema.js
const storeSchema = {
  version: '1.0.0',

  // Application metadata
  version: {
    type: 'string',
    default: '1.0.0',
    description: 'Application version for migration tracking'
  },

  // User settings
  settings: {
    type: 'object',
    default: {},
    properties: {
      theme: {
        type: 'string',
        enum: ['light', 'dark', 'auto'],
        default: 'auto'
      },
      language: {
        type: 'string',
        default: 'en'
      },
      autoSave: {
        type: 'boolean',
        default: true
      },
      fontSize: {
        type: 'number',
        minimum: 8,
        maximum: 24,
        default: 14
      }
    }
  },

  // User profile
  user: {
    type: 'object',
    default: {},
    properties: {
      name: {
        type: 'string',
        default: ''
      },
      email: {
        type: 'string',
        format: 'email',
        default: ''
      },
      preferences: {
        type: 'object',
        default: {},
        properties: {
          notifications: {
            type: 'boolean',
            default: true
          },
          analytics: {
            type: 'boolean',
            default: false
          }
        }
      }
    }
  },

  // AI configuration
  ai: {
    type: 'object',
    default: {},
    properties: {
      provider: {
        type: 'string',
        enum: ['openai', 'anthropic', 'openrouter'],
        default: 'openai'
      },
      model: {
        type: 'string',
        default: 'gpt-4o'
      },
      apiKey: {
        type: 'string',
        default: ''
      },
      temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2,
        default: 0.7
      },
      maxTokens: {
        type: 'number',
        minimum: 1,
        maximum: 4096,
        default: 2048
      }
    }
  },

  // Workspace configurations
  workspaces: {
    type: 'object',
    default: {},
    patternProperties: {
      '.*': {
        type: 'object',
        properties: {
          path: {
            type: 'string'
          },
          name: {
            type: 'string'
          },
          settings: {
            type: 'object',
            default: {},
            properties: {
              buildOnSave: {
                type: 'boolean',
                default: true
              },
              autoRefresh: {
                type: 'boolean',
                default: false
              }
            }
          },
          lastOpened: {
            type: 'string',
            format: 'date-time'
          }
        }
      }
    }
  },

  // UI state
  ui: {
    type: 'object',
    default: {},
    properties: {
      windowBounds: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' }
        }
      },
      sidebarCollapsed: {
        type: 'boolean',
        default: false
      },
      activePanels: {
        type: 'array',
        items: { type: 'string' },
        default: ['chat', 'templates']
      }
    }
  },

  // Recent items
  recent: {
    type: 'object',
    default: {},
    properties: {
      workspaces: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10,
        default: []
      },
      templates: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 20,
        default: []
      }
    }
  }
};

module.exports = storeSchema;
```

#### 2. Schema Validation and Migration

```typescript
// src/main/store/SchemaValidator.js
const Ajv = require('ajv');
const storeSchema = require('./schema');

class SchemaValidator {
  constructor() {
    this.ajv = new Ajv({
      useDefaults: true,
      removeAdditional: false,
      coerceTypes: true
    });

    this.validateFunction = this.ajv.compile(storeSchema);
  }

  validate(data) {
    const valid = this.validateFunction(data);

    if (!valid) {
      return {
        valid: false,
        errors: this.validateFunction.errors
      };
    }

    return {
      valid: true,
      data: data // May have defaults applied
    };
  }

  sanitize(data) {
    // Deep clone to avoid modifying original
    const sanitized = JSON.parse(JSON.stringify(data));

    // Apply schema defaults and remove invalid properties
    const result = this.validate(sanitized);

    if (!result.valid) {
      console.warn('Store data validation errors:', result.errors);
      // Remove invalid properties
      result.errors.forEach(error => {
        if (error.instancePath) {
          const path = error.instancePath.split('/').filter(p => p);
          let target = sanitized;
          for (let i = 0; i < path.length - 1; i++) {
            if (target[path[i]]) {
              target = target[path[i]];
            } else {
              return; // Path doesn't exist
            }
          }
          delete target[path[path.length - 1]];
        }
      });
    }

    return result.valid ? result.data : sanitized;
  }

  getDefaults() {
    const defaults = {};

    const buildDefaults = (schema, path = '') => {
      if (schema.type === 'object' && schema.properties) {
        const obj = {};
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          const fullPath = path ? `${path}.${key}` : key;
          obj[key] = this.getDefaultValue(propSchema, fullPath);
        }
        return obj;
      }

      return this.getDefaultValue(schema, path);
    };

    const getDefaultValue = (schema, path) => {
      if (schema.default !== undefined) {
        return schema.default;
      }

      switch (schema.type) {
        case 'object':
          return buildDefaults(schema, path);
        case 'array':
          return [];
        case 'string':
          return '';
        case 'number':
          return 0;
        case 'boolean':
          return false;
        default:
          return null;
      }
    };

    return buildDefaults(storeSchema);
  }
}

module.exports = SchemaValidator;
```

### Phase 5: Testing and Quality Assurance

#### 1. Unit Tests for Store Manager

```typescript
// test/unit/store/StoreManager.test.js
const StoreManager = require('../../../src/main/store/StoreManager');
const BackupManager = require('../../../src/main/store/BackupManager');

jest.mock('electron-store');
jest.mock('../../../src/main/store/BackupManager');

describe('StoreManager', () => {
  let storeManager;
  let mockStore;
  let mockBackupManager;

  beforeEach(async () => {
    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      has: jest.fn(),
      clear: jest.fn(),
      store: {},
      path: '/mock/path'
    };

    mockBackupManager = {
      initialize: jest.fn(),
      createBackup: jest.fn(),
      dispose: jest.fn()
    };

    // Mock electron-store constructor
    const Store = require('electron-store');
    Store.mockImplementation(() => mockStore);

    BackupManager.mockImplementation(() => mockBackupManager);

    storeManager = new StoreManager();
    await storeManager.initialize();
  });

  afterEach(() => {
    storeManager.dispose();
  });

  describe('initialization', () => {
    test('should initialize store and backup manager', async () => {
      expect(mockStore.get).toHaveBeenCalledWith('version', '1.0.0');
      expect(mockBackupManager.initialize).toHaveBeenCalledWith('/mock/path');
    });

    test('should handle initialization errors', async () => {
      mockStore.get.mockImplementation(() => {
        throw new Error('Store error');
      });

      const newStoreManager = new StoreManager();

      await expect(newStoreManager.initialize()).rejects.toThrow('Store error');
    });
  });

  describe('basic operations', () => {
    test('should get values from store', () => {
      mockStore.get.mockReturnValue('test-value');

      const result = storeManager.get('test-key', 'default');

      expect(mockStore.get).toHaveBeenCalledWith('test-key', 'default');
      expect(result).toBe('test-value');
    });

    test('should set values in store', () => {
      storeManager.set('test-key', 'test-value');

      expect(mockStore.set).toHaveBeenCalledWith('test-key', 'test-value');
    });

    test('should notify change listeners', () => {
      const mockCallback = jest.fn();
      storeManager.onChange('test-key', mockCallback);

      storeManager.set('test-key', 'new-value');

      expect(mockCallback).toHaveBeenCalledWith('new-value', undefined, 'test-key');
    });

    test('should create backups for critical keys', () => {
      storeManager.set('ai.apiKey', 'secret-key');

      expect(mockBackupManager.createBackup).toHaveBeenCalled();
    });
  });

  describe('change listeners', () => {
    test('should support multiple listeners for same key', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      storeManager.onChange('test-key', callback1);
      storeManager.onChange('test-key', callback2);

      storeManager.set('test-key', 'value');

      expect(callback1).toHaveBeenCalledWith('value', undefined, 'test-key');
      expect(callback2).toHaveBeenCalledWith('value', undefined, 'test-key');
    });

    test('should support global listeners', () => {
      const mockCallback = jest.fn();
      storeManager.onChange('*', mockCallback);

      storeManager.set('any-key', 'value');

      expect(mockCallback).toHaveBeenCalledWith('value', undefined, 'any-key');
    });

    test('should return unsubscribe function', () => {
      const mockCallback = jest.fn();
      const unsubscribe = storeManager.onChange('test-key', mockCallback);

      unsubscribe();
      storeManager.set('test-key', 'value');

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });
});
```

#### 2. Integration Tests for IPC Communication

```typescript
// test/integration/store-ipc.test.js
const { ipcMain, ipcRenderer } = require('electron');
const StoreIPCHandlers = require('../../src/main/ipc/store-handlers');
const StoreManager = require('../../src/main/store/StoreManager');

describe('Store IPC Communication', () => {
  let storeManager;
  let ipcHandlers;
  let mockEvent;

  beforeEach(async () => {
    storeManager = new StoreManager();
    await storeManager.initialize();

    ipcHandlers = new StoreIPCHandlers(storeManager);

    mockEvent = {
      sender: {
        send: jest.fn(),
        storeUnsubscribers: new Set()
      }
    };
  });

  describe('basic IPC operations', () => {
    test('should handle store-get requests', async () => {
      storeManager.get = jest.fn().mockReturnValue('test-value');

      const result = await ipcMain.emit('store-get', mockEvent, 'test-key');

      expect(storeManager.get).toHaveBeenCalledWith('test-key', undefined);
      expect(result).toBe('test-value');
    });

    test('should handle store-set requests', async () => {
      storeManager.set = jest.fn();

      await ipcMain.emit('store-set', mockEvent, 'test-key', 'test-value');

      expect(storeManager.set).toHaveBeenCalledWith('test-key', 'test-value');
    });

    test('should handle errors gracefully', async () => {
      storeManager.get = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      await expect(
        ipcMain.emit('store-get', mockEvent, 'test-key')
      ).rejects.toThrow('Test error');
    });
  });

  describe('change listeners', () => {
    test('should register change listeners', async () => {
      storeManager.onChange = jest.fn().mockReturnValue(jest.fn());

      await ipcMain.emit('store-on-change', mockEvent, 'test-key');

      expect(storeManager.onChange).toHaveBeenCalledWith('test-key', expect.any(Function));
    });

    test('should cleanup listeners', async () => {
      const mockUnsubscribe = jest.fn();
      mockEvent.sender.storeUnsubscribers.add(mockUnsubscribe);

      await ipcMain.emit('store-off-change', mockEvent, 'test-key');

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
```

### Phase 6: Performance Optimization

#### 1. Store Performance Monitoring

```typescript
// src/main/store/PerformanceMonitor.js
class StorePerformanceMonitor {
  constructor(storeManager) {
    this.storeManager = storeManager;
    this.metrics = {
      operations: 0,
      totalTime: 0,
      averageTime: 0,
      slowestOperation: { time: 0, operation: '', key: '' },
      operationCounts: new Map(),
      errorCount: 0
    };

    this.enabled = process.env.NODE_ENV === 'development';
  }

  measure(operation, key, fn) {
    if (!this.enabled) return fn();

    const startTime = process.hrtime.bigint();
    let result;
    let error = null;

    try {
      result = fn();
    } catch (err) {
      error = err;
      this.metrics.errorCount++;
    }

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e6; // Convert