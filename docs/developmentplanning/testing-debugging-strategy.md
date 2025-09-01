# Testing and Debugging Strategy for Electron Migration

## Overview

This document outlines a comprehensive testing and debugging strategy for migrating TAD from a VS Code extension to a standalone Electron application. The strategy covers unit testing, integration testing, end-to-end testing, performance testing, and debugging approaches specific to the Electron platform.

## Current VS Code Testing Infrastructure

### Existing Test Coverage
```json
// package.json test scripts
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:e2e": "jest --config jest.e2e.config.js"
  }
}
```

### VS Code Extension Test Setup
```typescript
// src/test/runTest.ts
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions']
    });
  } catch (err) {
    console.error('Failed to run tests');
    process.exit(1);
  }
}
```

## Electron Testing Strategy

### Test Architecture Overview

#### 1. Multi-Layer Testing Pyramid
```
┌─────────────────┐
│   E2E Tests     │ ← User journey validation
│   (Spectron/    │
│    Playwright)  │
├─────────────────┤
│ Integration     │ ← Component interaction
│   Tests         │
├─────────────────┤
│ Unit Tests      │ ← Individual function testing
│   (Jest)        │
└─────────────────┘
```

#### 2. Test Categories
- **Unit Tests**: Individual functions, classes, and modules
- **Integration Tests**: IPC communication, file operations, build system
- **End-to-End Tests**: Complete user workflows in Electron
- **Performance Tests**: Memory usage, startup time, rendering performance
- **Security Tests**: File access validation, command execution safety
- **Cross-Platform Tests**: Windows, macOS, Linux compatibility

### Unit Testing Framework

#### 1. Jest Configuration for Electron
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/src/**/*.spec.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 10000,
  maxWorkers: '50%'
};
```

#### 2. Electron-Specific Test Setup
```typescript
// test/setup.ts
import { app } from 'electron';

// Mock Electron modules for unit tests
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(),
    getVersion: jest.fn(),
    on: jest.fn(),
    quit: jest.fn()
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    show: jest.fn(),
    close: jest.fn(),
    destroy: jest.fn(),
    webContents: {
      send: jest.fn(),
      on: jest.fn()
    }
  })),
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn()
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
    showMessageBox: jest.fn()
  }
}));

// Setup test environment
beforeAll(async () => {
  // Initialize test database or mocks
});

afterAll(async () => {
  // Cleanup test resources
});
```

#### 3. Main Process Testing
```typescript
// src/main/TADApplication.test.ts
import { TADApplication } from '../main/TADApplication';
import { WorkspaceManager } from '../main/WorkspaceManager';

jest.mock('../main/WorkspaceManager');
jest.mock('electron', () => ({
  app: {
    whenReady: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    quit: jest.fn(),
    getPath: jest.fn().mockReturnValue('/tmp/test'),
    getVersion: jest.fn().mockReturnValue('1.0.0')
  },
  BrowserWindow: jest.fn()
}));

describe('TADApplication', () => {
  let app: TADApplication;
  let mockWorkspaceManager: jest.Mocked<WorkspaceManager>;

  beforeEach(() => {
    mockWorkspaceManager = new WorkspaceManager() as jest.Mocked<WorkspaceManager>;
    app = new TADApplication();
  });

  afterEach(async () => {
    await app.dispose();
  });

  describe('initialization', () => {
    test('should initialize core managers', async () => {
      await app.initialize();

      expect(mockWorkspaceManager.initialize).toHaveBeenCalled();
    });

    test('should create main window', async () => {
      await app.initialize();

      expect(app.mainWindow).toBeDefined();
    });

    test('should setup IPC handlers', async () => {
      await app.initialize();

      // Verify IPC handlers are registered
      expect(ipcMain.handle).toHaveBeenCalledWith('get-app-info', expect.any(Function));
    });
  });

  describe('workspace management', () => {
    test('should handle workspace selection', async () => {
      const mockDialog = require('electron').dialog;
      mockDialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/workspace']
      });

      await app.selectWorkspace();

      expect(mockWorkspaceManager.setWorkspace).toHaveBeenCalledWith('/path/to/workspace');
    });
  });

  describe('error handling', () => {
    test('should handle initialization errors gracefully', async () => {
      mockWorkspaceManager.initialize.mockRejectedValue(new Error('Init failed'));

      await expect(app.initialize()).rejects.toThrow('Init failed');
    });
  });
});
```

### Integration Testing Framework

#### 1. IPC Communication Testing
```typescript
// test/integration/ipc.test.ts
import { ipcMain, ipcRenderer } from 'electron';
import { TADApplication } from '../../src/main/TADApplication';

