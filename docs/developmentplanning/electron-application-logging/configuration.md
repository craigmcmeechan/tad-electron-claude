# Electron Timber Logging Configuration Guide

## Overview

This guide provides comprehensive information about configuring the electron-timber logging system for the TAD Electron application. It covers configuration options, environment-specific settings, and best practices for different deployment scenarios.

## Configuration Architecture

### Configuration Sources Hierarchy

The logging system supports multiple configuration sources with the following priority order (highest to lowest):

```
┌─────────────────────────────────────────────────────────────┐
│                    Configuration Priority                   │
├─────────────────────────────────────────────────────────────┤
│  1. Environment Variables (LOG_*)                         │
│  2. Runtime Configuration Overrides                        │
│  3. User Configuration File (~/.tad/logging-config.json)   │
│  4. Application Configuration (config/logging.*.js)        │
│  5. Built-in Defaults                                      │
└─────────────────────────────────────────────────────────────┘
```

### Configuration File Structure

```typescript
interface LoggingConfig {
  // Global settings
  level: LogLevel;
  separationMode: 'process' | 'unified';
  enabled: boolean;

  // Transport configurations
  console: ConsoleConfig;
  file: FileConfig;
  ipc: IPCConfig;

  // Advanced features
  rotation: RotationConfig;
  retention: RetentionConfig;
  security: SecurityConfig;
  performance: PerformanceConfig;
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silly';
```

## Environment-Specific Configurations

### Development Configuration

**File: `config/logging.development.js`**

```javascript
module.exports = {
  // Global settings
  level: 'silly',
  separationMode: 'process',
  enabled: true,

  // Console transport - maximum verbosity for debugging
  console: {
    enabled: true,
    format: 'pretty',
    colors: true,
    timestamp: true,
    level: 'silly'
  },

  // File transport - detailed logging with frequent rotation
  file: {
    enabled: true,
    directory: './logs/development',
    filename: 'tad-dev-%DATE%.log',
    format: 'json',
    level: 'silly',
    rotation: {
      frequency: 'hourly',
      datePattern: 'YYYY-MM-DD-HH',
      maxSize: '10m',
      maxFiles: '24h'
    },
    retention: {
      maxAge: '7d',
      compressOld: false
    }
  },

  // IPC transport - full debugging
  ipc: {
    enabled: true,
    bufferSize: 1000,
    batchSize: 10,
    flushInterval: 1000,
    level: 'silly'
  },

  // Security - relaxed for development
  security: {
    sanitizeSensitiveData: true,
    allowedFileExtensions: ['*'],
    maxFileSize: '100m',
    validatePaths: false
  },

  // Performance - monitoring enabled
  performance: {
    monitoring: true,
    metrics: true,
    profiling: true,
    memoryThreshold: '200m',
    cpuThreshold: 80
  }
};
```

**Key Development Features:**
- **Maximum Verbosity**: All log levels enabled (`silly`)
- **Pretty Console Output**: Human-readable console logs with colors
- **Frequent Rotation**: Hourly rotation for easier debugging
- **Performance Monitoring**: Detailed performance metrics
- **Relaxed Security**: Faster development workflow

### Production Configuration

**File: `config/logging.production.js`**

```javascript
module.exports = {
  // Global settings
  level: 'info',
  separationMode: 'unified',
  enabled: true,

  // Console transport - disabled for production
  console: {
    enabled: false,
    format: 'json',
    colors: false,
    level: 'warn'
  },

  // File transport - optimized for production
  file: {
    enabled: true,
    directory: './logs/production',
    filename: 'tad-%DATE%.log',
    format: 'json',
    level: 'info',
    rotation: {
      frequency: 'daily',
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '30d'
    },
    retention: {
      maxAge: '90d',
      compressOld: true,
      deleteEmpty: true
    }
  },

  // IPC transport - optimized
  ipc: {
    enabled: true,
    bufferSize: 500,
    batchSize: 50,
    flushInterval: 5000,
    level: 'warn'
  },

  // Security - strict for production
  security: {
    sanitizeSensitiveData: true,
    allowedFileExtensions: ['.log', '.json'],
    maxFileSize: '10m',
    validatePaths: true,
    encryptLogs: true
  },

  // Performance - optimized
  performance: {
    monitoring: true,
    metrics: false,
    profiling: false,
    memoryThreshold: '100m',
    cpuThreshold: 60
  }
};
```

**Key Production Features:**
- **Minimal Verbosity**: Only essential logs (`info` and above)
- **No Console Output**: Prevents log leakage to console
- **Daily Rotation**: Balances file size and analysis needs
- **Long Retention**: 90 days for compliance and debugging
- **Compression**: Reduces storage costs
- **Strict Security**: Validates all inputs and paths

### Test Configuration

**File: `config/logging.test.js`**

