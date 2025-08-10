const path = require('path');
const fs = require('fs-extra');
const nunjucks = require('nunjucks');
const { glob } = require('glob');
const { html: beautifyHtml } = require('js-beautify');

async function main() {
  const root = path.resolve(__dirname, '..');
  const appDir = path.resolve(__dirname );
  const templateDir = path.resolve(root, 'templates')
  // New folder structure:
  // - elements: base design system primitives (macros/partials)
  // - components: higher-level compositions of primitives and content
  // - pages: final compositions of both elements and components
  const pagesDir = path.join(templateDir, 'pages');
  const componentsDir = path.join(templateDir, 'components');
  const elementsDir = path.join(templateDir, 'elements');
  const outDir = path.join(root, 'dist');
  const workspaceRoot = path.resolve(root, '..');
  const defaultTemplateExtensions = ['.njk', '.nunjucks', '.html'];
  const pagesOutDir = path.join(outDir, 'pages');
  const componentsOutDir = path.join(outDir, 'components');

  // Prepare output directories; clean only pages/components to preserve top-level assets like design-system.css
  await fs.ensureDir(outDir);
  await fs.ensureDir(pagesOutDir);
  await fs.ensureDir(componentsOutDir);
  await fs.emptyDir(pagesOutDir);
  await fs.emptyDir(componentsOutDir);

  // Configure Nunjucks to load from pages, components, and elements
  const searchPaths = [pagesDir, componentsDir, elementsDir];
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(searchPaths, {
      noCache: true,
    }),
    { autoescape: false }
  );

  // Global data available to all templates
  const globalData = {
    titleSuffix: '— Wireframe',
  };

  // Debug: print resolved directories
  console.log('Pages dir:', pagesDir);
  console.log('Components dir:', componentsDir);
  console.log('Elements dir:', elementsDir);
  console.log('Output dir (root):', outDir);
  console.log('Output dir (pages):', pagesOutDir);
  console.log('Output dir (components):', componentsOutDir);

  // Use absolute pattern to avoid cwd issues and Windows escaping problems
  const pattern = path.join(pagesDir, '**', '*.njk').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true, windowsPathsNoEscape: true });
  console.log('Matched pages:', files.map(f => path.relative(pagesDir, f)));

  const beautifyOptions = {
    indent_size: 2,
    preserve_newlines: true,
    max_preserve_newlines: 2,
    wrap_line_length: 120,
    end_with_newline: true,
    extra_liners: [],
  };

  // --- Dependency scanning helpers for manifest generation ---
  const manifest = {}; // key: output rel path under dist/, value: { page, components[], elements[], tags? }
  const canvasMetadata = {}; // key: output rel path under dist/, value: { tags?: string[] }

  function toRel(fromDir, absPath) {
    return path.relative(fromDir, absPath).replace(/\\/g, '/');
  }

  function isUnder(dir, file) {
    const rel = path.relative(dir, file);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  function resolveTemplateRef(currentFile, ref) {
    // Try relative to current file first
    const candidateRel = path.resolve(path.dirname(currentFile), ref);
    if (fs.existsSync(candidateRel)) return candidateRel;
    // Try each search path (pages, components, elements)
    for (const base of [pagesDir, componentsDir, elementsDir]) {
      const candidate = path.resolve(base, ref);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  // Resolve a relationship target string to an absolute file path of a page template.
  // Supports:
  // - Workspace-relative: .superdesign/templates/pages/...
  // - Template-root-relative: pages/...
  // - Extensionless paths: tries defaultTemplateExtensions
  function resolveRelationshipTarget(currentFile, target) {
    if (!target || typeof target !== 'string') return null;
    const cleaned = target.trim();
    if (!cleaned) return null;
    if (cleaned.includes('*')) return null; // disallow globs per spec

    const candidates = [];

    // Absolute or workspace-relative starting with .superdesign/
    if (cleaned.startsWith('.superdesign/')) {
      const absBase = path.resolve(workspaceRoot, cleaned);
      candidates.push(absBase);
    }

    // Template-root-relative (pages/...)
    if (/^(pages|components|elements)\//.test(cleaned)) {
      candidates.push(path.resolve(templateDir, cleaned));
    }

    // If path is relative without prefix, try relative to current file
    if (!path.isAbsolute(cleaned) && !cleaned.startsWith('.superdesign/') && !/^(pages|components|elements)\//.test(cleaned)) {
      candidates.push(path.resolve(path.dirname(currentFile), cleaned));
    }

    // Try each candidate with/without extensions
    for (const base of candidates) {
      // If the provided path already has an extension, test it directly
      if (path.extname(base)) {
        if (fs.existsSync(base)) return base;
      } else {
        for (const ext of defaultTemplateExtensions) {
          const withExt = base + ext;
          if (fs.existsSync(withExt)) return withExt;
        }
      }
    }

    return null;
  }

  function parseMacroNameFromFile(absPath) {
    try {
      const src = fs.readFileSync(absPath, 'utf8');
      const m = src.match(/{%\s*macro\s+([A-Za-z_][\w]*)\s*\(/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function scanDependencies(entryFile, seen = new Set()) {
    const results = { components: new Set(), elements: new Set() };
    const stack = [entryFile];
    while (stack.length) {
      const file = stack.pop();
      const norm = path.resolve(file);
      if (seen.has(norm)) continue;
      seen.add(norm);
      let src;
      try {
        src = fs.readFileSync(norm, 'utf8');
      } catch {
        continue;
      }
      // Find Nunjucks refs: include/import/from/extends
      const regex = /{%\s*(include|import|from|extends)\s+['"]([^'"]+)['"][^%]*%}/g;
      let match;
      while ((match = regex.exec(src)) !== null) {
        const ref = match[2];
        const resolved = resolveTemplateRef(norm, ref);
        if (!resolved) continue;
        if (isUnder(componentsDir, resolved)) {
          results.components.add(resolved);
        } else if (isUnder(elementsDir, resolved)) {
          results.elements.add(resolved);
        }
        // Recurse
        stack.push(resolved);
      }
    }
    return results;
  }

  // --- Tag extraction helpers ---
  function parseTagList(str) {
    if (!str) return [];
    // Remove brackets if present
    const inner = str.replace(/^\[/, '').replace(/\]$/, '');
    return inner
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function extractTagsFromFrontmatter(src) {
    // YAML-like frontmatter block at very top
    const fmMatch = src.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];
    const block = fmMatch[1];
    // Try array-oneline: tags: [a, b]
    const arrMatch = block.match(/\btags\s*:\s*\[([^\]]*)\]/i);
    if (arrMatch) return parseTagList(arrMatch[1]);
    // Try multiline list:
    const tagLine = block.match(/\btags\s*:\s*\n([\s\S]*)/i);
    if (tagLine) {
      const lines = tagLine[1]
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const items = [];
      for (const l of lines) {
        if (!l.startsWith('-')) break;
        const v = l.replace(/^-\s*/, '').trim();
        if (v) items.push(v);
      }
      return items;
    }
    return [];
  }

  function extractTagsFromInlineComments(src) {
    // Nunjucks comment: {# tags: a, b #}
    const nj = src.match(/\{#\s*tags\s*:\s*([^#]+?)#\}/i);
    if (nj) return parseTagList(nj[1]);
    // HTML comment: <!-- tags: a, b -->
    const html = src.match(/<!--\s*tags\s*:\s*([\s\S]*?)-->/i);
    if (html) return parseTagList(html[1]);
    return [];
  }

  function extractTagsFromSource(src) {
    try {
      const fm = extractTagsFromFrontmatter(src);
      if (fm.length) return fm;
      const inline = extractTagsFromInlineComments(src);
      if (inline.length) return inline;
    } catch {}
    return [];
  }

  // --- Relationship extraction helpers ---
  const REL_KEYS = ['next', 'prev', 'parent', 'children', 'related'];

  function extractTopNunjucksComment(src) {
    const m = src.match(/^\s*\{#([\s\S]*?)#\}/);
    return m ? m[1] : '';
  }

  function parseYamlLikeList(value, followingLines) {
    // Inline array form: [a, b, c]
    const trimmed = (value || '').trim();
    if (trimmed.startsWith('[') && trimmed.includes(']')) {
      const inner = trimmed.replace(/^\[/, '').replace(/\].*$/, '');
      return inner.split(',').map(s => s.trim()).filter(Boolean);
    }
    // Multiline list form using following lines starting with '- '
    const items = [];
    for (const line of followingLines) {
      const l = line.trim();
      if (!l.startsWith('-')) break;
      const v = l.replace(/^-\s*/, '').trim();
      if (v) items.push(v);
    }
    if (items.length) return items;
    // Single scalar value
    if (trimmed) return [trimmed];
    return [];
  }

  function extractRelationshipsFromYamlBlock(src) {
    const rels = { next: [], prev: [], parent: [], children: [], related: [] };
    const block = extractTopNunjucksComment(src);
    if (!block || !/\brelationships\s*:/.test(block)) return rels;
    // Slice from 'relationships:' to end of comment
    const idx = block.indexOf('relationships:');
    const body = block.slice(idx);
    const lines = body.split(/\r?\n/);
    // Map key -> array
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^\s*(next|prev|parent|children|related)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2] || '';
      const following = [];
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j];
        if (/^\s*(next|prev|parent|children|related)\s*:/.test(ln)) break;
        following.push(ln);
      }
      const values = parseYamlLikeList(rest, following);
      if (values.length) rels[key] = [...rels[key], ...values];
    }
    return rels;
  }

  function extractRelationshipsFromRelShorthand(src) {
    const rels = { next: [], prev: [], parent: [], children: [], related: [] };
    const regex = /\{#\s*@rel\s+(next|prev|parent|children|related)\s*:\s*([^#]+?)#\}/gi;
    let m;
    while ((m = regex.exec(src)) !== null) {
      const key = m[1].toLowerCase();
      const value = m[2] || '';
      const list = value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (list.length) rels[key] = [...rels[key], ...list];
    }
    return rels;
  }

  function mergeRelationshipMaps(a, b) {
    const out = { next: [], prev: [], parent: [], children: [], related: [] };
    for (const k of REL_KEYS) {
      const set = new Set([...(a[k] || []), ...(b[k] || [])]);
      out[k] = Array.from(set);
    }
    return out;
  }

  // Returns relationships with values resolved to manifest page keys like 'pages/..../file.html'
  function extractRelationshipsForPage(src, currentFileAbs) {
    const yamlRels = extractRelationshipsFromYamlBlock(src);
    const relRels = extractRelationshipsFromRelShorthand(src);
    const combined = mergeRelationshipMaps(yamlRels, relRels);
    const resolved = { next: [], prev: [], parent: [], children: [], related: [] };

    for (const key of REL_KEYS) {
      for (const target of combined[key]) {
        const abs = resolveRelationshipTarget(currentFileAbs, target);
        if (!abs) {
          console.warn(`Relationship target not resolved for ${path.basename(currentFileAbs)}:`, target);
          continue;
        }
        if (!isUnder(pagesDir, abs)) {
          // Only include page targets
          continue;
        }
        const relFromPages = path.relative(pagesDir, abs).replace(/\\/g, '/');
        const outRel = relFromPages.replace(/\.(njk|nunjucks|html)$/i, '.html');
        resolved[key].push(`pages/${outRel}`);
      }
      // dedupe
      resolved[key] = Array.from(new Set(resolved[key]));
    }
    return resolved;
  }

  const renderedOutRels = new Set();
  for (const file of files) {
    const rel = path.relative(pagesDir, file).replace(/\\/g, '/');
    const src = file;
    const outRel = rel.replace(/\.njk$/, '.html');
    const dest = path.join(pagesOutDir, outRel);
    await fs.ensureDir(path.dirname(dest));

    // Compute stylesheet href relative to the output file location
    const cssHref = path
      .relative(path.dirname(dest), path.join(outDir, 'design-system.css'))
      .replace(/\\/g, '/');

    const rendered = env.render(path.relative(pagesDir, src), {
      ...globalData,
      designSystemCssHref: cssHref,
    });
    const prettyRendered = beautifyHtml(rendered, beautifyOptions);
    await fs.writeFile(dest, prettyRendered, 'utf8');
    process.stdout.write(`Built ${outRel}\n`);
    renderedOutRels.add(outRel);

    // Manifest entry for page
    try {
      const deps = scanDependencies(src);
      const pageName = path.basename(src, path.extname(src));
      const key = `pages/${outRel}`;
      // Extract tags from page source
      let tags = [];
      let relationships = null;
      try {
        const pageSrc = fs.readFileSync(src, 'utf8');
        tags = extractTagsFromSource(pageSrc);
        const rels = extractRelationshipsForPage(pageSrc, src);
        const hasAny = REL_KEYS.some(k => (rels[k] || []).length > 0);
        relationships = hasAny ? rels : null;
      } catch {}
      const compEntries = Array.from(deps.components).map(p => ({
        name: parseMacroNameFromFile(p) || path.basename(p, path.extname(p)),
        path: p
      }));
      const elemEntries = Array.from(deps.elements).map(p => ({
        name: path.basename(p, path.extname(p)),
        path: p
      }));
      manifest[key] = {
        page: { name: pageName, path: src },
        components: compEntries,
        elements: elemEntries,
        ...(tags.length ? { tags } : {}),
        ...(relationships ? { relationships } : {})
      };
      if (tags.length) canvasMetadata[key] = { tags };
    } catch (e) {
      console.warn('Manifest (page) build warning:', e?.message || e);
    }
  }

  // Also copy any plain HTML files in pages (nested) into dist preserving structure
  const staticHtmlPattern = path.join(pagesDir, '**', '*.html').replace(/\\/g, '/');
  const staticHtmlFiles = await glob(staticHtmlPattern, { nodir: true, windowsPathsNoEscape: true });
  for (const file of staticHtmlFiles) {
    const rel = path.relative(pagesDir, file).replace(/\\/g, '/');
    // Skip copying if a .njk page rendered to the same target path
    if (renderedOutRels.has(rel)) {
      continue;
    }
    const dest = path.join(pagesOutDir, rel);
    await fs.ensureDir(path.dirname(dest));
    const raw = await fs.readFile(file, 'utf8');
    const pretty = beautifyHtml(raw, beautifyOptions);
    await fs.writeFile(dest, pretty, 'utf8');
    process.stdout.write(`Copied ${rel}\n`);
  }

  // Build individual component previews (data-driven states)
  // Convention:
  // - For each component file at components/**/<name>.njk containing a macro
  //   like `{% macro ComponentName(props) %}`, we look for an optional sibling
  //   JSON file `<name>.states.json` describing states and their props.
  //   Example JSON:
  //   {
  //     "default": { "props": { "title": "Title" } },
  //     "dense": { "props": { "class": "dense" } }
  //   }
  // - If no states file is found, we render a single "default" state with empty props.
  const componentPattern = path.join(componentsDir, '**', '*.njk').replace(/\\/g, '/');
  const componentFiles = await glob(componentPattern, { nodir: true, windowsPathsNoEscape: true });
  const builtComponentIndex = [];

  for (const compFile of componentFiles) {
    const relFromComponents = path.relative(componentsDir, compFile).replace(/\\/g, '/');
    const compSource = await fs.readFile(compFile, 'utf8');
    const macroMatch = compSource.match(/{%\s*macro\s+([A-Za-z_][\w]*)\s*\(/);
    if (!macroMatch) {
      // Not a macro-bearing file; skip
      continue;
    }
    const macroName = macroMatch[1];

    // Load states if available
    const baseName = path.basename(compFile, '.njk');
    const statesPath = path.join(path.dirname(compFile), `${baseName}.states.json`);
    let states; // { [stateName]: { props: object } | object }
    if (await fs.pathExists(statesPath)) {
      try {
        const raw = await fs.readFile(statesPath, 'utf8');
        const parsed = JSON.parse(raw);
        states = parsed && typeof parsed === 'object' ? parsed : {};
      } catch (e) {
        console.warn(`Warning: failed to parse states JSON for ${relFromComponents}:`, e?.message || e);
        states = {};
      }
    } else {
      states = {};
    }
    if (!states || Object.keys(states).length === 0) {
      states = { default: { props: {} } };
    }

    const importTarget = relFromComponents; // loader search path includes componentsDir
    const relOutBase = relFromComponents.replace(/\.njk$/, '');
    const compOutBaseDir = path.join(componentsOutDir, relOutBase);
    await fs.ensureDir(compOutBaseDir);

    const statesBuilt = [];
    for (const [stateName, stateDef] of Object.entries(states)) {
      const props = stateDef && typeof stateDef === 'object' && 'props' in stateDef ? stateDef.props : (stateDef || {});
      const dest = path.join(compOutBaseDir, `${stateName}.html`);

      const cssHref = path
        .relative(path.dirname(dest), path.join(outDir, 'design-system.css'))
        .replace(/\\/g, '/');

      const wrapper = `<!doctype html>\n` +
        `<html lang="en">\n` +
        `<head>\n` +
        `  <meta charset=\"utf-8\"/>\n` +
        `  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n` +
        `  <title>${relOutBase} — ${stateName}</title>\n` +
        `  <link rel=\"stylesheet\" href=\"${cssHref}\"/>\n` +
        `  <script src=\"https://cdn.tailwindcss.com\"></script>\n` +
        `</head>\n` +
        `<body class=\"sd-preview\">\n` +
        `  <main class=\"p-6\">\n` +
        `    <section class=\"max-w-5xl mx-auto\">\n` +
        `      {% from "${importTarget}" import ${macroName} as Comp %}\n` +
        `      {{ Comp(props) }}\n` +
        `    </section>\n` +
        `  </main>\n` +
        `</body>\n` +
        `</html>\n`;

      const rendered = env.renderString(wrapper, { props });
      const prettyRendered = beautifyHtml(rendered, beautifyOptions);
      await fs.writeFile(dest, prettyRendered, 'utf8');
      process.stdout.write(`Built component ${relOutBase}/${stateName}.html\n`);
      statesBuilt.push({ name: stateName, outRel: path.relative(componentsOutDir, dest).replace(/\\/g, '/') });

      // Manifest entry for component preview state
      try {
        const deps = scanDependencies(compFile);
        const key = `components/${relOutBase}/${stateName}.html`;
        const mainComp = [{ name: macroName || path.basename(compFile, '.njk'), path: compFile }];
        const nestedComps = Array.from(deps.components)
          .filter(p => p !== compFile)
          .map(p => ({ name: parseMacroNameFromFile(p) || path.basename(p, path.extname(p)), path: p }));
        const elemEntries = Array.from(deps.elements).map(p => ({ name: path.basename(p, path.extname(p)), path: p }));
        // Extract tags from component source
        let tags = [];
        try {
          const compSrc = fs.readFileSync(compFile, 'utf8');
          tags = extractTagsFromSource(compSrc);
        } catch {}
        manifest[key] = {
          page: null,
          components: [...mainComp, ...nestedComps],
          elements: elemEntries,
          ...(tags.length ? { tags } : {})
        };
        if (tags.length) canvasMetadata[key] = { tags };
      } catch (e) {
        console.warn('Manifest (component) build warning:', e?.message || e);
      }
    }

    builtComponentIndex.push({ id: relOutBase, states: statesBuilt });
  }

  // Create a simple index for built components
  if (builtComponentIndex.length > 0) {
    const indexDest = path.join(componentsOutDir, 'index.html');
    const indexCssHref = path
      .relative(path.dirname(indexDest), path.join(outDir, 'design-system.css'))
      .replace(/\\/g, '/');
    const indexHtml = `<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\"/>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n  <title>Components</title>\n  <link rel=\"stylesheet\" href=\"${indexCssHref}\"/>\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n</head>\n<body class=\"sd-preview\">\n  <main class=\"p-6 max-w-5xl mx-auto\">\n    <h1 class=\"text-2xl font-semibold mb-4\">Components</h1>\n    <ul class=\"space-y-3\">\n      ${builtComponentIndex.map(c => `\n      <li>\n        <div class=\"font-mono text-sm text-muted-foreground\">${c.id}</div>\n        <div class=\"flex flex-wrap gap-2 mt-1\">${c.states.map(s => `<a class=\\"px-2 py-1 rounded border hover:bg-muted\\" href=\\"./${s.outRel.replace(/^.*?\//, '')}\\">${s.name}</a>`).join(' ')}</div>\n      </li>`).join('')}\n    </ul>\n  </main>\n</body>\n</html>`;
    const prettyIndex = beautifyHtml(indexHtml, beautifyOptions);
    await fs.writeFile(indexDest, prettyIndex, 'utf8');

    // JSON manifest for programmatic consumption
    const manifestDest = path.join(componentsOutDir, 'index.json');
    await fs.writeJson(manifestDest, builtComponentIndex, { spaces: 2 });
  }

  // Ensure design-system.css is available at dist root for both pages and components
  const cssDest = path.join(outDir, 'design-system.css');
  const cssCandidates = [
    path.join(appDir, 'styles', 'design-system.css'),
  ];
  let cssProvided = false;
  try {
    for (const candidate of cssCandidates) {
      if (await fs.pathExists(candidate)) {
        await fs.copyFile(candidate, cssDest);
        cssProvided = true;
        break;
      }
    }
    if (!cssProvided) {
      console.warn('design-system.css not found in sources;');
    }
  } catch (err) {
    console.warn('Warning ensuring design-system.css:', err?.message || err);
  }

  await fs.remove(path.join(root, 'design_iterations'));
  await fs.copy(path.join(root, 'dist', 'pages'), path.join(root, 'design_iterations'));
  await fs.copy(cssDest, path.join(root, 'design-system.css'));

  // Write manifest at dist root
  try {
    const manifestDest = path.join(outDir, 'manifest.json');
    await fs.writeJson(manifestDest, manifest, { spaces: 2 });
    console.log('Wrote manifest.json with', Object.keys(manifest).length, 'entries');
  } catch (err) {
    console.warn('Warning writing manifest.json:', err?.message || err);
  }

  // Write canvas metadata (tags) at dist root
  try {
    const metaDest = path.join(outDir, 'canvas-metadata.json');
    await fs.writeJson(metaDest, canvasMetadata, { spaces: 2 });
    console.log('Wrote canvas-metadata.json with', Object.keys(canvasMetadata).length, 'entries');
  } catch (err) {
    console.warn('Warning writing canvas-metadata.json:', err?.message || err);
  }

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});