describe('IPC Communication', () => {
  let app: TADApplication;

  beforeEach(async () => {
    app = new TADApplication();
    await app.initialize();
  });

  afterEach(async () => {
    await app.dispose();
  });

  describe('file operations', () => {
    test('should handle file read requests', async () => {
      const mockRenderer = {
        invoke: jest.fn().mockResolvedValue(undefined)
      };

      // Simulate renderer requesting file read
      const result = await mockRenderer.invoke('read-file', 'test.txt');

      expect(result).toBeDefined();
      // Verify file was read correctly
    });

    test('should handle file write requests', async () => {
      const testContent = 'Hello, World!';
      const testPath = 'test.txt';

      // Simulate renderer requesting file write
      await ipcRenderer.invoke('write-file', testPath, testContent);

      // Verify file was written
      const writtenContent = await fs.readFile(testPath, 'utf8');
      expect(writtenContent).toBe(testContent);
    });

    test('should reject unauthorized file access', async () => {
      const maliciousPath = '../../../etc/passwd';

      await expect(
        ipcRenderer.invoke('read-file', maliciousPath)
      ).rejects.toThrow('Access denied');
    });
  });

  describe('workspace operations', () => {
    test('should handle workspace changes', async () => {
      const newWorkspace = '/new/workspace/path';

      await ipcRenderer.invoke('set-workspace', newWorkspace);

      // Verify workspace was updated
      const workspaceInfo = await ipcRenderer.invoke('get-workspace-info');
      expect(workspaceInfo.path).toBe(newWorkspace);
    });
  });

  describe('build operations', () => {
    test('should handle build requests', async () => {
      const buildId = await ipcRenderer.invoke('build-templates');

      expect(buildId).toBeDefined();
      expect(typeof buildId).toBe('string');
    });

    test('should report build progress', async () => {
      const buildId = await ipcRenderer.invoke('build-templates');

      // Wait for build progress events
      await new Promise(resolve => {
        ipcRenderer.on('build-progress', (event, progress) => {
          expect(progress).toHaveProperty('buildId');
          expect(progress).toHaveProperty('status');
          resolve();
        });
      });
    });
  });
});
```

#### 2. File System Integration Testing
```typescript
// test/integration/filesystem.test.ts
import { WorkspaceManager } from '../../src/main/WorkspaceManager';
import { FileOperationManager } from '../../src/main/FileOperationManager';
import fs from 'fs/promises';
import path from 'path';

