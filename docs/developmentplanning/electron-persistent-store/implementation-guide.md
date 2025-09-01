# Electron Store Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the electron-store package in the TAD Electron application. The implementation ensures persistent storage of application settings with cross-process synchronization between the main Electron process and renderer processes.

## Prerequisites

### Dependencies

```json
{
  "dependencies": {
    "electron-store": "^8.1.1",
    "ajv": "^8.12.0"
  },
  "devDependencies": {
    "chokidar": "^3.5.3",
    "@types/node": "^20.0.0"
  }
}
```

### Project Structure

```
src/
├── main/
│   ├── store/
│   │   ├── StoreManager.js
│   │   ├── BackupManager.js
│   │   ├── SchemaValidator.js
│   │   └── PerformanceMonitor.js
│   ├── ipc/
│   │   └── store-handlers.js
│   └── preload/
│       └── store-preload.js
├── renderer/
│   ├── services/
│   │   └── StoreService.js
│   └── hooks/
│       └── useStore.js
└── shared/
    └── types/
        └── store-schema.js
```

## Step 1: Core Store Manager Implementation

### 1.1 Create StoreManager Class

```typescript
// src/main/store/StoreManager.js
const Store = require('electron-store');
const path = require('path');
const fs = require('fs').promises;
const { app, BrowserWindow } = require('electron');
const BackupManager = require('./BackupManager');
const SchemaValidator = require('./SchemaValidator');

class StoreManager {
  constructor() {
    this.store = null;
    this.isInitialized = false;
    this.changeListeners = new Map();
    this.backupManager = new BackupManager();
    this.schemaValidator = new SchemaValidator();
    this.performanceMonitor = new PerformanceMonitor(this);
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

      // Setup performance monitoring
      this.performanceMonitor.start();

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
    const targetVersion = app.getVersion();

    if (currentVersion !== targetVersion) {
      console.log(`Migrating store from ${currentVersion} to ${targetVersion}`);
      await this.migrateData(currentVersion, targetVersion);
      this.store.set('version', targetVersion);
    }

    // Validate current data against schema
    const allData = this.store.store;
    const validation = this.schemaValidator.validate(allData);

    if (!validation.valid) {
      console.warn('Store data validation errors:', validation.errors);
      // Attempt to sanitize data
      const sanitized = this.schemaValidator.sanitize(allData);
      this.store.store = sanitized;
    }
  }

  async migrateData(fromVersion, toVersion) {
    const migrations = this.getMigrations(fromVersion, toVersion);

    for (const migration of migrations) {
      try {
        await migration.up();
        console.log(`Applied migration: ${migration.name}`);
      } catch (error) {
        console.error(`Migration failed: ${migration.name}`, error);
        // Attempt rollback if available
        if (migration.down) {
          try {
            await migration.down();
            console.log(`Rolled back migration: ${migration.name}`);
          } catch (rollbackError) {
            console.error(`Rollback failed: ${migration.name}`, rollbackError);
          }
        }
        throw error;
      }
    }
  }

  getMigrations(fromVersion, toVersion) {
    // Define migration functions based on version changes
    const migrations = [];

    // Example migration: Add new setting with default value
    if (this.compareVersions(fromVersion, '1.1.0') < 0) {
      migrations.push({
        name: 'add-new-feature-setting',
        up: async () => {
          const currentSettings = this.store.get('settings', {});
          if (!currentSettings.newFeature) {
            currentSettings.newFeature = {
              enabled: true,
              value: 'default'
            };
            this.store.set('settings', currentSettings);
          }
        },
        down: async () => {
          const currentSettings = this.store.get('settings', {});
          delete currentSettings.newFeature;
          this.store.set('settings', currentSettings);
        }
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

  // Core store operations with performance monitoring
  get(key, defaultValue) {
    return this.performanceMonitor.measure('get', key, () => {
      this.ensureInitialized();
      return this.store.get(key, defaultValue);
    });
  }

  set(key, value) {
    return this.performanceMonitor.measure('set', key, () => {
      this.ensureInitialized();

      const oldValue = this.get(key);
      this.store.set(key, value);

      // Notify listeners
      this.notifyChangeListeners(key, value, oldValue);

      // Trigger backup if critical data changed
      if (this.isCriticalKey(key)) {
        this.backupManager.createBackup('critical-data-change');
      }

      return true;
    });
  }

  delete(key) {
    return this.performanceMonitor.measure('delete', key, () => {
      this.ensureInitialized();

      const oldValue = this.get(key);
      this.store.delete(key);

      this.notifyChangeListeners(key, undefined, oldValue);

      return true;
    });
  }

  has(key) {
    return this.performanceMonitor.measure('has', key, () => {
      this.ensureInitialized();
      return this.store.has(key);
    });
  }

  clear() {
    this.ensureInitialized();

    // Create backup before clearing
    this.backupManager.createBackup('store-cleared');

    this.store.clear();
    this.notifyChangeListeners(null, null, null);

    return true;
  }

  // Bulk operations
  getAll() {
    return this.performanceMonitor.measure('getAll', null, () => {
      this.ensureInitialized();
      return this.store.store;
    });
  }

  setMultiple(data) {
    return this.performanceMonitor.measure('setMultiple', null, () => {
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

      return true;
    });
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
      version: this.store.get('version', '1.0.0'),
      listeners: this.changeListeners.size
    };
  }

  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }

    this.changeListeners.clear();
    this.backupManager.dispose();
    this.performanceMonitor.stop();
  }
}

module.exports = StoreManager;
```

