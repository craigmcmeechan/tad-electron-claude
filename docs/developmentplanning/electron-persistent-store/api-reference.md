# Electron Store API Reference

## Overview

This document provides a comprehensive reference for the electron-store API implementation in the TAD Electron application. The API is designed to provide secure, type-safe, and reactive data storage across the main Electron process and renderer processes.

## Main Process API

### StoreManager Class

The StoreManager is the central component that manages the electron-store instance and coordinates data operations.

#### Constructor

```typescript
const storeManager = new StoreManager();
```

#### Methods

##### `initialize(): Promise<void>`

Initializes the store manager and sets up all necessary components.

```typescript
await storeManager.initialize();
```

**Throws:**
- `Error` if initialization fails

##### `get(key: string, defaultValue?: any): any`

Retrieves a value from the store.

```typescript
const theme = storeManager.get('settings.theme', 'light');
const user = storeManager.get('user', {});
```

**Parameters:**
- `key` (string): The key to retrieve
- `defaultValue` (any, optional): Default value if key doesn't exist

**Returns:** The stored value or default value

##### `set(key: string, value: any): Promise<void>`

Stores a value in the store.

```typescript
await storeManager.set('settings.theme', 'dark');
await storeManager.set('user.preferences', { notifications: true });
```

**Parameters:**
- `key` (string): The key to store the value under
- `value` (any): The value to store

**Throws:**
- `Error` if the operation fails

##### `delete(key: string): Promise<void>`

Removes a key from the store.

```typescript
await storeManager.delete('user.tempData');
```

**Parameters:**
- `key` (string): The key to remove

##### `has(key: string): boolean`

Checks if a key exists in the store.

```typescript
if (storeManager.has('settings.theme')) {
  // Key exists
}
```

**Parameters:**
- `key` (string): The key to check

**Returns:** `true` if the key exists, `false` otherwise

##### `clear(): Promise<void>`

Clears all data from the store.

```typescript
await storeManager.clear();
```

**Note:** This operation creates a backup before clearing.

##### `getAll(): object`

Retrieves all data from the store.

```typescript
const allData = storeManager.getAll();
console.log(allData.settings.theme);
```

**Returns:** Complete store data as an object

##### `setMultiple(data: object): Promise<void>`

Sets multiple key-value pairs at once.

```typescript
await storeManager.setMultiple({
  'settings.theme': 'dark',
  'settings.fontSize': 14,
  'user.name': 'John Doe'
});
```

**Parameters:**
- `data` (object): Object containing key-value pairs to set

##### `onChange(key: string, callback: Function): Function`

Registers a change listener for a specific key.

```typescript
const unsubscribe = storeManager.onChange('settings.theme', (newValue, oldValue, key) => {
  console.log(`${key} changed from ${oldValue} to ${newValue}`);
  updateUITheme(newValue);
});

// Later, to stop listening:
unsubscribe();
```

**Parameters:**
- `key` (string): The key to listen for changes on (use `'*'` for all changes)
- `callback` (Function): Callback function with signature `(newValue, oldValue, key)`

**Returns:** Unsubscribe function

##### `reloadStore(): Promise<void>`

Forces a reload of the store from disk.

```typescript
await storeManager.reloadStore();
```

##### `getStoreInfo(): object`

Gets information about the store.

```typescript
const info = storeManager.getStoreInfo();
// Returns: { path, size, keys, version, listeners }
```

**Returns:**
```typescript
{
  path: string,        // Path to the store file
  size: number,        // Number of keys in store
  keys: string[],      // Array of all keys
  version: string,     // Store version
  listeners: number    // Number of active listeners
}
```

##### `dispose(): void`

Cleans up resources and stops all operations.

```typescript
storeManager.dispose();
```

## Renderer Process API

### Store Service

The StoreService provides a high-level API for renderer processes with caching and reactive capabilities.

#### Constructor

```typescript
import StoreService from './services/StoreService';
const storeService = new StoreService();
```

#### Methods

##### `initialize(): Promise<void>`

Initializes the store service.

```typescript
await storeService.initialize();
```

