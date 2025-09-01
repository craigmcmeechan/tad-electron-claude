# Electron Application Logging with electron-timber

## Overview

This document outlines the comprehensive logging strategy for the TAD Electron application using electron-timber. The logging system is designed to provide detailed debugging information during development while maintaining efficient, production-ready logging in deployed environments.

## Architecture Overview

### Core Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Main Process  │    │ Renderer        │    │  Log Files     │
│   Logger        │◄──►│ Process Logger  │    │                │
│                 │    │                 │    │ • main.log      │
│ • Console       │    │ • Console       │    │ • renderer.log  │
│ • File          │    │ • File          │    │ • combined.log  │
│ • IPC Bridge    │    │ • IPC Bridge    │    │ • errors.log    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Features

- **Environment-Aware**: Different verbosity levels for development vs production
- **Process Separation**: Configurable log separation by process or unified logging
- **Daily Rotation**: Automatic log rotation with configurable retention
- **Performance Optimized**: Minimal overhead in production environments
- **IPC Integration**: Seamless logging across main and renderer processes
- **Structured Logging**: JSON format with metadata for better analysis

## Logging Levels and Environments

### Development Environment

**Characteristics:**
- Maximum verbosity for debugging
- All log levels enabled
- Console output for immediate feedback
- Detailed stack traces and metadata
- Performance monitoring enabled

**Log Levels:**
```javascript
// Development configuration
const devLevels = {
  error: 0,    // Always logged
  warn: 1,     // Warnings and above
  info: 2,     // General information
  debug: 3,    // Debug information
  trace: 4,    // Detailed tracing
  silly: 5     // Everything including internal operations
};
```

### Production Environment

**Characteristics:**
- Minimal verbosity for performance
- Only essential logs (errors, warnings, critical info)
- Optimized file output only
- Structured JSON format
- Automatic cleanup and rotation

**Log Levels:**
```javascript
// Production configuration
const prodLevels = {
  error: 0,    // Application errors
  warn: 1,     // Important warnings
  info: 2,     // Critical information only
  debug: false, // Disabled
  trace: false, // Disabled
  silly: false  // Disabled
};
```

## Log Separation Strategies

### Option 1: Process-Based Separation

**Structure:**
```
logs/
├── main/
│   ├── main-2025-09-01.log
│   ├── main-2025-09-02.log
│   └── main-2025-09-03.log
├── renderer/
│   ├── renderer-2025-09-01.log
│   ├── renderer-2025-09-02.log
│   └── renderer-2025-09-03.log
└── errors/
    ├── errors-2025-09-01.log
    └── errors-2025-09-02.log
```

**Benefits:**
- Clear separation of concerns
- Easier debugging per process
- Smaller individual log files
- Process-specific filtering

### Option 2: Unified Logging with Prefixes

**Structure:**
```
logs/
├── combined-2025-09-01.log
├── combined-2025-09-02.log
└── errors-2025-09-01.log
```

**Log Format:**
```
[2025-09-01 10:30:15] [MAIN] INFO: Application started successfully
[2025-09-01 10:30:16] [RENDERER:chat] DEBUG: Chat component initialized
[2025-09-01 10:30:17] [RENDERER:canvas] INFO: Canvas loaded with 15 frames
[2025-09-01 10:30:18] [MAIN] ERROR: Failed to load workspace configuration
```

**Benefits:**
- Single file for complete application flow
- Easier chronological analysis
- Reduced file management overhead
- Better for distributed tracing

## Daily Rotation and Retention

### Rotation Strategy

**Configuration:**
```javascript
const rotationConfig = {
  frequency: 'daily',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',        // 20MB per file
  maxFiles: '14d',       // Keep 14 days of logs
  zippedArchive: true    // Compress old logs
};
```

**Rotation Triggers:**
- Daily at midnight (configurable)
- File size limit reached
- Application restart (optional)

### Retention Policy