### 1.2 Create Backup Manager

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
    // Create backup on initialization
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

## Step 2: IPC Communication Setup

### 2.1 Create IPC Handlers

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

### 2.2 Create Preload Script

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

## Step 3: Renderer Process Integration

### 3.1 Create Store Service

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

### 3.2 Create React Hooks

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

## Step 4: Integration with Main Application

### 4.1 Update Main Application

```typescript
// src/main/TADApplication.js
const StoreManager = require('./store/StoreManager');
const StoreIPCHandlers = require('./ipc/store-handlers');

class TADApplication {
  constructor() {
    this.storeManager = new StoreManager();
    this.storeIPCHandlers = null;
  }

  async initialize() {
    try {
      // Initialize store manager first
      await this.storeManager.initialize();

      // Setup IPC handlers for store
      this.storeIPCHandlers = new StoreIPCHandlers(this.storeManager);

      // Continue with other initialization...
      await this.initializeCoreManagers();
      await this.createMainWindow();
      this.setupIPCHandlers();

      console.log('TAD Application initialized successfully');
    } catch (error) {
      console.error('Failed to initialize TAD:', error);
      throw error;
    }
  }

  // ... other methods ...

  dispose() {
    if (this.storeManager) {
      this.storeManager.dispose();
    }
    // ... other cleanup ...
  }
}

module.exports = TADApplication;
```

### 4.2 Update Preload Script

```typescript
// src/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Import store preload
require('./store-preload');

// Expose other APIs...
contextBridge.exposeInMainWorld('tadAPI', {
  // ... existing APIs ...

  // Store is already exposed via store-preload.js
  // Access it via window.storeAPI
});

// Handle application-level events
ipcRenderer.on('application-error', (event, error) => {
  console.error('TAD Application Error:', error);
});
```

## Step 5: Usage Examples

### 5.1 Basic Usage in Renderer

```typescript
// Basic store operations
async function exampleUsage() {
  // Get a value
  const theme = await window.storeAPI.get('settings.theme', 'light');

  // Set a value
  await window.storeAPI.set('settings.theme', 'dark');

  // Listen for changes
  const unsubscribe = window.storeAPI.onChange('settings.theme', (newValue, oldValue) => {
    console.log('Theme changed from', oldValue, 'to', newValue);
    updateUITheme(newValue);
  });

  // Cleanup when done
  unsubscribe();
}
```

