## CanvasView: Technical Breakdown

This document provides a detailed, implementation-level overview of the `CanvasView` component and its related modules. It covers lifecycle, state and data structures, algorithms, rendering pipeline, performance strategies, and extension messaging.

### Overview

`CanvasView` renders an infinite, zoomable/pannable canvas of design frames built from `.tad/dist` output. It supports:
- Grid layout of pages/components/groups with group headers and explicit row alignment
- Relationship layout (horizontal next → chains, vertical children ↓ stacks) with teleport chips for duplicates/cycles
- Viewport-aware rendering (mobile/tablet/desktop) and global/per-frame viewport modes
- Level-of-detail rendering (placeholder vs iframe) based on zoom and viewport culling
- Directional connection lines (next arrows and relationship edges)
- Drag-to-reposition with snap-to-grid and persisted custom positions
- Search, focus/center on frame, and VS Code integration for opening templates and refreshing designs

Key dependencies:
- React + `react-zoom-pan-pinch` for transform state and gestures
- Internal utilities: `gridLayout.ts`, `relationshipLayout.ts`
- Presentation components: `DesignFrame`, `ConnectionLines`, `TeleportFrame`

### Props and Configuration

- `vscode: any`: VS Code webview API bridge for postMessage
- `nonce: string | null`: CSP nonce injected into iframe script tags

Default `CanvasConfig` (can be responsively adjusted):
- Frame size, grid spacing, frames per row, min/max zoom
- Responsive rules (scaling, min/max frame sizes)
- Viewport dimensions per mode (desktop/tablet/mobile)
- Hierarchy/relationships spacing and connection styles

### State Model

- `designFiles: DesignFile[]`: canonical list of rendered items (pages/components)
- `selectedFrames: string[]`: currently selected frame(s)
- `isLoading: boolean`, `error: string | null`
- Transform: `currentZoom: number`, `pan: {x,y}` (derived and persisted)
- `currentConfig: CanvasConfig`: responsive config snapshot
- Viewports: `globalViewportMode: ViewportMode`, per-frame `frameViewports: Record<string, ViewportMode>`, `useGlobalViewport: boolean`
- Custom positions: `customPositions: Record<string, GridPosition>`; drag state object with `isDragging`, `draggedFrame`, `startPosition`, `currentPosition`, `offset`
- Layout: `layoutMode: 'grid' | 'relationships'`, `collapsedGroups: Record<string, boolean>` (reserved), `distMode: 'pages' | 'components' | 'groups'`
- Spaces: `spaces: {name; distDir}[]`, `selectedSpace: string | null`, `defaultSpace?: string`
- Debug: `showDebug: boolean`, `focusDebug: ...` (last focus operation diagnostics)
- Refs: `transformRef` (zoom/pan pinch), RAF schedulers for throttling/persisting (`rafZoomStateRef`, `rafPersistRef`), drag RAF bookkeeping, saved state cache, and `forceRenderFrame` (ensures mount for focus measurement)

### Data Structures

- `DesignFile`: dist item metadata including `name`, `path`, `content`, `fileType`, `tags`, optional `relationships` (next/prev/parent/children/related), and optional `templates` (page/components/elements)
- Search index items: `{ name, kind: 'page'|'component'|'element', frame, path? }` built from `DesignFile.templates` with fallback to frame name
- Grouped plan items (grid mode):
  - Pages: `{ _kind: 'file'|'spacer'|'header', _file?, _id?, _label? }`
  - Components: `{ _kind: 'file'|'spacer'|'header'|'subheader', ... }`
  - Groups: `{ _kind: 'file'|'spacer'|'header', _tag? }`
  - Each plan includes an `indexMap` mapping `DesignFile.name` (and composite keys for groups) to a stable render index
- Relationship layout: `LayoutPositions` with `frames` (baseId → GridPosition), `teleports` (synthetic chips), `groups` placeholder
- Connection lines: `{ id, fromFrame, toFrame, fromPosition, toPosition, color?, width? }`

### Lifecycle