```javascript
module.exports = {
  // Global settings
  level: 'error',
  separationMode: 'unified',
  enabled: true,

  // Console transport - minimal for tests
  console: {
    enabled: false,
    format: 'json',
    colors: false,
    level: 'error'
  },

  // File transport - test-specific logs
  file: {
    enabled: true,
    directory: './logs/test',
    filename: 'tad-test-%DATE%.log',
    format: 'json',
    level: 'error',
    rotation: {
      frequency: 'daily',
      maxSize: '5m',
      maxFiles: '7d'
    },
    retention: {
      maxAge: '7d',
      compressOld: false
    }
  },

  // IPC transport - disabled for tests
  ipc: {
    enabled: false,
    bufferSize: 100,
    level: 'error'
  },

  // Security - minimal for tests
  security: {
    sanitizeSensitiveData: false,
    allowedFileExtensions: ['*'],
    maxFileSize: '1m',
    validatePaths: false
  },

  // Performance - disabled for tests
  performance: {
    monitoring: false,
    metrics: false,
    profiling: false
  }
};
```

## Environment Variable Configuration

### Global Settings

```bash
# Log level (error, warn, info, debug, trace, silly)
LOG_LEVEL=info

# Separation mode (process, unified)
LOG_SEPARATION_MODE=unified

# Enable/disable logging
LOG_ENABLED=true

# Configuration file path
LOG_CONFIG_PATH=./config/custom-logging.js
```

### Transport-Specific Settings

```bash
# Console transport
LOG_CONSOLE_ENABLED=true
LOG_CONSOLE_FORMAT=pretty
LOG_CONSOLE_COLORS=true
LOG_CONSOLE_LEVEL=info

# File transport
LOG_FILE_ENABLED=true
LOG_FILE_DIRECTORY=./logs
LOG_FILE_FORMAT=json
LOG_FILE_LEVEL=info
LOG_FILE_MAX_SIZE=20m
LOG_FILE_MAX_FILES=14d

# IPC transport
LOG_IPC_ENABLED=true
LOG_IPC_BUFFER_SIZE=1000
LOG_IPC_BATCH_SIZE=10
LOG_IPC_FLUSH_INTERVAL=5000
```

### Advanced Settings

```bash
# Security settings
LOG_SECURITY_SANITIZE=true
LOG_SECURITY_MAX_FILE_SIZE=10m
LOG_SECURITY_VALIDATE_PATHS=true

# Performance settings
LOG_PERFORMANCE_MONITORING=true
LOG_PERFORMANCE_MEMORY_THRESHOLD=100m
LOG_PERFORMANCE_CPU_THRESHOLD=80

# Rotation settings
LOG_ROTATION_FREQUENCY=daily
LOG_ROTATION_MAX_AGE=30d
LOG_ROTATION_COMPRESS=true
```

## User Configuration File

### Location and Format

**File: `~/.tad/logging-config.json` (or `%APPDATA%/tad/logging-config.json` on Windows)**

```json
{
  "level": "debug",
  "separationMode": "process",
  "console": {
    "enabled": true,
    "format": "pretty",
    "colors": true
  },
  "file": {
    "directory": "/custom/log/directory",
    "rotation": {
      "maxFiles": "60d"
    }
  },
  "overrides": {
    "MainLogger": {
      "level": "trace"
    },
    "ChatLogger": {
      "level": "debug"
    }
  }
}
```

### Runtime Configuration Overrides

```typescript
// Runtime configuration changes
import { mainLogger } from './logger/MainLogger';

// Change log level at runtime
mainLogger.setLevel('debug');

// Update file transport settings
mainLogger.updateTransport('file', {
  maxSize: '100m',
  maxFiles: '60d'
});

// Enable/disable transports
mainLogger.enableTransport('console');
mainLogger.disableTransport('ipc');

// Update retention policy
mainLogger.updateRetention({
  maxAge: '120d',
  compressOld: true
});
```

## Component-Specific Configuration

### Logger Overrides

```javascript
// Component-specific log levels
const loggerConfig = {
  overrides: {
    "WorkspaceManager": {
      level: "debug",
      transports: ["file"]
    },
    "ChatService": {
      level: "trace",
      transports: ["console", "file"]
    },
    "FileSystem": {
      level: "info",
      transports: ["file"],
      filters: ["exclude-temp-files"]
    }
  }
};
```

### Transport Filters

```javascript
// Transport-specific filters
const transportFilters = {
  console: {
    exclude: ["trace", "silly"],
    include: ["error", "warn", "info"]
  },
  file: {
    exclude: [],
    include: ["*"],
    filters: [
      "exclude-sensitive-data",
      "include-user-actions"
    ]
  }
};
```

## Log Rotation and Retention Configuration

### Rotation Strategies

#### Time-Based Rotation