### 5.2 React Component Usage

```typescript
// src/renderer/components/SettingsPanel.js
import React from 'react';
import { useStoreSettings, useStoreAIConfig } from '../hooks/useStore';

function SettingsPanel() {
  const { value: settings, updateValue: updateSettings } = useStoreSettings();
  const { value: aiConfig, updateValue: updateAIConfig } = useStoreAIConfig();

  const handleThemeChange = async (theme) => {
    await updateSettings({ ...settings, theme });
  };

  const handleAIProviderChange = async (provider) => {
    await updateAIConfig({ ...aiConfig, provider });
  };

  return (
    <div className="settings-panel">
      <div className="setting-group">
        <label>Theme:</label>
        <select
          value={settings.theme || 'light'}
          onChange={(e) => handleThemeChange(e.target.value)}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="auto">Auto</option>
        </select>
      </div>

      <div className="setting-group">
        <label>AI Provider:</label>
        <select
          value={aiConfig.provider || 'openai'}
          onChange={(e) => handleAIProviderChange(e.target.value)}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>
    </div>
  );
}

export default SettingsPanel;
```

### 5.3 Main Process Usage

```typescript
// src/main/some-module.js
class SomeModule {
  constructor(storeManager) {
    this.storeManager = storeManager;
    this.setupStoreListeners();
  }

  setupStoreListeners() {
    // Listen for settings changes
    this.storeManager.onChange('settings', (newSettings, oldSettings) => {
      this.handleSettingsChange(newSettings, oldSettings);
    });

    // Listen for AI config changes
    this.storeManager.onChange('ai', (newConfig, oldConfig) => {
      this.handleAIConfigChange(newConfig, oldConfig);
    });
  }

  handleSettingsChange(newSettings, oldSettings) {
    // Update module behavior based on settings
    if (newSettings.theme !== oldSettings.theme) {
      this.updateTheme(newSettings.theme);
    }
  }

  handleAIConfigChange(newConfig, oldConfig) {
    // Update AI provider configuration
    if (newConfig.provider !== oldConfig.provider) {
      this.switchAIProvider(newConfig.provider);
    }
  }
}
```

## Step 6: Testing

### 6.1 Unit Tests

```typescript
// test/unit/store/StoreManager.test.js
const StoreManager = require('../../../src/main/store/StoreManager');

describe('StoreManager', () => {
  let storeManager;

  beforeEach(async () => {
    storeManager = new StoreManager();
    await storeManager.initialize();
  });

  afterEach(() => {
    storeManager.dispose();
  });

  test('should get and set values', async () => {
    await storeManager.set('test-key', 'test-value');
    const value = await storeManager.get('test-key');

    expect(value).toBe('test-value');
  });

  test('should notify change listeners', async () => {
    const mockCallback = jest.fn();
    storeManager.onChange('test-key', mockCallback);

    await storeManager.set('test-key', 'new-value');

    expect(mockCallback).toHaveBeenCalledWith('new-value', undefined, 'test-key');
  });
});
```

### 6.2 Integration Tests

```typescript
// test/integration/store-integration.test.js
describe('Store Integration', () => {
  test('should synchronize data across processes', async () => {
    // This would require setting up test Electron environment
    // with both main and renderer processes
  });
});
```

## Step 7: Error Correction System Integration

### 7.1 Add Error Correction Dependencies

```json
{
  "dependencies": {
    "electron-store": "^8.1.1",
    "ajv": "^8.12.0",
    "crypto": "builtin"  // Node.js built-in
  },
  "devDependencies": {
    "chokidar": "^3.5.3",
    "@types/node": "^20.0.0"
  }
}
```

### 7.2 Create Error Correction Manager

