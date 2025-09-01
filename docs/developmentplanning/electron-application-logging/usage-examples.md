# Electron Timber Logging Usage Examples

## Overview

This document provides practical examples of how to use the electron-timber logging system in the TAD Electron application. It covers common logging patterns, best practices, and real-world usage scenarios.

## Basic Logging Usage

### Main Process Logging

```typescript
// src/main/index.ts
import { MainLogger } from './logger/MainLogger';

const logger = new MainLogger();

// Application startup
logger.info('TAD Application starting', {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version
});

// Error handling
try {
  await initializeApplication();
  logger.info('Application initialized successfully');
} catch (error) {
  logger.error('Failed to initialize application', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  app.quit();
}
```

### Renderer Process Logging

```typescript
// src/renderer/main.ts
import { RendererLogger } from './logger/RendererLogger';

const logger = new RendererLogger('main');

// Component initialization
logger.info('Main renderer initializing', {
  userAgent: navigator.userAgent,
  url: window.location.href,
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight
  }
});

// User interactions
document.getElementById('open-workspace')?.addEventListener('click', () => {
  logger.info('User clicked open workspace button', {
    timestamp: new Date().toISOString(),
    userAction: 'open-workspace'
  });
});
```

## Component-Specific Logging

### Service Layer Logging

```typescript
// src/main/services/WorkspaceService.ts
export class WorkspaceService {
  private logger: Logger;

  constructor(logger: MainLogger) {
    this.logger = logger.child({
      component: 'WorkspaceService',
      service: 'workspace-management'
    });
  }

  async openWorkspace(workspacePath: string) {
    this.logger.time('workspace-open');

    try {
      this.logger.debug('Opening workspace', { workspacePath });

      // Validate workspace
      const isValid = await this.validateWorkspace(workspacePath);
      if (!isValid) {
        throw new Error('Invalid workspace');
      }

      // Load workspace configuration
      const config = await this.loadWorkspaceConfig(workspacePath);
      this.logger.info('Workspace configuration loaded', {
        workspacePath,
        configVersion: config.version,
        templateCount: config.templates?.length || 0
      });

      // Initialize workspace
      await this.initializeWorkspace(config);

      this.logger.timeEnd('workspace-open');
      this.logger.info('Workspace opened successfully', {
        workspacePath,
        duration: this.getLastTimerDuration('workspace-open')
      });

      return config;
    } catch (error) {
      this.logger.timeEnd('workspace-open');
      this.logger.error('Failed to open workspace', {
        workspacePath,
        error: error.message,
        stack: error.stack,
        duration: this.getLastTimerDuration('workspace-open')
      });
      throw error;
    }
  }

  private getLastTimerDuration(label: string): number {
    // Implementation to get timer duration
    return 0;
  }
}
```

### UI Component Logging

```typescript
// src/renderer/components/ChatInterface.ts
export class ChatInterface {
  private logger: Logger;

  constructor() {
    this.logger = new RendererLogger('chat').child({
      component: 'ChatInterface',
      feature: 'real-time-chat'
    });
  }

  async sendMessage(message: string) {
    const messageId = this.generateMessageId();

    this.logger.debug('Sending chat message', {
      messageId,
      messageLength: message.length,
      timestamp: new Date().toISOString()
    });

    try {
      const response = await this.api.sendMessage({
        id: messageId,
        content: message,
        timestamp: new Date().toISOString()
      });

      this.logger.info('Message sent successfully', {
        messageId,
        responseId: response.id,
        responseTime: Date.now() - new Date(response.timestamp).getTime()
      });

      return response;
    } catch (error) {
      this.logger.error('Failed to send message', {
        messageId,
        error: error.message,
        messageLength: message.length,
        retryCount: this.retryCount
      });

      // Implement retry logic
      if (this.shouldRetry(error)) {
        return this.retrySendMessage(message, messageId);
      }

      throw error;
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private shouldRetry(error: any): boolean {
    // Retry logic based on error type
    return error.code === 'NETWORK_ERROR' && this.retryCount < 3;
  }
}
```

