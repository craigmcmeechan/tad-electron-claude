### React Canvas Component Structure — Quality Review (Performance & Extensibility)

Scope: `src/webview/components/CanvasView.tsx`, `DesignFrame.tsx`, `ConnectionLines.tsx`, `DesignPanel.tsx`, `src/webview/utils/gridLayout.ts`, `src/webview/types/canvas.types.ts`, and related canvas hosting in `src/extension.ts`.

## Summary
- **Strengths**: Clear separation between view, layout utilities, and types; solid selection/drag UX; per-frame/global viewport modes; hierarchy and relationships layouts; backend CSS inlining and file watching; search across manifest-backed templates; tags-to-groups view.
- **Current mitigations in place**: Viewport culling + zoom-based LOD (placeholder vs iframe), RAF-throttled transform and drag updates, memoized frames and connection lines, noisy logs gated behind `DEBUG`.
- **Primary risks**: Hierarchy layout functions mutate structures (harder to cache/persist); connection point computation is recomputed for dependency changes instead of an identity-cached map; no IntersectionObserver-based mount heuristics; large-graph edges still on SVG.
- **Outcome of next steps**: Even smoother pan/zoom at scale, simpler caching, and cleaner path to larger graphs and alternate render backends.

## Strengths
- **Modular structure**: Layout math in `gridLayout.ts`, typed models in `canvas.types.ts`, rendering in `DesignFrame.tsx` and connection overlay in `ConnectionLines.tsx`.
- **Good UX primitives**: Selection, drag overlay to prevent iframe capture, global/per-frame viewport control, and hierarchy + relationships views.
- **Extension integration**: Builder extracts manifest with tags/relationships; extension inlines CSS and streams dist/manifests to canvas; quick open for template sources.
- **Type safety**: `DesignFile`, `HierarchyTree`, `ConnectionLine` support feature growth.

## Performance notes (current state)
- **Viewport culling + LOD (present)**
  - Frames outside expanded viewport bounds are not rendered; low zoom uses `placeholder`, above threshold mounts `iframe`. See [CanvasView.tsx](mdc:src/webview/components/CanvasView.tsx) `visibleBounds` and `getOptimalRenderMode`.

- **Transform and drag updates (throttled)**
  - Transform state and persistence are throttled via `requestAnimationFrame`; drag moves are RAF-throttled; wheel zoom disabled in favor of precise programmatic zoom/pan.

- **Memoization (present)**
  - `DesignFrame` and `ConnectionLines` wrapped in `React.memo` with custom comparators; connections derived via `useMemo`.

- **No per-iframe Service Worker**
  - Iframes render `srcDoc` with nonce injection for scripts; SW is not injected.

- **Areas to improve next**
  - Hierarchy layout mutates the `HierarchyTree`; prefer pure returns to enable caching and reliable equality checks.
  - Consider `IntersectionObserver` for mount/unmount heuristics in addition to math-based culling.
  - Cache connection point computations by frame identity and viewport to avoid recomputing across minor state changes.
  - For very large graphs, consider Canvas/WebGL rendering of edges.

## Extensibility gaps
- **Layout strategy surface**
  - Relationship layout is a separate module, but there is no formal `LayoutStrategy` interface. Adding one would make new layouts (flow, masonry, swimlanes) pluggable.
- **State orchestration**
  - Multiple interdependent state slices in `CanvasView` remain manageable but could later benefit from a reducer/selectors for saved layouts, grouping, and filters.

## Recommendations (prioritized)
1. **Make hierarchy layout pure**
   - Return a new `HierarchyTree` with updated positions/bounds without mutating inputs.
2. **Add IntersectionObserver-based mount hints**
   - Use it to complement mathematical culling for stable mount/unmount at viewport edges.
3. **Connection point caching**
   - Cache by `(from, to, viewportMode(s), dimensions, customPositions)` key for large designs.
4. **Layout strategy interface**
   - Introduce `LayoutStrategy` with `computePositions(...)` and `computeConnections(...)`; implement for `grid`, `hierarchy`, `relationships`.
5. **Optional: Edge backend**
   - Keep SVG by default; switch to Canvas/WebGL when connections exceed a threshold.

## Quick wins (remaining)
- Convert hierarchy layout functions in [gridLayout.ts](mdc:src/webview/utils/gridLayout.ts) to pure functional returns.
- Extract toolbar controls from [CanvasView.tsx](mdc:src/webview/components/CanvasView.tsx) to reduce re-render surface.
- Add a lightweight connection-point cache keyed by frame identity + viewport.

## Minimally invasive changes implemented
- **Log gating**: Guarded chat/canvas loader logs behind `DEBUG` in [CanvasView.tsx](mdc:src/webview/components/CanvasView.tsx) to reduce console pressure in production webviews.
- **Stronger culling**: Skip rendering offscreen frames entirely (including placeholders) unless explicitly forced; further reduces DOM churn while panning.

## Suggested implementation notes
- **Virtualization**
  - Use transform state to compute visible bounds plus buffer. Only map frames whose rect intersects the expanded bounds.
- **LOD (level-of-detail)**
  - Keep `zoom < threshold` → placeholder; otherwise mount `iframe` and show loading overlay.
- **Transform handling**
  - Maintain refs for transient state; batch updates via RAF; persist snapshots less frequently.
- **Drag loop**
  - Capture pointer deltas in refs; RAF update visuals; persist on drop; snap-to-grid for cleanliness.
- **Pure layout**
  - Immutable `HierarchyTree` enables shallow memo and persistent caches.
- **Security/CSP**
  - Continue nonce injection and avoid permissive CSP in `srcDoc`.

## Actionable checklist
- [x] Memoize `DesignFrame` and `ConnectionLines` with custom prop equality.
- [x] Implement viewport-based culling with buffer and zoom-based LOD.
- [ ] Add `IntersectionObserver` for mount/unmount edging.
- [x] Debounce/RAF transform updates; throttle drag move; guard logs behind `DEBUG`.
- [x] Verify no per-iframe Service Worker injection is present.
- [ ] Make `calculateHierarchyPositions` pure; memoize connection point calculations.
- [ ] Extract toolbar into a separate component; keep canvas subtree stable.
- [ ] Introduce `LayoutStrategy` interface and register `grid`/`hierarchy`/`relationships` strategies.
- [ ] Consider Canvas/WebGL path for connections when edge count is high.

## Expected impact
- **Performance**: Lower main-thread pressure, fewer re-renders, smoother zoom/pan, and reduced memory from fewer live iframes.
- **Extensibility**: Cleaner addition of new layouts and behaviors; easier to persist/share layouts; safer embedding with tighter CSP.