```typescript
// src/main/store/ErrorCorrectionManager.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

class ErrorCorrectionManager {
  constructor(storeManager) {
    this.storeManager = storeManager;
    this.historyDir = null;
    this.maxHistoryEntries = 100;
  }

  async initialize() {
    // Create storeHistory directory
    const userDataPath = app.getPath('userData');
    this.historyDir = path.join(userDataPath, 'storeHistory');

    await fs.mkdir(this.historyDir, { recursive: true });

    // Initialize metadata file
    await this.initializeMetadata();

    console.log('Error Correction Manager initialized');
  }

  async processDataChange(operation, originalData, newData, metadata = {}) {
    try {
      console.log(`Processing data change: ${operation}`);

      // Step 1: Create in-memory copies
      const originalCopy = JSON.parse(JSON.stringify(originalData));
      const proposedCopy = JSON.parse(JSON.stringify(newData));

      // Step 2: Validate proposed JSON structure
      const validation = await this.validateProposedData(proposedCopy);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Step 3: Create binary diff
      const diff = this.createBinaryDiff(originalCopy, proposedCopy);

      // Step 4: Store diff in history
      const timestamp = new Date().toISOString();
      const diffFilename = `${timestamp.replace(/[:.]/g, '-')}.diff`;

      const diffData = {
        timestamp,
        operation,
        originalHash: this.hashData(originalCopy),
        newHash: this.hashData(proposedCopy),
        diff: diff,
        metadata: {
          ...metadata,
          userAgent: 'TAD-Electron',
          version: app.getVersion()
        }
      };

      await this.storeDiff(diffFilename, diffData);

      // Step 5: Update metadata
      await this.updateMetadata(operation, timestamp);

      console.log(`Data change processed successfully: ${diffFilename}`);

      return {
        success: true,
        diffId: diffFilename,
        timestamp
      };

    } catch (error) {
      console.error('Error processing data change:', error);

      // Log error to history for debugging
      await this.logError(operation, error, metadata);

      return {
        success: false,
        error: error.message
      };
    }
  }

  async validateProposedData(data) {
    try {
      // Basic JSON validation
      JSON.stringify(data);

      // Schema validation
      const schemaValidation = this.storeManager.schemaValidator.validate(data);

      if (!schemaValidation.valid) {
        return {
          valid: false,
          errors: schemaValidation.errors.map(err => err.message)
        };
      }

      // Custom validation rules
      const customErrors = await this.runCustomValidations(data);
      if (customErrors.length > 0) {
        return {
          valid: false,
          errors: customErrors
        };
      }

      return { valid: true };

    } catch (error) {
      return {
        valid: false,
        errors: [`JSON parsing error: ${error.message}`]
      };
    }
  }

  async runCustomValidations(data) {
    const errors = [];

    // Validate workspace paths exist
    if (data.workspaces) {
      for (const [id, workspace] of Object.entries(data.workspaces)) {
        if (workspace.path && !await this.pathExists(workspace.path)) {
          errors.push(`Workspace ${id} path does not exist: ${workspace.path}`);
        }
      }
    }

    // Validate AI provider configuration
    if (data.ai?.provider) {
      const validProviders = ['openai', 'anthropic', 'openrouter', 'local'];
      if (!validProviders.includes(data.ai.provider)) {
        errors.push(`Invalid AI provider: ${data.ai.provider}`);
      }
    }

    // Validate theme values
    if (data.settings?.theme) {
      const validThemes = ['light', 'dark', 'auto'];
      if (!validThemes.includes(data.settings.theme)) {
        errors.push(`Invalid theme: ${data.settings.theme}`);
      }
    }

    return errors;
  }

  async pathExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  createBinaryDiff(originalData, newData) {
    // Create a minimal diff representation
    const diff = {
      changes: [],
      metadata: {
        originalSize: JSON.stringify(originalData).length,
        newSize: JSON.stringify(newData).length
      }
    };

    // Deep comparison to find changes
    this.compareObjects('', originalData, newData, diff.changes);

    return diff;
  }

  compareObjects(path, original, current, changes) {
    if (original === current) return;

    if (original === null || original === undefined) {
      changes.push({
        type: 'add',
        path,
        value: current
      });
      return;
    }

    if (current === null || current === undefined) {
      changes.push({
        type: 'remove',
        path
      });
      return;
    }

    if (typeof original !== typeof current) {
      changes.push({
        type: 'replace',
        path,
        oldValue: original,
        newValue: current
      });
      return;
    }

    if (typeof original === 'object') {
      if (Array.isArray(original)) {
        this.compareArrays(path, original, current, changes);
      } else {
        this.compareObjectProperties(path, original, current, changes);
      }
    } else {
      changes.push({
        type: 'replace',
        path,
        oldValue: original,
        newValue: current
      });
    }
  }

  compareArrays(path, original, current, changes) {
    const maxLength = Math.max(original.length, current.length);

    for (let i = 0; i < maxLength; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;

      if (i >= original.length) {
        changes.push({
          type: 'add',
          path: itemPath,
          value: current[i]
        });
      } else if (i >= current.length) {
        changes.push({
          type: 'remove',
          path: itemPath,
          oldValue: original[i]
        });
      } else {
        this.compareObjects(itemPath, original[i], current[i], changes);
      }
    }
  }

  compareObjectProperties(path, original, current, changes) {
    const allKeys = new Set([...Object.keys(original), ...Object.keys(current)]);

    for (const key of allKeys) {
      const keyPath = path ? `${path}.${key}` : key;

      if (!(key in original)) {
        changes.push({
          type: 'add',
          path: keyPath,
          value: current[key]
        });
      } else if (!(key in current)) {
        changes.push({
          type: 'remove',
          path: keyPath,
          oldValue: original[key]
        });
      } else {
        this.compareObjects(keyPath, original[key], current[key], changes);
      }
    }
  }

  hashData(data) {
    const jsonString = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }

  async storeDiff(filename, diffData) {
    const diffPath = path.join(this.historyDir, filename);
    const compressedData = JSON.stringify(diffData, null, 2);

    await fs.writeFile(diffPath, compressedData, 'utf8');

    // Maintain history size limit
    await this.cleanupOldEntries();
  }

  async updateMetadata(operation, timestamp) {
    const metadataPath = path.join(this.historyDir, 'metadata.json');

    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataContent);

      metadata.totalEntries++;
      metadata.lastOperation = {
        type: operation,
        timestamp
      };
      metadata.lastModified = timestamp;

      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error('Failed to update metadata:', error);
    }
  }

  async cleanupOldEntries() {
    try {
      const files = await fs.readdir(this.historyDir);
      const diffFiles = files
        .filter(file => file.endsWith('.diff'))
        .map(file => ({
          name: file,
          path: path.join(this.historyDir, file),
          stat: fs.stat(path.join(this.historyDir, file))
        }));

      // Get file stats
      const fileStats = await Promise.all(
        diffFiles.map(async item => ({
          ...item,
          stat: await item.stat
        }))
      );

      // Sort by modification time (newest first)
      fileStats.sort((a, b) => b.stat.mtime - a.stat.mtime);

      // Remove excess files
      if (fileStats.length > this.maxHistoryEntries) {
        const filesToDelete = fileStats.slice(this.maxHistoryEntries);

        for (const file of filesToDelete) {
          await fs.unlink(file.path);
          console.log(`Cleaned up old diff: ${file.name}`);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old entries:', error);
    }
  }

  async rollbackToTimestamp(targetTimestamp) {
    try {
      // Find the diff file closest to the target timestamp
      const diffFile = await this.findDiffForTimestamp(targetTimestamp);
      if (!diffFile) {
        throw new Error(`No diff found for timestamp: ${targetTimestamp}`);
      }

      // Load and apply the rollback
      const rollbackResult = await this.applyRollback(diffFile);

      return rollbackResult;
    } catch (error) {
      console.error('Rollback failed:', error);
      throw error;
    }
  }

  async findDiffForTimestamp(targetTimestamp) {
    const files = await fs.readdir(this.historyDir);
    const diffFiles = files.filter(file => file.endsWith('.diff'));

    let closestFile = null;
    let closestTime = Infinity;

    for (const file of diffFiles) {
      const timestamp = file.replace('.diff', '').replace(/-/g, ':').replace('T', 'T');
      const fileTime = new Date(timestamp).getTime();
      const targetTime = new Date(targetTimestamp).getTime();

      if (fileTime <= targetTime && targetTime - fileTime < closestTime) {
        closestFile = file;
        closestTime = targetTime - fileTime;
      }
    }

    return closestFile;
  }

  async applyRollback(diffFile) {
    const diffPath = path.join(this.historyDir, diffFile);
    const diffContent = await fs.readFile(diffPath, 'utf8');
    const diffData = JSON.parse(diffContent);

    // Apply the reverse of each change
    const currentData = this.storeManager.getAll();
    const rolledBackData = this.applyReverseDiff(currentData, diffData.diff);

    // Validate rolled back data
    const validation = await this.validateProposedData(rolledBackData);
    if (!validation.valid) {
      throw new Error(`Rollback validation failed: ${validation.errors.join(', ')}`);
    }

    // Apply the rolled back data
    await this.storeManager.setMultiple(rolledBackData);

    return {
      success: true,
      rolledBackTo: diffData.timestamp,
      changesReverted: diffData.diff.changes.length
    };
  }

  applyReverseDiff(data, diff) {
    const result = JSON.parse(JSON.stringify(data));

    // Apply changes in reverse order
    for (let i = diff.changes.length - 1; i >= 0; i--) {
      const change = diff.changes[i];
      this.applyReverseChange(result, change);
    }

    return result;
  }

  applyReverseChange(data, change) {
    const pathParts = change.path.split(/\.|\[|\]/).filter(p => p);
    let current = data;

    // Navigate to the parent of the target property
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part]) {
        if (Array.isArray(current)) {
          current[part] = [];
        } else {
          current[part] = {};
        }
      }
      current = current[part];
    }

    const lastPart = pathParts[pathParts.length - 1];

    switch (change.type) {
      case 'add':
        delete current[lastPart];
        break;
      case 'remove':
        current[lastPart] = change.oldValue;
        break;
      case 'replace':
        current[lastPart] = change.oldValue;
        break;
    }
  }

  async logError(operation, error, metadata) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      operation,
      error: {
        message: error.message,
        stack: error.stack
      },
      metadata
    };

    const errorFilename = `error-${Date.now()}.json`;
    const errorPath = path.join(this.historyDir, errorFilename);

    try {
      await fs.writeFile(errorPath, JSON.stringify(errorEntry, null, 2));
    } catch (writeError) {
      console.error('Failed to log error:', writeError);
    }
  }

  async getHistorySummary() {
    try {
      const files = await fs.readdir(this.historyDir);
      const diffFiles = files.filter(file => file.endsWith('.diff'));

      const summary = {
        totalEntries: diffFiles.length,
        historyFiles: diffFiles,
        metadata: null
      };

      // Load metadata
      try {
        const metadataContent = await fs.readFile(
          path.join(this.historyDir, 'metadata.json'),
          'utf8'
        );
        summary.metadata = JSON.parse(metadataContent);
      } catch {
        // Metadata not available
      }

      return summary;
    } catch (error) {
      console.error('Failed to get history summary:', error);
      return { totalEntries: 0, historyFiles: [], metadata: null };
    }
  }

  dispose() {
    // Cleanup resources if needed
  }
}

module.exports = ErrorCorrectionManager;
```