describe('File System Integration', () => {
  let workspaceManager: WorkspaceManager;
  let fileManager: FileOperationManager;
  let testWorkspace: string;

  beforeEach(async () => {
    testWorkspace = path.join(__dirname, 'test-workspace');
    await fs.mkdir(testWorkspace, { recursive: true });

    workspaceManager = new WorkspaceManager();
    fileManager = new FileOperationManager(workspaceManager);

    await workspaceManager.setWorkspace(testWorkspace);
  });

  afterEach(async () => {
    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  describe('template management', () => {
    test('should create and read templates', async () => {
      const templatePath = '.tad/templates/test.njk';
      const templateContent = `
{% set title = "Test Template" %}
<h1>{{ title }}</h1>
<p>This is a test template.</p>
`.trim();

      // Create template
      await fileManager.writeFile(templatePath, templateContent);

      // Read template
      const result = await fileManager.readFile(templatePath);

      expect(result.content).toBe(templateContent);
      expect(result.size).toBeGreaterThan(0);
    });

    test('should handle template dependencies', async () => {
      // Create component
      const componentPath = '.tad/templates/components/button.njk';
      const componentContent = `
{% macro button(props) %}
<button class="btn {{ props.variant or 'primary' }}">
  {{ props.label }}
</button>
{% endmacro %}
`.trim();

      // Create page that uses component
      const pagePath = '.tad/templates/index.njk';
      const pageContent = `
{% from "components/button.njk" import button %}
<!DOCTYPE html>
<html>
<body>
  {{ button({ label: "Click me" }) }}
</body>
</html>
`.trim();

      await fileManager.writeFile(componentPath, componentContent);
      await fileManager.writeFile(pagePath, pageContent);

      // Verify dependencies are tracked
      const pageInfo = await workspaceManager.getTemplateInfo(pagePath);
      expect(pageInfo.dependencies).toContain('components/button.njk');
    });
  });

  describe('build system integration', () => {
    test('should build templates successfully', async () => {
      // Create test templates
      const templatePath = '.tad/templates/index.njk';
      const templateContent = `
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><h1>Hello World</h1></body>
</html>
`.trim();

      await fileManager.writeFile(templatePath, templateContent);

      // Build templates
      const buildManager = require('../../src/main/BuildManager');
      const buildId = await buildManager.buildTemplates();

      // Wait for build completion
      await waitForBuildComplete(buildId);

      // Verify output
      const outputPath = '.tad/dist/index.html';
      const outputExists = await fileManager.fileExists(outputPath);
      expect(outputExists).toBe(true);

      const outputContent = await fileManager.readFile(outputPath);
      expect(outputContent).toContain('<h1>Hello World</h1>');
    });
  });

  describe('file watching', () => {
    test('should detect file changes', async () => {
      const templatePath = '.tad/templates/watch-test.njk';

      // Start watching
      const watcherId = await fileManager.watchFile(templatePath);

      // Create file
      await fileManager.writeFile(templatePath, 'initial content');

      // Wait for change detection
      const changeEvent = await waitForFileEvent(watcherId, 'add');

      expect(changeEvent.path).toBe(templatePath);
      expect(changeEvent.eventType).toBe('add');

      // Modify file
      await fileManager.writeFile(templatePath, 'modified content');

      const modifyEvent = await waitForFileEvent(watcherId, 'change');
      expect(modifyEvent.eventType).toBe('change');

      // Stop watching
      await fileManager.unwatchFile(watcherId);
    });
  });
});
```

### End-to-End Testing Framework

#### 1. Spectron/Playwright Setup
```typescript
// test/e2e/main.e2e.test.ts
import { Application } from 'spectron';
import { ElectronApplication, Page, _electron as electron } from 'playwright';
import path from 'path';

describe('TAD Application E2E', () => {
  let electronApp: ElectronApplication;
  let mainWindow: Page;

  beforeEach(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main.js')],
      env: {
        NODE_ENV: 'test'
      }
    });

    mainWindow = await electronApp.firstWindow();
    await mainWindow.waitForLoadState();
  });

  afterEach(async () => {
    await electronApp.close();
  });

  describe('application launch', () => {
    test('should launch successfully', async () => {
      const title = await mainWindow.title();
      expect(title).toBe('TAD - Template-Assisted Design');
    });

    test('should show main interface', async () => {
      const mainContent = await mainWindow.locator('.main-content');
      await expect(mainContent).toBeVisible();
    });
  });

  describe('workspace management', () => {
    test('should allow workspace selection', async () => {
      // Click workspace selector
      await mainWindow.click('#select-workspace');

      // Handle file dialog (mocked in test environment)
      // Verify workspace is loaded
      const workspaceInfo = await mainWindow.locator('.workspace-header');
      await expect(workspaceInfo).toBeVisible();
    });

    test('should display template tree', async () => {
      // Setup test workspace with templates
      await setupTestWorkspace();

      // Refresh workspace
      await mainWindow.click('#refresh-workspace');

      // Verify template tree is populated
      const templateTree = await mainWindow.locator('#template-tree');
      const templateItems = await templateTree.locator('.template-item');
      expect(await templateItems.count()).toBeGreaterThan(0);
    });
  });

  describe('template editing', () => {
    test('should open template in editor', async () => {
      // Click on template in tree
      await mainWindow.click('.template-item:first-child');

      // Verify editor window opens
      const windows = electronApp.windows();
      expect(windows.length).toBe(2); // Main + Editor

      const editorWindow = windows[1];
      const editorTitle = await editorWindow.title();
      expect(editorTitle).toContain('TAD Editor');
    });

    test('should save template changes', async () => {
      // Open template in editor
      await mainWindow.click('.template-item:first-child');
      const editorWindow = electronApp.windows()[1];

      // Modify content
      const editor = await editorWindow.locator('.editor-content');
      await editor.fill('Modified template content');

      // Save changes
      await editorWindow.click('#save-button');

      // Verify changes are saved
      const saveNotification = await editorWindow.locator('.save-notification');
      await expect(saveNotification).toBeVisible();
    });
  });

  describe('build system', () => {
    test('should build templates', async () => {
      // Click build button
      await mainWindow.click('#build-templates');

      // Wait for build completion
      const buildProgress = await mainWindow.locator('.build-progress');
      await expect(buildProgress).toBeVisible();

      // Verify build success
      const buildStatus = await mainWindow.locator('.build-status');
      await expect(buildStatus).toContainText('Build completed');
    });

    test('should open canvas after build', async () => {
      // Build templates
      await mainWindow.click('#build-templates');

      // Click open canvas
      await mainWindow.click('#open-canvas');

      // Verify canvas window opens
      const windows = electronApp.windows();
      expect(windows.length).toBe(2); // Main + Canvas

      const canvasWindow = windows[1];
      const canvasTitle = await canvasWindow.title();
      expect(canvasTitle).toBe('TAD Canvas');
    });
  });

  describe('canvas interaction', () => {
    let canvasWindow: Page;

    beforeEach(async () => {
      // Open canvas
      await mainWindow.click('#open-canvas');
      canvasWindow = electronApp.windows()[1];
    });

    test('should display design frames', async () => {
      const frames = await canvasWindow.locator('.design-frame');
      expect(await frames.count()).toBeGreaterThan(0);
    });

    test('should allow frame selection', async () => {
      const firstFrame = await canvasWindow.locator('.design-frame').first();
      await firstFrame.click();

      // Verify frame is selected
      await expect(firstFrame).toHaveClass('selected');
    });

    test('should support zoom controls', async () => {
      const zoomIn = await canvasWindow.locator('#zoom-in');
      const zoomLevel = await canvasWindow.locator('#zoom-level');

      const initialZoom = await zoomLevel.textContent();

      await zoomIn.click();

      const newZoom = await zoomLevel.textContent();
      expect(newZoom).not.toBe(initialZoom);
    });

    test('should allow frame repositioning', async () => {
      const frame = await canvasWindow.locator('.design-frame').first();

      // Get initial position
      const initialBox = await frame.boundingBox();

      // Drag frame
      await frame.dragTo(canvasWindow.locator('#canvas-container'), {
        targetPosition: { x: 100, y: 100 }
      });

      // Verify position changed
      const newBox = await frame.boundingBox();
      expect(newBox.x).not.toBe(initialBox.x);
      expect(newBox.y).not.toBe(initialBox.y);
    });
  });

  describe('chat functionality', () => {
    test('should send chat messages', async () => {
      const chatInput = await mainWindow.locator('#chat-input');
      const sendButton = await mainWindow.locator('#send-button');

      await chatInput.fill('Hello, TAD!');
      await sendButton.click();

      // Verify message appears in chat
      const messages = await mainWindow.locator('.chat-messages .message');
      expect(await messages.count()).toBeGreaterThan(0);

      const lastMessage = await messages.last();
      await expect(lastMessage).toContainText('Hello, TAD!');
    });

    test('should handle AI responses', async () => {
      // Send message
      await mainWindow.fill('#chat-input', 'Create a button component');
      await mainWindow.click('#send-button');

      // Wait for AI response
      await mainWindow.waitForSelector('.message.assistant');

      // Verify response contains expected content
      const aiResponse = await mainWindow.locator('.message.assistant').last();
      await expect(aiResponse).toBeVisible();
    });
  });

  describe('error handling', () => {
    test('should handle build failures gracefully', async () => {
      // Create invalid template
      await createInvalidTemplate();

      // Attempt build
      await mainWindow.click('#build-templates');

      // Verify error is displayed
      const errorMessage = await mainWindow.locator('.error-message');
      await expect(errorMessage).toBeVisible();
    });

    test('should handle network errors', async () => {
      // Disconnect network (mock)
      await mockNetworkDisconnect();

      // Try AI chat
      await mainWindow.fill('#chat-input', 'Test message');
      await mainWindow.click('#send-button');

      // Verify error handling
      const errorMessage = await mainWindow.locator('.chat-error');
      await expect(errorMessage).toContainText('network');
    });
  });
});
```

### Performance Testing Framework

#### 1. Startup Performance Testing
```typescript
// test/performance/startup.test.ts
import { Application } from 'spectron';
import { performance } from 'perf_hooks';

