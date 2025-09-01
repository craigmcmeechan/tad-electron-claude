ocs/developmentplanning/language-server-electron/README.md</path>
<content">          start: { line: brace.line, character: brace.char },
          end: { line: brace.line, character: brace.char + 2 }
        },
        message,
        severity,
        source: 'nunjucks-lsp'
      });
    }
  }

  addError(message, lineNumber, startChar, endChar) {
    this.errors.push({
      range: {
        start: { line: lineNumber, character: startChar },
        end: { line: lineNumber, character: endChar }
      },
      message,
      severity: 1, // Error
      source: 'nunjucks-lsp'
    });
  }

  addWarning(message, lineNumber, startChar, endChar) {
    this.errors.push({
      range: {
        start: { line: lineNumber, character: startChar },
        end: { line: lineNumber, character: endChar }
      },
      message,
      severity: 2, // Warning
      source: 'nunjucks-lsp'
    });
  }
}

module.exports = NunjucksDiagnostics;
```

### 8. Formatting Provider

Provides document and range formatting capabilities.

```typescript
// src/language-server/formatting/NunjucksFormatter.js
class NunjucksFormatter {
  constructor() {
    this.indentSize = 2;
    this.indentChar = ' ';
  }

  format(content, options = {}) {
    this.indentSize = options.tabSize || 2;
    this.indentChar = options.insertSpaces ? ' ' : '\t';

    const lines = content.split('\n');
    const formattedLines = [];
    let indentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const formattedLine = this.formatLine(line, indentLevel, i, lines);
      formattedLines.push(formattedLine);

      // Update indent level based on the line
      indentLevel = this.updateIndentLevel(line, indentLevel);
    }

    return formattedLines.join('\n');
  }

  formatLine(line, indentLevel, lineIndex, allLines) {
    if (!line) return '';

    // Calculate the current indent
    const currentIndent = this.getIndentString(indentLevel);

    // Handle different line types
    if (line.includes('{%')) {
      return this.formatStatementLine(line, currentIndent);
    } else if (line.includes('{{')) {
      return this.formatExpressionLine(line, currentIndent);
    } else {
      return currentIndent + line;
    }
  }

  formatStatementLine(line, indent) {
    // Format Nunjucks statements
    let formatted = line;

    // Add space after {% and before %}
    formatted = formatted.replace(/{%\s*/, '{% ');
    formatted = formatted.replace(/\s*%}/, ' %}');

    // Format specific statement types
    if (formatted.includes('if ')) {
      formatted = this.formatIfStatement(formatted);
    } else if (formatted.includes('for ')) {
      formatted = this.formatForStatement(formatted);
    } else if (formatted.includes('set ')) {
      formatted = this.formatSetStatement(formatted);
    }

    return indent + formatted;
  }

  formatExpressionLine(line, indent) {
    // Format Nunjucks expressions
    let formatted = line;

    // Add space after {{ and before }}
    formatted = formatted.replace(/{{\s*/, '{{ ');
    formatted = formatted.replace(/\s*}}/, ' }}');

    return indent + formatted;
  }

  formatIfStatement(line) {
    // Format if statements
    return line.replace(/{%\s*if\s+(.+?)\s*%}/, '{% if $1 %}');
  }

  formatForStatement(line) {
    // Format for statements
    return line.replace(/{%\s*for\s+(.+?)\s*%}/, '{% for $1 %}');
  }

  formatSetStatement(line) {
    // Format set statements
    return line.replace(/{%\s*set\s+(.+?)\s*%}/, '{% set $1 %}');
  }

  updateIndentLevel(line, currentLevel) {
    let newLevel = currentLevel;

    // Increase indent for block start statements
    if (line.includes('{% if ') || line.includes('{% for ') ||
        line.includes('{% macro ') || line.includes('{% block ')) {
      newLevel++;
    }

    // Decrease indent for block end statements
    if (line.includes('{% endif %}') || line.includes('{% endfor %}') ||
        line.includes('{% endmacro %}') || line.includes('{% endblock %}')) {
      newLevel = Math.max(0, newLevel - 1);
    }

    return newLevel;
  }

  getIndentString(level) {
    if (this.indentChar === '\t') {
      return '\t'.repeat(level);
    } else {
      return ' '.repeat(level * this.indentSize);
    }
  }

  formatRange(content, range, options) {
    // Format only the specified range
    const lines = content.split('\n');
    const startLine = range.start.line;
    const endLine = range.end.line;

    const linesToFormat = lines.slice(startLine, endLine + 1);
    const formattedLines = this.format(linesToFormat.join('\n'), options).split('\n');

    // Replace the original lines
    lines.splice(startLine, endLine - startLine + 1, ...formattedLines);

    return lines.join('\n');
  }
}

