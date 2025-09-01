# Electron Store Schema Definition

## Overview

This document defines the complete schema for the electron-store implementation in the TAD Electron application. The schema ensures data consistency, provides validation rules, and supports automatic migration between versions.

## Schema Structure

### Root Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "description": "Application version for migration tracking",
      "default": "1.0.0"
    },
    "settings": { "$ref": "#/definitions/Settings" },
    "user": { "$ref": "#/definitions/User" },
    "ai": { "$ref": "#/definitions/AIConfig" },
    "workspaces": { "$ref": "#/definitions/Workspaces" },
    "ui": { "$ref": "#/definitions/UIState" },
    "recent": { "$ref": "#/definitions/RecentItems" },
    "cache": { "$ref": "#/definitions/Cache" }
  },
  "additionalProperties": false,
  "required": ["version"]
}
```

## Schema Definitions

### Settings Schema

```json
{
  "Settings": {
    "type": "object",
    "description": "Application-wide settings",
    "properties": {
      "theme": {
        "type": "string",
        "enum": ["light", "dark", "auto"],
        "default": "auto",
        "description": "UI theme preference"
      },
      "language": {
        "type": "string",
        "default": "en",
        "description": "Application language"
      },
      "autoSave": {
        "type": "boolean",
        "default": true,
        "description": "Automatically save changes"
      },
      "fontSize": {
        "type": "number",
        "minimum": 8,
        "maximum": 24,
        "default": 14,
        "description": "Font size in pixels"
      },
      "fontFamily": {
        "type": "string",
        "default": "system-ui, -apple-system, sans-serif",
        "description": "Font family preference"
      },
      "notifications": {
        "type": "object",
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": true
          },
          "sound": {
            "type": "boolean",
            "default": true
          },
          "desktop": {
            "type": "boolean",
            "default": true
          }
        },
        "default": {
          "enabled": true,
          "sound": true,
          "desktop": true
        }
      },
      "editor": {
        "type": "object",
        "properties": {
          "tabSize": {
            "type": "number",
            "minimum": 2,
            "maximum": 8,
            "default": 2
          },
          "insertSpaces": {
            "type": "boolean",
            "default": true
          },
          "wordWrap": {
            "type": "string",
            "enum": ["off", "on", "wordWrapColumn", "bounded"],
            "default": "on"
          },
          "minimap": {
            "type": "boolean",
            "default": true
          },
          "lineNumbers": {
            "type": "string",
            "enum": ["off", "on", "relative", "interval"],
            "default": "on"
          }
        },
        "default": {
          "tabSize": 2,
          "insertSpaces": true,
          "wordWrap": "on",
          "minimap": true,
          "lineNumbers": "on"
        }
      },
      "build": {
        "type": "object",
        "properties": {
          "autoBuild": {
            "type": "boolean",
            "default": true
          },
          "buildOnSave": {
            "type": "boolean",
            "default": true
          },
          "clearConsole": {
            "type": "boolean",
            "default": true
          },
          "showBuildNotifications": {
            "type": "boolean",
            "default": true
          }
        },
        "default": {
          "autoBuild": true,
          "buildOnSave": true,
          "clearConsole": true,
          "showBuildNotifications": true
        }
      }
    },
    "default": {
      "theme": "auto",
      "language": "en",
      "autoSave": true,
      "fontSize": 14,
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "notifications": {
        "enabled": true,
        "sound": true,
        "desktop": true
      },
      "editor": {
        "tabSize": 2,
        "insertSpaces": true,
        "wordWrap": "on",
        "minimap": true,
        "lineNumbers": "on"
      },
      "build": {
        "autoBuild": true,
        "buildOnSave": true,
        "clearConsole": true,
        "showBuildNotifications": true
      }
    }
  }
}
```

### User Profile Schema

```json
{
  "User": {
    "type": "object",
    "description": "User profile and preferences",
    "properties": {
      "id": {
        "type": "string",
        "description": "Unique user identifier"
      },
      "name": {
        "type": "string",
        "maxLength": 100,
        "description": "User's display name"
      },
      "email": {
        "type": "string",
        "format": "email",
        "description": "User's email address"
      },
      "avatar": {
        "type": "string",
        "format": "uri",
        "description": "URL to user's avatar image"
      },
      "preferences": {
        "type": "object",
        "properties": {
          "notifications": {
            "type": "boolean",
            "default": true
          },
          "analytics": {
            "type": "boolean",
            "default": false
          },
          "autoUpdate": {
            "type": "boolean",
            "default": true
          },
          "crashReporting": {
            "type": "boolean",
            "default": true
          },
          "dataCollection": {
            "type": "boolean",
            "default": false
          }
        },
        "default": {
          "notifications": true,
          "analytics": false,
          "autoUpdate": true,
          "crashReporting": true,
          "dataCollection": false
        }
      },
      "lastLogin": {
        "type": "string",
        "format": "date-time",
        "description": "Last login timestamp"
      },
      "loginCount": {
        "type": "number",
        "minimum": 0,
        "default": 0,
        "description": "Number of times user has logged in"
      }
    },
    "required": ["id"]
  }
}
```

### AI Configuration Schema

```json
{
  "AIConfig": {
    "type": "object",
    "description": "AI provider and model configuration",
    "properties": {
      "provider": {
        "type": "string",
        "enum": ["openai", "anthropic", "openrouter", "local"],
        "default": "openai",
        "description": "AI provider to use"
      },
      "model": {
        "type": "string",
        "default": "gpt-4o",
        "description": "AI model to use"
      },
      "apiKey": {
        "type": "string",
        "description": "API key for the AI provider",
        "sensitive": true
      },
      "baseUrl": {
        "type": "string",
        "format": "uri",
        "description": "Custom base URL for API calls"
      },
      "temperature": {
        "type": "number",
        "minimum": 0,
        "maximum": 2,
        "default": 0.7,
        "description": "Controls randomness in AI responses"
      },
      "maxTokens": {
        "type": "number",
        "minimum": 1,
        "maximum": 32768,
        "default": 2048,
        "description": "Maximum tokens in AI response"
      },
      "topP": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "default": 1,
        "description": "Controls diversity via nucleus sampling"
      },
      "frequencyPenalty": {
        "type": "number",
        "minimum": -2,
        "maximum": 2,
        "default": 0,
        "description": "Reduces repetition of frequent tokens"
      },
      "presencePenalty": {
        "type": "number",
        "minimum": -2,
        "maximum": 2,
        "default": 0,
        "description": "Encourages new topics"
      },
      "systemPrompt": {
        "type": "string",
        "maxLength": 10000,
        "description": "Custom system prompt for AI"
      },
      "timeout": {
        "type": "number",
        "minimum": 1000,
        "maximum": 300000,
        "default": 30000,
        "description": "Request timeout in milliseconds"
      },
      "retryAttempts": {
        "type": "number",
        "minimum": 0,
        "maximum": 10,
        "default": 3,
        "description": "Number of retry attempts for failed requests"
      },
      "retryDelay": {
        "type": "number",
        "minimum": 100,
        "maximum": 10000,
        "default": 1000,
        "description": "Delay between retry attempts in milliseconds"
      }
    },
    "default": {
      "provider": "openai",
      "model": "gpt-4o",
      "temperature": 0.7,
      "maxTokens": 2048,
      "topP": 1,
      "frequencyPenalty": 0,
      "presencePenalty": 0,
      "timeout": 30000,
      "retryAttempts": 3,
      "retryDelay": 1000
    }
  }
}
```

### Workspaces Schema

```json
{
  "Workspaces": {
    "type": "object",
    "description": "Workspace configurations",
    "patternProperties": {
      ".*": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique workspace identifier"
          },
          "name": {
            "type": "string",
            "maxLength": 100,
            "description": "Display name for the workspace"
          },
          "path": {
            "type": "string",
            "description": "File system path to the workspace"
          },
          "type": {
            "type": "string",
            "enum": ["local", "remote", "cloud"],
            "default": "local",
            "description": "Type of workspace"
          },
          "settings": {
            "type": "object",
            "properties": {
              "buildOnSave": {
                "type": "boolean",
                "default": true
              },
              "autoRefresh": {
                "type": "boolean",
                "default": false
              },
              "templateRoot": {
                "type": "string",
                "default": ".tad/templates"
              },
              "outputDir": {
                "type": "string",
                "default": ".tad/dist"
              },
              "watchIgnored": {
                "type": "array",
                "items": { "type": "string" },
                "default": ["node_modules", ".git"]
              }
            },
            "default": {
              "buildOnSave": true,
              "autoRefresh": false,
              "templateRoot": ".tad/templates",
              "outputDir": ".tad/dist",
              "watchIgnored": ["node_modules", ".git"]
            }
          },
          "metadata": {
            "type": "object",
            "properties": {
              "created": {
                "type": "string",
                "format": "date-time"
              },
              "lastOpened": {
                "type": "string",
                "format": "date-time"
              },
              "lastModified": {
                "type": "string",
                "format": "date-time"
              },
              "fileCount": {
                "type": "number",
                "minimum": 0
              },
              "size": {
                "type": "number",
                "minimum": 0,
                "description": "Workspace size in bytes"
              }
            }
          },
          "favorites": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Paths to favorite files/templates"
          },
          "bookmarks": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "path": { "type": "string" },
                "line": { "type": "number", "minimum": 1 }
              },
              "required": ["name", "path"]
            }
          }
        },
        "required": ["id", "name", "path"]
      }
    },
    "default": {}
  }
}
```

### UI State Schema

```json
{
  "UIState": {
    "type": "object",
    "description": "UI state and layout preferences",
    "properties": {
      "mainWindow": {
        "type": "object",
        "properties": {
          "bounds": {
            "type": "object",
            "properties": {
              "x": { "type": "number" },
              "y": { "type": "number" },
              "width": { "type": "number", "minimum": 800 },
              "height": { "type": "number", "minimum": 600 }
            }
          },
          "maximized": {
            "type": "boolean",
            "default": false
          },
          "fullscreen": {
            "type": "boolean",
            "default": false
          }
        }
      },
      "sidebar": {
        "type": "object",
        "properties": {
          "collapsed": {
            "type": "boolean",
            "default": false
          },
          "width": {
            "type": "number",
            "minimum": 200,
            "maximum": 600,
            "default": 300
          },
          "activePanel": {
            "type": "string",
            "enum": ["files", "templates", "components", "settings"],
            "default": "files"
          }
        },
        "default": {
          "collapsed": false,
          "width": 300,
          "activePanel": "files"
        }
      },
      "panels": {
        "type": "object",
        "properties": {
          "active": {
            "type": "array",
            "items": { "type": "string" },
            "default": ["chat", "preview"]
          },
          "layout": {
            "type": "string",
            "enum": ["horizontal", "vertical", "grid"],
            "default": "horizontal"
          }
        },
        "default": {
          "active": ["chat", "preview"],
          "layout": "horizontal"
        }
      },
      "editor": {
        "type": "object",
        "properties": {
          "zoom": {
            "type": "number",
            "minimum": 0.1,
            "maximum": 3.0,
            "default": 1.0
          },
          "fontSize": {
            "type": "number",
            "minimum": 8,
            "maximum": 24,
            "default": 14
          },
          "theme": {
            "type": "string",
            "default": "vs-dark"
          }
        },
        "default": {
          "zoom": 1.0,
          "fontSize": 14,
          "theme": "vs-dark"
        }
      },
      "canvas": {
        "type": "object",
        "properties": {
          "zoom": {
            "type": "number",
            "minimum": 0.1,
            "maximum": 5.0,
            "default": 1.0
          },
          "pan": {
            "type": "object",
            "properties": {
              "x": { "type": "number", "default": 0 },
              "y": { "type": "number", "default": 0 }
            },
            "default": { "x": 0, "y": 0 }
          },
          "layout": {
            "type": "string",
            "enum": ["grid", "freeform", "hierarchy"],
            "default": "grid"
          },
          "showGrid": {
            "type": "boolean",
            "default": true
          },
          "snapToGrid": {
            "type": "boolean",
            "default": true
          }
        },
        "default": {
          "zoom": 1.0,
          "pan": { "x": 0, "y": 0 },
          "layout": "grid",
          "showGrid": true,
          "snapToGrid": true
        }
      }
    },
    "default": {
      "mainWindow": {
        "maximized": false,
        "fullscreen": false
      },
      "sidebar": {
        "collapsed": false,
        "width": 300,
        "activePanel": "files"
      },
      "panels": {
        "active": ["chat", "preview"],
        "layout": "horizontal"
      },
      "editor": {
        "zoom": 1.0,
        "fontSize": 14,
        "theme": "vs-dark"
      },
      "canvas": {
        "zoom": 1.0,
        "pan": { "x": 0, "y": 0 },
        "layout": "grid",
        "showGrid": true,
        "snapToGrid": true
      }
    }
  }
}
```

### Recent Items Schema

```json
{
  "RecentItems": {
    "type": "object",
    "description": "Recently accessed items for quick access",
    "properties": {
      "workspaces": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 10,
        "uniqueItems": true,
        "description": "Recently opened workspace paths"
      },
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 20,
        "uniqueItems": true,
        "description": "Recently opened file paths"
      },
      "templates": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 15,
        "uniqueItems": true,
        "description": "Recently used template paths"
      },
      "searches": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 10,
        "uniqueItems": true,
        "description": "Recent search queries"
      }
    },
    "default": {
      "workspaces": [],
      "files": [],
      "templates": [],
      "searches": []
    }
  }
}
```

### Cache Schema

```json
{
  "Cache": {
    "type": "object",
    "description": "Application cache for performance optimization",
    "properties": {
      "templates": {
        "type": "object",
        "description": "Template compilation cache",
        "patternProperties": {
          ".*": {
            "type": "object",
            "properties": {
              "hash": { "type": "string" },
              "lastModified": { "type": "string", "format": "date-time" },
              "size": { "type": "number" },
              "dependencies": {
                "type": "array",
                "items": { "type": "string" }
              }
            }
          }
        }
      },
      "api": {
        "type": "object",
        "description": "API response cache",
        "patternProperties": {
          ".*": {
            "type": "object",
            "properties": {
              "data": { "type": "string" },
              "timestamp": { "type": "string", "format": "date-time" },
              "ttl": { "type": "number" }
            }
          }
        }
      },
      "metadata": {
        "type": "object",
        "description": "File and workspace metadata cache",
        "patternProperties": {
          ".*": {
            "type": "object",
            "properties": {
              "type": { "type": "string" },
              "size": { "type": "number" },
              "modified": { "type": "string", "format": "date-time" },
              "hash": { "type": "string" }
            }
          }
        }
      }
    },
    "default": {
      "templates": {},
      "api": {},
      "metadata": {}
    }
  }
}
```

## Schema Validation Rules

### Type Validation

- **String**: Basic string validation with optional min/max length
- **Number**: Numeric validation with optional min/max bounds
- **Boolean**: True/false validation
- **Object**: Nested object validation with required properties
- **Array**: Array validation with item type constraints

### Format Validation

- **Email**: RFC 5322 compliant email validation
- **URI**: RFC 3986 compliant URI validation
- **Date-Time**: ISO 8601 date-time format validation

### Custom Validation Rules

```javascript
// Custom validation functions
const customValidators = {
  // Validate workspace path exists
  validateWorkspacePath: (path) => {
    return fs.existsSync(path) && fs.statSync(path).isDirectory();
  },

  // Validate API key format
  validateApiKey: (key, provider) => {
    const patterns = {
      openai: /^sk-[a-zA-Z0-9]{48}$/,
      anthropic: /^sk-ant-[a-zA-Z0-9-_]{95,}$/
    };
    return patterns[provider]?.test(key) ?? true;
  },

  // Validate template file exists
  validateTemplatePath: (path) => {
    return path.endsWith('.njk') && fs.existsSync(path);
  }
};
```

## Migration Strategies

### Version Migration Rules

```javascript
const migrationRules = {
  '1.0.0': {
    to: '1.1.0',
    changes: [
      {
        type: 'add',
        path: 'settings.editor',
        value: {
          tabSize: 2,
          insertSpaces: true,
          wordWrap: 'on',
          minimap: true,
          lineNumbers: 'on'
        }
      },
      {
        type: 'rename',
        from: 'settings.notifications.enabled',
        to: 'settings.notifications.desktop'
      }
    ]
  },
  '1.1.0': {
    to: '1.2.0',
    changes: [
      {
        type: 'add',
        path: 'ai.timeout',
        value: 30000
      },
      {
        type: 'add',
        path: 'ai.retryAttempts',
        value: 3
      }
    ]
  }
};
```

### Migration Execution

```javascript
class SchemaMigrator {
  async migrate(data, fromVersion, toVersion) {
    const rule = migrationRules[fromVersion];
    if (!rule) {
      throw new Error(`No migration rule found for ${fromVersion} to ${toVersion}`);
    }

    let migratedData = { ...data };

    for (const change of rule.changes) {
      migratedData = await this.applyChange(migratedData, change);
    }

    migratedData.version = toVersion;
    return migratedData;
  }