### 7.3 Integrate Error Correction with Store Manager

```typescript
// src/main/store/StoreManager.js
const ErrorCorrectionManager = require('./ErrorCorrectionManager');

class StoreManager {
  constructor() {
    // ... existing constructor code ...
    this.errorCorrection = new ErrorCorrectionManager(this);
  }

  async initialize() {
    // ... existing initialization code ...

    // Initialize error correction system
    await this.errorCorrection.initialize();

    // ... rest of initialization ...
  }

  async set(key, value) {
    // ... existing set method ...

    // Create error correction entry
    const originalData = this.getAll();
    const newData = { ...originalData };
    this.setNestedValue(newData, key, value);

    const correctionResult = await this.errorCorrection.processDataChange(
      'set',
      originalData,
      newData,
      { key, operation: 'single-set' }
    );

    if (!correctionResult.success) {
      throw new Error(`Data change validation failed: ${correctionResult.error}`);
    }

    // ... existing set logic ...
  }

  async setMultiple(data) {
    // ... existing setMultiple method ...

    // Create error correction entry
    const originalData = this.getAll();
    const newData = { ...originalData, ...data };

    const correctionResult = await this.errorCorrection.processDataChange(
      'set-multiple',
      originalData,
      newData,
      { keys: Object.keys(data), operation: 'bulk-set' }
    );

    if (!correctionResult.success) {
      throw new Error(`Bulk data change validation failed: ${correctionResult.error}`);
    }

    // ... existing setMultiple logic ...
  }

  async migrateData(fromVersion, toVersion) {
    // ... existing migration logic ...

    for (const migration of migrations) {
      const originalData = this.getAll();

      try {
        await migration.up();

        const newData = this.getAll();

        // Create error correction entry for migration (includes full backup)
          const correctionResult = await this.errorCorrection.processDataChange(
            'migration',
            originalData,
            newData,
            {
              migrationName: migration.name,
              fromVersion,
              toVersion
            }
          );
  
          if (!correctionResult.success) {
            console.error(`Migration validation failed: ${correctionResult.error}`);
            // Continue with migration but log the error
          }
  
          // Log migration backup creation
          if (correctionResult.hasFullBackup) {
            console.log(`Migration backup created for: ${migration.name}`);
          }

      } catch (error) {
        // ... existing error handling ...
      }
    }
  }

  // Add rollback capability
  async rollbackToTimestamp(timestamp) {
    return await this.errorCorrection.rollbackToTimestamp(timestamp);
  }

  // Add history summary
  async getHistorySummary() {
    return await this.errorCorrection.getHistorySummary();
  }

  dispose() {
    // ... existing dispose logic ...
    if (this.errorCorrection) {
      this.errorCorrection.dispose();
    }
  }
}
```

