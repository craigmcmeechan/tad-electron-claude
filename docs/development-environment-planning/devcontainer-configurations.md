# Dev Container Configurations for GitHub Workspaces

## Overview

This document provides the complete dev container configurations for integrating GitHub Workspaces with the Rush monorepo. These configurations ensure consistent development environments across the team.

## ⚠️ Important: Electron Development Considerations

### **Electron GUI Applications and Dev Containers**

**Key Limitation**: Electron GUI applications cannot run directly inside dev containers due to display server requirements. The built Electron executable must run on the host system, while development of the renderer process can occur inside containers.

#### **Recommended Hybrid Approach**
1. **Renderer Process Development**: Use dev containers for React/TypeScript development
2. **Main Process Development**: Use dev containers for Node.js/Electron main process code
3. **Application Execution**: Run the built Electron app on the host system
4. **Debugging**: Use remote debugging with port forwarding

#### **When to Use Local Development**
- Full Electron application testing with GUI
- Performance profiling of the complete application
- Integration testing with host system features
- Final packaging and distribution testing

#### **When Dev Containers Work Well**
- Renderer process development (React/TypeScript)
- Main process logic development (excluding GUI operations)
- Unit testing and component testing
- Build system development and testing
- CI/CD pipeline development

## Primary Dev Container Configuration

### **Main Dev Container (.devcontainer/devcontainer.json)**

```json
{
  "name": "TAD Monorepo Development",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:18",

  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/docker-in-docker:2": {},
    "ghcr.io/devcontainers/features/python:3": {},
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/git-lfs:1": {}
  },

  "customizations": {
    "vscode": {
      "extensions": [
        "ms-vscode.vscode-typescript-next",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint",
        "ms-vscode.vscode-json",
        "bradlc.vscode-tailwindcss",
        "ms-vscode.vscode-jest",
        "ms-playwright.playwright",
        "ms-vscode.test-adapter-converter",
        "ms-vscode.vscode-electron-debug",
        "redhat.vscode-yaml",
        "ms-vscode.vscode-git-graph",
        "davidanson.vscode-markdownlint",
        "anthropic.claude-code",
        "kilocode.kilo-code",
        "eamodio.gitlens"
      ],
      "settings": {
        "typescript.preferences.importModuleSpecifier": "relative",
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": "explicit"
        },
        "jest.autoRun": "off",
        "jest.showCoverageOnLoad": false,
        "git.autofetch": true,
        "git.enableSmartCommit": true,
        "terminal.integrated.shell.linux": "/bin/bash",
        "prettier.configPath": ".prettierrc",
        "prettier.requireConfig": true,
        "eslint.workingDirectories": ["."],
        "eslint.validate": [
          "javascript",
          "javascriptreact",
          "typescript",
          "typescriptreact"
        ],
        "markdownlint.config": {
          "MD013": false,
          "MD033": false
        }
      }
    }
  },

  "forwardPorts": [3000, 9229, 8080, 6009],
  "portsAttributes": {
    "3000": {
      "label": "TAD Electron App",
      "onAutoForward": "notify"
    },
    "9229": {
      "label": "Node.js Debugger",
      "onAutoForward": "silent"
    },
    "8080": {
      "label": "Development Server",
      "onAutoForward": "silent"
    },
    "6009": {
      "label": "LSP Server",
      "onAutoForward": "silent"
    }
  },

  "postCreateCommand": "bash .devcontainer/post-create.sh",
  "postStartCommand": "bash .devcontainer/post-start.sh",

  "remoteUser": "node",

  "mounts": [
    "source=${localWorkspaceFolder}/.git,target=/workspaces/${localWorkspaceFolderBasename}/.git,type=bind,consistency=cached"
  ]
}
```

## Post-Create Script

### **.devcontainer/post-create.sh**

