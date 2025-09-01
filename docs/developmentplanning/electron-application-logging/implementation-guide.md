# Electron Timber Logging Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing electron-timber logging in the TAD Electron application. It covers installation, configuration, and integration across main and renderer processes.

## Prerequisites

### Dependencies Installation

```bash
# Install electron-timber and required dependencies
pnpm add electron-timber winston winston-daily-rotate-file
pnpm add -D @types/winston

# Verify installation
pnpm list electron-timber winston winston-daily-rotate-file
```

### Project Structure Setup

```
src/
├── main/
│   ├── logger/
│   │   ├── MainLogger.ts
│   │   ├── LoggerConfig.ts
│   │   └── LogTransport.ts
│   └── processes/
│       └── LoggerIPC.ts
├── renderer/
│   ├── logger/
│   │   ├── RendererLogger.ts
│   │   └── LoggerBridge.ts
│   └── components/
│       └── LogViewer.ts
├── shared/
│   └── types/
│       └── logging.ts
└── preload/
    └── logging-preload.ts
```

## Step 1: Core Logger Configuration

### 1.1 Environment Detection

```typescript
// src/shared/utils/environment.ts
export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';

export const getLogLevel = (): string => {
  if (isDevelopment) return 'silly';
  if (isTest) return 'error';
  return 'info';
};

export const shouldEnableConsole = (): boolean => {
  return isDevelopment || process.env.FORCE_CONSOLE_LOGGING === 'true';
};
```

### 1.2 Logging Types and Interfaces

```typescript
// src/shared/types/logging.ts
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silly';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: any;
  processId?: string;
  component?: string;
  userId?: string;
  sessionId?: string;
}

export interface LoggingConfig {
  level: LogLevel;
  separationMode: 'process' | 'unified';
  console: {
    enabled: boolean;
    format: 'pretty' | 'json';
  };
  file: {
    enabled: boolean;
    directory: string;
    rotation: {
      frequency: 'daily' | 'hourly';
      maxSize: string;
      maxFiles: string;
    };
    retention: {
      maxAge: string;
      compressOld: boolean;
    };
  };
  ipc: {
    enabled: boolean;
    bufferSize: number;
  };
}

export interface Logger {
  error(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
  trace(message: string, meta?: any): void;
  silly(message: string, meta?: any): void;

  child(meta: any): Logger;
  time(label: string): void;
  timeEnd(label: string): void;
}
```

## Step 2: Main Process Logger Implementation

### 2.1 Main Logger Class