### 7.4 Add Error Correction IPC Handlers

```typescript
// src/main/ipc/store-handlers.js
class StoreIPCHandlers {
  // ... existing handlers ...

  setupHandlers() {
    // ... existing handlers ...

    // Error correction handlers
    ipcMain.handle('store-rollback', async (event, timestamp) => {
      try {
        return await this.storeManager.rollbackToTimestamp(timestamp);
      } catch (error) {
        console.error('Store rollback error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-history-summary', async (event) => {
      try {
        return await this.storeManager.getHistorySummary();
      } catch (error) {
        console.error('Store history summary error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-validate-data', async (event, data) => {
      try {
        return await this.storeManager.errorCorrection.validateProposedData(data);
      } catch (error) {
        console.error('Store data validation error:', error);
        throw error;
      }
    });

    // Migration backup handlers
    ipcMain.handle('store-list-migration-backups', async (event) => {
      try {
        return await this.storeManager.errorCorrection.listMigrationBackups();
      } catch (error) {
        console.error('Store list migration backups error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-restore-migration-backup', async (event, backupName) => {
      try {
        return await this.storeManager.errorCorrection.restoreMigrationBackup(backupName);
      } catch (error) {
        console.error('Store restore migration backup error:', error);
        throw error;
      }
    });

    ipcMain.handle('store-validate-migration-backup', async (event, backupName) => {
      try {
        return await this.storeManager.errorCorrection.validateMigrationBackup(backupName);
      } catch (error) {
        console.error('Store validate migration backup error:', error);
        throw error;
      }
    });
  }
}
```

