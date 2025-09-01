# LSP Server Implementation Details

## Package Configuration

### package.json
```json
{
  "name": "nunjucks-language-server",
  "version": "1.0.0",
  "description": "Standalone Language Server Protocol implementation for Nunjucks templating language",
  "main": "bin/nunjucks-lsp",
  "bin": {
    "nunjucks-lsp": "./bin/nunjucks-lsp.js"
  },
  "scripts": {
    "build": "webpack --mode production",
    "dev": "webpack --mode development --watch",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/**/*.js",
    "lint:fix": "eslint src/**/*.js --fix"
  },
  "dependencies": {
    "vscode-languageserver": "^8.0.2",
    "vscode-languageserver-textdocument": "^1.0.8",
    "nunjucks": "^3.2.3",
    "glob": "^8.1.0",
    "chokidar": "^3.5.3",
    "fast-glob": "^3.2.12"
  },
  "devDependencies": {
    "webpack": "^5.88.2",
    "webpack-cli": "^5.1.4",
    "jest": "^29.5.0",
    "eslint": "^8.44.0",
    "@types/node": "^20.4.2"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "keywords": [
    "lsp",
    "language-server",
    "nunjucks",
    "templates",
    "electron"
  ],
  "author": "TAD Development Team",
  "license": "MIT"
}
```

## Project Structure

```
src/language-server/
├── bin/
│   └── nunjucks-lsp.js          # Executable entry point
├── server.js                    # Main LSP server implementation
├── parser/
│   └── NunjucksParser.js        # Template parsing and AST generation
├── completion/
│   └── NunjucksCompleter.js     # Auto-completion provider
├── hover/
│   └── NunjucksHoverProvider.js # Hover information provider
├── definition/
│   └── NunjucksDefinitionProvider.js # Go to definition provider
├── diagnostics/
│   └── NunjucksDiagnostics.js   # Syntax validation and error reporting
├── formatting/
│   └── NunjucksFormatter.js     # Code formatting provider
└── utils/
    ├── TemplateIndex.js         # Template indexing and caching
    ├── SymbolTable.js           # Symbol resolution and management
    └── FileWatcher.js           # File system monitoring
```

## Executable Entry Point

### bin/nunjucks-lsp.js
```javascript
#!/usr/bin/env node

const { NunjucksLanguageServer } = require('../server');

// Handle process signals for graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the language server
try {
  const server = new NunjucksLanguageServer();
  server.listen();
  console.log('Nunjucks Language Server started successfully');
} catch (error) {
  console.error('Failed to start language server:', error);
  process.exit(1);
}
```

## Webpack Configuration

### webpack.config.js
```javascript
const path = require('path');

module.exports = {
  target: 'node',
  entry: './src/language-server/server.js',
  output: {
    path: path.resolve(__dirname, 'bin'),
    filename: 'nunjucks-lsp.js',
    libraryTarget: 'commonjs2'
  },
  resolve: {
    extensions: ['.js', '.json']
  },
  externals: {
    // Don't bundle Node.js built-in modules
    ...require('webpack-node-externals')()
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: { node: '16' },
                modules: false
              }]
            ]
          }
        }
      }
    ]
  },
  optimization: {
    minimize: true
  },
  devtool: 'source-map'
};
```

## Utility Classes