describe('Startup Performance', () => {
  let app: Application;

  beforeEach(async () => {
    const startTime = performance.now();

    app = new Application({
      path: require('electron'),
      args: [require('path').join(__dirname, '../../dist/main.js')]
    });

    await app.start();

    const endTime = performance.now();
    console.log(`Application startup time: ${endTime - startTime}ms`);
  });

  afterEach(async () => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  test('should start within acceptable time', async () => {
    const startTime = performance.now();

    await app.client.waitUntilWindowLoaded();

    const loadTime = performance.now() - startTime;
    expect(loadTime).toBeLessThan(5000); // 5 seconds max
  });

  test('should render main interface quickly', async () => {
    const startTime = performance.now();

    await app.client.waitForVisible('.main-content');

    const renderTime = performance.now() - startTime;
    expect(renderTime).toBeLessThan(2000); // 2 seconds max
  });

  test('should initialize workspace management promptly', async () => {
    const startTime = performance.now();

    await app.client.waitForVisible('.workspace-view');

    const initTime = performance.now() - startTime;
    expect(initTime).toBeLessThan(1000); // 1 second max
  });
});
```

#### 2. Memory Usage Testing
```typescript
// test/performance/memory.test.ts
import { Application } from 'spectron';

describe('Memory Usage', () => {
  let app: Application;

  beforeEach(async () => {
    app = new Application({
      path: require('electron'),
      args: [require('path').join(__dirname, '../../dist/main.js')]
    });

    await app.start();
    await app.client.waitUntilWindowLoaded();
  });

  afterEach(async () => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  test('should maintain reasonable memory usage', async () => {
    // Wait for application to stabilize
    await app.client.pause(5000);

    const metrics = await app.electron.remote.app.getAppMetrics();
    const mainProcess = metrics.find(p => p.type === 'Browser');

    expect(mainProcess.memory.workingSetSize).toBeLessThan(200 * 1024 * 1024); // 200MB
    expect(mainProcess.memory.privateBytes).toBeLessThan(150 * 1024 * 1024); // 150MB
  });

  test('should handle memory pressure gracefully', async () => {
    // Load large workspace
    await loadLargeWorkspace(app);

    // Monitor memory usage
    const initialMetrics = await app.electron.remote.app.getAppMetrics();
    const initialMemory = initialMetrics[0].memory.workingSetSize;

    // Perform memory-intensive operations
    await performMemoryIntensiveOperations(app);

    // Check memory hasn't grown excessively
    const finalMetrics = await app.electron.remote.app.getAppMetrics();
    const finalMemory = finalMetrics[0].memory.workingSetSize;

    const growth = finalMemory - initialMemory;
    expect(growth).toBeLessThan(50 * 1024 * 1024); // 50MB max growth
  });

  test('should cleanup memory properly', async () => {
    // Perform operations that create objects
    await createManyObjects(app);

    // Force garbage collection (if available)
    if (global.gc) {
      global.gc();
    }

    // Wait for cleanup
    await app.client.pause(2000);

    // Verify memory is reasonable
    const metrics = await app.electron.remote.app.getAppMetrics();
    expect(metrics[0].memory.workingSetSize).toBeLessThan(250 * 1024 * 1024); // 250MB
  });
});
```

### Cross-Platform Testing

#### 1. Platform-Specific Test Configuration
```typescript
// test/cross-platform/config.js
const path = require('path');

const platformConfigs = {
  win32: {
    electronPath: require('electron'),
    testWorkspace: path.join(process.env.TEMP, 'tad-test'),
    expectedBehavior: {
      fileDialog: 'windows-style',
      menuBar: 'visible',
      shortcuts: 'ctrl-based'
    }
  },
  darwin: {
    electronPath: require('electron'),
    testWorkspace: path.join('/tmp', 'tad-test'),
    expectedBehavior: {
      fileDialog: 'macos-style',
      menuBar: 'native',
      shortcuts: 'cmd-based'
    }
  },
  linux: {
    electronPath: require('electron'),
    testWorkspace: path.join('/tmp', 'tad-test'),
    expectedBehavior: {
      fileDialog: 'linux-style',
      menuBar: 'visible',
      shortcuts: 'ctrl-based'
    }
  }
};

module.exports = {
  getPlatformConfig() {
    return platformConfigs[process.platform] || platformConfigs.linux;
  },

  getTestWorkspace() {
    const config = this.getPlatformConfig();
    return config.testWorkspace;
  }
};
```

#### 2. Cross-Platform Test Suite
```typescript
// test/cross-platform/integration.test.ts
const { getPlatformConfig } = require('./config');

describe('Cross-Platform Integration', () => {
  const platformConfig = getPlatformConfig();

  describe('File Dialogs', () => {
    test('should show appropriate file dialog', async () => {
      // Test file dialog behavior
      const dialogResult = await showFileDialog();

      // Verify dialog matches platform expectations
      expect(dialogResult.style).toBe(platformConfig.expectedBehavior.fileDialog);
    });
  });

  describe('Keyboard Shortcuts', () => {
    test('should use correct modifier keys', async () => {
      // Test keyboard shortcuts
      const shortcuts = getApplicationShortcuts();

      if (platformConfig.expectedBehavior.shortcuts === 'cmd-based') {
        expect(shortcuts.save).toContain('Cmd');
      } else {
        expect(shortcuts.save).toContain('Ctrl');
      }
    });
  });

  describe('Menu System', () => {
    test('should display appropriate menu bar', async () => {
      const menuVisible = await isMenuBarVisible();

      if (platformConfig.expectedBehavior.menuBar === 'native') {
        // macOS has native menu integration
        expect(menuVisible).toBe(false); // Hidden in favor of native menu
      } else {
        expect(menuVisible).toBe(true);
      }
    });
  });

  describe('File System Operations', () => {
    test('should handle platform-specific path separators', async () => {
      const testPath = 'folder/file.txt';
      const resolvedPath = resolvePlatformPath(testPath);

      // Verify path uses correct separators
      if (process.platform === 'win32') {
        expect(resolvedPath).toContain('\\');
      } else {
        expect(resolvedPath).toContain('/');
      }
    });

    test('should respect platform file permissions', async () => {
      const testFile = await createTestFile();

      if (process.platform === 'win32') {
        // Windows permissions are different
        expect(await hasWindowsPermissions(testFile)).toBe(true);
      } else {
        // Unix-like permissions
        expect(await hasUnixPermissions(testFile)).toBe(true);
      }
    });
  });

  describe('Window Management', () => {
    test('should handle platform-specific window behaviors', async () => {
      const window = await createTestWindow();

      if (process.platform === 'darwin') {
        // macOS has different window behaviors
        expect(await window.hasNativeTrafficLight()).toBe(true);
      }

      // Test window controls positioning
      const controlsPosition = await getWindowControlsPosition();
      expect(controlsPosition).toMatchPlatformExpectation();
    });
  });
});
```

### Debugging Strategy

#### 1. Development Tools Setup
```typescript
// .vscode/launch.json for Electron debugging
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd"
      },
      "args": ["."],
      "outputCapture": "std"
    },
    {
      "name": "Debug Renderer Process",
      "type": "chrome",
      "request": "launch",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd"
      },
      "args": ["."],
      "webRoot": "${workspaceFolder}/src/renderer"
    },
    {
      "name": "Attach to Renderer",
      "type": "chrome",
      "request": "attach",
      "port": 9222,
      "webRoot": "${workspaceFolder}/src/renderer"
    }
  ]
}
```

#### 2. Logging and Monitoring
```typescript
// src/main/Logger.js
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    this.logFile = path.join(app.getPath('userData'), 'debug.log');
    this.maxLogSize = 10 * 1024 * 1024; // 10MB
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  async log(level, message, meta = {}) {
    if (!this.shouldLog(level)) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
      process: {
        type: process.type || 'main',
        pid: process.pid,
        platform: process.platform
      }
    };

    console.log(`[${level.toUpperCase()}] ${message}`, meta);

    // Write to file
    await this.writeToFile(logEntry);

    // Send to renderer for debugging
    if (process.type === 'browser') {
      // Send to all windows
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('log-entry', logEntry);
      });
    }
  }

  shouldLog(level) {
    const levels = ['error', 'warn', 'info', 'debug'];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);

    return messageIndex <= currentIndex;
  }

  async writeToFile(entry) {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.logFile, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  // Convenience methods
  error(message, meta) { return this.log('error', message, meta); }
  warn(message, meta) { return this.log('warn', message, meta); }
  info(message, meta) { return this.log('info', message, meta); }
  debug(message, meta) { return this.log('debug', message, meta); }

  // Performance logging
  time(label) {
    this.startTimes = this.startTimes || new Map();
    this.startTimes.set(label, process.hrtime.bigint());
  }

  timeEnd(label) {
    if (!this.startTimes?.has(label)) return;

    const start = this.startTimes.get(label);
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1e6; // Convert to milliseconds

    this.debug(`${label} took ${duration.toFixed(2)}ms`);
    this.startTimes.delete(label);
  }
}