  async applyChange(data, change) {
    switch (change.type) {
      case 'add':
        return this.setNestedValue(data, change.path, change.value);
      case 'remove':
        return this.deleteNestedValue(data, change.path);
      case 'rename':
        return this.renameNestedValue(data, change.from, change.to);
      case 'transform':
        return await this.transformValue(data, change.path, change.transformer);
      default:
        return data;
    }
  }
}
```

## Schema Extensions

### Custom Property Types

```javascript
// Define custom property types
const customTypes = {
  'color': {
    type: 'string',
    pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$'
  },
  'file-path': {
    type: 'string',
    validate: (value) => fs.existsSync(value)
  },
  'directory-path': {
    type: 'string',
    validate: (value) => fs.existsSync(value) && fs.statSync(value).isDirectory()
  },
  'semver': {
    type: 'string',
    pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$'
  }
};
```

### Conditional Validation

```javascript
// Conditional validation based on other properties
const conditionalRules = [
  {
    condition: { 'ai.provider': 'openai' },
    required: ['ai.apiKey'],
    properties: {
      'ai.model': {
        enum: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']
      }
    }
  },
  {
    condition: { 'ai.provider': 'anthropic' },
    required: ['ai.apiKey'],
    properties: {
      'ai.model': {
        enum: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku']
      }
    }
  }
];
```

## Schema Documentation

### Auto-Generated Documentation

```javascript
class SchemaDocumentor {
  generateMarkdown(schema) {
    let markdown = '# Data Schema Documentation\n\n';

    for (const [key, definition] of Object.entries(schema.definitions)) {
      markdown += this.generateSection(key, definition);
    }

    return markdown;
  }

  generateSection(name, definition) {
    let section = `## ${name}\n\n`;

    if (definition.description) {
      section += `${definition.description}\n\n`;
    }

    if (definition.properties) {
      section += '### Properties\n\n';
      section += '| Property | Type | Default | Description |\n';
      section += '|----------|------|---------|-------------|\n';

      for (const [prop, config] of Object.entries(definition.properties)) {
        const type = this.getTypeString(config);
        const defaultValue = config.default !== undefined ? `\`${JSON.stringify(config.default)}\`` : '-';
        const description = config.description || '';

        section += `| ${prop} | ${type} | ${defaultValue} | ${description} |\n`;
      }
      section += '\n';
    }

    return section;
  }

  getTypeString(config) {
    if (config.enum) {
      return `enum: ${config.enum.map(v => `\`${v}\``).join(', ')}`;
    }

    let type = config.type;
    if (config.format) type += ` (${config.format})`;
    if (config.pattern) type += ' (pattern)';

    return type;
  }
}
```

This schema definition provides a comprehensive structure for the electron-store implementation, ensuring data consistency, validation, and maintainability across the TAD Electron application.