### Template Index Manager
```typescript
// src/language-server/utils/TemplateIndex.js
class TemplateIndex {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.templates = new Map();
    this.symbols = new Map();
    this.includes = new Map();
    this.macros = new Map();
  }

  async buildIndex() {
    const templateFiles = await this.findTemplateFiles();
    const indexPromises = templateFiles.map(file => this.indexTemplate(file));

    await Promise.all(indexPromises);
    this.buildSymbolIndex();
    this.buildIncludeGraph();
  }

  async findTemplateFiles() {
    const patterns = [
      '**/*.njk',
      '**/*.nunjucks',
      '**/*.html',
      '!node_modules/**',
      '!.tad/dist/**'
    ];

    const files = [];
    for (const pattern of patterns) {
      const matches = await fastGlob(pattern, {
        cwd: this.workspaceRoot,
        absolute: true
      });
      files.push(...matches);
    }

    return [...new Set(files)]; // Remove duplicates
  }

  async indexTemplate(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const relativePath = path.relative(this.workspaceRoot, filePath);

      const templateInfo = {
        path: relativePath,
        fullPath: filePath,
        content,
        ast: null,
        symbols: [],
        includes: [],
        macros: [],
        lastModified: fs.statSync(filePath).mtime
      };

      // Parse template
      const parser = new NunjucksParser();
      templateInfo.ast = parser.parse(content);

      // Extract symbols
      templateInfo.symbols = this.extractSymbols(content, relativePath);
      templateInfo.includes = this.extractIncludes(content);
      templateInfo.macros = this.extractMacros(content);

      this.templates.set(relativePath, templateInfo);

    } catch (error) {
      console.error(`Failed to index ${filePath}:`, error.message);
    }
  }

  extractSymbols(content, filePath) {
    const symbols = [];

    // Extract macro definitions
    const macroRegex = /{%\s*macro\s+([A-Za-z_][\w]*)\s*\(/g;
    let match;
    while ((match = macroRegex.exec(content)) !== null) {
      symbols.push({
        name: match[1],
        type: 'macro',
        location: this.getLocation(content, match.index, filePath),
        signature: this.extractMacroSignature(content, match.index)
      });
    }

    // Extract set statements
    const setRegex = /{%\s*set\s+([A-Za-z_][\w]*)\s*=/g;
    while ((match = setRegex.exec(content)) !== null) {
      symbols.push({
        name: match[1],
        type: 'variable',
        location: this.getLocation(content, match.index, filePath),
        value: this.extractSetValue(content, match.index)
      });
    }

    return symbols;
  }

  extractIncludes(content) {
    const includes = [];
    const includeRegex = /{%\s*include\s+['"]([^'"]+)['"]/g;

    let match;
    while ((match = includeRegex.exec(content)) !== null) {
      includes.push({
        path: match[1],
        location: this.getLocation(content, match.index)
      });
    }

    return includes;
  }

  extractMacros(content) {
    const macros = [];
    const macroRegex = /{%\s*macro\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/g;

    let match;
    while ((match = macroRegex.exec(content)) !== null) {
      macros.push({
        name: match[1],
        params: match[2].split(',').map(p => p.trim()).filter(p => p),
        location: this.getLocation(content, match.index)
      });
    }

    return macros;
  }

  getLocation(content, index, filePath = null) {
    const lines = content.substring(0, index).split('\n');
    return {
      uri: filePath ? `file://${path.join(this.workspaceRoot, filePath)}` : null,
      range: {
        start: {
          line: lines.length - 1,
          character: lines[lines.length - 1].length
        },
        end: {
          line: lines.length - 1,
          character: lines[lines.length - 1].length
        }
      }
    };
  }

  buildSymbolIndex() {
    this.symbols.clear();

    for (const [filePath, template] of this.templates) {
      for (const symbol of template.symbols) {
        if (!this.symbols.has(symbol.name)) {
          this.symbols.set(symbol.name, []);
        }
        this.symbols.get(symbol.name).push({
          ...symbol,
          filePath
        });
      }
    }
  }

  buildIncludeGraph() {
    this.includes.clear();

    for (const [filePath, template] of this.templates) {
      for (const include of template.includes) {
        if (!this.includes.has(include.path)) {
          this.includes.set(include.path, []);
        }
        this.includes.get(include.path).push({
          from: filePath,
          location: include.location
        });
      }
    }
  }

  findSymbol(name) {
    return this.symbols.get(name) || [];
  }

  findReferences(name) {
    const references = [];

    for (const [filePath, template] of this.templates) {
      const content = template.content;
      const regex = new RegExp(`\\b${name}\\b`, 'g');
      let match;

      while ((match = regex.exec(content)) !== null) {
        references.push({
          uri: `file://${template.fullPath}`,
          range: this.getLocation(content, match.index)
        });
      }
    }

    return references;
  }

  getTemplate(filePath) {
    return this.templates.get(filePath);
  }

  getAllTemplates() {
    return Array.from(this.templates.values());
  }

  invalidateTemplate(filePath) {
    this.templates.delete(filePath);
    // Rebuild dependent indexes
    this.buildSymbolIndex();
    this.buildIncludeGraph();
  }

  async updateTemplate(filePath) {
    await this.indexTemplate(filePath);
    this.buildSymbolIndex();
    this.buildIncludeGraph();
  }
}