**Automatic Cleanup:**
```javascript
const retentionConfig = {
  maxAge: '30d',         // Delete logs older than 30 days
  maxFiles: 100,         // Keep maximum 100 log files
  compressOld: true,     // Compress logs older than 7 days
  deleteEmpty: true      // Remove empty log files
};
```

**Cleanup Process:**
1. Scan log directory daily
2. Identify files older than retention period
3. Compress old files (optional)
4. Delete files beyond limits
5. Update retention statistics

## Implementation Guide

### 1. Installation and Setup

```bash
# Install electron-timber and dependencies
pnpm add electron-timber winston winston-daily-rotate-file
pnpm add -D @types/winston
```

### 2. Main Process Logger Configuration

```typescript
// src/main/logger/MainLogger.ts
import { Logger } from 'electron-timber';
import path from 'path';
import { app } from 'electron';

export class MainLogger {
  private logger: Logger;
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.initializeLogger();
  }

  private initializeLogger() {
    const logDir = path.join(app.getPath('userData'), 'logs');

    this.logger = Logger.create({
      name: 'TAD-Main',
      level: this.isDevelopment ? 'silly' : 'info',
      format: this.getLogFormat(),
      transports: this.getTransports(logDir)
    });
  }

  private getLogFormat() {
    return this.isDevelopment
      ? Logger.formats.pretty()
      : Logger.formats.json();
  }

  private getTransports(logDir: string) {
    const transports = [];

    // Console transport for development
    if (this.isDevelopment) {
      transports.push(Logger.transports.console({
        level: 'silly',
        format: Logger.formats.colorize()
      }));
    }

    // File transports with rotation
    transports.push(
      Logger.transports.dailyRotateFile({
        filename: path.join(logDir, 'main-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: Logger.formats.json()
      })
    );

    // Error-only file
    transports.push(
      Logger.transports.dailyRotateFile({
        filename: path.join(logDir, 'errors-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '10m',
        maxFiles: '30d',
        format: Logger.formats.json()
      })
    );

    return transports;
  }

  // Logging methods
  error(message: string, meta?: any) {
    this.logger.error(message, meta);
  }

  warn(message: string, meta?: any) {
    this.logger.warn(message, meta);
  }

  info(message: string, meta?: any) {
    this.logger.info(message, meta);
  }

  debug(message: string, meta?: any) {
    this.logger.debug(message, meta);
  }

  trace(message: string, meta?: any) {
    this.logger.trace(message, meta);
  }

  // Performance logging
  time(label: string) {
    this.logger.time(label);
  }

  timeEnd(label: string) {
    this.logger.timeEnd(label);
  }

  // Child logger for specific components
  child(meta: any) {
    return this.logger.child(meta);
  }
}
```

### 3. Renderer Process Logger Configuration

```typescript
// src/renderer/logger/RendererLogger.ts
import { Logger } from 'electron-timber';

export class RendererLogger {
  private logger: Logger;
  private processId: string;

  constructor(processId: string = 'main') {
    this.processId = processId;
    this.initializeLogger();
  }

  private initializeLogger() {
    this.logger = Logger.create({
      name: `TAD-Renderer-${this.processId}`,
      level: process.env.NODE_ENV === 'development' ? 'silly' : 'info',
      format: process.env.NODE_ENV === 'development'
        ? Logger.formats.pretty()
        : Logger.formats.json()
    });

    // IPC transport to send logs to main process
    this.setupIPCTransport();
  }

  private setupIPCTransport() {
    // Override console methods to also log via IPC
    const originalConsole = { ...console };

    ['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
      console[level] = (...args) => {
        // Call original console method
        originalConsole[level](...args);

        // Send to main process logger
        if (window.electronAPI?.sendLog) {
          window.electronAPI.sendLog({
            level,
            message: args.join(' '),
            processId: this.processId,
            timestamp: new Date().toISOString()
          });
        }
      };
    });
  }

  // Logging methods (same as MainLogger)
  error(message: string, meta?: any) {
    this.logger.error(message, meta);
  }

  // ... other methods
}
```