```javascript
const timeBasedRotation = {
  frequency: 'daily',        // daily, hourly, weekly
  datePattern: 'YYYY-MM-DD', // Moment.js format
  maxSize: '20m',           // Max size before rotation
  maxFiles: '14d'           // Keep files for 14 days
};
```

#### Size-Based Rotation

```javascript
const sizeBasedRotation = {
  frequency: 'size',        // Rotate based on size
  maxSize: '50m',           // Rotate when file reaches 50MB
  maxFiles: 10,             // Keep 10 files
  compressOnRotate: true    // Compress old files
};
```

#### Combined Rotation

```javascript
const combinedRotation = {
  frequency: 'combined',    // Both time and size
  datePattern: 'YYYY-MM-DD-HH',
  maxSize: '10m',
  maxFiles: '24h',         // 24 hours of hourly files
  compressOnRotate: true
};
```

### Retention Policies

#### Standard Retention

```javascript
const standardRetention = {
  maxAge: '30d',           // Delete files older than 30 days
  maxFiles: 100,           // Keep maximum 100 files
  compressOld: true,       // Compress files older than 7 days
  compressAfter: '7d',
  deleteEmpty: true        // Delete empty log files
};
```

#### Compliance Retention

```javascript
const complianceRetention = {
  maxAge: '2555d',         // 7 years for compliance
  maxFiles: 1000,          // Large number of files
  compressOld: true,
  compressAfter: '30d',    // Compress after 30 days
  encryptOld: true,        // Encrypt old files
  immutable: true          // Prevent deletion
};
```

#### Development Retention

```javascript
const developmentRetention = {
  maxAge: '7d',            // Short retention for development
  maxFiles: 50,
  compressOld: false,      // No compression for easy reading
  deleteEmpty: false       // Keep empty files for debugging
};
```

## Security Configuration

### Data Sanitization

```javascript
const securityConfig = {
  sanitizeSensitiveData: true,
  sensitiveKeys: [
    'password', 'token', 'apiKey', 'secret',
    'authorization', 'bearer', 'credentials'
  ],
  sensitivePatterns: [
    /password/i,
    /token/i,
    /key/i,
    /secret/i,
    /auth/i
  ],
  maskCharacter: '*',
  maskLength: 8
};
```

### File System Security

```javascript
const fileSecurityConfig = {
  allowedFileExtensions: ['.log', '.json', '.txt'],
  blockedFileExtensions: ['.exe', '.bat', '.cmd', '.scr'],
  allowedDirectories: ['./logs', '/var/log/tad'],
  blockedDirectories: ['/etc', '/usr', '/bin', 'C:\\Windows'],
  maxFileSize: '10m',
  maxDirectorySize: '1g',
  validatePaths: true,
  allowSymlinks: false
};
```

### Network Security

```javascript
const networkSecurityConfig = {
  allowedHosts: [
    'api.openai.com',
    'api.anthropic.com',
    'registry.npmjs.org'
  ],
  blockedHosts: ['*'],     // Block all except allowed
  allowedPorts: [80, 443, 22],
  maxRequestSize: '1m',
  timeout: 30000,
  sslVerification: true
};
```

## Performance Configuration

### Memory Management

```javascript
const memoryConfig = {
  bufferSize: 1000,        // Log entries buffer
  maxMemoryUsage: '100m',  // Max memory for logging
  gcThreshold: '50m',      // Trigger GC when exceeded
  objectPoolSize: 100,     // Reusable object pool
  bufferPoolSize: 10       // Reusable buffer pool
};
```

### CPU Optimization

```javascript
const cpuConfig = {
  asyncLogging: true,      // Non-blocking logging
  batchSize: 50,          // Batch log writes
  workerThreads: 2,       // Background workers
  compressionWorkers: 1,  // Compression workers
  maxConcurrency: 10      // Max concurrent operations
};
```

### Monitoring Configuration

```javascript
const monitoringConfig = {
  enabled: true,
  metrics: {
    logRate: true,         // Logs per second
    errorRate: true,       // Error percentage
    memoryUsage: true,     // Memory consumption
    diskUsage: true,       // Disk space used
    responseTime: true     // Average response time
  },
  alerts: {
    highMemoryUsage: '80%',    // Alert at 80% memory
    highErrorRate: '5%',       // Alert at 5% errors
    highDiskUsage: '90%',      // Alert at 90% disk
    slowResponseTime: '1000ms' // Alert at 1s response time
  },
  reporting: {
    interval: '5m',        // Report every 5 minutes
    format: 'json',
    destination: './logs/metrics'
  }
};
```

## Configuration Validation

### Schema Validation