module.exports = TemplateIndex;
```

### Symbol Table Implementation
```typescript
// src/language-server/utils/SymbolTable.js
class SymbolTable {
  constructor() {
    this.globalScope = new Map();
    this.fileScopes = new Map();
    this.macroScopes = new Map();
  }

  addGlobalSymbol(name, symbol) {
    this.globalScope.set(name, symbol);
  }

  addFileSymbol(filePath, name, symbol) {
    if (!this.fileScopes.has(filePath)) {
      this.fileScopes.set(filePath, new Map());
    }
    this.fileScopes.get(filePath).set(name, symbol);
  }

  addMacroSymbol(macroName, name, symbol) {
    if (!this.macroScopes.has(macroName)) {
      this.macroScopes.set(macroName, new Map());
    }
    this.macroScopes.get(macroName).set(name, symbol);
  }

  resolveSymbol(name, context = {}) {
    const { filePath, macroName } = context;

    // Check macro scope first (most specific)
    if (macroName && this.macroScopes.has(macroName)) {
      const macroScope = this.macroScopes.get(macroName);
      if (macroScope.has(name)) {
        return macroScope.get(name);
      }
    }

    // Check file scope
    if (filePath && this.fileScopes.has(filePath)) {
      const fileScope = this.fileScopes.get(filePath);
      if (fileScope.has(name)) {
        return fileScope.get(name);
      }
    }

    // Check global scope
    if (this.globalScope.has(name)) {
      return this.globalScope.get(name);
    }

    return null;
  }

  getAllSymbols(context = {}) {
    const symbols = [];

    // Add global symbols
    for (const [name, symbol] of this.globalScope) {
      symbols.push({ name, symbol, scope: 'global' });
    }

    // Add file-scoped symbols
    const { filePath } = context;
    if (filePath && this.fileScopes.has(filePath)) {
      for (const [name, symbol] of this.fileScopes.get(filePath)) {
        symbols.push({ name, symbol, scope: 'file' });
      }
    }

    // Add macro-scoped symbols
    const { macroName } = context;
    if (macroName && this.macroScopes.has(macroName)) {
      for (const [name, symbol] of this.macroScopes.get(macroName)) {
        symbols.push({ name, symbol, scope: 'macro' });
      }
    }

    return symbols;
  }

  clearFileScope(filePath) {
    this.fileScopes.delete(filePath);
  }

  clearMacroScope(macroName) {
    this.macroScopes.delete(macroName);
  }

  getSymbolInfo(name, context = {}) {
    const symbol = this.resolveSymbol(name, context);
    if (!symbol) return null;

    return {
      name,
      type: symbol.type,
      location: symbol.location,
      documentation: symbol.documentation,
      scope: this.getSymbolScope(name, context)
    };
  }

  getSymbolScope(name, context = {}) {
    const { filePath, macroName } = context;

    if (macroName && this.macroScopes.has(macroName) &&
        this.macroScopes.get(macroName).has(name)) {
      return 'macro';
    }

    if (filePath && this.fileScopes.has(filePath) &&
        this.fileScopes.get(filePath).has(name)) {
      return 'file';
    }

    if (this.globalScope.has(name)) {
      return 'global';
    }

    return 'unknown';
  }

