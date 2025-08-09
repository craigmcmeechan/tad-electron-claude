### React Canvas Component Structure — Quality Review (Performance & Extensibility)

Scope: `src/webview/components/CanvasView.tsx`, `DesignFrame.tsx`, `ConnectionLines.tsx`, `DesignPanel.tsx`, `src/webview/utils/gridLayout.ts`, `src/webview/types/canvas.types.ts`, and related canvas hosting in `src/extension.ts`.

## Summary
- **Strengths**: Clear separation between view, layout utilities, and types; solid selection/drag UX; per-frame/global viewport modes; hierarchy visualization; backend CSS inlining and file watching.
- **Primary risks**: Unvirtualized iframe rendering, high-frequency state updates and logging, per-iframe service worker injection, recomputation without memoization.
- **Outcome if addressed**: Substantial gains in frame-count scalability, smoother panning/zooming, simpler security posture, and cleaner path to new layouts/features.

## Strengths
- **Modular structure**: Layout math in `gridLayout.ts`, typed models in `canvas.types.ts`, and rendering in `DesignFrame.tsx` is a solid baseline.
- **Good UX primitives**: Selection, drag overlay to prevent iframe capture, global/per-frame viewport control, and hierarchy connections.
- **Extension integration**: File watcher and CSS inlining reduce broken previews; consistent messaging between webview and extension.
- **Type safety**: `DesignFile`, `HierarchyTree`, `ConnectionLine` support feature growth.

## Performance issues and risks
- **No virtualization/culling of frames**
  - All frames render as iframes regardless of visibility or zoom. This does not scale for dozens/hundreds of frames.
  - In `CanvasView.tsx`, `getOptimalRenderMode` always returns `iframe`.

- **High-frequency re-renders during transform/drag**
  - `onTransformed/onZoom/onPanning` update React state directly and log verbosely; causes tree-wide re-renders and jank.
  - Drag `onMouseMove` sets state on every event without throttling.

- **Per-iframe Service Worker injection** in `DesignFrame.tsx`
  - Injects a SW into every iframe document to handle external images. Likely unsupported within VS Code’s webview iframes and adds overhead; increases complexity and risks.

- **Connection line recalculation each render**
  - `updateConnectionPositions` maps and recomputes positions without memoization; scales poorly with node/edge counts.

- **Lack of memoization for frames and lines**
  - `DesignFrame` and `ConnectionLines` are not wrapped in `React.memo`; any parent state change re-renders all frames/lines.

- **Mutable layout utilities**
  - `calculateHierarchyPositions` mutates the provided tree, making memoization and predictable renders harder.

## Extensibility gaps
- **No layout strategy abstraction**
  - Grid and hierarchy logic are embedded into the main view/utilities. A pluggable `LayoutStrategy` makes new layouts (flow, masonry, swimlanes) easier.

- **State orchestration**
  - Multiple interdependent state slices in `CanvasView` (zoom, viewports, custom positions, layout mode, selections) could benefit from a reducer + derived selectors to support future grouping, filtering, and saved layouts.

- **Rendering backend scalability**
  - SVG is fine for tens of connection lines; Canvas/WebGL would be preferable for large graphs. Worker-based path computation may help for complex layouts.

## Recommendations (prioritized)
1. **Introduce virtualization/culling for frames**
   - Render only frames within the visible viewport plus a buffer; mount placeholders for offscreen frames.
   - Re-enable zoom-based LOD: show placeholders below a zoom threshold; mount iframe above threshold.
   - Add `IntersectionObserver` to lazy-mount iframes when they enter view.

2. **Throttle/debounce transform and drag updates; gate logs**
   - Track transient zoom/pan in `useRef`; update React state on `requestAnimationFrame` or debounced intervals (16–33ms).
   - Throttle drag move updates; commit final position on drag end.
   - Remove or guard console logs behind a `DEBUG` flag.

3. **Memoize frames and connection lines**
   - Wrap `DesignFrame` and `ConnectionLines` in `React.memo` with custom comparators (position, selection, viewport, identity).
   - Memoize connection point computation with dependencies on tree/positions/viewports.

4. **Remove per-iframe Service Worker injection**
   - Rely on backend preprocessing (already inlining CSS). Avoid `'unsafe-eval'` and overly permissive CSP inside iframe content.

5. **Refactor layout utilities to pure functions**
   - Have `calculateHierarchyPositions` return a new tree instance without mutation to enable stable memoization and easier testing.

6. **Extract a layout strategy interface**
   - Define `LayoutStrategy` with `computePositions(files, config)` and `computeConnections(tree, config)`; register strategies for `grid`, `hierarchy`, etc.

7. **Decompose `CanvasView`**
   - Move toolbar/controls to separate components to keep the canvas subtree stable. Use selectors to feed only necessary props to children.

8. **Optional: Switch connection rendering backend for large graphs**
   - Keep SVG for moderate sizes; introduce Canvas/WebGL path when edge count crosses a threshold.

## Quick wins (low risk, high value)
- Wrap `DesignFrame` and `ConnectionLines` with `React.memo` now.
- Re-enable zoom-based placeholders to avoid mounting iframes at low zoom.
- Debounce `setCurrentZoom` and strip transform/pan logs.
- Remove Service Worker injection from `DesignFrame` iframes.
- Memoize `updateConnectionPositions` and hierarchical bounds.

## Suggested implementation notes
- **Virtualization**
  - Compute view bounds from transform state (scale, translateX/Y). Only map frames whose `x/y + width/height` intersect the expanded bounds.
  - Keep a small buffer (e.g., 1–2 screens) to reduce mount thrash when panning.

- **LOD (level-of-detail)**
  - If `zoom < threshold`, render lightweight placeholders (name, dimensions, status). When crossing threshold, mount iframe and show loading overlay.

- **Transform handling**
  - Maintain a ref: `transformRefState.current = { scale, x, y }`; schedule a single RAF to update React state and downstream memoized computations.

- **Drag loop**
  - Store pointer deltas in refs and update visual position via inline style within an RAF loop; persist to state on drop for layout saving.

- **Pure layout**
  - Return new `HierarchyTree` objects. Keep nodes immutable (`{ ...node, position: ... }`) to enable shallow-equality memo checks.

- **Security/CSP**
  - Avoid injecting permissive CSP (`'unsafe-eval'`, overly wide `connect-src`) into `srcDoc`; prefer deterministic, inlined assets.

## Actionable checklist
- [ ] Add `React.memo` to `DesignFrame` and `ConnectionLines` with custom prop equality.
- [ ] Implement viewport-based culling with buffer; integrate `IntersectionObserver` for iframe lazy-mount.
- [ ] Restore zoom-based render mode (placeholder vs iframe) with a sensible threshold.
- [ ] Debounce/RAF-transform updates; throttle drag move; remove/guard logs.
- [ ] Remove Service Worker injection in `DesignFrame` iframes.
- [ ] Make `calculateHierarchyPositions` pure; memoize connection point calculations.
- [ ] Extract toolbar into a separate component; keep canvas subtree stable.
- [ ] Introduce `LayoutStrategy` interface and register `grid`/`hierarchy` strategies.
- [ ] Consider Canvas/WebGL path for connections when edge count is high.

## Expected impact
- **Performance**: Lower main-thread pressure, fewer re-renders, smoother zoom/pan, and reduced memory from fewer live iframes.
- **Extensibility**: Cleaner addition of new layouts and behaviors; easier to persist/share layouts; safer embedding with tighter CSP.