module.exports = NunjucksFormatter;
```

## Implementation Roadmap

### Phase 1: Core LSP Infrastructure (Week 1-2)

#### 1.1 Project Setup
- [ ] Create `src/language-server/` directory structure
- [ ] Set up `package.json` with LSP dependencies
- [ ] Configure build system for language server
- [ ] Set up basic project scaffolding

#### 1.2 Core LSP Server
- [ ] Implement basic LSP server with JSON-RPC communication
- [ ] Add text document synchronization capabilities
- [ ] Implement server lifecycle management (initialize, shutdown)
- [ ] Add basic error handling and logging

#### 1.3 Main Process Integration
- [ ] Create `LanguageServerManager` class in main process
- [ ] Implement IPC communication between main and LSP server
- [ ] Add server process management and monitoring
- [ ] Integrate with existing Electron application structure

### Phase 2: Language Features Implementation (Week 3-4)

#### 2.1 Parser and AST
- [ ] Implement `NunjucksParser` with tokenization
- [ ] Add AST generation for template structures
- [ ] Support for all Nunjucks statement types
- [ ] Handle expressions, filters, and macros

#### 2.2 Completion Provider
- [ ] Implement keyword completion
- [ ] Add filter completion with documentation
- [ ] Support macro completion with signatures
- [ ] Variable completion from template context

#### 2.3 Diagnostics System
- [ ] Syntax validation for Nunjucks templates
- [ ] Error reporting for malformed statements
- [ ] Warning for deprecated patterns
- [ ] Real-time validation as user types

### Phase 3: Advanced Features (Week 5-6)

#### 3.1 Definition and References
- [ ] Go to definition for includes and extends
- [ ] Find references for variables and macros
- [ ] Cross-file navigation support
- [ ] Symbol resolution across template hierarchy

#### 3.2 Hover Information
- [ ] Contextual help for keywords and filters
- [ ] Macro signature display
- [ ] Variable type information
- [ ] Documentation on hover

#### 3.3 Formatting Support
- [ ] Document formatting with consistent indentation
- [ ] Range formatting for selections
- [ ] Configurable formatting options
- [ ] Integration with save actions

### Phase 4: Integration and Testing (Week 7-8)

#### 4.1 Electron Integration
- [ ] Connect LSP server to template editor
- [ ] Implement real-time diagnostics in UI
- [ ] Add completion suggestions to editor
- [ ] Integrate hover information display

#### 4.2 Workspace Features
- [ ] Template index building and maintenance
- [ ] Cross-template symbol resolution
- [ ] Incremental re-indexing on file changes
- [ ] Performance optimization for large workspaces

#### 4.3 Testing and Validation
- [ ] Unit tests for all LSP components
- [ ] Integration tests with Electron
- [ ] Performance testing with large template sets
- [ ] Cross-platform compatibility testing

## Key Technical Considerations

### Performance Optimization

#### 1. Incremental Parsing
```typescript
class IncrementalParser {
  parseIncremental(document, changes) {
    // Only re-parse changed sections
    // Update AST incrementally
    // Maintain symbol table efficiently
  }
}
```

#### 2. Caching Strategy
```typescript
class TemplateCache {
  constructor() {
    this.astCache = new Map();
    this.symbolCache = new Map();
    this.maxCacheSize = 100;
  }

  getCachedAST(filePath) {
    return this.astCache.get(filePath);
  }

  invalidateCache(filePath) {
    this.astCache.delete(filePath);
    this.symbolCache.delete(filePath);
  }
}
```

#### 3. Memory Management
- Implement LRU cache for frequently accessed templates
- Clean up unused AST nodes and symbol tables
- Monitor memory usage and implement garbage collection hints

### Error Handling and Recovery

#### 1. Graceful Degradation
```typescript
class ErrorRecovery {
  handleParseError(error, document) {
    // Continue parsing despite errors
    // Provide partial AST for available features
    // Log errors for debugging
  }