### 7.5 Update Preload Script

```typescript
// src/main/preload/store-preload.js
contextBridge.exposeInMainWorld('storeAPI', {
  // ... existing API ...

  // Error correction API
  rollbackToTimestamp: (timestamp) => ipcRenderer.invoke('store-rollback', timestamp),
  getHistorySummary: () => ipcRenderer.invoke('store-history-summary'),
  validateData: (data) => ipcRenderer.invoke('store-validate-data', data),

  // Migration backup API
  listMigrationBackups: () => ipcRenderer.invoke('store-list-migration-backups'),
  restoreMigrationBackup: (backupName) => ipcRenderer.invoke('store-restore-migration-backup', backupName),
  validateMigrationBackup: (backupName) => ipcRenderer.invoke('store-validate-migration-backup', backupName)
});
```

### 7.6 Error Correction Usage Examples

```typescript
// Manual rollback to a specific timestamp
const rollbackResult = await window.storeAPI.rollbackToTimestamp('2025-09-01T18:56:56.765Z');

if (rollbackResult.success) {
  console.log(`Rolled back ${rollbackResult.changesReverted} changes`);
} else {
  console.error('Rollback failed:', rollbackResult.error);
}

// Get history summary
const history = await window.storeAPI.getHistorySummary();
console.log(`Total history entries: ${history.totalEntries}`);

// Validate data before applying
const validation = await window.storeAPI.validateData(proposedData);
if (validation.valid) {
  // Apply the data
  await window.storeAPI.setMultiple(proposedData);
} else {
  console.error('Validation failed:', validation.errors);
}

// Migration operations automatically create full backups
const migrationResult = await storeManager.migrateData('1.0.0', '1.1.0');
if (migrationResult.hasFullBackup) {
  console.log('Migration backup created for safety');
}

// List available migration backups
const migrationBackups = await window.storeAPI.listMigrationBackups();
console.log(`Available migration backups: ${migrationBackups.length}`);

// Restore from a specific migration backup
await window.storeAPI.restoreMigrationBackup('migration-backup-add-feature-2025-09-01T18-56-56-765Z-abc123.json');
```