1) Mount/init
- Build responsive `currentConfig` and attach `resize` listener (updates framesPerRow/spacing)
- Load saved webview state (`canvasTransform`, `canvasCustomPositions`, `canvasSpace`, `canvasDistMode`) from `vscode.getState`
- Request spaces (`requestSpaces`) then request initial files (`loadDesignFiles`) for current `distMode` and space
- Attach `message` listeners:
  - `designFilesLoaded`: normalize dates, run `detectDesignRelationships`, set data, restore transform/positions, mark `isTransformReady`
  - `spaces:init`: configure spaces, persist selected space, trigger load
  - `error`: surface error
  - `fileChanged`: re-request files
  - Internal nav bridge: listen for `{ __canvasNavigateTo__: <targetName> }` from `DesignFrame`
- Attach keyboard shortcuts (Ctrl/Cmd plus/ minus/ 0) for zoom

2) Updates
- On `distMode` or `selectedSpace` change: persist and reload files
- On transform change (`onTransformed`): throttle zoom updates via RAF, persist transform (scale, x, y), update `pan`
- On drag: throttle `onMouseMove` via RAF; on end, snap to 25px grid, persist custom positions
- On search selection: set selection, call focus routine

3) Unmount/cleanup
- Remove `resize`, `message`, and `keydown` listeners

### Core Algorithms

#### 1. Responsive configuration

`generateResponsiveConfig(baseConfig, containerWidth)` adjusts `framesPerRow` and `gridSpacing` for breakpoints, preferring 10 columns on desktop and tighter spacing on smaller widths.

Example:

```ts
// src/webview/utils/gridLayout.ts
export function generateResponsiveConfig(
  baseConfig: CanvasConfig,
  containerWidth: number
): CanvasConfig {
  let framesPerRow = baseConfig.framesPerRow;
  let gridSpacing = baseConfig.gridSpacing;

  if (containerWidth < 600) {
    framesPerRow = 1;
    gridSpacing = 30;
  } else if (containerWidth < 900) {
    framesPerRow = 2;
    gridSpacing = 40;
  } else if (containerWidth < 1200) {
    framesPerRow = 3;
    gridSpacing = 45;
  } else {
    framesPerRow = Math.max(10, baseConfig.framesPerRow);
    gridSpacing = 50;
  }

  return { ...baseConfig, framesPerRow, gridSpacing };
}
```

#### 2. Grouped render planning (grid mode)

- Pages grouping:
  - Group by leading numeric prefix in filename (e.g., `1.*`, `2.*`).
  - Sort groups by numeric key and files alphanumerically.
  - Insert `header` items for groups and enforce explicit row breaks via `spacer` items so each group starts at the left-most column (no snake).
  - Produce `indexMap` for stable positions.

- Components grouping:
  - Consider only files under `components/`.
  - Build nested groups: top-level folder → subfolder (or `root`).
  - Order groups alphabetically, keep `root` first; add `header`/`subheader` and explicit row breaks.
  - Produce `indexMap`.

- Groups-by-tag:
Example (row-break enforcement and headers):

```ts
// src/webview/components/CanvasView.tsx (pages plan)
const pushRowBreak = (blockId: string) => {
  const fpr = (currentConfig.framesPerRow || 10);
  const remainder = items.length % fpr;
  if (remainder === 0) return;
  const need = fpr - remainder;
  for (let i = 0; i < need; i++) items.push({ _kind: 'spacer', _id: `${blockId}-rb-${i}` });
};

// Ensure header starts left and group frames begin left on the next row
pushRowBreak(`before-head-${k}`);
items.push({ _kind: 'header', _id: `head-${k}`, _label: `Group: ${k}` });
pushRowBreak(`after-head-${k}`);
```

  - Group by union of `DesignFile.tags`.
  - Sort tags alphabetically; add `header` for each tag with explicit row breaks; produce `indexMap` using composite keys (`name__tag`).

#### 3. Position selection per frame

`getFramePosition(fileName, index)` precedence:
1. Return `customPositions[fileName]` if present.
2. If in relationships layout, return `relationshipPositions.frames[fileName]`.
3. Otherwise compute grid position using effective index from the relevant `indexMap` (pages/components/groups) or fallback to the natural `index`.
4. Compute `x,y` from `framesPerRow`, `gridSpacing`, and actual viewport dimensions for the frame (+50 header space).