  handleServerCrash() {
    // Restart LSP server automatically
    // Preserve user session state
    // Notify user of temporary service interruption
  }
}
```

#### 2. User-Friendly Error Messages
- Translate technical errors to user-understandable messages
- Provide suggestions for fixing common issues
- Link to documentation for complex problems

### Security Considerations

#### 1. Input Validation
- Validate all file paths and URIs
- Sanitize template content before processing
- Prevent directory traversal attacks
- Limit file size and processing time

#### 2. Process Isolation
- Run LSP server in separate process from Electron main
- Implement IPC message validation
- Prevent malicious template code execution
- Sandbox file system operations

## Benefits of Standalone LSP Implementation

### 1. **Full Control and Customization**
- Complete control over language features and behavior
- Customizable completion and validation rules
- Extensible architecture for future enhancements
- No dependency on external LSP server availability

### 2. **Performance Optimization**
- Optimized for Nunjucks-specific patterns
- Efficient incremental parsing and caching
- Reduced latency through direct integration
- Memory-efficient symbol resolution

### 3. **Enhanced User Experience**
- Context-aware completions and suggestions
- Real-time syntax validation and error reporting
- Intelligent code navigation and refactoring
- Integrated documentation and help system

### 4. **Maintainability and Extensibility**
- Modular architecture with clear separation of concerns
- Comprehensive test coverage and validation
- Easy to extend with new language features
- Well-documented codebase for future development

## Integration with Electron Application

### 1. **Template Editor Integration**
```typescript
// src/renderer/editor/TemplateEditor.js
class TemplateEditor {
  constructor() {
    this.lspClient = new LSPClient();
    this.setupLanguageFeatures();
  }

  setupLanguageFeatures() {
    // Connect to LSP server for:
    // - Syntax highlighting
    // - Error diagnostics
    // - Auto-completion
    // - Go to definition
    // - Hover information
  }

  async provideCompletions(position) {
    return await this.lspClient.requestCompletion({
      filePath: this.currentFile,
      position: position
    });
  }
}
```

### 2. **Workspace Integration**
```typescript
// src/main/WorkspaceManager.js
class WorkspaceManager {
  constructor() {
    this.lspManager = new LanguageServerManager(this);
    this.templateIndex = new Map();
  }

  async initialize() {
    await this.lspManager.startServer();
    await this.buildTemplateIndex();
  }

  async onFileChanged(filePath) {
    // Notify LSP server of file changes
    await this.lspManager.notifyFileChanged(filePath);

    // Update local template index
    await this.updateTemplateIndex(filePath);
  }
}
```

### 3. **UI Integration**
```typescript
// src/renderer/components/LSPStatus.js
class LSPStatus {
  constructor() {
    this.status = 'disconnected';
    this.setupStatusMonitoring();
  }

  setupStatusMonitoring() {
    // Monitor LSP server status
    // Display connection state
    // Show language feature availability
    // Handle reconnection logic
  }

  updateStatus(newStatus) {
    this.status = newStatus;
    this.updateUI();
  }
}
```

## Testing Strategy

### 1. **Unit Testing**
```typescript
// tests/language-server/parser.test.js
describe('NunjucksParser', () => {
  test('should parse basic statements', () => {
    const parser = new NunjucksParser();
    const ast = parser.parse('{% set title = "Hello" %}');

    expect(ast.body).toHaveLength(1);
    expect(ast.body[0].type).toBe('SetStatement');
  });

  test('should handle complex expressions', () => {
    const parser = new NunjucksParser();
    const ast = parser.parse('{{ user.name | default("Anonymous") }}');

    expect(ast.body[0].type).toBe('Expression');
  });
});
```

### 2. **Integration Testing**
```typescript
// tests/integration/lsp-integration.test.ts
describe('LSP Integration', () => {
  let lspServer;
  let electronApp;

  beforeEach(async () => {
    lspServer = await startLSPServer();
    electronApp = await startElectronApp();
  });

  test('should provide completions in editor', async () => {
    const editor = await electronApp.openTemplateEditor();
    await editor.type('{% ');

    const completions = await editor.getCompletions();
    expect(completions.items).toContain('if');
    expect(completions.items).toContain('set');
  });
});
```

### 3. **Performance Testing**
```typescript
// tests/performance/lsp-performance.test.js
describe('LSP Performance', () => {
  test('should parse large templates quickly', async () => {
    const largeTemplate = generateLargeTemplate(1000); // 1000 lines
    const parser = new NunjucksParser();

    const startTime = Date.now();
    const ast = parser.parse(largeTemplate);
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(100); // 100ms max
    expect(ast.body).toBeDefined();
  });
});
```

## Conclusion

This standalone LSP server implementation provides a comprehensive, high-performance language service for Nunjucks templating that seamlessly integrates with the Electron version of TAD. The modular architecture ensures maintainability while the extensive feature set provides a superior development experience compared to generic language servers.

The implementation focuses on:

- **Performance**: Optimized parsing and caching for large template sets
- **Accuracy**: Nunjucks-specific understanding of template syntax and semantics
- **Integration**: Seamless integration with Electron's process architecture
- **Extensibility**: Modular design allowing easy addition of new features
- **Reliability**: Comprehensive error handling and recovery mechanisms

This LSP server will be a core component of the Electron TAD application, providing the intelligent language features that developers expect from a modern template development environment.