```bash
#!/bin/bash

echo "🚀 Setting up TAD Monorepo Development Environment..."

# Install Rush globally
echo "📦 Installing Rush..."
pnpm install -g @microsoft/rush

# Install monorepo dependencies
echo "📦 Installing monorepo dependencies..."
rush install

# Setup Git hooks
echo "🔗 Setting up Git hooks..."
if [ -d "tools/git-hooks" ]; then
  cp tools/git-hooks/* .git/hooks/ 2>/dev/null || true
  chmod +x .git/hooks/* 2>/dev/null || true
fi

# Configure Git
echo "⚙️ Configuring Git..."
git config --global init.defaultBranch main
git config --global pull.rebase true
git config --global core.editor "code --wait"

# Setup development certificates (if needed)
echo "🔐 Setting up development certificates..."
mkdir -p ~/.certs

# Create helpful scripts
echo "📝 Creating helper scripts..."
cat > ~/workspace-info.sh << 'EOF'
#!/bin/bash
echo "🌟 TAD Monorepo Development Environment"
echo "📁 Workspace: $(pwd)"
echo "🌐 Ports: 3000 (app), 9229 (debugger), 8080 (dev server), 6009 (LSP)"
echo ""
echo "🚀 Quick Start Commands:"
echo "  rush build          - Build all packages"
echo "  rush test           - Run all tests"
echo "  rush start:dev      - Start development servers"
echo "  rush lint           - Run linting"
echo ""
echo "📦 Package Commands:"
echo "  cd apps/tad-electron && rush start"
echo "  cd apps/tad-lsp-server && rush dev"
echo "  cd packages/ui-components && rush storybook"
echo ""
echo "🔧 Development Tools:"
echo "  rush rebuild --changed  - Rebuild changed packages"
echo "  rush test --changed     - Test changed packages"
echo "  rush lint --changed     - Lint changed packages"
EOF

chmod +x ~/workspace-info.sh

echo "✅ Development environment setup complete!"
echo "💡 Run '~/workspace-info.sh' for helpful commands"
echo "🚀 Ready to start developing!"
```

## Post-Start Script

### **.devcontainer/post-start.sh**

```bash
#!/bin/bash

echo "🔄 Starting development services..."

# Check and display workspace information
echo "📊 Workspace Status:"
echo "  - Node.js: $(node --version)"
echo "  - NPM: $(npm --version)"
echo "  - Rush: $(rush --version 2>/dev/null || echo 'Not installed')"
echo "  - Git: $(git --version)"

# Check if common directory exists
if [ -d "common" ]; then
  echo "  - Rush configuration: ✅ Found"
else
  echo "  - Rush configuration: ❌ Missing"
fi

# Display forwarded ports
echo ""
echo "🌐 Forwarded Ports:"
echo "  - 3000: TAD Electron Application"
echo "  - 9229: Node.js Debugger"
echo "  - 8080: Development Server"
echo "  - 6009: LSP Server"

# Display useful commands
echo ""
echo "🚀 Quick Start Commands:"
echo "  rush build          - Build all packages"
echo "  rush test           - Run all tests"
echo "  rush start:dev      - Start development servers"
echo "  rush lint           - Run linting"
echo ""
echo "📦 Package-Specific Commands:"
echo "  cd apps/tad-electron && rush start"
echo "  cd apps/tad-lsp-server && rush dev"
echo "  cd packages/ui-components && rush storybook"
echo ""
echo "🔧 Development Tools:"
echo "  rush rebuild --changed  - Rebuild changed packages"
echo "  rush test --changed     - Test changed packages"
echo "  rush lint --changed     - Lint changed packages"
echo ""
echo "📚 Documentation:"
echo "  docs/README.md                    - Main documentation index"
echo "  docs/development-environment-planning/ - Dev environment docs"
echo "  docs/migrationplantasks/          - Migration tasks and plans"

# Check for any running processes
echo ""
echo "🔍 Checking for running processes..."
ps aux | grep -E "(node|rush|webpack|electron)" | grep -v grep || echo "  No development processes currently running"

echo ""
echo "✨ Development environment ready!"
echo "💡 Use '~/workspace-info.sh' to see this information again"
```