```typescript
// src/main/logger/MainLogger.ts
import { Logger as ElectronLogger } from 'electron-timber';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { app } from 'electron';
import { LoggingConfig, LogLevel } from '../../shared/types/logging';
import { isDevelopment, shouldEnableConsole } from '../../shared/utils/environment';

export class MainLogger implements Logger {
  private logger: ElectronLogger;
  private winstonLogger: winston.Logger;
  private config: LoggingConfig;
  private timers: Map<string, bigint> = new Map();

  constructor(config?: Partial<LoggingConfig>) {
    this.config = this.createDefaultConfig(config);
    this.initializeLogger();
  }

  private createDefaultConfig(userConfig?: Partial<LoggingConfig>): LoggingConfig {
    const userDataPath = app.getPath('userData');

    return {
      level: (process.env.LOG_LEVEL as LogLevel) || 'info',
      separationMode: 'unified',
      console: {
        enabled: shouldEnableConsole(),
        format: isDevelopment ? 'pretty' : 'json'
      },
      file: {
        enabled: true,
        directory: path.join(userDataPath, 'logs'),
        rotation: {
          frequency: 'daily',
          maxSize: '20m',
          maxFiles: '14d'
        },
        retention: {
          maxAge: '30d',
          compressOld: true
        }
      },
      ipc: {
        enabled: true,
        bufferSize: 1000
      },
      ...userConfig
    };
  }

  private initializeLogger() {
    // Create Winston logger for advanced features
    this.winstonLogger = this.createWinstonLogger();

    // Create Electron Timber logger
    this.logger = Logger.create({
      name: 'TAD-Main',
      level: this.config.level,
      transports: this.createTransports()
    });
  }

  private createWinstonLogger(): winston.Logger {
    const transports: winston.transport[] = [];

    // File transport with daily rotation
    if (this.config.file.enabled) {
      transports.push(new winston.transports.DailyRotateFile({
        filename: path.join(this.config.file.directory, 'tad-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: this.config.file.rotation.maxSize,
        maxFiles: this.config.file.rotation.maxFiles,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      }));

      // Error-only file
      transports.push(new winston.transports.DailyRotateFile({
        filename: path.join(this.config.file.directory, 'errors-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '10m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      }));
    }

    return winston.createLogger({
      level: this.config.level,
      transports
    });
  }

  private createTransports() {
    const transports = [];

    // Console transport for development
    if (this.config.console.enabled) {
      transports.push(Logger.transports.console({
        level: this.config.level,
        format: this.config.console.format === 'pretty'
          ? Logger.formats.pretty()
          : Logger.formats.json()
      }));
    }

    // IPC transport for renderer communication
    if (this.config.ipc.enabled) {
      transports.push(new Logger.transports.IPC({
        level: this.config.level
      }));
    }

    return transports;
  }

  // Logging methods
  error(message: string, meta?: any): void {
    this.logger.error(message, meta);
    this.winstonLogger.error(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
    this.winstonLogger.warn(message, meta);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
    this.winstonLogger.info(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
    this.winstonLogger.debug(message, meta);
  }

  trace(message: string, meta?: any): void {
    this.logger.trace(message, meta);
    this.winstonLogger.log('trace', message, meta);
  }

  silly(message: string, meta?: any): void {
    this.logger.silly(message, meta);
    this.winstonLogger.log('silly', message, meta);
  }

  // Performance timing
  time(label: string): void {
    this.timers.set(label, process.hrtime.bigint());
    this.debug(`Timer started: ${label}`);
  }

  timeEnd(label: string): void {
    const start = this.timers.get(label);
    if (start) {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1e6; // Convert to milliseconds
      this.timers.delete(label);
      this.info(`Timer ended: ${label}`, { duration: `${duration.toFixed(2)}ms` });
    }
  }

  // Child logger
  child(meta: any): Logger {
    const childLogger = this.logger.child(meta);
    const childWinston = this.winstonLogger.child(meta);

    return {
      error: (msg, m) => { childLogger.error(msg, m); childWinston.error(msg, m); },
      warn: (msg, m) => { childLogger.warn(msg, m); childWinston.warn(msg, m); },
      info: (msg, m) => { childLogger.info(msg, m); childWinston.info(msg, m); },
      debug: (msg, m) => { childLogger.debug(msg, m); childWinston.debug(msg, m); },
      trace: (msg, m) => { childLogger.trace(msg, m); childWinston.log('trace', msg, m); },
      silly: (msg, m) => { childLogger.silly(msg, m); childWinston.log('silly', msg, m); },
      child: (m) => this.child({ ...meta, ...m }),
      time: (label) => this.time(label),
      timeEnd: (label) => this.timeEnd(label)
    };
  }

  // Configuration management
  updateConfig(newConfig: Partial<LoggingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.reinitializeLogger();
  }

  private reinitializeLogger(): void {
    // Close existing loggers
    if (this.winstonLogger) {
      this.winstonLogger.end();
    }

    // Reinitialize
    this.initializeLogger();
  }

  // Cleanup
  dispose(): void {
    if (this.winstonLogger) {
      this.winstonLogger.end();
    }
    this.timers.clear();
  }
}
```

### 2.2 Logger Configuration Manager