##### `get(key: string, defaultValue?: any): Promise<any>`

Retrieves a value from the store with caching.

```typescript
const theme = await storeService.get('settings.theme', 'light');
```

##### `set(key: string, value: any): Promise<void>`

Stores a value in the store.

```typescript
await storeService.set('settings.theme', 'dark');
```

##### `delete(key: string): Promise<void>`

Removes a key from the store.

```typescript
await storeService.delete('user.tempData');
```

##### `has(key: string): Promise<boolean>`

Checks if a key exists.

```typescript
const exists = await storeService.has('settings.theme');
```

##### `clear(): Promise<void>`

Clears all data.

```typescript
await storeService.clear();
```

##### `getAll(): Promise<object>`

Gets all data.

```typescript
const allData = await storeService.getAll();
```

##### `setMultiple(data: object): Promise<void>`

Sets multiple values.

```typescript
await storeService.setMultiple({
  'settings.theme': 'dark',
  'settings.fontSize': 14
});
```

##### `subscribe(key: string, callback: Function): Function`

Subscribes to changes for a specific key.

```typescript
const unsubscribe = storeService.subscribe('settings.theme', (newValue, oldValue, key) => {
  updateUITheme(newValue);
});
```

##### `getSettings(): Promise<object>`

Gets application settings.

```typescript
const settings = await storeService.getSettings();
```

##### `updateSettings(updates: object): Promise<void>`

Updates application settings.

```typescript
await storeService.updateSettings({
  theme: 'dark',
  fontSize: 14
});
```

##### `getUserPreferences(): Promise<object>`

Gets user preferences.

```typescript
const prefs = await storeService.getUserPreferences();
```

##### `updateUserPreferences(updates: object): Promise<void>`

Updates user preferences.

```typescript
await storeService.updateUserPreferences({
  notifications: true,
  analytics: false
});
```

##### `getWorkspaceSettings(workspaceId: string): Promise<object>`

Gets settings for a specific workspace.

```typescript
const wsSettings = await storeService.getWorkspaceSettings('workspace-1');
```

##### `updateWorkspaceSettings(workspaceId: string, updates: object): Promise<void>`

Updates workspace settings.

```typescript
await storeService.updateWorkspaceSettings('workspace-1', {
  buildOnSave: true,
  autoRefresh: false
});
```

##### `getAIConfig(): Promise<object>`

Gets AI configuration.

```typescript
const aiConfig = await storeService.getAIConfig();
// Returns: { provider, model, apiKey, temperature, maxTokens }
```

##### `updateAIConfig(updates: object): Promise<void>`

Updates AI configuration.

```typescript
await storeService.updateAIConfig({
  provider: 'anthropic',
  model: 'claude-3'
});
```

## React Hooks API

### useStore Hook

A React hook for reactive store access.

```typescript
import { useStore } from './hooks/useStore';

function MyComponent() {
  const { value, loading, error, updateValue } = useStore('settings.theme', 'light');

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <select value={value} onChange={(e) => updateValue(e.target.value)}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
```

**Parameters:**
- `key` (string): The store key to watch
- `defaultValue` (any, optional): Default value if key doesn't exist

**Returns:**
```typescript
{
  value: any,           // Current value
  loading: boolean,     // Loading state
  error: Error | null,  // Error state
  updateValue: Function // Function to update the value
}
```

### Specialized Hooks

#### `useStoreSettings(): StoreHookResult`

Hook for application settings.

```typescript
const { value: settings, updateValue: updateSettings } = useStoreSettings();
```

#### `useStoreUserPrefs(): StoreHookResult`

Hook for user preferences.

```typescript
const { value: prefs, updateValue: updatePrefs } = useStoreUserPrefs();
```

#### `useStoreAIConfig(): StoreHookResult`

Hook for AI configuration.

```typescript
const { value: aiConfig, updateValue: updateAIConfig } = useStoreAIConfig();
```

#### `useStoreWorkspaceSettings(workspaceId: string): StoreHookResult`

Hook for workspace-specific settings.

```typescript
const { value: wsSettings, updateValue: updateWSSettings } = useStoreWorkspaceSettings('ws-1');
```