  renameSymbol(oldName, newName, context = {}) {
    const symbol = this.resolveSymbol(oldName, context);
    if (!symbol) return false;

    const scope = this.getSymbolScope(oldName, context);

    // Remove old symbol
    this.removeSymbol(oldName, context);

    // Add new symbol
    symbol.name = newName;
    this.addSymbolToScope(newName, symbol, scope, context);

    return true;
  }

  removeSymbol(name, context = {}) {
    const { filePath, macroName } = context;

    if (macroName && this.macroScopes.has(macroName)) {
      this.macroScopes.get(macroName).delete(name);
    }

    if (filePath && this.fileScopes.has(filePath)) {
      this.fileScopes.get(filePath).delete(name);
    }

    this.globalScope.delete(name);
  }

  addSymbolToScope(name, symbol, scope, context = {}) {
    switch (scope) {
      case 'global':
        this.addGlobalSymbol(name, symbol);
        break;
      case 'file':
        if (context.filePath) {
          this.addFileSymbol(context.filePath, name, symbol);
        }
        break;
      case 'macro':
        if (context.macroName) {
          this.addMacroSymbol(context.macroName, name, symbol);
        }
        break;
    }
  }
}

module.exports = SymbolTable;
```

## Testing Infrastructure

### Unit Test Examples

#### Parser Tests
```typescript
// tests/parser/NunjucksParser.test.js
const NunjucksParser = require('../../src/language-server/parser/NunjucksParser');

describe('NunjucksParser', () => {
  let parser;

  beforeEach(() => {
    parser = new NunjucksParser();
  });

  describe('Statement Parsing', () => {
    test('should parse set statements', () => {
      const content = '{% set title = "Hello World" %}';
      const ast = parser.parse(content);

      expect(ast.body).toHaveLength(1);
      expect(ast.body[0]).toMatchObject({
        type: 'SetStatement',
        name: 'title',
        value: '"Hello World"'
      });
    });

    test('should parse macro definitions', () => {
      const content = '{% macro button(label, variant="primary") %}{{ label }}{% endmacro %}';
      const ast = parser.parse(content);

      expect(ast.body).toHaveLength(1);
      expect(ast.body[0]).toMatchObject({
        type: 'MacroStatement',
        name: 'button',
        params: ['label', 'variant="primary"']
      });
    });

    test('should parse include statements', () => {
      const content = '{% include "components/header.njk" %}';
      const ast = parser.parse(content);

      expect(ast.body).toHaveLength(1);
      expect(ast.body[0]).toMatchObject({
        type: 'IncludeStatement',
        path: 'components/header.njk'
      });
    });
  });

  describe('Expression Parsing', () => {
    test('should parse simple expressions', () => {
      const content = '{{ user.name }}';
      const ast = parser.parse(content);

      expect(ast.body).toHaveLength(1);
      expect(ast.body[0]).toMatchObject({
        type: 'Expression',
        content: 'user.name'
      });
    });

    test('should parse expressions with filters', () => {
      const content = '{{ title | lower | capitalize }}';
      const ast = parser.parse(content);

      expect(ast.body).toHaveLength(1);
      expect(ast.body[0]).toMatchObject({
        type: 'Expression',
        content: 'title | lower | capitalize'
      });
    });
  });

  describe('Syntax Validation', () => {
    test('should detect unclosed statements', () => {
      const content = '{% if true';
      const errors = parser.validateSyntax(content);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Unclosed statement');
    });

    test('should detect unclosed expressions', () => {
      const content = '{{ user.name';
      const errors = parser.validateSyntax(content);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Unclosed expression');
    });

    test('should validate balanced braces', () => {
      const content = '{% if true %}{% endif %}';
      const errors = parser.validateSyntax(content);

      expect(errors).toHaveLength(0);
    });
  });
});
```

#### Completion Tests
```typescript
// tests/completion/NunjucksCompleter.test.js
const NunjucksCompleter = require('../../src/language-server/completion/NunjucksCompleter');

