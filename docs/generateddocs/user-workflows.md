# TAD User Workflows and Experience Guide

## Introduction

TAD (Template-Assisted Design) provides a comprehensive workflow for developing, managing, and visualizing Nunjucks-based design systems. This guide explores the complete user experience from initial setup through advanced development workflows.

## Getting Started Workflow

### 1. Installation and Setup

#### VS Code Extension Installation
```bash
# Install from VS Code Marketplace
code --install-extension tad.template-assisted-design

# Or download .vsix file and install manually
code --install-extension tad-0.0.8.vsix
```

#### Initial Configuration
After installation, TAD requires API key configuration for AI features:

1. **Open Settings**: `Ctrl/Cmd + ,` → Search "TAD"
2. **Configure AI Provider**:
   - Choose provider: OpenAI, Anthropic, or OpenRouter
   - Set API key for selected provider
   - Select preferred model (GPT-4o, Claude, etc.)

#### Project Initialization
```bash
# Initialize TAD in existing project
# Command Palette: "TAD: Initialize Project"
```

This creates the `.tad/` directory structure:
```
.tad/
├── templates/          # Template source files
│   ├── pages/         # Page templates
│   ├── components/    # Component macros
│   ├── elements/      # Partial templates
│   └── styles/        # CSS stylesheets
├── builder/           # Build tools and scripts
├── dist/             # Compiled outputs
└── spaces.json       # Multi-space configuration
```

### 2. Template Space Creation

#### Single Space Setup
```bash
# Command: "TAD: Create Template Space"
# Creates basic directory structure with sample files
```

#### Multi-Space Configuration
For complex projects with multiple sites or environments:

```json
// .tad/spaces.json
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

## Core Development Workflows

### 1. Template Authoring Workflow

#### Creating Page Templates
1. **Create Page Structure**:
   ```nunjucks
   {# pages/home.njk #}
   {#
   relationships:
     next:
       - pages/about.njk
     related:
       - pages/contact.njk
   #}

   {% from 'container.njk' import container %}
   {% from 'hero.njk' import hero %}
   {% from 'footer.njk' import footer %}

   <!DOCTYPE html>
   <html lang="en">
   <head>
     <title>Home - My Site</title>
     <link rel="stylesheet" href="{{ designSystemCssHref }}">
   </head>
   <body>
     {{ container({
       body: [
         hero({ title: 'Welcome', subtitle: 'Build amazing things' }),
         '<p>Main content here...</p>'
       ] | join('')
     }) }}

     {{ footer({ copyright: '© 2024 My Site' }) }}
   </body>
   </html>
   ```

2. **Component Development**:
   ```nunjucks
   {# components/hero.njk #}
   {% macro hero(props) %}
   <section class="hero">
     <h1>{{ props.title }}</h1>
     {% if props.subtitle %}
       <p class="hero-subtitle">{{ props.subtitle }}</p>
     {% endif %}
   </section>
   {% endmacro %}
   ```

3. **Component States**:
   ```json
   // components/hero.states.json
   {
     "default": {
       "props": { "title": "Welcome", "subtitle": "Hello World" }
     },
     "minimal": {
       "props": { "title": "Hi" }
     }
   }
   ```

#### Intelligent Code Features
- **Auto-completion**: Type `{% include "` and get path suggestions
- **Go-to-Definition**: `Ctrl/Cmd + Click` on template paths
- **Hover Information**: See resolved file paths and relationships
- **Diagnostics**: Real-time validation of template references

### 2. Build and Preview Workflow

#### Automated Building
```bash
# Command: "TAD: Sync Builder"
# Seeds .tad/builder/ with build scripts

# Command: "TAD: Compile Templates"
# Compiles all templates and generates outputs
```

#### Build Output Structure
```
.tad/dist/
├── pages/
│   ├── home.html
│   └── about.html
├── components/
│   ├── hero/
│   │   ├── default.html
│   │   └── minimal.html
│   └── index.html          # Component catalog
├── design-system.css       # Copied stylesheet
├── manifest.json          # Template metadata
└── canvas-metadata.json   # Tags and relationships
```

#### Canvas Visualization
1. **Open Canvas**: `Ctrl/Cmd + Shift + P` → "TAD: Open Canvas View"
2. **Layout Modes**:
   - **Grid**: Traditional component library view
   - **Relationships**: Graph view of page connections
   - **Tags**: Group by custom tags

3. **Interactive Features**:
   - **Search**: Find frames by name or content
   - **Zoom/Pan**: Navigate large design systems
   - **Drag & Drop**: Reposition frames (persisted)
   - **Frame Actions**: Open source, view relationships

### 3. AI-Assisted Development Workflow

#### Chat Interface
1. **Open Chat**: Click TAD icon in activity bar
2. **Context-Aware Assistance**:
   ```
   User: "Create a card component with image, title, and description"

   TAD: I'll help you create a card component. Let me:
   1. Create the component macro
   2. Add state variations
   3. Show you how to use it in a page
   ```

#### Tool Integration
TAD provides various tools for AI assistance:

- **File Operations**: Read, write, edit template files
- **Search Tools**: Find patterns across templates
- **Build Tools**: Compile and preview changes
- **Theme Tools**: Generate CSS for design systems

#### Example Workflow
```
Developer: "I need a navigation component"
TAD: "I'll create a responsive navigation component with:
- Logo area
- Menu items
- Mobile hamburger menu
- Active state styling"

[AI creates component files, states, and usage examples]
[Automatically builds and shows preview in Canvas]
```

## Advanced Workflows

### 1. Design System Management

#### Component Library Organization
```
components/
├── atoms/
│   ├── button.njk
│   ├── input.njk
│   └── icon.njk
├── molecules/
│   ├── form-field.njk
│   ├── card.njk
│   └── navigation.njk
└── organisms/
    ├── header.njk
    ├── footer.njk
    └── sidebar.njk
```

#### Tag-Based Organization
```nunjucks
{# tags: atoms, ui, interactive #}
{% macro button(props) %}
<button class="btn {{ props.variant or 'primary' }}">
  {{ props.label }}
</button>
{% endmacro %}
```

#### Canvas Grouping
- **Tag View**: Group components by tags (atoms, molecules, organisms)
- **Custom Layouts**: Save and share component arrangements
- **Search Filters**: Find components by tag, name, or content

### 2. Multi-Site Development

#### Space-Based Architecture
```json
{
  "spaces": [
    {
      "name": "marketing",
      "templateRoot": "sites/marketing/templates",
      "distDir": "sites/marketing/dist"
    },
    {
      "name": "app",
      "templateRoot": "sites/app/templates",
      "distDir": "sites/app/dist"
    },
    {
      "name": "docs",
      "templateRoot": "sites/docs/templates",
      "distDir": "sites/docs/dist"
    }
  ]
}
```

#### Shared Component Strategy
```
shared/
├── components/
│   ├── button.njk
│   └── layout.njk
└── styles/
    └── design-system.css

sites/marketing/templates/
├── pages/
└── components/     # Marketing-specific components

sites/app/templates/
├── pages/
└── components/     # App-specific components
```

### 3. Collaborative Development

#### Version Control Integration
```bash
# .tad/ directory structure for collaboration
.tad/
├── templates/      # Source templates (tracked)
├── builder/        # Build tools (tracked)
├── spaces.json     # Configuration (tracked)
├── dist/          # Generated (ignored)
└── design_iterations/  # Manual iterations (optional)
```

#### Code Review Workflow
1. **Template Changes**: Modify `.njk` files
2. **Build Verification**: Run "TAD: Compile Templates"
3. **Canvas Review**: Open canvas to verify visual changes
4. **Relationship Validation**: Check navigation flows
5. **Component Testing**: Verify component states

### 4. Performance Optimization

#### Large Project Strategies
- **Viewport Culling**: Only render visible frames
- **LOD Rendering**: Use placeholders at low zoom
- **Lazy Loading**: Load components on demand
- **Build Caching**: Incremental compilation

#### Memory Management
- **Frame Limits**: Configure maximum frames per view
- **Image Optimization**: Compress preview images
- **Cache Strategies**: Browser caching for assets

## Integration Workflows

### 1. CI/CD Integration

#### Automated Building
```yaml
# .github/workflows/build.yml
name: Build Templates
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npx @vscode/vsce package
      - run: npm run build-templates
```

#### Quality Gates
```yaml
# Template validation
- name: Validate Templates
  run: |
    npx tad validate-templates
    npx tad check-relationships
    npx tad lint-components
```

### 2. External Tool Integration

#### Design Tool Integration
```javascript
// Figma plugin or design tool export
const designTokens = {
  colors: { primary: '#007acc', secondary: '#6c757d' },
  spacing: { small: '8px', medium: '16px', large: '24px' },
  typography: { fontFamily: 'Inter, sans-serif' }
};

// Generate CSS custom properties
const css = generateDesignTokens(designTokens);
```

#### Content Management Systems
```javascript
// CMS integration example
const cmsContent = await fetch('/api/content/home');
const pageData = {
  title: cmsContent.title,
  content: cmsContent.body,
  metadata: cmsContent.meta
};

// Render with Nunjucks
const html = nunjucks.render('page.njk', pageData);
```

### 3. Testing Integration

#### Visual Regression Testing
```javascript
// Canvas-based visual testing
const canvas = await openCanvas();
const screenshots = await canvas.captureAllFrames();

for (const screenshot of screenshots) {
  await compareWithBaseline(screenshot);
}
```

#### Component Testing
```javascript
// Template compilation testing
const component = nunjucks.render('button.njk', { label: 'Test' });
expect(component).toContain('btn');
expect(component).toContain('Test');
```

## Troubleshooting and Best Practices

### Common Issues and Solutions

#### Template Resolution Problems
```
Issue: "Cannot resolve template path"
Solution:
1. Check .tad/nunjucks settings
2. Verify template root configuration
3. Ensure file extensions are correct
4. Check space configuration
```

#### Build Failures
```
Issue: "Build failed with errors"
Solution:
1. Check template syntax
2. Verify component macro definitions
3. Ensure all dependencies exist
4. Check relationship targets
```

#### Performance Issues
```
Issue: "Canvas is slow with many frames"
Solution:
1. Enable viewport culling
2. Use tag-based filtering
3. Increase zoom for LOD rendering
4. Limit frames per view
```

### Best Practices

#### Template Organization
- Use consistent naming conventions
- Group related components logically
- Document component APIs clearly
- Use meaningful relationship annotations

#### Build Optimization
- Use incremental builds when possible
- Cache compiled templates
- Minimize component dependencies
- Optimize images and assets

#### Collaboration
- Use descriptive commit messages
- Document breaking changes
- Review template changes visually
- Maintain component documentation

## Future Workflow Enhancements

### Planned Features
- **Real-time Collaboration**: Multi-user canvas editing
- **Version Control Integration**: Git-aware template management
- **Advanced AI Features**: Code generation and refactoring
- **Performance Monitoring**: Build and runtime analytics
- **Plugin Ecosystem**: Third-party tool integrations

### Community Workflows
- **Template Sharing**: Public component libraries
- **Workflow Templates**: Pre-configured project setups
- **Integration Guides**: Third-party tool documentation
- **Best Practices**: Community-contributed patterns

## Conclusion

TAD provides a comprehensive workflow for template-based design system development, from initial setup through advanced collaborative development. The combination of intelligent code features, visual canvas, AI assistance, and automated building creates a powerful environment for creating, managing, and scaling design systems.

The extensible architecture and focus on developer experience make TAD suitable for projects ranging from small component libraries to large-scale design system platforms.