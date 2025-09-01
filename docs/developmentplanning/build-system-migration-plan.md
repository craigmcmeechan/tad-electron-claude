
# Build System Migration Plan

## Overview

This document outlines the migration strategy for TAD's build system from a VS Code extension context to a standalone Electron application. The build system is responsible for compiling Nunjucks templates, managing dependencies, generating manifests, and creating the final distributable assets that power the Canvas visualization.

## Current VS Code Build System Architecture

### Extension-Hosted Build Process

#### 1. Build Command Integration
```typescript
// src/extension.ts - Build command registration
const buildTemplatesDisposable = vscode.commands.registerCommand('tad.buildTemplates', async () => {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  // Ensure workspace-local builder exists
  const { builderDir } = await ensureWorkspaceBuilder(context, workspaceFolder.uri);

  // Execute build with progress indication
  await vscode.window.withProgress({
    title: 'Building Tad templates',
    location: vscode.ProgressLocation.Notification
  }, async () => {
    const child = execaNode('build.js', { cwd: builderDir.fsPath });
    // Stream output to TAD output channel
  });
});
```

#### 2. Builder Seeding Process
```typescript
// src/extension.ts - ensureWorkspaceBuilder function
async function ensureWorkspaceBuilder(context, workspaceUri) {
  const builderDir = vscode.Uri.joinPath(workspaceUri, '.tad', 'builder');
  const embeddedBuilder = vscode.Uri.joinPath(context.extensionUri, 'assets', 'builder');

  // Copy builder assets from extension to workspace
  await copyDirectory(embeddedBuilder, builderDir);

  return { builderDir, buildScript: vscode.Uri.joinPath(builderDir, 'build.js') };
}
```

#### 3. Build Script Architecture
The build system consists of several key components:

**Main Build Script (`build.js`)**:
```javascript
// .tad/builder/build.js
const nunjucks = require('nunjucks');
const fs = require('fs').promises;
const path = require('path');

async function buildSingleSpace(params) {
  const { workspaceRoot, appDir, spaceName, templateRootAbs, distDirAbs } = params;

  // 1. Configure Nunjucks environment
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(searchPaths, { noCache: true }),
    { autoescape: false }
  );

  // 2. Process templates
  await processTemplates(env, templateRootAbs, distDirAbs);

  // 3. Generate manifest and metadata
  await generateManifest(distDirAbs, processedTemplates);

  // 4. Copy design system assets
  await copyDesignSystemAssets(workspaceRoot, distDirAbs);
}
```

**Template Processing Pipeline**:
```javascript
// Template compilation process
async function processTemplates(env, templateRoot, distDir) {
  // 1. Discover all .njk files
  const templateFiles = await glob('**/*.njk', { cwd: templateRoot });

  // 2. Process each template
  for (const templatePath of templateFiles) {
    const outputPath = path.join(distDir, templatePath.replace('.njk', '.html'));
    const content = await fs.readFile(path.join(templateRoot, templatePath), 'utf8');

    // 3. Render with Nunjucks
    const rendered = env.render(templatePath, globalData);

    // 4. Beautify HTML
    const beautified = beautify.html(rendered, { indent_size: 2 });

    // 5. Write output
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, beautified);
  }
}
```

### Build System Components

#### 1. Multi-Space Support
```javascript
// .tad/spaces.json configuration
{
  "defaultSpace": "web",
  "spaces": [
    {
      "name": "web",
      "templateRoot": ".tad/templates",
      "distDir": ".tad/dist"
    },
    {
      "name": "mobile",
      "templateRoot": "mobile/templates",
      "distDir": "mobile/dist"
    }
  ]
}
```

#### 2. Component State Management
```javascript
// Component with states: components/button.njk
{% macro button(props) %}
<button class="btn {{ props.variant or 'primary' }}">
  {{ props.label }}
</button>
{% endmacro %}

// Associated states: components/button.states.json
{
  "default": { "props": { "label": "Click me" } },
  "disabled": { "props": { "label": "Disabled", "disabled": true } }
}
```

#### 3. Relationship Processing
```javascript
// Extract relationships from comments
const RELATIONSHIP_REGEX = /{#\s*@rel\s+(\w+):\s*([^#]+)#}/g;

// Process relationships for manifest generation
function extractRelationships(content) {
  const relationships = { next: [], prev: [], parent: [], children: [], related: [] };

  let match;
  while ((match = RELATIONSHIP_REGEX.exec(content)) !== null) {
    const [_, type, targets] = match;
    const targetList = targets.split(',').map(t => t.trim());
    relationships[type].push(...targetList);
  }

  return relationships;
}
```

## Electron Build System Migration Strategy

### Phase 1: Build System Integration