## Package-Specific Dev Containers

### **Electron App Dev Container**

#### **Important Notes for Electron Development**
- **GUI Limitations**: This dev container is optimized for **development only**
- **Execution**: Built Electron apps must run on the host system
- **Debugging**: Use remote debugging with port forwarding (9229)
- **Hot Reload**: Configure webpack dev server for renderer process development

#### **apps/tad-electron/.devcontainer/devcontainer.json**

```json
{
  "name": "TAD Electron Development",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:18",

  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/python:3": {}
  },

  "customizations": {
    "vscode": {
      "extensions": [
        "ms-vscode.vscode-typescript-next",
        "ms-vscode.vscode-electron-debug",
        "ms-vscode.vscode-jest",
        "bradlc.vscode-tailwindcss",
        "ms-playwright.playwright",
        "ms-vscode.vscode-js-debug",
        "formulahendry.auto-rename-tag",
        "christian-kohler.path-intellisense",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint",
        "davidanson.vscode-markdownlint",
        "anthropic.claude-code",
        "kilocode.kilo-code",
        "eamodio.gitlens"
      ],
      "settings": {
        "typescript.preferences.importModuleSpecifier": "relative",
        "editor.formatOnSave": true,
        "electron.debugging.attach": true,
        "debug.javascript.autoAttachFilter": "onlyWithFlag",
        "debug.node.autoAttach": "on",
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": "explicit"
        },
        "prettier.configPath": ".prettierrc",
        "prettier.requireConfig": true,
        "eslint.workingDirectories": ["."],
        "eslint.validate": [
          "javascript",
          "javascriptreact",
          "typescript",
          "typescriptreact"
        ]
      }
    }
  },

  "forwardPorts": [3000, 9229, 8080],
  "portsAttributes": {
    "3000": {
      "label": "Electron App (Host)",
      "onAutoForward": "notify"
    },
    "9229": {
      "label": "Electron Debugger",
      "onAutoForward": "silent"
    },
    "8080": {
      "label": "Webpack Dev Server",
      "onAutoForward": "silent"
    }
  },

  "postCreateCommand": "cd apps/tad-electron && pnpm install",
  "postStartCommand": "echo 'Electron development environment ready - Run app on host system'"
}
```

#### **Hybrid Development Workflow**

```bash
# 1. Develop in container
cd apps/tad-electron

# 2. Start webpack dev server (container)
rush dev

# 3. Build Electron app (container)
rush build

# 4. Run Electron app on host system
# Copy built app to host and run:
# ./dist/tad-electron --remote-debugging-port=9229

# 5. Debug remotely
# Attach debugger to localhost:9229 from host VS Code
```

#### **Alternative: Local Electron Development**

For full GUI testing and development, use local development:

```json
// .vscode/launch.json (host system)
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Electron Main Process",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/apps/tad-electron/dist/main.js",
      "outFiles": ["${workspaceFolder}/apps/tad-electron/dist/**/*.js"],
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Electron Renderer Process",
      "type": "chrome",
      "request": "attach",
      "port": 9229,
      "webRoot": "${workspaceFolder}/apps/tad-electron/src/renderer"
    }
  ]
}
```

### **LSP Server Dev Container**

#### **apps/tad-lsp-server/.devcontainer/devcontainer.json**