```typescript
// src/main/logger/LoggerConfig.ts
import { LoggingConfig } from '../../shared/types/logging';
import { Store } from 'electron-store';

export class LoggerConfigManager {
  private store: Store;

  constructor() {
    this.store = new Store({
      name: 'logging-config',
      defaults: this.getDefaultConfig()
    });
  }

  getConfig(): LoggingConfig {
    return this.store.store as LoggingConfig;
  }

  updateConfig(config: Partial<LoggingConfig>): void {
    this.store.set(config);
  }

  resetConfig(): void {
    this.store.clear();
  }

  private getDefaultConfig(): LoggingConfig {
    return {
      level: process.env.NODE_ENV === 'development' ? 'silly' : 'info',
      separationMode: 'unified',
      console: {
        enabled: process.env.NODE_ENV === 'development',
        format: process.env.NODE_ENV === 'development' ? 'pretty' : 'json'
      },
      file: {
        enabled: true,
        directory: '', // Will be set to userData/logs
        rotation: {
          frequency: 'daily',
          maxSize: '20m',
          maxFiles: '14d'
        },
        retention: {
          maxAge: '30d',
          compressOld: true
        }
      },
      ipc: {
        enabled: true,
        bufferSize: 1000
      }
    };
  }
}
```

## Step 3: Renderer Process Logger Implementation

### 3.1 Renderer Logger Class

```typescript
// src/renderer/logger/RendererLogger.ts
import { Logger as ElectronLogger } from 'electron-timber';
import { Logger, LogLevel } from '../../shared/types/logging';

export class RendererLogger implements Logger {
  private logger: ElectronLogger;
  private processId: string;
  private timers: Map<string, number> = new Map();

  constructor(processId: string = 'main') {
    this.processId = processId;
    this.initializeLogger();
    this.setupConsoleOverride();
  }

  private initializeLogger() {
    this.logger = Logger.create({
      name: `TAD-Renderer-${this.processId}`,
      level: this.getLogLevel(),
      format: this.getLogFormat()
    });
  }

  private getLogLevel(): LogLevel {
    return (window as any).electronAPI?.getLogLevel?.() || 'info';
  }

  private getLogFormat() {
    return process.env.NODE_ENV === 'development'
      ? Logger.formats.pretty()
      : Logger.formats.json();
  }

  private setupConsoleOverride() {
    // Store original console methods
    const originalConsole = { ...console };

    // Override console methods to also log via IPC
    ['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
      console[level] = (...args: any[]) => {
        // Call original console method
        originalConsole[level](...args);

        // Send to main process logger
        this.sendToMainProcess(level, args.join(' '));
      };
    });
  }

  private sendToMainProcess(level: string, message: string) {
    if ((window as any).electronAPI?.sendLog) {
      (window as any).electronAPI.sendLog({
        level,
        message,
        processId: this.processId,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
      });
    }
  }

  // Logging methods
  error(message: string, meta?: any): void {
    this.logger.error(message, { ...meta, processId: this.processId });
    this.sendToMainProcess('error', message);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, { ...meta, processId: this.processId });
    this.sendToMainProcess('warn', message);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, { ...meta, processId: this.processId });
    this.sendToMainProcess('info', message);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, { ...meta, processId: this.processId });
    this.sendToMainProcess('debug', message);
  }

  trace(message: string, meta?: any): void {
    this.logger.log('trace', message, { ...meta, processId: this.processId });
    this.sendToMainProcess('trace', message);
  }

  silly(message: string, meta?: any): void {
    this.logger.log('silly', message, { ...meta, processId: this.processId });
    this.sendToMainProcess('silly', message);
  }

  // Performance timing
  time(label: string): void {
    this.timers.set(label, performance.now());
    this.debug(`Timer started: ${label}`);
  }

  timeEnd(label: string): void {
    const start = this.timers.get(label);
    if (start !== undefined) {
      const duration = performance.now() - start;
      this.timers.delete(label);
      this.info(`Timer ended: ${label}`, { duration: `${duration.toFixed(2)}ms` });
    }
  }

  // Child logger
  child(meta: any): Logger {
    const childLogger = this.logger.child(meta);
    const childProcessId = `${this.processId}:${meta.component || 'unknown'}`;

    return {
      error: (msg, m) => this.error(msg, { ...meta, ...m }),
      warn: (msg, m) => this.warn(msg, { ...meta, ...m }),
      info: (msg, m) => this.info(msg, { ...meta, ...m }),
      debug: (msg, m) => this.debug(msg, { ...meta, ...m }),
      trace: (msg, m) => this.trace(msg, { ...meta, ...m }),
      silly: (msg, m) => this.silly(msg, { ...meta, ...m }),
      child: (m) => this.child({ ...meta, ...m }),
      time: (label) => this.time(label),
      timeEnd: (label) => this.timeEnd(label)
    };
  }

  // Cleanup
  dispose(): void {
    this.timers.clear();
    // Restore original console methods
    Object.assign(console, originalConsole);
  }
}
```