describe('NunjucksCompleter', () => {
  let completer;
  let templateIndex;

  beforeEach(() => {
    completer = new NunjucksCompleter();
    templateIndex = new Map();
  });

  describe('Statement Completions', () => {
    test('should provide keyword completions', () => {
      const context = {
        type: 'statement',
        content: ''
      };

      const completions = completer.provideStatementCompletions(context, templateIndex);

      expect(completions.items).toContainEqual(
        expect.objectContaining({
          label: 'if',
          kind: 14, // Keyword
          detail: 'Nunjucks statement'
        })
      );
    });

    test('should filter keywords by prefix', () => {
      const context = {
        type: 'statement',
        content: 'se'
      };

      const completions = completer.provideStatementCompletions(context, templateIndex);

      expect(completions.items).toContainEqual(
        expect.objectContaining({
          label: 'set',
          kind: 14
        })
      );

      expect(completions.items).not.toContainEqual(
        expect.objectContaining({
          label: 'if'
        })
      );
    });
  });

  describe('Filter Completions', () => {
    test('should provide filter completions', () => {
      const context = {
        type: 'filter',
        content: ''
      };

      const completions = completer.provideFilterCompletions(context);

      expect(completions.items).toContainEqual(
        expect.objectContaining({
          label: 'default',
          kind: 3, // Function
          detail: 'Nunjucks filter'
        })
      );
    });

    test('should provide filter documentation', () => {
      const item = {
        label: 'default',
        kind: 3
      };

      const resolved = completer.resolveCompletionItem(item, templateIndex);

      expect(resolved.documentation).toContain('Return default value');
    });
  });

  describe('Macro Completions', () => {
    test('should provide macro completions from template index', () => {
      const mockTemplate = {
        macros: new Map([
          ['button', {
            name: 'button',
            params: ['label', 'variant']
          }]
        ])
      };

      templateIndex.set('components/button.njk', mockTemplate);

      const context = {
        type: 'statement',
        content: 'button'
      };

      const completions = completer.provideStatementCompletions(context, templateIndex);

      expect(completions.items).toContainEqual(
        expect.objectContaining({
          label: 'button',
          kind: 3, // Function
          detail: 'Macro from components/button.njk'
        })
      );
    });
  });
});
```

## Performance Benchmarks

### Benchmark Suite
```typescript
// benchmarks/lsp-performance.js
const { NunjucksParser } = require('../src/language-server/parser/NunjucksParser');
const { NunjucksCompleter } = require('../src/language-server/completion/NunjucksCompleter');

class LSPBenchmark {
  constructor() {
    this.parser = new NunjucksParser();
    this.completer = new NunjucksCompleter();
  }

  async runBenchmarks() {
    console.log('Running LSP Performance Benchmarks...\n');

    await this.benchmarkParsing();
    await this.benchmarkCompletion();
    await this.benchmarkDiagnostics();
  }

  async benchmarkParsing() {
    console.log('=== Parsing Benchmarks ===');

    const testCases = [
      { name: 'Simple Template', content: this.generateSimpleTemplate() },
      { name: 'Complex Template', content: this.generateComplexTemplate() },
      { name: 'Large Template', content: this.generateLargeTemplate(1000) }
    ];

    for (const testCase of testCases) {
      const times = [];

      for (let i = 0; i < 10; i++) {
        const start = process.hrtime.bigint();
        this.parser.parse(testCase.content);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1e6); // Convert to milliseconds
      }

      const avg = times.reduce((a, b) => a + b) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);