module.exports = new Logger();
```

#### 3. Error Reporting and Crash Handling
```typescript
// src/main/ErrorHandler.js
const { crashReporter, dialog } = require('electron');
const Logger = require('./Logger');

class ErrorHandler {
  constructor() {
    this.setupCrashReporter();
    this.setupGlobalErrorHandlers();
    this.setupRendererErrorHandlers();
  }

  setupCrashReporter() {
    crashReporter.start({
      productName: 'TAD',
      companyName: 'TAD Team',
      submitURL: 'https://your-domain.com/crash-reports',
      uploadToServer: true,
      ignoreSystemCrashHandler: false
    });
  }

  setupGlobalErrorHandlers() {
    process.on('uncaughtException', (error) => {
      Logger.error('Uncaught Exception:', {
        error: error.message,
        stack: error.stack
      });

      this.showErrorDialog('Uncaught Exception', error.message);
    });

    process.on('unhandledRejection', (reason, promise) => {
      Logger.error('Unhandled Rejection:', {
        reason: reason?.message || reason,
        promise: promise.toString()
      });

      this.showErrorDialog('Unhandled Promise Rejection', reason?.message || 'Unknown error');
    });
  }

  setupRendererErrorHandlers() {
    // Handle renderer process crashes
    app.on('renderer-process-crashed', (event, webContents, killed) => {
      Logger.error('Renderer Process Crashed:', {
        killed,
        url: webContents.getURL(),
        title: webContents.getTitle()
      });

      this.handleRendererCrash(webContents);
    });

    // Handle GPU process crashes
    app.on('gpu-process-crashed', (event, killed) => {
      Logger.error('GPU Process Crashed:', { killed });
    });
  }