### 3.2 Logger Bridge for IPC Communication

```typescript
// src/renderer/logger/LoggerBridge.ts
import { LogEntry } from '../../shared/types/logging';

export class LoggerBridge {
  private buffer: LogEntry[] = [];
  private maxBufferSize: number = 1000;
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startPeriodicFlush();
  }

  sendLog(entry: LogEntry): void {
    this.buffer.push(entry);

    // Flush immediately for errors
    if (entry.level === 'error') {
      this.flush();
    }

    // Flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      if ((window as any).electronAPI?.sendLogBatch) {
        await (window as any).electronAPI.sendLogBatch(entries);
      }
    } catch (error) {
      // If batch send fails, try individual sends
      console.error('Failed to send log batch:', error);
      for (const entry of entries) {
        try {
          if ((window as any).electronAPI?.sendLog) {
            await (window as any).electronAPI.sendLog(entry);
          }
        } catch (individualError) {
          console.error('Failed to send individual log:', individualError);
        }
      }
    }
  }

  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 5000); // Flush every 5 seconds
  }

  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush(); // Final flush
  }
}
```

## Step 4: Preload Script Integration

### 4.1 Logging Preload Script

```typescript
// src/preload/logging-preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { LogEntry, LogLevel } from '../shared/types/logging';

// Expose logging API to renderer processes
contextBridge.exposeInMainWorld('loggingAPI', {
  // Send single log entry
  sendLog: (entry: LogEntry) => {
    return ipcRenderer.invoke('log-entry', entry);
  },

  // Send batch of log entries
  sendLogBatch: (entries: LogEntry[]) => {
    return ipcRenderer.invoke('log-batch', entries);
  },

  // Get current log level
  getLogLevel: () => {
    return ipcRenderer.invoke('get-log-level');
  },

  // Update log level
  setLogLevel: (level: LogLevel) => {
    return ipcRenderer.invoke('set-log-level', level);
  },

  // Get logging configuration
  getLoggingConfig: () => {
    return ipcRenderer.invoke('get-logging-config');
  },

  // Update logging configuration
  updateLoggingConfig: (config: Partial<LoggingConfig>) => {
    return ipcRenderer.invoke('update-logging-config', config);
  },

  // Listen for log level changes
  onLogLevelChanged: (callback: (level: LogLevel) => void) => {
    ipcRenderer.on('log-level-changed', (_event, level) => callback(level));
    return () => ipcRenderer.removeListener('log-level-changed', callback);
  },

  // Listen for logging configuration changes
  onLoggingConfigChanged: (callback: (config: LoggingConfig) => void) => {
    ipcRenderer.on('logging-config-changed', (_event, config) => callback(config));
    return () => ipcRenderer.removeListener('logging-config-changed', callback);
  }
});

// Handle main process log messages (for debugging)
ipcRenderer.on('main-log', (_event, entry: LogEntry) => {
  // Forward to renderer console for development
  if (process.env.NODE_ENV === 'development') {
    const level = entry.level.toUpperCase();
    const message = `[MAIN] ${entry.message}`;
    const meta = entry.meta ? JSON.stringify(entry.meta, null, 2) : '';

    switch (entry.level) {
      case 'error':
        console.error(`%c${level}%c ${message}`, 'color: red; font-weight: bold', 'color: inherit', meta);
        break;
      case 'warn':
        console.warn(`%c${level}%c ${message}`, 'color: orange; font-weight: bold', 'color: inherit', meta);
        break;
      case 'info':
        console.info(`%c${level}%c ${message}`, 'color: blue; font-weight: bold', 'color: inherit', meta);
        break;
      case 'debug':
        console.debug(`%c${level}%c ${message}`, 'color: green; font-weight: bold', 'color: inherit', meta);
        break;
      default:
        console.log(`%c${level}%c ${message}`, 'color: gray; font-weight: bold', 'color: inherit', meta);
    }
  }
});
```