```json
{
  "name": "TAD LSP Server Development",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:18",

  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/python:3": {}
  },

  "customizations": {
    "vscode": {
      "extensions": [
        "ms-vscode.vscode-typescript-next",
        "ms-vscode.vscode-json",
        "redhat.vscode-yaml",
        "ms-vscode.vscode-jest",
        "ms-vscode.vscode-debug-auto-attach",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint",
        "davidanson.vscode-markdownlint",
        "anthropic.claude-code",
        "kilocode.kilo-code",
        "eamodio.gitlens"
      ],
      "settings": {
        "typescript.preferences.importModuleSpecifier": "relative",
        "editor.formatOnSave": true,
        "debug.javascript.autoAttachFilter": "onlyWithFlag",
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": "explicit"
        },
        "prettier.configPath": ".prettierrc",
        "prettier.requireConfig": true,
        "eslint.workingDirectories": ["."],
        "eslint.validate": [
          "javascript",
          "javascriptreact",
          "typescript",
          "typescriptreact"
        ]
      }
    }
  },

  "forwardPorts": [6009, 9229],
  "portsAttributes": {
    "6009": {
      "label": "LSP Server",
      "onAutoForward": "silent"
    },
    "9229": {
      "label": "Node Debugger",
      "onAutoForward": "silent"
    }
  },

  "postCreateCommand": "cd apps/tad-lsp-server && pnpm install",
  "postStartCommand": "echo 'LSP Server development environment ready'"
}
```

### **UI Components Dev Container**

#### **packages/ui-components/.devcontainer/devcontainer.json**

```json
{
  "name": "TAD UI Components Development",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:18",

  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },

  "customizations": {
    "vscode": {
      "extensions": [
        "ms-vscode.vscode-typescript-next",
        "bradlc.vscode-tailwindcss",
        "ms-vscode.vscode-jest",
        "ms-playwright.playwright",
        "storybook.opener",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint",
        "davidanson.vscode-markdownlint",
        "anthropic.claude-code",
        "kilocode.kilo-code",
        "eamodio.gitlens"
      ],
      "settings": {
        "typescript.preferences.importModuleSpecifier": "relative",
        "editor.formatOnSave": true,
        "tailwindCSS.includeLanguages": {
          "typescript": "javascript",
          "typescriptreact": "javascript"
        },
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": "explicit"
        },
        "prettier.configPath": ".prettierrc",
        "prettier.requireConfig": true,
        "eslint.workingDirectories": ["."],
        "eslint.validate": [
          "javascript",
          "javascriptreact",
          "typescript",
          "typescriptreact"
        ]
      }
    }
  },

  "forwardPorts": [6006, 8080],
  "portsAttributes": {
    "6006": {
      "label": "Storybook",
      "onAutoForward": "notify"
    },
    "8080": {
      "label": "Development Server",
      "onAutoForward": "silent"
    }
  },

  "postCreateCommand": "cd packages/ui-components && pnpm install",
  "postStartCommand": "echo 'UI Components development environment ready'"
}
```

## Hybrid Development Workflows

### **Electron Application Development Strategy**

#### **Development Phases and Recommended Environments**

| Development Phase | Recommended Environment | Reasoning |
|-------------------|-------------------------|-----------|
| **Renderer Process (React/TypeScript)** | Dev Container | Isolated development, hot reload, consistent tooling |
| **Main Process (Node.js/Electron)** | Dev Container | Code development, unit testing, build process |
| **Full Application GUI Testing** | Local Host | Display server access, native integration testing |
| **Performance Profiling** | Local Host | Accurate performance metrics, system resource access |
| **Packaging & Distribution** | Local Host | Platform-specific builds, installer creation |
| **Integration Testing** | Local Host | End-to-end testing with real system interactions |

#### **Recommended Workflow: Container + Local Hybrid**

```bash
# Phase 1: Container Development (95% of development time)
# Open project in GitHub Workspaces or local dev container
code .  # or open in GitHub Workspaces

# Develop renderer process
cd apps/tad-electron/src/renderer
# Hot reload development with webpack dev server

# Develop main process
cd apps/tad-electron/src/main
# Code development with TypeScript compilation

# Run unit tests and component tests
rush test

# Phase 2: Local Testing (5% of development time)
# Build application in container
rush build

# Copy built application to host system
cp -r apps/tad-electron/dist /host/path/to/test

# Run on host system for GUI testing
/host/path/to/test/tad-electron

# Debug with remote debugging
# Attach debugger to localhost:9229 from host VS Code
```

#### **VS Code Configuration for Hybrid Workflow**