  showErrorDialog(title, message) {
    dialog.showErrorBox(title, message);
  }

  async handleRendererCrash(webContents) {
    const choice = await dialog.showMessageBox(null, {
      type: 'error',
      title: 'Renderer Process Crashed',
      message: 'The application encountered an error. What would you like to do?',
      buttons: ['Reload', 'Quit', 'Ignore'],
      defaultId: 0,
      cancelId: 2
    });

    switch (choice.response) {
      case 0: // Reload
        webContents.reload();
        break;
      case 1: // Quit
        app.quit();
        break;
      case 2: // Ignore
        // Do nothing
        break;
    }
  }

  // Development error overlay
  setupDevErrorOverlay() {
    if (process.env.NODE_ENV === 'development') {
      // Show error overlay in development
      app.on('renderer-process-crashed', (event, webContents) => {
        webContents.loadURL(`data:text/html,
          <html>
            <body style="background: #f44336; color: white; font-family: Arial;">
              <h1>Renderer Process Crashed</h1>
              <p>Check the console for more details.</p>
              <button onclick="location.reload()">Reload</button>
            </body>
          </html>
        `);
      });
    }
  }
}

module.exports = ErrorHandler;
```

### Continuous Integration and Testing

#### 1. CI/CD Pipeline Configuration
```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node-version: [18.x, 20.x]

    runs-on: ${{ matrix.os }}

    steps:
    - uses: actions/checkout@v3

    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}

    - name: Install dependencies
      run: npm ci

    - name: Run unit tests
      run: npm run test:unit

    - name: Run integration tests
      run: npm run test:integration

    - name: Run E2E tests
      run: npm run test:e2e
      if: matrix.os == 'ubuntu-latest' # Only run E2E on Linux for speed

    - name: Upload test results
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: test-results-${{ matrix.os }}-${{ matrix.node-version }}
        path: |
          coverage/
          test-results/
          screenshots/

  performance:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3

    - name: Run performance tests
      run: npm run test:performance

    - name: Upload performance results
      uses: actions/upload-artifact@v3
      with:
        name: performance-results
        path: performance-results/

  security:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3

    - name: Run security tests
      run: npm run test:security

    - name: Security audit
      run: npm audit --audit-level high