## Step 5: IPC Handler Setup

### 5.1 Main Process IPC Handlers

```typescript
// src/main/processes/LoggerIPC.ts
import { ipcMain, BrowserWindow } from 'electron';
import { MainLogger } from '../logger/MainLogger';
import { LogEntry, LoggingConfig, LogLevel } from '../../shared/types/logging';

export class LoggerIPC {
  private logger: MainLogger;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize: number = 1000;

  constructor(logger: MainLogger) {
    this.logger = logger;
    this.setupIPCHandlers();
  }

  private setupIPCHandlers() {
    // Single log entry
    ipcMain.handle('log-entry', async (_event, entry: LogEntry) => {
      this.handleLogEntry(entry);
    });

    // Batch log entries
    ipcMain.handle('log-batch', async (_event, entries: LogEntry[]) => {
      for (const entry of entries) {
        this.handleLogEntry(entry);
      }
    });

    // Get current log level
    ipcMain.handle('get-log-level', () => {
      return this.logger.getLevel();
    });

    // Set log level
    ipcMain.handle('set-log-level', (_event, level: LogLevel) => {
      this.logger.setLevel(level);
      this.broadcastLogLevelChange(level);
    });

    // Get logging configuration
    ipcMain.handle('get-logging-config', () => {
      return this.logger.getConfig();
    });

    // Update logging configuration
    ipcMain.handle('update-logging-config', (_event, config: Partial<LoggingConfig>) => {
      this.logger.updateConfig(config);
      this.broadcastConfigChange(this.logger.getConfig());
    });
  }

  private handleLogEntry(entry: LogEntry) {
    // Add to buffer
    this.logBuffer.push(entry);

    // Log immediately based on level
    this.logEntry(entry);

    // Manage buffer size
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
    }
  }

  private logEntry(entry: LogEntry) {
    const meta = {
      ...entry.meta,
      processId: entry.processId,
      timestamp: entry.timestamp,
      userAgent: entry.userAgent,
      url: entry.url
    };

    switch (entry.level) {
      case 'error':
        this.logger.error(entry.message, meta);
        break;
      case 'warn':
        this.logger.warn(entry.message, meta);
        break;
      case 'info':
        this.logger.info(entry.message, meta);
        break;
      case 'debug':
        this.logger.debug(entry.message, meta);
        break;
      case 'trace':
        this.logger.trace(entry.message, meta);
        break;
      case 'silly':
        this.logger.silly(entry.message, meta);
        break;
    }
  }

  private broadcastLogLevelChange(level: LogLevel) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('log-level-changed', level);
    });
  }

  private broadcastConfigChange(config: LoggingConfig) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('logging-config-changed', config);
    });
  }

  // Get buffered logs (for debugging)
  getBufferedLogs(): LogEntry[] {
    return [...this.logBuffer];
  }

  // Clear buffer
  clearBuffer(): void {
    this.logBuffer = [];
  }
}
```