```typescript
import Joi from 'joi';

const loggingConfigSchema = Joi.object({
  level: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace', 'silly').required(),
  separationMode: Joi.string().valid('process', 'unified').required(),
  enabled: Joi.boolean().default(true),

  console: Joi.object({
    enabled: Joi.boolean().default(false),
    format: Joi.string().valid('pretty', 'json').default('json'),
    colors: Joi.boolean().default(false),
    timestamp: Joi.boolean().default(true),
    level: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace', 'silly')
  }),

  file: Joi.object({
    enabled: Joi.boolean().default(true),
    directory: Joi.string().required(),
    filename: Joi.string().default('tad-%DATE%.log'),
    format: Joi.string().valid('json', 'text').default('json'),
    level: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace', 'silly'),
    rotation: Joi.object({
      frequency: Joi.string().valid('daily', 'hourly', 'weekly').default('daily'),
      maxSize: Joi.string().pattern(/^\d+[kmg]?$/).default('20m'),
      maxFiles: Joi.string().pattern(/^\d+[hdwm]?$/).default('14d')
    })
  }),

  ipc: Joi.object({
    enabled: Joi.boolean().default(true),
    bufferSize: Joi.number().min(1).max(10000).default(1000),
    batchSize: Joi.number().min(1).max(100).default(10),
    flushInterval: Joi.number().min(100).max(60000).default(5000)
  })
});

export function validateLoggingConfig(config: any): ValidationResult {
  const { error, value } = loggingConfigSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true
  });

  return {
    isValid: !error,
    errors: error ? error.details.map(detail => detail.message) : [],
    validatedConfig: value
  };
}
```

### Configuration Migration

#### From VS Code Extension

```typescript
// Migrate VS Code settings to Electron logging config
function migrateVSCodeSettings(vscodeSettings: any): LoggingConfig {
  return {
    level: mapVSCodeLogLevel(vscodeSettings['tad.logging.level']),
    separationMode: 'unified',
    console: {
      enabled: vscodeSettings['tad.logging.console'] !== false,
      format: vscodeSettings['tad.logging.format'] || 'pretty'
    },
    file: {
      enabled: true,
      directory: vscodeSettings['tad.logging.directory'] || './logs',
      rotation: {
        maxFiles: vscodeSettings['tad.logging.retention'] || '30d'
      }
    }
  };
}

function mapVSCodeLogLevel(vscodeLevel: string): LogLevel {
  const levelMap = {
    'off': 'error',
    'error': 'error',
    'warn': 'warn',
    'info': 'info',
    'debug': 'debug',
    'trace': 'trace',
    'verbose': 'silly'
  };
  return levelMap[vscodeLevel] || 'info';
}
```

#### Configuration Versioning

```typescript
const CONFIG_VERSIONS = {
  '1.0.0': {
    migration: (config: any) => ({
      ...config,
      version: '1.1.0',
      ipc: config.ipc || { enabled: true, bufferSize: 1000 }
    })
  },
  '1.1.0': {
    migration: (config: any) => ({
      ...config,
      version: '1.2.0',
      security: config.security || { sanitizeSensitiveData: true }
    })
  }
};

export function migrateConfiguration(config: any): LoggingConfig {
  let migratedConfig = { ...config };
  const targetVersion = '1.2.0';

  while (migratedConfig.version !== targetVersion) {
    const migration = CONFIG_VERSIONS[migratedConfig.version];
    if (!migration) break;

    migratedConfig = migration.migration(migratedConfig);
  }

  return migratedConfig;
}
```

## Best Practices

### Configuration Management

1. **Use Environment Variables for Secrets**: Never store sensitive data in config files
2. **Validate Configuration**: Always validate config before applying
3. **Version Control**: Keep configuration under version control (except secrets)
4. **Documentation**: Document all configuration options
5. **Testing**: Test configuration changes in staging environment

### Performance Optimization

1. **Right-size Buffers**: Balance memory usage with performance
2. **Monitor Resource Usage**: Set up alerts for resource thresholds
3. **Optimize Rotation**: Choose rotation strategy based on use case
4. **Compress Old Logs**: Reduce storage costs for old logs
5. **Async Operations**: Use async logging to avoid blocking

### Security Best Practices

1. **Sanitize Data**: Always sanitize sensitive information
2. **Validate Paths**: Validate file paths to prevent traversal attacks
3. **Limit File Sizes**: Prevent log files from consuming too much disk space
4. **Regular Audits**: Regularly audit log files for security issues
5. **Access Control**: Restrict access to log files and directories

### Maintenance

1. **Regular Cleanup**: Implement automated log cleanup
2. **Monitor Disk Usage**: Set up alerts for disk space issues
3. **Backup Important Logs**: Backup critical logs before deletion
4. **Archive Old Logs**: Archive old logs for compliance requirements
5. **Update Configuration**: Regularly review and update logging configuration

This comprehensive configuration guide provides all the necessary information to properly configure the electron-timber logging system for different environments and use cases, ensuring optimal performance, security, and maintainability.