## Step 8: Deployment and Maintenance

### 7.1 Package Configuration

```json
// package.json
{
  "dependencies": {
    "electron-store": "^8.1.1",
    "ajv": "^8.12.0"
  },
  "devDependencies": {
    "chokidar": "^3.5.3",
    "jest": "^29.0.0"
  }
}
```

### 7.2 Build Configuration

```javascript
// build.js or webpack config
module.exports = {
  // Ensure electron-store and dependencies are included
  externals: {
    'electron-store': 'commonjs electron-store'
  }
};
```

### 7.3 Monitoring and Maintenance

```typescript
// src/main/monitoring/StoreMonitor.js
class StoreMonitor {
  constructor(storeManager) {
    this.storeManager = storeManager;
    this.setupMonitoring();
  }

  setupMonitoring() {
    // Monitor store performance
    setInterval(() => {
      const info = this.storeManager.getStoreInfo();
      console.log('Store metrics:', info);
    }, 60000); // Every minute
  }

  generateHealthReport() {
    const info = this.storeManager.getStoreInfo();
    const backups = this.storeManager.backupManager.listBackups();

    return {
      storeSize: info.size,
      keyCount: info.keys.length,
      listenerCount: info.listeners,
      backupCount: backups.length,
      lastBackup: backups[0]?.metadata?.backupTime
    };
  }
}
```

This implementation guide provides a comprehensive approach to implementing electron-store for persistent data storage in the TAD Electron application, ensuring cross-process synchronization and data integrity.