## Step 6: Integration with Application

### 6.1 Main Application Integration

```typescript
// src/main/TADApplication.ts
import { MainLogger } from './logger/MainLogger';
import { LoggerIPC } from './processes/LoggerIPC';
import { LoggerConfigManager } from './logger/LoggerConfig';

export class TADApplication {
  private logger: MainLogger;
  private loggerIPC: LoggerIPC;
  private loggerConfig: LoggerConfigManager;

  async initialize() {
    // Initialize logger first
    this.loggerConfig = new LoggerConfigManager();
    const config = this.loggerConfig.getConfig();

    // Set log directory to userData/logs
    config.file.directory = path.join(app.getPath('userData'), 'logs');
    this.loggerConfig.updateConfig(config);

    this.logger = new MainLogger(config);
    this.loggerIPC = new LoggerIPC(this.logger);

    this.logger.info('TAD Application initializing', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    });

    // Continue with normal initialization
    await this.initializeCoreComponents();
  }

  private async initializeCoreComponents() {
    this.logger.time('core-initialization');

    try {
      // Initialize other components
      await this.initializeWorkspaceManager();
      await this.initializeWindowManager();
      await this.initializeLanguageServer();

      this.logger.timeEnd('core-initialization');
      this.logger.info('Core components initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize core components', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}
```

### 6.2 Renderer Process Integration

```typescript
// src/renderer/main.ts
import { RendererLogger } from './logger/RendererLogger';
import { LoggerBridge } from './logger/LoggerBridge';

class MainRenderer {
  private logger: RendererLogger;
  private loggerBridge: LoggerBridge;

  constructor() {
    this.initializeLogging();
    this.initializeApplication();
  }

  private initializeLogging() {
    this.loggerBridge = new LoggerBridge();
    this.logger = new RendererLogger('main');

    this.logger.info('Main renderer initializing', {
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  private initializeApplication() {
    this.logger.time('renderer-initialization');

    try {
      // Initialize UI components
      this.initializeUI();
      this.setupEventListeners();

      this.logger.timeEnd('renderer-initialization');
      this.logger.info('Renderer initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize renderer', {
        error: error.message,
        stack: error.stack
      });
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new MainRenderer();
});
```

## Step 7: Configuration and Environment Setup

### 7.1 Environment-Specific Configuration

```typescript
// config/logging.config.js
module.exports = {
  development: {
    level: 'silly',
    separationMode: 'process',
    console: {
      enabled: true,
      format: 'pretty'
    },
    file: {
      enabled: true,
      directory: './logs/dev',
      rotation: {
        frequency: 'daily',
        maxSize: '50m',
        maxFiles: '7d'
      },
      retention: {
        maxAge: '14d',
        compressOld: false
      }
    },
    ipc: {
      enabled: true,
      bufferSize: 1000
    }
  },

  production: {
    level: 'info',
    separationMode: 'unified',
    console: {
      enabled: false,
      format: 'json'
    },
    file: {
      enabled: true,
      directory: './logs/prod',
      rotation: {
        frequency: 'daily',
        maxSize: '20m',
        maxFiles: '30d'
      },
      retention: {
        maxAge: '90d',
        compressOld: true
      }
    },
    ipc: {
      enabled: true,
      bufferSize: 500
    }
  },

  test: {
    level: 'error',
    separationMode: 'unified',
    console: {
      enabled: false,
      format: 'json'
    },
    file: {
      enabled: false,
      directory: './logs/test'
    },
    ipc: {
      enabled: false,
      bufferSize: 100
    }
  }
};
```

### 7.2 Runtime Configuration Loading