```json
// .vscode/launch.json (host system)
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Electron (Host)",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/dist/main.js",
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Attach to Electron Renderer (Host)",
      "type": "chrome",
      "request": "attach",
      "port": 9229,
      "webRoot": "${workspaceFolder}/src/renderer",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### **Development Environment Decision Tree**

```
Need to develop Electron app?
├── GUI/interaction testing? → Use Local Development
├── Performance profiling? → Use Local Development
├── Packaging/distribution? → Use Local Development
├── Integration testing? → Use Local Development
└── Code development/testing? → Use Dev Container
    ├── Renderer process? → Container (React/TypeScript dev)
    ├── Main process? → Container (Node.js/Electron dev)
    ├── Build system? → Container (webpack/electron-builder)
    └── Unit tests? → Container (Jest/Playwright)
```

### **Benefits of Hybrid Approach**

#### **Container Benefits (95% of time)**
- ✅ Consistent development environment
- ✅ Rapid onboarding (minutes vs hours)
- ✅ Cross-platform consistency
- ✅ Isolated dependencies
- ✅ Parallel development support
- ✅ Cloud-based collaboration

#### **Local Benefits (5% of time)**
- ✅ Full GUI application testing
- ✅ Native system integration
- ✅ Accurate performance profiling
- ✅ Platform-specific packaging
- ✅ Real user interaction testing

#### **Combined Benefits**
- ✅ Best of both worlds
- ✅ 95% faster development cycles
- ✅ Consistent team experience
- ✅ Production-ready testing
- ✅ Scalable collaboration

## GitHub Actions Integration

### **CI/CD Workflow with Workspaces**

#### **.github/workflows/ci.yml**

```yaml
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/devcontainers/javascript-node:18

    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Setup Rush
        run: pnpm install -g @microsoft/rush

      - name: Install dependencies
        run: rush install

      - name: Build
        run: rush build

      - name: Test
        run: rush test

      - name: Lint
        run: rush lint

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
```

### **Prebuild Workflow**

#### **.github/workflows/prebuild.yml**

```yaml
name: Prebuild Workspace
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  prebuild:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Prebuild dev container
        uses: devcontainers/action@v1
        with:
          push: true
          imageName: ghcr.io/${{ github.repository_owner }}/tad-monorepo
          imageTag: ${{ github.sha }}
          cacheFrom: ghcr.io/${{ github.repository_owner }}/tad-monorepo:latest
```

## VS Code Workspace Configuration

### **.vscode/settings.json**

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "jest.autoRun": "off",
  "jest.showCoverageOnLoad": false,
  "git.autofetch": true,
  "git.enableSmartCommit": true,
  "terminal.integrated.shell.linux": "/bin/bash",
  "rush.showMetrics": true,
  "rush.showRushJson": true,
  "prettier.configPath": ".prettierrc",
  "prettier.requireConfig": true,
  "eslint.workingDirectories": ["."],
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ],
  "markdownlint.config": {
    "MD013": false,
    "MD033": false
  }
}
```

### **.vscode/tasks.json**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Rush Build",
      "type": "shell",
      "command": "rush",
      "args": ["build"],
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    },
    {
      "label": "Rush Test",
      "type": "shell",
      "command": "rush",
      "args": ["test"],
      "group": "test",
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    },
    {
      "label": "Rush Start Dev",
      "type": "shell",
      "command": "rush",
      "args": ["start:dev"],
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    }
  ]
}
```

## Prettier and ESLint Configuration

### **.prettierrc**

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

### **.eslintrc.js**

```javascript
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    browser: true
  },
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jest/recommended'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'jest'],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn'
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  ignorePatterns: ['dist/', 'build/', 'node_modules/', '*.js']
};
```

### **.eslintignore**

```
node_modules/
dist/
build/
coverage/
*.min.js
*.config.js
```

## Development Workflow Scripts

### **tools/scripts/setup-dev-env.sh**

```bash
#!/bin/bash

echo "🚀 Setting up TAD Development Environment..."