## Error Handling and Logging

### Error Boundary Logging

```typescript
// src/renderer/components/ErrorBoundary.tsx
import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; logger: Logger },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; logger: Logger }) {
    super(props);
    this.state = { hasError: false };

    this.logger = props.logger.child({
      component: 'ErrorBoundary',
      boundary: 'react-error-boundary'
    });
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    this.logger.error('React Error Boundary caught an error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorBoundary: 'ErrorBoundary',
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    });

    // Report error to monitoring service
    this.reportError(error, errorInfo);
  }

  private async reportError(error: Error, errorInfo: React.ErrorInfo) {
    try {
      await fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href
        })
      });
    } catch (reportError) {
      this.logger.error('Failed to report error', {
        reportError: reportError.message
      });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>Please refresh the page or contact support if the problem persists.</p>
          <button onClick={() => window.location.reload()}>
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### API Error Logging

```typescript
// src/main/services/APIService.ts
export class APIService {
  private logger: Logger;

  constructor(logger: MainLogger) {
    this.logger = logger.child({
      component: 'APIService',
      service: 'external-api'
    });
  }

  async makeRequest(endpoint: string, options: RequestOptions = {}) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    this.logger.debug('Making API request', {
      requestId,
      endpoint,
      method: options.method || 'GET',
      headers: this.sanitizeHeaders(options.headers),
      timestamp: new Date().toISOString()
    });

    try {
      const response = await this.executeRequest(endpoint, options);
      const duration = Date.now() - startTime;

      this.logger.info('API request completed', {
        requestId,
        endpoint,
        status: response.status,
        duration: `${duration}ms`,
        responseSize: response.headers.get('content-length') || 'unknown'
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('API request failed', {
        requestId,
        endpoint,
        error: error.message,
        duration: `${duration}ms`,
        retryCount: options.retryCount || 0,
        stack: error.stack
      });

      throw error;
    }
  }

  private async executeRequest(endpoint: string, options: RequestOptions) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
      const response = await fetch(endpoint, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }

  private sanitizeHeaders(headers?: Record<string, string>) {
    if (!headers) return {};

    const sanitized = { ...headers };
    const sensitiveKeys = ['authorization', 'api-key', 'token'];

    for (const key of sensitiveKeys) {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

## Performance Monitoring

### Performance Timer Logging

```typescript
// src/main/performance/PerformanceMonitor.ts
export class PerformanceMonitor {
  private logger: Logger;

  constructor(logger: MainLogger) {
    this.logger = logger.child({
      component: 'PerformanceMonitor',
      monitor: 'application-performance'
    });
  }

  async monitorFunction<T>(
    label: string,
    fn: () => Promise<T>,
    metadata?: any
  ): Promise<T> {
    const startTime = process.hrtime.bigint();
    const startMemory = process.memoryUsage();

    try {
      this.logger.debug(`Starting ${label}`, {
        ...metadata,
        startTime: new Date().toISOString()
      });

      const result = await fn();

      const endTime = process.hrtime.bigint();
      const endMemory = process.memoryUsage();

      const duration = Number(endTime - startTime) / 1e6; // Convert to milliseconds
      const memoryDelta = {
        rss: endMemory.rss - startMemory.rss,
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal
      };

      this.logger.info(`Completed ${label}`, {
        ...metadata,
        duration: `${duration.toFixed(2)}ms`,
        memoryDelta,
        success: true
      });

      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1e6;

      this.logger.error(`Failed ${label}`, {
        ...metadata,
        duration: `${duration.toFixed(2)}ms`,
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  monitorMemoryUsage() {
    const memUsage = process.memoryUsage();

    this.logger.info('Memory usage snapshot', {
      rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`,
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
      timestamp: new Date().toISOString()
    });
  }