Example:

```ts
// src/webview/components/CanvasView.tsx
const col = effectiveIndex % currentConfig.framesPerRow;
const row = Math.floor(effectiveIndex / currentConfig.framesPerRow);
const x = col * (Math.max(actualWidth, currentConfig.frameSize.width) + currentConfig.gridSpacing);
const y = row * (Math.max(actualHeight, currentConfig.frameSize.height) + currentConfig.gridSpacing);
return { x, y };
```

#### 4. Relationship layout (graph instances)

From `relationshipLayout.ts`:
- Build base nodes via `buildBaseNodes(designs, viewMode)`:
  - Include files matching current view (`pages`/`components`/`groups`).
  - Create nodes with `id`, `kind: 'frame'`, and normalize/filter `next` and `children` to the included set.
- Determine roots: nodes with no inbound `next`.
- Build chains by following the first `next` pointer until cycle.
- Place multi-item chains in horizontal rows, left-to-right; for repeated appearances create teleport chips instead of re-placing frames.
- For each placed frame, recursively stack `children` vertically beneath the parent, placing teleports for duplicates/cycles.
- Pack isolated single-item chains into a 10-column grid.
- Return `positions.frames` and `positions.teleports`.

Example (roots, chains, placement, teleports):

```ts
// src/webview/utils/relationshipLayout.ts
const inboundNext = computeInboundNextTargets(nodes);
const baseRoots = Array.from(nodes.keys()).filter(id => !inboundNext.has(id));

const chains: Array<{ root: string; chain: string[] }>= [];
for (const baseRoot of baseRoots) {
  const chain: string[] = [];
  let cur = baseRoot;
  const seenBase = new Set<string>();
  while (cur && !seenBase.has(cur)) {
    chain.push(cur);
    seenBase.add(cur);
    const n = nodes.get(cur);
    cur = n && n.next && n.next.length > 0 ? n.next[0] : '';
  }
  chains.push({ root: baseRoot, chain });
}

for (const { chain } of multiChains) {
  let cursorX = 0;
  for (const baseId of chain) {
    const size = measure(baseId, nodes.get(baseId)?.kind || 'frame');
    if (!placedBases.has(baseId)) {
      positions.frames[baseId] = { x: cursorX, y: cursorY };
      placedBases.add(baseId);
    } else {
      const cnt = (tpCount.get(baseId) || 0) + 1;
      tpCount.set(baseId, cnt);
      positions.teleports[`tp:${baseId}:${cnt}`] = { x: cursorX, y: cursorY, width: options.groupHeader.width, height: options.groupHeader.height, targetBaseId: baseId };
    }
    cursorX += size.width + options.horizontalGap;
  }
  cursorY += rowMaxHeight + options.verticalGap * 2;
}
```

#### 5. Connection building

- Relationships mode edges:
  - Rebuild base graph and create `ConnectionLine` items for each `next` and `child` edge.
  - Compute endpoints from `relationshipPositions.frames` plus viewport dims.
  - Compute aggregate bounds for the connection overlay.

- Pages view `next` arrows:
  - Build conns from manifest `relationships.next`, restricted to `pages/` items.
  - Robust target resolution:
    1) Try exact dist name
    2) Try normalized dist base (slashes unified, extension dropped)
    3) Try original template path mapping from `templates.page.path` (normalized)
  - After building conns, call `updateConnectionPositions` to recompute endpoints based on the current layout/viewport.

Examples:

```ts
// src/webview/components/CanvasView.tsx (relationships edges)
const addEdge = (toId: string, kind: 'next' | 'child') => {
  const toPos = relationshipPositions.frames[toId];
  if (!toPos) return;
  const toDims = getDims(toId);
  connections.push({
    id: `rel:${kind}:${fromId}->${toId}`,
    fromFrame: fromId,
    toFrame: toId,
    fromPosition: { x: fromPos.x + fromDims.w, y: fromPos.y + fromDims.h / 2 },
    toPosition: { x: toPos.x, y: toPos.y + toDims.h / 2 },
    color: 'var(--vscode-textLink-foreground)',
    width: 2
  });
};
```