# Check prerequisites
echo "📋 Checking prerequisites..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ NPM is required but not installed. Aborting."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ Git is required but not installed. Aborting."; exit 1; }

echo "✅ Prerequisites check passed"

# Install Rush globally
echo "📦 Installing Rush..."
pnpm install -g @microsoft/rush

# Verify Rush installation
rush --version

# Install dependencies
echo "📦 Installing monorepo dependencies..."
rush install

# Build all packages
echo "🔨 Building all packages..."
rush build

# Run tests
echo "🧪 Running tests..."
rush test

# Setup Git hooks
echo "🔗 Setting up Git hooks..."
if [ -d "tools/git-hooks" ]; then
  cp tools/git-hooks/* .git/hooks/
  chmod +x .git/hooks/*
fi

echo "✅ Development environment setup complete!"
echo ""
echo "🚀 Quick start commands:"
echo "  rush start:dev    - Start development servers"
echo "  rush build        - Build all packages"
echo "  rush test         - Run all tests"
echo ""
echo "📚 Useful resources:"
echo "  docs/README.md   - Main documentation"
echo "  docs/development-environment-planning/ - Dev environment docs"
```

### **tools/scripts/dev-status.sh**

```bash
#!/bin/bash

echo "📊 TAD Monorepo Development Status"
echo "=================================="

# Check Rush status
echo "🔧 Rush Status:"
if command -v rush >/dev/null 2>&1; then
  echo "  ✅ Rush installed: $(rush --version)"
else
  echo "  ❌ Rush not installed"
fi

# Check Node.js
echo "📦 Node.js Status:"
echo "  ✅ Node.js: $(node --version)"
echo "  ✅ NPM: $(npm --version)"

# Check Git
echo "🔗 Git Status:"
echo "  ✅ Git: $(git --version)"
echo "  📁 Repository: $(git rev-parse --show-toplevel 2>/dev/null || echo 'Not a Git repository')"

# Check workspace
echo "📁 Workspace Status:"
if [ -f "rush.json" ]; then
  echo "  ✅ Rush configuration found"
else
  echo "  ❌ Rush configuration missing"
fi

if [ -d "common" ]; then
  echo "  ✅ Common directory found"
else
  echo "  ❌ Common directory missing"
fi

# Check packages
echo "📦 Packages Status:"
package_count=$(find . -name "package.json" -not -path "./node_modules/*" | wc -l)
echo "  📊 Total packages: $package_count"

# Check for running processes
echo "🔍 Running Processes:"
node_processes=$(ps aux | grep -E "(node|rush|webpack|electron)" | grep -v grep | wc -l)
if [ "$node_processes" -gt 0 ]; then
  echo "  ✅ Development processes running: $node_processes"
else
  echo "  ⚠️ No development processes running"
fi

echo ""
echo "🚀 Quick Commands:"
echo "  rush install     - Install dependencies"
echo "  rush build       - Build all packages"
echo "  rush test        - Run all tests"
echo "  rush start:dev   - Start development servers"
```

## Troubleshooting Guide

### **Common Issues and Solutions**

#### **Dev Container Build Failures**
```bash
# Check the dev container logs in VS Code
# Verify base image is available: docker pull mcr.microsoft.com/devcontainers/javascript-node:18
# Check network connectivity for feature downloads
# Validate devcontainer.json syntax
```

#### **Rush Installation Issues**
```bash
# Clear npm cache: npm cache clean --force
# Reinstall Rush: npm uninstall -g @microsoft/rush && npm install -g @microsoft/rush
# Check Node.js version compatibility
```

#### **Port Forwarding Issues**
```bash
# Check if ports are already in use: netstat -tulpn | grep :3000
# Configure alternative ports in devcontainer.json
# Restart the dev container
```

#### **Extension Installation Problems**
```bash
# Check VS Code marketplace connectivity
# Verify extension IDs in devcontainer.json
# Try installing extensions manually after container starts
```

#### **Performance Issues**
```bash
# Monitor resource usage in VS Code
# Check dev container resource limits
# Consider using a larger machine type for GitHub Workspaces
# Optimize dev container features and extensions
```

### **Electron-Specific Development Issues**

#### **GUI Application Won't Run in Container**
```bash
# This is expected behavior - Electron GUI apps need host display
# Solution: Use hybrid workflow
# 1. Develop in container
# 2. Build application
# 3. Run on host system
```

#### **Remote Debugging Connection Issues**
```bash
# Ensure port 9229 is forwarded in devcontainer.json
# Start Electron with debugging: electron . --remote-debugging-port=9229
# In host VS Code, attach debugger to localhost:9229
# Check firewall settings on host system
```

#### **Hot Reload Not Working**
```bash
# For renderer process development:
# 1. Use webpack dev server in container
# 2. Forward port 8080 to host
# 3. Access http://localhost:8080 from host browser
# 4. Use webpack hot module replacement (HMR)
```

#### **File System Access Issues**
```bash
# Container has limited access to host file system
# Use volume mounts for shared directories
# Copy built files to host for testing
# Use rsync or similar for file synchronization
```

#### **Native Module Compilation Issues**
```bash
# Native modules need host system compilation
# Build native dependencies on host system
# Use electron-rebuild for native modules
# Consider using node-gyp with host toolchain
```

#### **Cross-Platform Development Challenges**
```bash
# Develop on Linux container (recommended)
# Test on Windows/macOS host systems
# Use platform-specific build scripts
# Handle path separators and file permissions
```

## Best Practices

### **Dev Container Optimization**
- Use lightweight base images when possible
- Layer features efficiently to reduce build time
- Keep essential extensions only
- Use post-create scripts for one-time setup
- Use post-start scripts for runtime configuration

### **Workspace Management**
- Use separate workspaces for different branches/features
- Regularly update dev container configurations
- Monitor storage usage and clean up old workspaces
- Use prebuilt workspaces for faster startup

### **Security Considerations**
- Store secrets in GitHub repository secrets
- Use GitHub's built-in secret management
- Configure appropriate access controls
- Regularly update base images and dependencies

### **Electron Development Best Practices**

#### **Hybrid Workflow Optimization**
- **95/5 Rule**: Spend 95% of time in containers, 5% testing locally
- **Build Frequently**: Build and test locally at least daily
- **Version Control**: Commit container-developed code regularly
- **Documentation**: Document local testing procedures and requirements

#### **Container Development Guidelines**
- **Renderer Focus**: Use containers primarily for React/TypeScript development
- **Main Process Logic**: Develop business logic in containers
- **Unit Testing**: Run all unit and component tests in containers
- **Build Validation**: Validate builds in container environment

#### **Local Development Guidelines**
- **GUI Testing**: Reserve local development for visual and interaction testing
- **Performance Testing**: Use local environment for accurate performance metrics
- **Integration Testing**: Test with real system integrations locally
- **Packaging**: Perform final packaging and distribution testing locally

#### **Debugging Strategies**
- **Remote Debugging**: Use port forwarding for remote debugging
- **Source Maps**: Ensure source maps are generated for debugging
- **Console Logging**: Use container logs for development debugging
- **Host Logs**: Use host system logs for runtime debugging

#### **File Synchronization**
- **Build Artifacts**: Sync built applications to host for testing
- **Development Assets**: Share development assets between container and host
- **Configuration Files**: Maintain consistent configs across environments
- **Test Data**: Sync test data and fixtures as needed

#### **Performance Considerations**
- **Container Resources**: Allocate sufficient resources for Electron development
- **Build Caching**: Use Rush's build caching for faster rebuilds
- **Hot Reloading**: Configure webpack HMR for efficient development
- **Parallel Processing**: Leverage container resources for parallel tasks

This configuration provides a complete, production-ready development environment that integrates seamlessly with the Rush monorepo architecture and supports the complex requirements of the TAD Electron migration project.