### 4. Configuration Management

```typescript
// src/main/config/LoggingConfig.ts
export interface LoggingConfig {
  level: string;
  separationMode: 'process' | 'unified';
  rotation: {
    frequency: 'daily' | 'hourly';
    maxSize: string;
    maxFiles: string;
  };
  retention: {
    maxAge: string;
    maxFiles: number;
    compressOld: boolean;
  };
  transports: {
    console: boolean;
    file: boolean;
    ipc: boolean;
  };
}

export const defaultLoggingConfig: LoggingConfig = {
  level: process.env.NODE_ENV === 'development' ? 'silly' : 'info',
  separationMode: 'unified', // or 'process'
  rotation: {
    frequency: 'daily',
    maxSize: '20m',
    maxFiles: '14d'
  },
  retention: {
    maxAge: '30d',
    maxFiles: 100,
    compressOld: true
  },
  transports: {
    console: process.env.NODE_ENV === 'development',
    file: true,
    ipc: true
  }
};
```

## Usage Examples

### Basic Logging

```typescript
// Main process
import { mainLogger } from './logger/MainLogger';

mainLogger.info('Application started', {
  version: app.getVersion(),
  platform: process.platform
});

mainLogger.error('Failed to load workspace', {
  error: error.message,
  workspacePath: workspacePath
});

// With timing
mainLogger.time('workspace-load');
await loadWorkspace();
mainLogger.timeEnd('workspace-load');
```

### Component-Specific Logging

```typescript
// Create child logger for specific component
const canvasLogger = mainLogger.child({
  component: 'canvas',
  windowId: canvasWindow.id
});

canvasLogger.debug('Canvas initialized', {
  frameCount: frames.length,
  dimensions: canvasDimensions
});
```

### Renderer Process Logging

```typescript
// Renderer process
import { RendererLogger } from './logger/RendererLogger';

const logger = new RendererLogger('chat');

logger.info('Chat component mounted');
logger.debug('Loading chat history', { messageCount: history.length });

// Error logging with context
try {
  await sendMessage(message);
} catch (error) {
  logger.error('Failed to send message', {
    error: error.message,
    messageId: message.id,
    userId: currentUser.id
  });
}
```

## Performance Considerations

### Development Optimizations

**Memory Management:**
- Circular buffer for recent logs (last 1000 entries)
- Lazy initialization of debug loggers
- Automatic cleanup of old log entries

**CPU Optimization:**
- Async logging operations
- Batched log writes
- Minimal string formatting in hot paths

### Production Optimizations

**Minimal Overhead:**
- Synchronous logging disabled
- File-only output (no console)
- Compressed log format
- Background log rotation

**Resource Management:**
- Memory-mapped file writes
- Automatic log compression
- Configurable log levels per component

## Monitoring and Analysis

### Log Analysis Tools

**Built-in Analysis:**
```typescript
// Log statistics
const stats = logger.getStats();
console.log('Log Statistics:', {
  totalEntries: stats.total,
  errorCount: stats.byLevel.error,
  averageEntrySize: stats.averageSize,
  oldestEntry: stats.oldest,
  newestEntry: stats.newest
});
```

**External Tools:**
- ELK Stack (Elasticsearch, Logstash, Kibana)
- Splunk
- Custom log analysis scripts
- Real-time monitoring dashboards

### Alerting and Notifications

**Error Alerting:**
```typescript
// Automatic error alerting
logger.on('error', (entry) => {
  if (entry.level === 'error') {
    sendErrorNotification(entry);
  }
});

function sendErrorNotification(entry) {
  // Send to monitoring service
  // Show user notification
  // Write to error dashboard
}
```

## Security Considerations

### Log Data Protection