      console.log(`${testCase.name}:`);
      console.log(`  Average: ${avg.toFixed(2)}ms`);
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms\n`);
    }
  }

  async benchmarkCompletion() {
    console.log('=== Completion Benchmarks ===');

    const templateIndex = this.buildMockTemplateIndex();
    const testPositions = [
      { line: 0, character: 3 }, // After '{% '
      { line: 1, character: 3 }, // After '{{ '
      { line: 2, character: 8 }  // After '| '
    ];

    for (const position of testPositions) {
      const times = [];

      for (let i = 0; i < 100; i++) {
        const start = process.hrtime.bigint();
        this.completer.provideCompletions(null, position, '', 0, templateIndex);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1e6);
      }

      const avg = times.reduce((a, b) => a + b) / times.length;
      console.log(`Completion at ${position.line}:${position.character}: ${avg.toFixed(2)}ms average`);
    }
    console.log('');
  }

  async benchmarkDiagnostics() {
    console.log('=== Diagnostics Benchmarks ===');

    const testTemplates = [
      this.generateValidTemplate(),
      this.generateTemplateWithErrors(),
      this.generateLargeTemplate(500)
    ];

    for (let i = 0; i < testTemplates.length; i++) {
      const template = testTemplates[i];
      const times = [];

      for (let j = 0; j < 10; j++) {
        const start = process.hrtime.bigint();
        this.parser.validateSyntax(template);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1e6);
      }

      const avg = times.reduce((a, b) => a + b) / times.length;
      console.log(`Template ${i + 1} diagnostics: ${avg.toFixed(2)}ms average`);
    }
    console.log('');
  }

  generateSimpleTemplate() {
    return `{% set title = "Hello World" %}
<h1>{{ title }}</h1>
{% if showFooter %}
  <footer>© 2024</footer>
{% endif %}`;
  }

  generateComplexTemplate() {
    let content = '';

    // Add multiple macros
    for (let i = 0; i < 10; i++) {
      content += `{% macro component${i}(param1, param2) %}
<div class="component-${i}">
  <h3>{{ param1 }}</h3>
  <p>{{ param2 }}</p>
</div>
{% endmacro %}\n`;
    }

    // Add complex expressions
    content += '{{ user.name | default("Anonymous") | capitalize }}\n';
    content += '{{ items | selectattr("active") | list | length }}\n';

    // Add nested conditionals
    content += `{% if user.loggedIn %}
  {% if user.admin %}
    <div>Admin Panel</div>
  {% else %}
    <div>User Panel</div>
  {% endif %}
{% endif %}\n`;

    return content;
  }

  generateLargeTemplate(lines = 1000) {
    let content = '';

    for (let i = 0; i < lines; i++) {
      if (i % 50 === 0) {
        content += `{% set section${i} = "Section ${i}" %}\n`;
      } else if (i % 30 === 0) {
        content += `<div class="row-${i}">{{ section${Math.floor(i/50)*50} }}</div>\n`;
      } else {
        content += `<p>Line ${i} content</p>\n`;
      }
    }

    return content;
  }

  generateValidTemplate() {
    return `{% extends "base.njk" %}

{% block content %}
  {% for item in items %}
    {% if item.visible %}
      <div class="item {{ item.type }}">
        <h3>{{ item.title | default("Untitled") }}</h3>
        <p>{{ item.description | truncate(100) }}</p>
      </div>
    {% endif %}
  {% endfor %}
{% endblock %}`;
  }

  generateTemplateWithErrors() {
    return `{% if true
<div>{{ user.name</div>
{% set title = %}
{% include %}`;
  }

  buildMockTemplateIndex() {
    const index = new Map();

    // Add some mock templates with macros
    for (let i = 0; i < 5; i++) {
      const template = {
        macros: new Map([
          [`macro${i}`, {
            name: `macro${i}`,
            params: [`param${i}1`, `param${i}2`]
          }]
        ])
      };
      index.set(`template${i}.njk`, template);
    }

    return index;
  }
}

// Run benchmarks if called directly
if (require.main === module) {
  const benchmark = new LSPBenchmark();
  benchmark.runBenchmarks().catch(console.error);
}

module.exports = LSPBenchmark;
```

## Integration Testing

### Electron Integration Tests
```typescript
// tests/integration/electron-lsp.test.js
const { app } = require('electron');
const LanguageServerManager = require('../../src/main/language-server/LanguageServerManager');

describe('Electron LSP Integration', () => {
  let languageServerManager;
  let testWorkspace;

  beforeAll(async () => {
    // Create test workspace
    testWorkspace = await createTestWorkspace();

    // Initialize Electron app
    await app.whenReady();

    // Initialize language server manager
    languageServerManager = new LanguageServerManager({
      currentWorkspace: testWorkspace
    });
  });

  afterAll(async () => {
    // Cleanup
    await languageServerManager.dispose();
    await cleanupTestWorkspace(testWorkspace);
    app.quit();
  });

  describe('Server Lifecycle', () => {
    test('should start language server successfully', async () => {
      await expect(languageServerManager.startServer()).resolves.toBeUndefined();
      expect(languageServerManager.serverProcess).toBeDefined();
    }, 10000);

    test('should initialize server with capabilities', async () => {
      await expect(languageServerManager.initializeServer()).resolves.toBeDefined();
      expect(languageServerManager.capabilities).toBeDefined();
      expect(languageServerManager.isInitialized).toBe(true);
    }, 5000);
  });

  describe('IPC Communication', () => {
    test('should handle completion requests', async () => {
      const params = {
        filePath: path.join(testWorkspace, 'test.njk'),
        position: { line: 0, character: 3 },
        text: '{% se'
      };

      const result = await languageServerManager.requestCompletion(params);
      expect(result).toBeDefined();
      expect(result.items).toContainEqual(
        expect.objectContaining({
          label: 'set'
        })
      );
    });

    test('should handle hover requests', async () => {
      const params = {
        filePath: path.join(testWorkspace, 'test.njk'),
        position: { line: 0, character: 6 },
        text: '{% set title %}'
      };

      const result = await languageServerManager.requestHover(params);
      expect(result).toBeDefined();
      expect(result.contents).toBeDefined();
    });
  });

  describe('Document Synchronization', () => {
    test('should handle document open', async () => {
      const filePath = path.join(testWorkspace, 'test.njk');
      const content = '{% set title = "Test" %}';

      await fs.writeFile(filePath, content);

      await expect(languageServerManager.openDocument(filePath, content))
        .resolves.toBeUndefined();
    });

    test('should handle document changes', async () => {
      const filePath = path.join(testWorkspace, 'test.njk');
      const changes = [{
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 }
        },
        text: '<!-- Comment -->\n'
      }];

      await expect(languageServerManager.changeDocument(filePath, changes, 2))
        .resolves.toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle server crashes gracefully', async () => {
      // Force server crash
      languageServerManager.serverProcess.kill('SIGKILL');

      // Wait for crash detection
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should attempt restart
      expect(languageServerManager.serverProcess).toBeNull();

      // Restart server
      await languageServerManager.startServer();
      expect(languageServerManager.serverProcess).toBeDefined();
    });

    test('should handle invalid requests', async () => {
      const invalidParams = {
        filePath: '/nonexistent/file.njk',
        position: { line: 0, character: 0 }
      };

      await expect(languageServerManager.requestCompletion(invalidParams))
        .rejects.toThrow();
    });
  });
});
```

## Deployment and Distribution

### Build Process
```bash
# Build the language server
npm run build

# Create distribution package
npm pack

# The resulting .tgz file can be included in the Electron app
```

### Integration with Electron Builder
```json
// electron-builder.json
{
  "extraFiles": [
    {
      "from": "node_modules/nunjucks-language-server/bin",
      "to": "resources/language-server",
      "filter": ["**/*"]
    }
  ]
}
```

This comprehensive implementation provides a robust, performant, and feature-complete LSP server for Nunjucks templating that seamlessly integrates with the Electron version of TAD.