  monitorCPUUsage() {
    const startUsage = process.cpuUsage();

    setTimeout(() => {
      const endUsage = process.cpuUsage(startUsage);
      const totalUsage = (endUsage.user + endUsage.system) / 1000; // Convert to milliseconds

      this.logger.info('CPU usage snapshot', {
        user: `${endUsage.user / 1000}ms`,
        system: `${endUsage.system / 1000}ms`,
        total: `${totalUsage}ms`,
        percentage: `${((totalUsage / 100) * 100).toFixed(2)}%`,
        timestamp: new Date().toISOString()
      });
    }, 100); // Measure over 100ms
  }
}
```

### Database Operation Logging

```typescript
// src/main/database/DatabaseManager.ts
export class DatabaseManager {
  private logger: Logger;

  constructor(logger: MainLogger) {
    this.logger = logger.child({
      component: 'DatabaseManager',
      database: 'sqlite'
    });
  }

  async executeQuery(query: string, params: any[] = []) {
    const queryId = this.generateQueryId();

    this.logger.debug('Executing database query', {
      queryId,
      query: this.sanitizeQuery(query),
      paramCount: params.length,
      timestamp: new Date().toISOString()
    });

    const startTime = Date.now();

    try {
      const result = await this.db.run(query, params);
      const duration = Date.now() - startTime;

      this.logger.info('Database query completed', {
        queryId,
        duration: `${duration}ms`,
        changes: result.changes,
        lastID: result.lastID,
        success: true
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('Database query failed', {
        queryId,
        query: this.sanitizeQuery(query),
        paramCount: params.length,
        duration: `${duration}ms`,
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  async executeSelect(query: string, params: any[] = []) {
    const queryId = this.generateQueryId();

    this.logger.debug('Executing SELECT query', {
      queryId,
      query: this.sanitizeQuery(query),
      paramCount: params.length
    });

    const startTime = Date.now();

    try {
      const rows = await this.db.all(query, params);
      const duration = Date.now() - startTime;

      this.logger.info('SELECT query completed', {
        queryId,
        duration: `${duration}ms`,
        rowCount: rows.length,
        success: true
      });

      return rows;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('SELECT query failed', {
        queryId,
        query: this.sanitizeQuery(query),
        duration: `${duration}ms`,
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  private sanitizeQuery(query: string): string {
    // Remove sensitive data from query for logging
    return query.replace(/('[^']*password[^']*')/gi, "'[REDACTED]'");
  }

  private generateQueryId(): string {
    return `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

## Security Event Logging

### Authentication Logging

```typescript
// src/main/auth/AuthManager.ts
export class AuthManager {
  private logger: Logger;

  constructor(logger: MainLogger) {
    this.logger = logger.child({
      component: 'AuthManager',
      security: 'authentication'
    });
  }

  async authenticate(credentials: LoginCredentials) {
    const sessionId = this.generateSessionId();

    this.logger.info('Authentication attempt', {
      sessionId,
      username: credentials.username,
      ipAddress: this.getClientIP(),
      userAgent: credentials.userAgent,
      timestamp: new Date().toISOString()
    });

    try {
      const user = await this.validateCredentials(credentials);

      this.logger.info('Authentication successful', {
        sessionId,
        userId: user.id,
        username: user.username,
        role: user.role,
        ipAddress: this.getClientIP(),
        success: true
      });

      return this.createSession(user, sessionId);
    } catch (error) {
      this.logger.warn('Authentication failed', {
        sessionId,
        username: credentials.username,
        ipAddress: this.getClientIP(),
        reason: error.message,
        success: false
      });

      throw error;
    }
  }

  async logout(sessionId: string) {
    this.logger.info('User logout', {
      sessionId,
      timestamp: new Date().toISOString()
    });

    try {
      await this.destroySession(sessionId);

      this.logger.info('Logout successful', {
        sessionId,
        success: true
      });
    } catch (error) {
      this.logger.error('Logout failed', {
        sessionId,
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getClientIP(): string {
    // Implementation to get client IP address
    return 'unknown';
  }
}
```

### File Access Logging

```typescript
// src/main/filesystem/FileManager.ts
export class FileManager {
  private logger: Logger;

  constructor(logger: MainLogger) {
    this.logger = logger.child({
      component: 'FileManager',
      security: 'file-access'
    });
  }

  async readFile(filePath: string, userId: string) {
    const operationId = this.generateOperationId();

    this.logger.info('File read operation', {
      operationId,
      filePath: this.sanitizePath(filePath),
      userId,
      operation: 'read',
      timestamp: new Date().toISOString()
    });

    try {
      const content = await fs.readFile(filePath, 'utf8');

      this.logger.info('File read successful', {
        operationId,
        filePath: this.sanitizePath(filePath),
        userId,
        size: content.length,
        success: true
      });

      return content;
    } catch (error) {
      this.logger.error('File read failed', {
        operationId,
        filePath: this.sanitizePath(filePath),
        userId,
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  async writeFile(filePath: string, content: string, userId: string) {
    const operationId = this.generateOperationId();

    this.logger.info('File write operation', {
      operationId,
      filePath: this.sanitizePath(filePath),
      userId,
      operation: 'write',
      size: content.length,
      timestamp: new Date().toISOString()
    });

    try {
      await fs.writeFile(filePath, content, 'utf8');

      this.logger.info('File write successful', {
        operationId,
        filePath: this.sanitizePath(filePath),
        userId,
        size: content.length,
        success: true
      });
    } catch (error) {
      this.logger.error('File write failed', {
        operationId,
        filePath: this.sanitizePath(filePath),
        userId,
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  private sanitizePath(filePath: string): string {
    // Remove sensitive information from file paths
    return filePath.replace(/\/home\/[^\/]+/, '/home/[USER]');
  }

  private generateOperationId(): string {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

## Advanced Logging Patterns

### Structured Logging with Context

```typescript
// src/main/context/RequestContext.ts
export class RequestContext {
  private contextId: string;
  private logger: Logger;
  private context: Map<string, any> = new Map();

  constructor(logger: MainLogger, initialContext: any = {}) {
    this.contextId = this.generateContextId();
    this.logger = logger.child({
      contextId: this.contextId,
      ...initialContext
    });

    // Add initial context
    Object.entries(initialContext).forEach(([key, value]) => {
      this.context.set(key, value);
    });
  }

  set(key: string, value: any) {
    this.context.set(key, value);
    this.logger = this.logger.child({ [key]: value });
  }

  get(key: string): any {
    return this.context.get(key);
  }

  getAll(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.context) {
      result[key] = value;
    }
    return result;
  }

  info(message: string, extra?: any) {
    this.logger.info(message, {
      ...this.getAll(),
      ...extra
    });
  }

  error(message: string, error?: Error, extra?: any) {
    this.logger.error(message, {
      ...this.getAll(),
      error: error?.message,
      stack: error?.stack,
      ...extra
    });
  }

  createChildLogger(childContext: any = {}) {
    return new RequestContext(this.logger, {
      ...this.getAll(),
      ...childContext
    });
  }

  private generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Usage example
const context = new RequestContext(logger, {
  userId: 'user123',
  sessionId: 'sess456',
  requestId: 'req789'
});

context.set('operation', 'file-upload');
context.info('Starting file upload', { fileName: 'document.pdf' });

const childContext = context.createChildLogger({
  step: 'validation'
});

childContext.info('Validating file format');
```

### Log Correlation and Tracing

```typescript
// src/main/tracing/LogTracer.ts
export class LogTracer {
  private logger: Logger;
  private traces: Map<string, Trace> = new Map();

  constructor(logger: MainLogger) {
    this.logger = logger.child({
      component: 'LogTracer',
      feature: 'distributed-tracing'
    });
  }

  startTrace(traceId: string, name: string, initialContext: any = {}) {
    const trace = new Trace(traceId, name, initialContext);
    this.traces.set(traceId, trace);

    this.logger.info('Trace started', {
      traceId,
      name,
      timestamp: new Date().toISOString(),
      ...initialContext
    });

    return trace;
  }

  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  endTrace(traceId: string) {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const duration = Date.now() - trace.startTime;

    this.logger.info('Trace completed', {
      traceId,
      name: trace.name,
      duration: `${duration}ms`,
      spanCount: trace.spans.length,
      ...trace.context
    });

    this.traces.delete(traceId);
  }

  addSpan(traceId: string, spanName: string, context: any = {}) {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = new Span(spanName, context);
    trace.spans.push(span);

    this.logger.debug('Span added to trace', {
      traceId,
      spanName,
      spanId: span.id,
      ...context
    });

    return span;
  }
}

class Trace {
  public readonly id: string;
  public readonly name: string;
  public readonly startTime: number;
  public readonly spans: Span[] = [];
  public readonly context: any;

  constructor(id: string, name: string, context: any = {}) {
    this.id = id;
    this.name = name;
    this.startTime = Date.now();
    this.context = context;
  }
}

class Span {
  public readonly id: string;
  public readonly name: string;
  public readonly startTime: number;
  public readonly context: any;

  constructor(name: string, context: any = {}) {
    this.id = this.generateSpanId();
    this.name = name;
    this.startTime = Date.now();
    this.context = context;
  }

  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Usage example
const tracer = new LogTracer(logger);

const trace = tracer.startTrace('user-login', 'User Login Flow', {
  userId: 'user123',
  loginMethod: 'email'
});

const authSpan = tracer.addSpan(trace.id, 'authenticate', {
  provider: 'local'
});

try {
  // Authentication logic
  await authenticateUser();

  tracer.addSpan(trace.id, 'create-session', {
    sessionType: 'persistent'
  });

  // Session creation logic
  const session = await createUserSession();

  tracer.endTrace(trace.id);

  logger.info('User login completed successfully', {
    traceId: trace.id,
    sessionId: session.id
  });
} catch (error) {
  tracer.endTrace(trace.id);

  logger.error('User login failed', {
    traceId: trace.id,
    error: error.message
  });
}
```

## Custom Log Formatters

### Colored Console Formatter

```typescript
// src/main/logger/formatters/ColoredConsoleFormatter.ts
export class ColoredConsoleFormatter {
  format(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toLocaleTimeString();
    const levelColor = this.getLevelColor(level);
    const levelStr = this.padLevel(level.toUpperCase());

    let formatted = `${timestamp} ${levelColor}${levelStr}\x1b[0m ${message}`;

    if (meta) {
      const metaStr = JSON.stringify(meta, null, 2);
      formatted += `\n\x1b[2m${metaStr}\x1b[0m`;
    }

    return formatted;
  }

  private getLevelColor(level: string): string {
    switch (level) {
      case 'error': return '\x1b[31m'; // Red
      case 'warn': return '\x1b[33m';  // Yellow
      case 'info': return '\x1b[36m';  // Cyan
      case 'debug': return '\x1b[35m'; // Magenta
      case 'trace': return '\x1b[37m'; // White
      case 'silly': return '\x1b[32m'; // Green
      default: return '\x1b[0m';       // Reset
    }
  }

  private padLevel(level: string): string {
    return level.padEnd(5);
  }
}
```

### JSON Formatter with Custom Fields

```typescript
// src/main/logger/formatters/CustomJSONFormatter.ts
export class CustomJSONFormatter {
  format(level: string, message: string, meta?: any): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      processId: process.pid,
      processType: this.getProcessType(),
      hostname: require('os').hostname(),
      version: require('../../../package.json').version,
      ...meta
    };

    return JSON.stringify(logEntry, null, 0);
  }

  private getProcessType(): string {
    if (typeof window !== 'undefined') {
      return 'renderer';
    }
    return 'main';
  }
}
```

These examples demonstrate the comprehensive logging capabilities of the electron-timber system, showing how to implement various logging patterns for different use cases while maintaining consistency and providing valuable debugging and monitoring information.