#### `useStoreBulk(): BulkStoreHookResult`

Hook for bulk operations.

```typescript
const { data, loading, updateMultiple } = useStoreBulk();

// Update multiple values at once
await updateMultiple({
  'settings.theme': 'dark',
  'settings.fontSize': 14,
  'user.name': 'John'
});
```

**Returns:**
```typescript
{
  data: object,         // All store data
  loading: boolean,     // Loading state
  updateMultiple: Function // Function to update multiple values
}
```

## IPC API

### Main Process IPC Handlers

The following IPC handlers are available for direct communication:

#### Basic Operations

- `store-get` - Get a value
- `store-set` - Set a value
- `store-delete` - Delete a key
- `store-has` - Check if key exists
- `store-clear` - Clear all data

#### Bulk Operations

- `store-get-all` - Get all data
- `store-set-multiple` - Set multiple values

#### Advanced Operations

- `store-info` - Get store information
- `store-reload` - Reload store from disk

#### Backup Operations

- `store-create-backup` - Create a backup
- `store-list-backups` - List all backups
- `store-restore-backup` - Restore from backup

#### Change Listeners

- `store-on-change` - Register change listener
- `store-off-change` - Unregister change listeners

### Renderer Process IPC API

The preload script exposes a secure API via `window.storeAPI`:

```typescript
// All methods return Promises
await window.storeAPI.get('key', defaultValue);
await window.storeAPI.set('key', value);
await window.storeAPI.delete('key');
await window.storeAPI.has('key');
await window.storeAPI.clear();

await window.storeAPI.getAll();
await window.storeAPI.setMultiple(data);

await window.storeAPI.getInfo();
await window.storeAPI.reload();

await window.storeAPI.createBackup(reason);
await window.storeAPI.listBackups();
await window.storeAPI.restoreBackup(backupPath);

// Change listeners
const unsubscribe = window.storeAPI.onChange('key', callback);
unsubscribe();

// Utility functions
window.storeAPI.getKey('nested.key');
window.storeAPI.setKey('nested.key', value);
```

## Data Schema

### Application Settings Schema

```typescript
interface Settings {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  autoSave: boolean;
  fontSize: number; // 8-24
  notifications: boolean;
  analytics: boolean;
}
```

### User Profile Schema

```typescript
interface User {
  name: string;
  email: string; // Must be valid email format
  preferences: {
    notifications: boolean;
    analytics: boolean;
    autoUpdate: boolean;
  };
}
```

### AI Configuration Schema

```typescript
interface AIConfig {
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  apiKey: string;
  temperature: number; // 0-2
  maxTokens: number; // 1-4096
  systemPrompt?: string;
}
```

### Workspace Configuration Schema

```typescript
interface Workspace {
  [workspaceId: string]: {
    path: string;
    name: string;
    settings: {
      buildOnSave: boolean;
      autoRefresh: boolean;
      templateRoot: string;
      outputDir: string;
    };
    lastOpened: string; // ISO date string
  };
}
```

### UI State Schema

```typescript
interface UIState {
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sidebarCollapsed: boolean;
  activePanels: string[];
  zoomLevel: number;
  lastViewedFiles: string[];
}
```

## Error Handling

### Error Types

#### `StoreInitializationError`

Thrown when the store fails to initialize.

```typescript
try {
  await storeManager.initialize();
} catch (error) {
  if (error.name === 'StoreInitializationError') {
    console.error('Failed to initialize store:', error.message);
  }
}
```

#### `StoreValidationError`

Thrown when data validation fails.

```typescript
try {
  await storeManager.set('invalid-key', invalidValue);
} catch (error) {
  if (error.name === 'StoreValidationError') {
    console.error('Validation failed:', error.details);
  }
}
```

#### `StoreBackupError`

Thrown when backup operations fail.

```typescript
try {
  await storeManager.backupManager.createBackup();
} catch (error) {
  if (error.name === 'StoreBackupError') {
    console.error('Backup failed:', error.message);
  }
}
```

### Error Recovery