```ts
// src/webview/components/CanvasView.tsx (pages next arrows with robust resolution)
const resolveTargetToFile = (target: string) => {
  let match = byExactName.get(target);
  if (match) return match;
  match = byNormalizedDist.get(normalizePath(target));
  if (match) return match;
  match = byTemplatePath.get(normalizePath(target));
  return match;
};
```

#### 6. Focus/center on frame

`focusOnFrame(fileName)`:
- Ensure the target frame mounts (`forceRenderFrame`).
- Prefer actual DOM measurement for the frame’s current pre-transform offset; otherwise use computed layout position.
- Compute target-centered translate and a fit scale with 15% padding, clamped to min/max.
- Apply transform via `setTransform`, then a settle pass: re-measure and apply a subtle correction if drift > 0.5px.

Example (fit and center with settle pass):

```ts
// src/webview/components/CanvasView.tsx
const desiredScale = Math.min(scaleX, scaleY, 1);
const clampedScale = Math.max(currentConfig.minZoom, Math.min(currentConfig.maxZoom, desiredScale));
const positionX = (containerWidth / 2) - (targetCenterX * clampedScale);
const positionY = (containerHeight / 2) - (targetCenterY * clampedScale);
transformRef.current?.setTransform(positionX, positionY, clampedScale);
// settle pass: re-measure and correct tiny drift
```

#### 7. Dragging and snapping

- On mousedown in `DesignFrame`, compute initial offset by transforming screen coordinates into canvas space using current transform state.
- Throttle pointer updates via RAF; update `currentPosition` during drag.
- On drag end, snap to 25px grid, persist `canvasCustomPositions` via `vscode.setState`.

Examples:

```ts
// src/webview/components/CanvasView.tsx (mouse to canvas space)
const transformState = transformRef.current?.instance?.transformState;
return {
  x: (rawMouseX - (transformState?.positionX || 0)) / (transformState?.scale || 1),
  y: (rawMouseY - (transformState?.positionY || 0)) / (transformState?.scale || 1)
};
```

```ts
// RAF-throttled drag updates
pendingDragPosRef.current = mousePos;
if (dragRafRef.current === null) {
  dragRafRef.current = requestAnimationFrame(() => {
    if (pendingDragPosRef.current) {
      handleDragMove(pendingDragPosRef.current);
    }
    dragRafRef.current = null;
  });
}
```

```ts
// Snap and persist
const gridSize = 25;
const snapped = {
  x: Math.round(dragState.currentPosition.x / gridSize) * gridSize,
  y: Math.round(dragState.currentPosition.y / gridSize) * gridSize
};
vscode?.setState?.({ ...prevState, canvasCustomPositions: nextPositions });
```

#### 8. Viewport culling and LOD

- Compute `visibleBounds` from transform state and viewport size, with a ±400px buffer.
- Skip rendering offscreen frames unless the effective render mode is `placeholder` or the frame is force-mounted for focus.
- Choose render mode via `getOptimalRenderMode(zoom)`: `placeholder` below ~0.35 zoom; otherwise `iframe`.

Examples:

```ts
// src/webview/components/CanvasView.tsx
const LOD_IFRAME_THRESHOLD = 0.35;
const getOptimalRenderMode = (zoom: number): 'placeholder' | 'iframe' => {
  return zoom < LOD_IFRAME_THRESHOLD ? 'placeholder' : 'iframe';
};
```

```ts
// Viewport culling check
const isInView =
  frameRight >= visibleBounds.left && frameLeft <= visibleBounds.right &&
  frameBottom >= visibleBounds.top && frameTop <= visibleBounds.bottom;
```

### Rendering Pipeline

1) Toolbar
- Space selector, search box (with startsWith/contains + de-dup, top 25), zoom controls, reset, reload, layout toggles, dist toggles, debug toggle, viewport toggle and mode buttons.