**Sensitive Data Filtering:**
```typescript
const sensitiveKeys = ['password', 'token', 'apiKey', 'secret'];

function sanitizeLogData(data: any): any {
  if (typeof data === 'object' && data !== null) {
    const sanitized = { ...data };
    for (const key of sensitiveKeys) {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }
  return data;
}
```

**File Permissions:**
- Log files: 0640 (owner read/write, group read)
- Log directories: 0750 (owner read/write/execute, group read/execute)
- Automatic permission verification

### Audit Logging

**Security Events:**
```typescript
// Security event logging
logger.security('authentication_attempt', {
  userId: user.id,
  success: false,
  ipAddress: request.ip,
  userAgent: request.userAgent
});

logger.security('file_access', {
  userId: user.id,
  filePath: filePath,
  operation: 'read',
  success: true
});
```

## Testing Strategy

### Unit Tests

```typescript
// tests/logger/MainLogger.test.ts
describe('MainLogger', () => {
  let logger: MainLogger;

  beforeEach(() => {
    logger = new MainLogger();
  });

  test('should log error messages', () => {
    const spy = jest.spyOn(console, 'error');
    logger.error('Test error');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Test error'));
  });

  test('should respect log levels', () => {
    const devLogger = new MainLogger('development');
    const prodLogger = new MainLogger('production');

    devLogger.debug('Debug message'); // Should log
    prodLogger.debug('Debug message'); // Should not log
  });
});
```

### Integration Tests

```typescript
// tests/integration/logging.integration.test.ts
describe('Logging Integration', () => {
  test('should persist logs to file', async () => {
    const logger = new MainLogger();
    const testMessage = 'Integration test message';

    logger.info(testMessage);

    // Wait for async write
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify log file contains message
    const logContent = await fs.readFile(logFilePath, 'utf8');
    expect(logContent).toContain(testMessage);
  });

  test('should handle IPC logging', async () => {
    // Test IPC log transport
    const rendererLogger = new RendererLogger('test');
    const mainLogger = new MainLogger();

    rendererLogger.info('IPC test message');

    // Verify message received in main process
    await expectIPCMessage('log-entry', {
      level: 'info',
      message: 'IPC test message'
    });
  });
});
```

## Migration Path

### Phase 1: Basic Setup (Week 1)
- [ ] Install electron-timber and dependencies
- [ ] Create basic logger configuration
- [ ] Replace console.log statements with logger calls
- [ ] Setup file logging with basic rotation

### Phase 2: Advanced Features (Week 2)
- [ ] Implement environment-specific configurations
- [ ] Add IPC logging bridge
- [ ] Setup log retention and cleanup
- [ ] Add performance monitoring

### Phase 3: Process Separation (Week 3)
- [ ] Implement renderer process logging
- [ ] Add process-specific log separation
- [ ] Setup unified logging option
- [ ] Test cross-process logging

### Phase 4: Production Optimization (Week 4)
- [ ] Performance testing and optimization
- [ ] Security hardening
- [ ] Monitoring and alerting setup
- [ ] Documentation and training

## Success Metrics

### Performance Metrics
- **Startup Time**: < 100ms logging initialization overhead
- **Memory Usage**: < 10MB additional memory for logging system
- **CPU Usage**: < 1% CPU overhead during normal operation
- **Log Write Latency**: < 5ms for individual log entries

### Reliability Metrics
- **Log Loss Rate**: < 0.01% of log entries lost
- **Rotation Success Rate**: 100% successful log rotations
- **Error Recovery**: Automatic recovery from log write failures

### Maintainability Metrics
- **Code Coverage**: > 90% test coverage for logging components
- **Documentation**: Complete API documentation
- **Configuration**: Easy configuration management
- **Monitoring**: Real-time logging system health monitoring

This comprehensive logging strategy ensures that TAD has robust, scalable logging capabilities suitable for both development debugging and production monitoring, with flexible configuration options to meet different operational requirements.