```

#### 2. Test Reporting and Analytics
```typescript
// test/utils/TestReporter.js
const fs = require('fs').promises;
const path = require('path');

class TestReporter {
  constructor() {
    this.results = {
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0
      },
      suites: [],
      startTime: Date.now()
    };
  }

  onTestStart(test) {
    console.log(`Starting test: ${test.title}`);
  }

  onTestPass(test) {
    this.results.summary.passed++;
    console.log(`✓ ${test.title} (${test.duration}ms)`);
  }

  onTestFail(test, error) {
    this.results.summary.failed++;
    console.log(`✗ ${test.title} (${test.duration}ms)`);
    console.log(`  Error: ${error.message}`);
  }

  onTestSkip(test) {
    this.results.summary.skipped++;
    console.log(`- ${test.title} (skipped)`);
  }

  onSuiteStart(suite) {
    this.results.suites.push({
      title: suite.title,
      tests: [],
      startTime: Date.now()
    });
  }

  onSuiteEnd(suite) {
    const suiteResult = this.results.suites[this.results.suites.length - 1];
    suiteResult.duration = Date.now() - suiteResult.startTime;
  }

  async generateReport() {
    this.results.summary.duration = Date.now() - this.results.startTime;
    this.results.summary.total = this.results.summary.passed +
                                this.results.summary.failed +
                                this.results.summary.skipped;

    // Generate HTML report
    const htmlReport = this.generateHTMLReport();

    // Generate JSON report
    const jsonReport = JSON.stringify(this.results, null, 2);

    // Write reports
    await fs.mkdir('test-results', { recursive: true });
    await fs.writeFile('test-results/report.html', htmlReport);
    await fs.writeFile('test-results/report.json', jsonReport);

    // Print summary
    console.log('\n=== Test Results ===');
    console.log(`Total: ${this.results.summary.total}`);
    console.log(`Passed: ${this.results.summary.passed}`);
    console.log(`Failed: ${this.results.summary.failed}`);
    console.log(`Skipped: ${this.results.summary.skipped}`);
    console.log(`Duration: ${this.results.summary.duration}ms`);

    return this.results;
  }

  generateHTMLReport() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>TAD Test Results</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .passed { color: #4CAF50; }
        .failed { color: #f44336; }
        .skipped { color: #ff9800; }
        .suite { margin: 20px 0; }
        .test { margin: 5px 0; padding-left: 20px; }
    </style>
</head>
<body>
    <h1>TAD Test Results</h1>

    <div class="summary">
        <h2>Summary</h2>
        <p>Total Tests: ${this.results.summary.total}</p>
        <p class="passed">Passed: ${this.results.summary.passed}</p>
        <p class="failed">Failed: ${this.results.summary.failed}</p>
        <p class="skipped">Skipped: ${this.results.summary.skipped}</p>
        <p>Duration: ${this.results.summary.duration}ms</p>
    </div>

    <div class="suites">
        <h2>Test Suites</h2>
        ${this.results.suites.map(suite => `
            <div class="suite">
                <h3>${suite.title}</h3>
                <p>Duration: ${suite.duration}ms</p>
                <div class="tests">
                    ${suite.tests.map(test => `
                        <div class="test ${test.state}">${test.title}</div>
                    `).join('')}
                </div>
            </div>
        `).join('')}
    </div>
</body>
</html>`;
  }
}

module.exports = TestReporter;
```

## Conclusion

This comprehensive testing and debugging strategy ensures the Electron migration maintains TAD's reliability and performance while providing a robust foundation for future development. The multi-layered approach covers:

- **Unit Tests**: Individual component validation
- **Integration Tests**: IPC and file system interaction
- **End-to-End Tests**: Complete user workflow validation
- **Performance Tests**: Startup time and memory usage monitoring
- **Cross-Platform Tests**: Windows, macOS, and Linux compatibility
- **Security Tests**: File access and command execution validation

The debugging infrastructure provides:
- **Development Tools**: VS Code integration for main and renderer debugging
- **Logging System**: Comprehensive application logging
- **Error Handling**: Crash reporting and recovery
- **Performance Monitoring**: Memory and CPU usage tracking

This strategy ensures the Electron version of TAD meets or exceeds the quality standards of the VS Code extension while providing a seamless standalone desktop experience.