```typescript
// Automatic retry with exponential backoff
async function retryOperation(operation, maxRetries = 3) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Usage
await retryOperation(() => storeManager.set('key', value));
```

## Performance Considerations

### Optimization Techniques

#### 1. Debounced Operations

```typescript
class DebouncedStore {
  constructor(storeManager) {
    this.storeManager = storeManager;
    this.debounceTimers = new Map();
  }

  async setDebounced(key, value, delay = 500) {
    return new Promise((resolve) => {
      // Clear existing timer
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }

      // Set new timer
      const timer = setTimeout(async () => {
        await this.storeManager.set(key, value);
        this.debounceTimers.delete(key);
        resolve();
      }, delay);

      this.debounceTimers.set(key, timer);
    });
  }
}
```

#### 2. Batch Operations

```typescript
// Instead of multiple individual sets:
await storeManager.set('key1', value1);
await storeManager.set('key2', value2);
await storeManager.set('key3', value3);

// Use batch operation:
await storeManager.setMultiple({
  key1: value1,
  key2: value2,
  key3: value3
});
```

#### 3. Selective Listening

```typescript
// Instead of listening to all changes:
storeManager.onChange('*', callback);

// Listen only to specific keys:
storeManager.onChange('settings.theme', themeCallback);
storeManager.onChange('user.preferences', prefsCallback);
```

### Performance Monitoring

```typescript
// Monitor store performance
const metrics = storeManager.performanceMonitor.getMetrics();
console.log('Store Performance:', {
  totalOperations: metrics.operations,
  averageLatency: metrics.averageTime,
  slowestOperation: metrics.slowestOperation,
  errorRate: (metrics.errorCount / metrics.operations) * 100
});
```

## Security Considerations

### Data Sanitization

```typescript
// Sanitize user input before storing
function sanitizeUserInput(input) {
  if (typeof input === 'string') {
    return input.replace(/[<>]/g, ''); // Basic XSS prevention
  }
  return input;
}

// Usage
const sanitizedName = sanitizeUserInput(userInput.name);
await storeManager.set('user.name', sanitizedName);
```

### Access Control

```typescript
// Implement access control for sensitive data
class SecureStore {
  constructor(storeManager, userPermissions) {
    this.storeManager = storeManager;
    this.permissions = userPermissions;
  }

  async setSecure(key, value) {
    if (!this.checkPermission(key, 'write')) {
      throw new Error('Access denied');
    }

    // Encrypt sensitive data
    if (this.isSensitiveKey(key)) {
      value = await this.encrypt(value);
    }

    return this.storeManager.set(key, value);
  }

  checkPermission(key, operation) {
    // Implement permission checking logic
    return this.permissions.can(key, operation);
  }

  isSensitiveKey(key) {
    const sensitiveKeys = ['ai.apiKey', 'user.password'];
    return sensitiveKeys.some(sensitive => key.includes(sensitive));
  }
}
```

## Migration and Versioning

### Schema Versioning

```typescript
// Define schema versions
const SCHEMA_VERSIONS = {
  '1.0.0': {
    settings: { theme: 'light' },
    user: { preferences: {} }
  },
  '1.1.0': {
    // Added new fields
    settings: { theme: 'light', fontSize: 14 },
    ai: { provider: 'openai' }
  }
};
```

### Migration Scripts

```typescript
const migrations = {
  '1.0.0-to-1.1.0': async (store) => {
    // Add new settings
    const currentSettings = store.get('settings', {});
    store.set('settings', {
      ...currentSettings,
      fontSize: 14
    });

    // Add AI config
    store.set('ai', {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: ''
    });
  }
};
```

### Automatic Migration

```typescript
async function migrateStore(store, fromVersion, toVersion) {
  const migrationKey = `${fromVersion}-to-${toVersion}`;

  if (migrations[migrationKey]) {
    console.log(`Running migration: ${migrationKey}`);
    await migrations[migrationKey](store);
    store.set('version', toVersion);
  }
}
```

This API reference provides comprehensive documentation for implementing and using the electron-store system in the TAD Electron application. The API is designed to be secure, performant, and easy to use across different parts of the application.