2) Transform wrapper
- `react-zoom-pan-pinch` with tuned settings:
  - Min 0.1, max 3; `limitToBounds=false`, `smooth=false`, `disablePadding=true`
  - Double-click zoom-in; trackpad panning; wheel zoom disabled; pinch zoom enabled
  - Panning disabled while dragging a frame

3) Canvas content
- Pages view: render `nextConnections` SVG overlay via `ConnectionLines`.
- Relationships layout: render relationship `ConnectionLines`, `DesignFrame` instances at `relationshipPositions.frames`, and `TeleportFrame` chips at `positions.teleports`.
- Grid layout: map grouped plan items to either spacers (invisible), headers (badges positioned above first item), or `DesignFrame` components.
- Each `DesignFrame` receives: `file`, `position`, `dimensions`, selection/drag props, `viewport`, `nonce`, `vscode` bridge, and `onRefresh` which posts `reloadDesignFile`.

4) DesignFrame internals (summary)
- Renders `iframe` or placeholder based on `renderMode` and `fileType` (HTML/SVG handling differs).
- Viewport controls (unless global mode), metadata/status indicators, Template links (post `openTemplateFile`), Relationships dropdown (navigates via postMessage to canvas), drag-prevention overlay during drag, and copy-prompt utilities.

5) ConnectionLines
- Renders SVG paths with cubic Bezier curves; styles adapt to zoom (thinner lines, dash/opacity changes). Memoized with custom prop equality for perf.

Example:

```tsx
// src/webview/components/ConnectionLines.tsx
const createCurvePath = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const dx = to.x - from.x;
  const cp1x = from.x + dx * 0.6;
  const cp2x = to.x - dx * 0.6;
  return `M ${from.x} ${from.y} C ${cp1x} ${from.y}, ${cp2x} ${to.y}, ${to.x} ${to.y}`;
};

<path d={createCurvePath(connection.fromPosition, connection.toPosition)} />
```

### Messaging Protocol

Webview → Extension:
- `requestSpaces`
- `loadDesignFiles` ({ source: 'dist', kind, space? })
- `selectFrame` (fileName)
- `setContextFromCanvas` ({ fileName, type: 'frame' | 'clear' })
- `setChatPrompt` (prompt)
- `reloadDesignFile` ({ filePath })

Extension → Webview:
- `spaces:init` ({ spaces, defaultSpace, legacy? })
- `designFilesLoaded` ({ files })
- `designFileRefreshed` ({ file })
- `fileChanged` ({ fileName, changeType })
- `error` ({ error })

Examples:

```ts
// Webview → Extension
vscode.postMessage({ command: 'loadDesignFiles', data: { source: 'dist', kind: distMode, space: selectedSpace || undefined } });

// Extension → Webview handler
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.command === 'designFilesLoaded') {
    setDesignFiles(detectDesignRelationships(message.data.files.map(f => ({ ...f, modified: new Date(f.modified) }))));
  }
});
```

### Performance Considerations

- RAF-throttled zoom state updates and drag mouse-move
- Persist transform state in a scheduled batch to avoid spamming
- Viewport culling with buffer and LOD render mode switching
- Heavy use of `useMemo` for grouped plans, search results, relationship positions, and connections
- Custom `React.memo` equality for `DesignFrame` and `ConnectionLines`
- Using viewport dimensions (window.innerWidth/Height) for accurate centering and bounds

### Extensibility Notes

- Relationship graph honors manifest `relationships` with support for workspace and template-root-relative targets; unresolved targets simply won’t link/position.
- `collapsedGroups` is wired for future group containers; `groups` positions in relationship layout reserved for future use.
- Dist sources (pages/components/groups) can be extended with new views by adding a plan builder and integrating into `getFramePosition`.
- Teleport chips indicate repeated/cyclic references; clicking navigates to the canonical instance via `focusOnFrame`.

### Edge Cases / Guards

- Invalid transform scales (≤ 0) are clamped/reset defensively
- DOM measurement failures fall back to computed positions during focus
- No spaces or no files show friendly UI states; errors surface retry affordance
- Saved state restoration is resilient; missing keys fall back to sensible defaults