```typescript
// src/main/utils/ConfigLoader.ts
import { LoggingConfig } from '../../shared/types/logging';
import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';

export class ConfigLoader {
  static async loadLoggingConfig(): Promise<LoggingConfig> {
    const env = process.env.NODE_ENV || 'development';
    const configPath = path.join(app.getAppPath(), 'config', 'logging.config.js');

    try {
      // Load base configuration
      const baseConfig = require(configPath)[env];

      // Load user overrides
      const userConfigPath = path.join(app.getPath('userData'), 'logging-config.json');
      const userConfig = await this.loadUserConfig(userConfigPath);

      // Merge configurations
      return this.mergeConfigs(baseConfig, userConfig);
    } catch (error) {
      console.error('Failed to load logging configuration:', error);
      return this.getDefaultConfig();
    }
  }

  private static async loadUserConfig(configPath: string): Promise<Partial<LoggingConfig>> {
    try {
      const configData = await fs.readFile(configPath, 'utf8');
      return JSON.parse(configData);
    } catch {
      return {};
    }
  }

  private static mergeConfigs(base: LoggingConfig, user: Partial<LoggingConfig>): LoggingConfig {
    return {
      ...base,
      ...user,
      console: { ...base.console, ...user.console },
      file: { ...base.file, ...user.file },
      ipc: { ...base.ipc, ...user.ipc }
    };
  }

  private static getDefaultConfig(): LoggingConfig {
    return {
      level: 'info',
      separationMode: 'unified',
      console: { enabled: false, format: 'json' },
      file: {
        enabled: true,
        directory: path.join(app.getPath('userData'), 'logs'),
        rotation: { frequency: 'daily', maxSize: '20m', maxFiles: '14d' },
        retention: { maxAge: '30d', compressOld: true }
      },
      ipc: { enabled: true, bufferSize: 1000 }
    };
  }
}
```

## Step 8: Usage Examples and Best Practices

### 8.1 Component-Specific Logging

```typescript
// src/renderer/components/ChatComponent.ts
export class ChatComponent {
  private logger: Logger;

  constructor() {
    this.logger = new RendererLogger('chat').child({
      component: 'ChatComponent',
      version: '1.0.0'
    });
  }

  async sendMessage(message: string) {
    this.logger.debug('Sending chat message', {
      messageLength: message.length,
      timestamp: new Date().toISOString()
    });

    try {
      const response = await this.api.sendMessage(message);
      this.logger.info('Message sent successfully', {
        messageId: response.id,
        responseTime: response.timestamp
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to send message', {
        error: error.message,
        messageLength: message.length,
        stack: error.stack
      });
      throw error;
    }
  }
}
```

### 8.2 Performance Monitoring

```typescript
// src/main/services/APIService.ts
export class APIService {
  private logger: Logger;

  constructor(logger: MainLogger) {
    this.logger = logger.child({ component: 'APIService' });
  }

  async makeRequest(endpoint: string, options: any) {
    this.logger.time(`api-request-${endpoint}`);

    try {
      const response = await fetch(endpoint, options);
      this.logger.timeEnd(`api-request-${endpoint}`);

      this.logger.info('API request completed', {
        endpoint,
        status: response.status,
        responseTime: this.getLastTimerDuration(`api-request-${endpoint}`)
      });

      return response;
    } catch (error) {
      this.logger.timeEnd(`api-request-${endpoint}`);
      this.logger.error('API request failed', {
        endpoint,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  private getLastTimerDuration(label: string): number {
    // Implementation to get last timer duration
    return 0; // Placeholder
  }
}
```

### 8.3 Error Boundary Logging

```typescript
// src/renderer/components/ErrorBoundary.tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
  logger: Logger;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.props.logger.error('React Error Boundary caught an error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorBoundary: 'ErrorBoundary',
      timestamp: new Date().toISOString()
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>Please check the logs for more details.</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

This implementation guide provides a comprehensive foundation for electron-timber logging in the TAD application, with proper separation of concerns, environment-specific configurations, and robust error handling across main and renderer processes.