#### 1. Electron Build Manager
```typescript
// src/main/BuildManager.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { BrowserWindow, ipcMain } = require('electron');

class BuildManager {
  constructor(workspaceManager, configManager) {
    this.workspaceManager = workspaceManager;
    this.configManager = configManager;
    this.activeBuilds = new Map();
    this.buildQueue = [];
  }

  async initialize() {
    // Ensure build system is ready
    await this.ensureBuildSystem();

    // Setup IPC handlers
    this.setupIPCHandlers();
  }

  async ensureBuildSystem() {
    const workspacePath = this.workspaceManager.currentWorkspace;
    const builderDir = path.join(workspacePath, '.tad', 'builder');
    const buildScript = path.join(builderDir, 'build.js');

    // Check if build system exists
    try {
      await fs.access(buildScript);
    } catch {
      // Copy build system from application assets
      await this.installBuildSystem(builderDir);
    }
  }

  async installBuildSystem(builderDir) {
    const appPath = require('electron').app.getAppPath();
    const sourceDir = path.join(appPath, 'assets', 'builder');
    const targetDir = builderDir;

    // Copy build system files
    await this.copyBuildSystem(sourceDir, targetDir);

    // Install dependencies if needed
    await this.installBuildDependencies(targetDir);
  }

  async buildTemplates(options = {}) {
    const buildId = `build-${Date.now()}`;
    const workspacePath = this.workspaceManager.currentWorkspace;

    // Create build job
    const buildJob = {
      id: buildId,
      workspacePath,
      options,
      status: 'queued',
      startTime: Date.now(),
      progress: 0
    };

    this.activeBuilds.set(buildId, buildJob);
    this.buildQueue.push(buildJob);

    // Start build process
    this.processBuildQueue();

    return buildId;
  }

  async processBuildQueue() {
    if (this.buildQueue.length === 0) return;

    const buildJob = this.buildQueue.shift();
    buildJob.status = 'running';

    try {
      await this.executeBuild(buildJob);
      buildJob.status = 'completed';
    } catch (error) {
      buildJob.status = 'failed';
      buildJob.error = error.message;
    }

    // Notify completion
    this.notifyBuildComplete(buildJob);
  }

  async executeBuild(buildJob) {
    const { workspacePath, options } = buildJob;
    const builderDir = path.join(workspacePath, '.tad', 'builder');
    const buildScript = path.join(builderDir, 'build.js');

    return new Promise((resolve, reject) => {
      const buildProcess = spawn('node', [buildScript], {
        cwd: builderDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TAD_WORKSPACE: workspacePath,
          TAD_OPTIONS: JSON.stringify(options)
        }
      });

      let stdout = '';
      let stderr = '';

      buildProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        this.updateBuildProgress(buildJob.id, 'running', stdout);
      });

      buildProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Build failed with code ${code}: ${stderr}`));
        }
      });

      buildProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  updateBuildProgress(buildId, status, output) {
    const buildJob = this.activeBuilds.get(buildId);
    if (buildJob) {
      buildJob.status = status;
      buildJob.output = output;

      // Estimate progress based on output
      buildJob.progress = this.estimateBuildProgress(output);

      // Notify renderer
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('build-progress', {
          buildId,
          status,
          progress: buildJob.progress,
          output
        });
      });
    }
  }

  estimateBuildProgress(output) {
    // Simple progress estimation based on build phases
    const phases = ['Discovering templates', 'Processing templates', 'Generating manifest', 'Copying assets'];
    let completedPhases = 0;

    for (const phase of phases) {
      if (output.includes(phase)) {
        completedPhases++;
      }
    }

    return Math.round((completedPhases / phases.length) * 100);
  }

  notifyBuildComplete(buildJob) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('build-complete', {
        buildId: buildJob.id,
        status: buildJob.status,
        error: buildJob.error,
        duration: Date.now() - buildJob.startTime
      });
    });

    // Cleanup
    this.activeBuilds.delete(buildJob.id);
  }

  async cancelBuild(buildId) {
    const buildJob = this.activeBuilds.get(buildId);
    if (buildJob && buildJob.process) {
      buildJob.process.kill();
      buildJob.status = 'cancelled';
      this.notifyBuildComplete(buildJob);
    }
  }

  getBuildStatus(buildId) {
    return this.activeBuilds.get(buildId);
  }

  getActiveBuilds() {
    return Array.from(this.activeBuilds.values());
  }

  setupIPCHandlers() {
    ipcMain.handle('build-templates', async (event, options) => {
      return await this.buildTemplates(options);
    });

    ipcMain.handle('build-cancel', async (event, buildId) => {
      await this.cancelBuild(buildId);
    });

    ipcMain.handle('build-status', (event, buildId) => {
      return this.getBuildStatus(buildId);
    });

    ipcMain.handle('build-active', () => {
      return this.getActiveBuilds();
    });
  }

  async copyBuildSystem(sourceDir, targetDir) {
    const fs = require('fs').promises;
    const path = require('path');

    async function copyRecursive(source, target) {
      const stats = await fs.stat(source);

      if (stats.isDirectory()) {
        await fs.mkdir(target, { recursive: true });
        const entries = await fs.readdir(source);

        for (const entry of entries) {
          const sourcePath = path.join(source, entry);
          const targetPath = path.join(target, entry);
          await copyRecursive(sourcePath, targetPath);
        }
      } else {
        await fs.copyFile(source, target);
      }
    }

    await copyRecursive(sourceDir, targetDir);
  }

  async installBuildDependencies(builderDir) {
    const { spawn } = require('child_process');

    return new Promise((resolve, reject) => {
      const installProcess = spawn('pnpm', ['install', '--prod'], {
        cwd: builderDir,
        stdio: 'inherit'
      });

      installProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to install build dependencies: ${code}`));
        }
      });

      installProcess.on('error', reject);
    });
  }

  dispose() {
    // Cancel all active builds
    for (const [buildId, buildJob] of this.activeBuilds) {
      if (buildJob.process) {
        buildJob.process.kill();
      }
    }
    this.activeBuilds.clear();
    this.buildQueue.length = 0;
  }
}

module.exports = BuildManager;
```

#### 2. Enhanced Build Script for Electron
```javascript
// assets/builder/build.js - Enhanced for Electron
const nunjucks = require('nunjucks');
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob-promise');
const beautify = require('js-beautify');

// Get environment variables from Electron
const workspaceRoot = process.env.TAD_WORKSPACE || process.cwd();
const buildOptions = JSON.parse(process.env.TAD_OPTIONS || '{}');

async function main() {
  try {
    console.log('Starting TAD build process...');
    console.log(`Workspace: ${workspaceRoot}`);

    // Load configuration
    const config = await loadConfiguration(workspaceRoot);

    // Determine spaces to build
    const spacesToBuild = buildOptions.spaces || config.spaces || [{
      name: 'default',
      templateRoot: '.tad/templates',
      distDir: '.tad/dist'
    }];

    // Build each space
    for (const space of spacesToBuild) {
      console.log(`Building space: ${space.name}`);
      await buildSingleSpace({
        workspaceRoot,
        spaceName: space.name,
        templateRoot: space.templateRoot,
        distDir: space.distDir,
        config
      });
    }

    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

async function loadConfiguration(workspaceRoot) {
  const configPath = path.join(workspaceRoot, '.tad', 'config.json');

  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch {
    // Return default configuration
    return {
      nunjucks: {
        templateRoots: ['.tad/templates'],
        defaultExtensions: ['.njk', '.nunjucks', '.html']
      },
      build: {
        beautify: true,
        sourceMaps: false
      }
    };
  }
}

async function buildSingleSpace(params) {
  const { workspaceRoot, spaceName, templateRoot, distDir, config } = params;

  // Resolve paths
  const templateRootAbs = path.resolve(workspaceRoot, templateRoot);
  const distDirAbs = path.resolve(workspaceRoot, distDir);

  console.log(`  Template root: ${templateRootAbs}`);
  console.log(`  Output directory: ${distDirAbs}`);

  // Ensure output directory exists
  await fs.mkdir(distDirAbs, { recursive: true });

  // Configure Nunjucks environment
  const env = await configureNunjucks(templateRootAbs, config);

  // Discover templates
  console.log('  Discovering templates...');
  const templates = await discoverTemplates(templateRootAbs, config);

  // Process templates
  console.log(`  Processing ${templates.length} templates...`);
  const processedTemplates = await processTemplates(env, templates, {
    templateRootAbs,
    distDirAbs,
    config
  });

  // Process components with states
  console.log('  Processing components...');
  const components = await processComponents(env, templateRootAbs, distDirAbs, config);

  // Generate manifest
  console.log('  Generating manifest...');
  await generateManifest(distDirAbs, processedTemplates, components, config);

  // Copy design system assets
  console.log('  Copying design system assets...');
  await copyDesignSystemAssets(workspaceRoot, distDirAbs, config);

  console.log(`  Space ${spaceName} build completed!`);
}

async function configureNunjucks(templateRoot, config) {
  const searchPaths = [
    templateRoot,
    path.join(templateRoot, 'pages'),
    path.join(templateRoot, 'components'),
    path.join(templateRoot, 'elements')
  ];

  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(searchPaths, { noCache: true }),
    {
      autoescape: false,
      throwOnUndefined: false
    }
  );

  // Add global data
  env.addGlobal('designSystemCssHref', './design-system.css');
  env.addGlobal('spaceName', path.basename(templateRoot));

  return env;
}

async function discoverTemplates(templateRoot, config) {
  const extensions = config.nunjucks?.defaultExtensions || ['.njk', '.nunjucks', '.html'];
  const ignore = config.nunjucks?.ignore || ['**/node_modules/**', '.tad/dist/**'];

  const patterns = extensions.map(ext => `**/*${ext}`);
  const templates = [];

  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: templateRoot,
      ignore,
      absolute: true
    });
    templates.push(...files);
  }

  return [...new Set(templates)]; // Remove duplicates
}

async function processTemplates(env, templates, options) {
  const { templateRootAbs, distDirAbs, config } = options;
  const processed = [];

  for (const templatePath of templates) {
    const relativePath = path.relative(templateRootAbs, templatePath);
    const outputPath = path.join(distDirAbs, relativePath.replace(/\.(njk|nunjucks)$/, '.html'));

    try {
      // Read template content
      const content = await fs.readFile(templatePath, 'utf8');

      // Extract metadata
      const metadata = extractTemplateMetadata(content, relativePath);

      // Render template
      const rendered = env.render(relativePath, {
        ...metadata.globalData,
        templatePath: relativePath
      });

      // Beautify HTML if enabled
      let finalOutput = rendered;
      if (config.build?.beautify !== false) {
        finalOutput = beautify.html(rendered, {
          indent_size: 2,
          preserve_newlines: true,
          max_preserve_newlines: 2
        });
      }

      // Write output
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, finalOutput, 'utf8');

      processed.push({
        inputPath: relativePath,
        outputPath: path.relative(distDirAbs, outputPath),
        metadata
      });

    } catch (error) {
      console.error(`Failed to process ${relativePath}:`, error.message);
      throw error;
    }
  }

  return processed;
}

function extractTemplateMetadata(content, filePath) {
  const metadata = {
    relationships: { next: [], prev: [], parent: [], children: [], related: [] },
    tags: [],
    globalData: {}
  };

  // Extract relationships
  const relRegex = /{#\s*@rel\s+(\w+):\s*([^#]+)#}/g;
  let match;
  while ((match = relRegex.exec(content)) !== null) {
    const [_, type, targets] = match;
    const targetList = targets.split(',').map(t => t.trim());
    if (metadata.relationships[type]) {
      metadata.relationships[type].push(...targetList);
    }
  }

  // Extract tags
  const tagRegex = /{#\s*tags?:\s*([^#]+)#}/g;
  while ((match = tagRegex.exec(content)) !== null) {
    const tagList = match[1].split(',').map(t => t.trim());
    metadata.tags.push(...tagList);
  }

  return metadata;
}

async function processComponents(env, templateRoot, distDir, config) {
  const componentsDir = path.join(templateRoot, 'components');
  const components = [];

  try {
    const componentFiles = await fs.readdir(componentsDir);

    for (const file of componentFiles) {
      if (path.extname(file) === '.njk') {
        const componentName = path.basename(file, '.njk');
        const component = await processComponent(
          env,
          componentsDir,
          distDir,
          componentName,
          config
        );
        components.push(component);
      }
    }
  } catch (error) {
    // Components directory doesn't exist, skip
    console.log('  No components directory found');
  }

  return components;
}

async function processComponent(env, componentsDir, distDir, componentName, config) {
  const componentPath = path.join(componentsDir, `${componentName}.njk`);
  const statesPath = path.join(componentsDir, `${componentName}.states.json`);

  // Read component macro
  const componentContent = await fs.readFile(componentPath, 'utf8');

  // Extract macro name
  const macroMatch = componentContent.match(/{%\s*macro\s+([A-Za-z_][\w]*)\s*\(/);
  if (!macroMatch) {
    throw new Error(`No macro found in ${componentName}.njk`);
  }

  const macroName = macroMatch[1];

  // Load states or use default
  let states = { default: { props: {} } };
  try {
    const statesContent = await fs.readFile(statesPath, 'utf8');
    states = JSON.parse(statesContent);
  } catch {
    // Use default state
  }

  // Generate HTML for each state
  const stateOutputs = {};
  for (const [stateName, stateConfig] of Object.entries(states)) {
    const wrapper = `
<!DOCTYPE html>
<html>
<head>
  <title>${componentName} - ${stateName}</title>
  <link rel="stylesheet" href="./design-system.css">
</head>
<body>
  {% from "${componentName}.njk" import ${macroName} as Component %}
  {{ Component(props) }}
</body>
</html>`.trim();

    const rendered = env.renderString(wrapper, {
      props: stateConfig.props || {},
      componentName,
      stateName
    });

    const beautified = config.build?.beautify !== false ?
      beautify.html(rendered, { indent_size: 2 }) : rendered;

    const outputPath = path.join(distDir, 'components', componentName, `${stateName}.html`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, beautified, 'utf8');

    stateOutputs[stateName] = path.relative(distDir, outputPath);
  }

  return {
    name: componentName,
    macro: macroName,
    path: path.relative(componentsDir, componentPath),
    states: stateOutputs
  };
}

async function generateManifest(distDir, processedTemplates, components, config) {
  const manifest = {
    version: '1.0',
    generated: new Date().toISOString(),
    templates: {},
    components: {},
    relationships: {},
    tags: {}
  };

  // Process templates
  for (const template of processedTemplates) {
    const key = template.inputPath.replace(/\.(njk|nunjucks)$/, '');
    manifest.templates[key] = {
      input: template.inputPath,
      output: template.outputPath,
      relationships: template.metadata.relationships,
      tags: template.metadata.tags
    };

    // Collect relationships
    for (const [type, targets] of Object.entries(template.metadata.relationships)) {
      if (!manifest.relationships[type]) manifest.relationships[type] = {};
      for (const target of targets) {
        if (!manifest.relationships[type][key]) manifest.relationships[type][key] = [];
        manifest.relationships[type][key].push(target);
      }
    }

    // Collect tags
    for (const tag of template.metadata.tags) {
      if (!manifest.tags[tag]) manifest.tags[tag] = [];
      manifest.tags[tag].push(key);
    }
  }

  // Process components
  for (const component of components) {
    manifest.components[component.name] = {
      macro: component.macro,
      path: component.path,
      states: component.states
    };
  }

  // Write manifest
  const manifestPath = path.join(distDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Write canvas metadata
  const canvasMetadata = {
    tags: Object.keys(manifest.tags),
    templates: Object.keys(manifest.templates),
    components: Object.keys(manifest.components)
  };

  const canvasMetadataPath = path.join(distDir, 'canvas-metadata.json');
  await fs.writeFile(canvasMetadataPath, JSON.stringify(canvasMetadata, null, 2), 'utf8');
}

async function copyDesignSystemAssets(workspaceRoot, distDir, config) {
  const possiblePaths = [
    path.join(workspaceRoot, 'design-system.css'),
    path.join(workspaceRoot, 'css', 'design-system.css'),
    path.join(workspaceRoot, '.tad', 'design-system.css')
  ];

  for (const cssPath of possiblePaths) {
    try {
      await fs.access(cssPath);
      const destPath = path.join(distDir, 'design-system.css');
      await fs.copyFile(cssPath, destPath);
      console.log(`  Copied design system CSS from ${cssPath}`);
      return;
    } catch {
      // Try next path
    }
  }

  console.log('  No design system CSS found, skipping...');
}

// Run build
if (require.main === module) {
  main().catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
  });
}

module.exports = { main, buildSingleSpace };
```

### Phase 2: Build System Enhancements

#### 1. Incremental Build System
```typescript
// src/main/IncrementalBuildManager.js
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class IncrementalBuildManager {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
    this.cacheFile = path.join(workspaceManager.currentWorkspace, '.tad', 'build-cache.json');
    this.cache = {};
  }

  async loadCache() {
    try {
      const cacheData = await fs.readFile(this.cacheFile, 'utf8');
      this.cache = JSON.parse(cacheData);
    } catch {
      this.cache = {};
    }
  }

  async saveCache() {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2), 'utf8');
  }

  async needsRebuild(filePath, content) {
    const hash = this.computeHash(content);
    const cached = this.cache[filePath];

    if (!cached || cached.hash !== hash) {
      this.cache[filePath] = {
        hash,
        lastBuilt: Date.now(),
        dependencies: await this.extractDependencies(content)
      };
      return true;
    }

    // Check if dependencies have changed
    for (const dep of cached.dependencies) {
      const depPath = path.resolve(path.dirname(filePath), dep);
      try {
        const depContent = await fs.readFile(depPath, 'utf8');
        const depHash = this.computeHash(depContent);

        if (this.cache[depPath]?.hash !== depHash) {
          return true;
        }
      } catch {
        // Dependency doesn't exist, force rebuild
        return true;
      }
    }

    return false;
  }

  computeHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  async extractDependencies(content) {
    const dependencies = [];
    const includeRegex = /{%\s*(?:include|import|from|extends)\s+['"]([^'"]+)['"]/g;

    let match;
    while ((match = includeRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return dependencies;
  }

  async getFilesNeedingRebuild(allFiles) {
    const needsRebuild = [];

    for (const filePath of allFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        if (await this.needsRebuild(filePath, content)) {
          needsRebuild.push(filePath);
        }
      } catch (error) {
        // File can't be read, force rebuild
        needsRebuild.push(filePath);
      }
    }

    return needsRebuild;
  }

  invalidateCache(filePath) {
    delete this.cache[filePath];

    // Also invalidate files that depend on this file
    for (const [cachedPath, cachedData] of Object.entries(this.cache)) {
      if (cachedData.dependencies?.includes(path.relative(path.dirname(cachedPath), filePath))) {
        delete this.cache[cachedPath];
      }
    }
  }

  clearCache() {
    this.cache = {};
  }

  getCacheStats() {
    const totalFiles = Object.keys(this.cache).length;
    const recentlyBuilt = Object.values(this.cache).filter(
      entry => Date.now() - entry.lastBuilt < 24 * 60 * 60 * 1000 // Last 24 hours
    ).length;

    return { totalFiles, recentlyBuilt };
  }
}

module.exports = IncrementalBuildManager;
```

#### 2. Build Watch Mode
```typescript
// src/main/BuildWatcher.js
const chokidar = require('chokidar');
const path = require('path');

class BuildWatcher {
  constructor(buildManager, workspaceManager) {
    this.buildManager = buildManager;
    this.workspaceManager = workspaceManager;
    this.watcher = null;
    this.isEnabled = false;
    this.pendingChanges = new Set();
    this.debounceTimer = null;
    this.debounceDelay = 500; // ms
  }

  start() {
    if (this.watcher) return;

    const workspacePath = this.workspaceManager.currentWorkspace;
    const watchPaths = [
      path.join(workspacePath, '.tad', 'templates', '**', '*.{njk,nunjucks,html}'),
      path.join(workspacePath, '.tad', 'spaces.json'),
      path.join(workspacePath, 'design-system.css')
    ];

    this.watcher = chokidar.watch(watchPaths, {
      ignored: [
        /(^|[\/\\])\../,
        '**/node_modules/**',
        '**/.tad/dist/**'
      ],
      persistent: true,
      ignoreInitial: true
    });

    this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
    this.watcher.on('add', (filePath) => this.handleFileChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleFileChange(filePath));

    this.isEnabled = true;
    console.log('Build watcher started');
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.isEnabled = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    console.log('Build watcher stopped');
  }

  handleFileChange(filePath) {
    if (!this.isEnabled) return;

    this.pendingChanges.add(filePath);

    // Debounce rebuild
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.triggerRebuild();
    }, this.debounceDelay);
  }

  async triggerRebuild() {
    if (this.pendingChanges.size === 0) return;

    const changedFiles = Array.from(this.pendingChanges);
    this.pendingChanges.clear();

    console.log(`Rebuilding due to changes in: ${changedFiles.join(', ')}`);

    try {
      await this.buildManager.buildTemplates({
        incremental: true,
        changedFiles
      });
    } catch (error) {
      console.error('Auto-rebuild failed:', error);
    }
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      pendingChanges: this.pendingChanges.size,
      debounceDelay: this.debounceDelay
    };
  }

  setDebounceDelay(delay) {
    this.debounceDelay = delay;
  }
}

module.exports = BuildWatcher;
```

### Phase 3: Build System UI Integration

#### 1. Build Progress UI
```html
<!-- src/renderer/components/BuildProgress.html -->
<div id="build-progress" class="build-progress hidden">
  <div class="build-header">
    <h3>Building Templates</h3>
    <button id="cancel-build" class="cancel-button">Cancel</button>
  </div>

  <div class="build-status">
    <div class="progress-bar">
      <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
    </div>
    <span id="progress-text">Initializing...</span>
  </div>

  <div class="build-output">
    <pre id="build-log"></pre>
  </div>
</div>
```

```typescript
// src/renderer/components/BuildProgress.js
class BuildProgress {
  constructor() {
    this.currentBuildId = null;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Cancel build button
    document.getElementById('cancel-build').addEventListener('click', () => {
      if (this.currentBuildId) {
        window.tadAPI.cancelBuild(this.currentBuildId);
      }
    });
  }

  show(buildId) {
    this.currentBuildId = buildId;
    document.getElementById('build-progress').classList.remove('hidden');
    this.updateProgress(0, 'Starting build...');
  }

  hide() {
    document.getElementById('build-progress').classList.add('hidden');
    this.currentBuildId = null;
  }

  updateProgress(progress, status, output = '') {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const buildLog = document.getElementById('build-log');

    progressFill.style.width = `${progress}%`;
    progressText.textContent = status;

    if (output) {
      buildLog.textContent += output + '\n';
      buildLog.scrollTop = buildLog.scrollHeight;
    }
  }

  handleBuildComplete(result) {
    if (result.buildId === this.currentBuildId) {
      if (result.status === 'completed') {
        this.updateProgress(100, 'Build completed successfully!');
      } else if (result.status === 'failed') {
        this.updateProgress(100, `Build failed: ${result.error}`);
      } else if (result.status === 'cancelled') {
        this.updateProgress(100, 'Build cancelled');
      }

      // Auto-hide after a delay
      setTimeout(() => this.hide(), 3000);
    }
  }
}

// IPC event handlers
const { ipcRenderer } = require('electron');

ipcRenderer.on('build-progress', (event, data) => {
  buildProgress.updateProgress(data.progress, data.status, data.output);
});

ipcRenderer.on('build-complete', (event, data) => {
  buildProgress.handleBuildComplete(data);
});

// Initialize
const buildProgress = new BuildProgress();
```

#### 2. Build Configuration UI
```html
<!-- src/renderer/components/BuildConfig.html -->
<div id="build-config" class="build-config">
  <div class="config-section">
    <h4>Build Options</h4>

    <div class="config-item">
      <label>
        <input type="checkbox" id="auto-build" checked>
        Auto-build on file changes
      </label>
    </div>

    <div class="config-item">
      <label>
        <input type="checkbox" id="beautify-html" checked>
        Beautify HTML output
      </label>
    </div>

    <div class="config-item">
      <label>
        <input type="checkbox" id="source-maps" checked>
        Generate source maps
      </label>
    </div>
  </div>

  <div class="config-section">
    <h4>Spaces</h4>
    <div id="spaces-list" class="spaces-list">
      <!-- Spaces will be populated here -->
    </div>
    <button id="add-space" class="add-button">Add Space</button>
  </div>

  <div class="config-actions">
    <button id="save-config" class="primary-button">Save Configuration</button>
    <button id="reset-config" class="secondary-button">Reset to Defaults</button>
  </div>
</div>
```

### Phase 4: Build System Testing and Validation

#### 1. Build System Tests
```typescript
// tests/build-system.test.js
const { BuildManager } = require('../src/main/BuildManager');
const { WorkspaceManager } = require('../src/main/WorkspaceManager');
const fs = require('fs').promises;
const path = require('path');

describe('Build System', () => {
  let buildManager;
  let workspaceManager;
  let testWorkspace;

  beforeEach(async () => {
    testWorkspace = await createTestWorkspace();
    workspaceManager = new WorkspaceManager();
    await workspaceManager.setWorkspace(testWorkspace);

    buildManager = new BuildManager(workspaceManager);
    await buildManager.initialize();
  });

  afterEach(async () => {
    await cleanupTestWorkspace(testWorkspace);
  });

  describe('Template Compilation', () => {
    test('should compile basic Nunjucks template', async () => {
      // Create test template
      const templatePath = path.join(testWorkspace, '.tad', 'templates', 'test.njk');
      const templateContent = `
{% set title = "Test Page" %}
<!DOCTYPE html>
<html>
<head><title>{{ title }}</title></head>
<body><h1>{{ title }}</h1></body>
</html>`.trim();

      await fs.mkdir(path.dirname(templatePath), { recursive: true });
      await fs.writeFile(templatePath, templateContent);

      // Build templates
      const buildId = await buildManager.buildTemplates();
      await waitForBuildComplete(buildId);

      // Check output
      const outputPath = path.join(testWorkspace, '.tad', 'dist', 'test.html');
      const outputContent = await fs.readFile(outputPath, 'utf8');

      expect(outputContent).toContain('<title>Test Page</title>');
      expect(outputContent).toContain('<h1>Test Page</h1>');
    });

    test('should handle template includes', async () => {
      // Create header component
      const headerPath = path.join(testWorkspace, '.tad', 'templates', 'components', 'header.njk');
      await fs.mkdir(path.dirname(headerPath), { recursive: true });
      await fs.writeFile(headerPath, `
{% macro header(title) %}
<header><h1>{{ title }}</h1></header>
{% endmacro %}`.trim());

      // Create page that includes header
      const pagePath = path.join(testWorkspace, '.tad', 'templates', 'index.njk');
      await fs.writeFile(pagePath, `
{% from "components/header.njk" import header %}
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>{{ header("Welcome") }}</body>
</html>`.trim());

      // Build and verify
      const buildId = await buildManager.buildTemplates();
      await waitForBuildComplete(buildId);

      const outputPath = path.join(testWorkspace, '.tad', 'dist', 'index.html');
      const outputContent = await fs.readFile(outputPath, 'utf8');

      expect(outputContent).toContain('<header><h1>Welcome</h1></header>');
    });

    test('should generate manifest with relationships', async () => {
      // Create templates with relationships
      const homePath = path.join(testWorkspace, '.tad', 'templates', 'home.njk');
      await fs.writeFile(homePath, `
{# @rel next: about.njk #}
<!DOCTYPE html>
<html>
<head><title>Home</title></head>
<body><h1>Home Page</h1></body>
</html>`.trim());

      const aboutPath = path.join(testWorkspace, '.tad', 'templates', 'about.njk');
      await fs.writeFile(aboutPath, `
{# @rel prev: home.njk #}
<!DOCTYPE html>
<html>
<head><title>About</title></head>
<body><h1>About Page</h1></body>
</html>`.trim());

      // Build and check manifest
      const buildId = await buildManager.buildTemplates();
      await waitForBuildComplete(buildId);

      const manifestPath = path.join(testWorkspace, '.tad', 'dist', 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

      expect(manifest.relationships.next.home).toContain('about.njk');
      expect(manifest.relationships.prev.about).toContain('home.njk');
    });
  });

  describe('Incremental Builds', () => {
    test('should skip unchanged files', async () => {
      // Create initial template
      const templatePath = path.join(testWorkspace, '.tad', 'templates', 'stable.njk');
      const content = '<h1>Stable Content</h1>';
      await fs.writeFile(templatePath, content);

      // First build
      await buildManager.buildTemplates();
      const firstBuildTime = Date.now();

      // Wait a bit and rebuild without changes
      await new Promise(resolve => setTimeout(resolve, 100));
      await buildManager.buildTemplates();

      // Check that output wasn't regenerated (by checking timestamps)
      const outputPath = path.join(testWorkspace, '.tad', 'dist', 'stable.html');
      const stats = await fs.stat(outputPath);

      // Output should not have been regenerated
      expect(stats.mtime.getTime()).toBeLessThan(firstBuildTime);
    });
  });

  describe('Multi-Space Builds', () => {
    test('should build multiple spaces independently', async () => {
      // Create spaces configuration
      const spacesConfig = {
        spaces: [
          {
            name: 'web',
            templateRoot: '.tad/templates/web',
            distDir: '.tad/dist/web'
          },
          {
            name: 'mobile',
            templateRoot: '.tad/templates/mobile',
            distDir: '.tad/dist/mobile'
          }
        ]
      };

      const spacesPath = path.join(testWorkspace, '.tad', 'spaces.json');
      await fs.writeFile(spacesPath, JSON.stringify(spacesConfig, null, 2));

      // Create templates in both spaces
      const webTemplate = path.join(testWorkspace, '.tad', 'templates', 'web', 'index.njk');
      const mobileTemplate = path.join(testWorkspace, '.tad', 'templates', 'mobile', 'index.njk');

      await fs.mkdir(path.dirname(webTemplate), { recursive: true });
      await fs.mkdir(path.dirname(mobileTemplate), { recursive: true });

      await fs.writeFile(webTemplate, '<h1>Web Version</h1>');
      await fs.writeFile(mobileTemplate, '<h1>Mobile Version</h1>');

      // Build all spaces
      const buildId = await buildManager.buildTemplates();
      await waitForBuildComplete(buildId);

      // Check outputs
      const webOutput = await fs.readFile(path.join(testWorkspace, '.tad', 'dist', 'web', 'index.html'), 'utf8');
      const mobileOutput = await fs.readFile(path.join(testWorkspace, '.tad', 'dist', 'mobile', 'index.html'), 'utf8');

      expect(webOutput).toContain('Web Version');
      expect(mobileOutput).toContain('Mobile Version');
    });
  });
});

// Helper functions
async function createTestWorkspace() {
  const tempDir = require('os').tmpdir();
  const workspacePath = path.join(tempDir, `tad-test-${Date.now()}`);

  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(path.join(workspacePath, '.tad'), { recursive: true });

  return workspacePath;
}

async function cleanupTestWorkspace(workspacePath) {
  await fs.rm(workspacePath, { recursive: true, force: true });
}

async function waitForBuildComplete(buildId) {
  return new Promise((resolve) => {
    const checkComplete = async () => {
      const status = await buildManager.getBuildStatus(buildId);
      if (status && (status.status === 'completed' || status.status === 'failed')) {
        resolve(status);
      } else {
        setTimeout(checkComplete, 100);
      }
    };
    checkComplete();
  });
}
```

## Migration Benefits and Implementation Timeline

### Benefits of the Enhanced Build System

1. **Native Performance**: Direct file system access without VS Code abstraction layers
2. **Incremental Builds**: Only rebuild changed files and their dependencies
3. **Watch Mode**: Automatic rebuilding on file changes
4. **Multi-Space Support**: Independent builds for different environments
5. **Progress Tracking**: Real-time build progress and status updates
6. **Error Handling**: Comprehensive error reporting and recovery
7. **Caching**: Build cache for improved performance
8. **Extensibility**: Plugin architecture for custom build steps

### Implementation Timeline

#### Week 1-2: Core Build Infrastructure
- [ ] Migrate build script to Electron assets
- [ ] Implement BuildManager class
- [ ] Setup IPC communication for build operations
- [ ] Basic template compilation testing

#### Week 3-4: Enhanced Build Features
- [ ] Implement incremental build system
- [ ] Add build watching capabilities
- [ ] Multi-space build support
- [ ] Progress tracking and UI

#### Week 5-6: Build System Integration
- [ ] Integrate with workspace manager
- [ ] Build configuration UI
- [ ] Error handling and recovery
- [ ] Build caching implementation

#### Week 7-8: Testing and Optimization
- [ ] Comprehensive build system testing
- [ ] Performance optimization
- [ ] Memory usage monitoring
- [ ] Cross-platform compatibility testing

### Success Metrics

-