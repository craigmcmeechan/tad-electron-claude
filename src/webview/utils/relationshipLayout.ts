import { DesignFile, GridPosition } from '../types/canvas.types';

export type ViewMode = 'pages' | 'components' | 'groups';

export type NodeKind = 'frame' | 'group';

export interface LayoutOptions {
  horizontalGap: number;
  verticalGap: number;
  groupPadding: number;
  groupHeader: { width: number; height: number };
}

export interface BaseNode {
  id: string;             // base id (DesignFile.name or synthetic group id)
  kind: NodeKind;
  next?: string[];        // ordered list of base ids
  children?: string[];    // ordered list of base ids
}

export interface CollapseState {
  isCollapsed: (instanceId: string) => boolean;
}

export interface LayoutPositions {
  // canonical frame placements by baseId
  frames: Record<string, GridPosition>;
  // group boxes by baseId (reserved for future group support)
  groups: Record<string, { x: number; y: number; width: number; height: number }>;
  // teleport chips keyed by teleport id
  teleports: Record<string, { x: number; y: number; width: number; height: number; targetBaseId: string }>; 
}

function isPage(df: DesignFile): boolean {
  return !!df.templates?.page || /(^|\/)pages\//.test(df.name);
}

function isComponent(df: DesignFile): boolean {
  return (df.templates?.components && df.templates.components.length > 0) || /(^|\/)components\//.test(df.name);
}

function normalizeTargets(val?: string[] | null): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter(v => typeof v === 'string');
}

export function buildBaseNodes(designs: DesignFile[], view: ViewMode): Map<string, BaseNode> {
  const nodes = new Map<string, BaseNode>();
  const include: (d: DesignFile) => boolean = view === 'pages' ? isPage : view === 'components' ? isComponent : () => true;

  // First pass: frames
  for (const df of designs) {
    if (!include(df)) continue;
    nodes.set(df.name, {
      id: df.name,
      kind: 'frame',
      next: [],
      children: Array.isArray(df.children) ? df.children.slice() : []
    });
  }

  // Second pass: relationships (filter endpoints to included set)
  for (const df of designs) {
    if (!nodes.has(df.name)) continue;
    const base = nodes.get(df.name)!;
    const nexts = normalizeTargets(df.relationships?.next);
    const childs = Array.isArray(df.children) ? df.children : normalizeTargets(df.relationships?.children);
    base.next = nexts.filter(t => nodes.has(t));
    base.children = childs.filter(t => nodes.has(t));
  }

  return nodes;
}

function computeInboundNextTargets(nodes: Map<string, BaseNode>): Set<string> {
  const inbound = new Set<string>();
  for (const [, n] of nodes) {
    if (!n.next) continue;
    for (const t of n.next) inbound.add(t);
  }
  return inbound;
}

export function computeRelationshipLayout(
  nodes: Map<string, BaseNode>,
  measure: (baseId: string, kind: NodeKind) => { width: number; height: number },
  options: LayoutOptions,
  collapse: CollapseState
): LayoutPositions {
  const positions: LayoutPositions = { frames: {}, groups: {}, teleports: {} };
  const placedBases = new Set<string>();
  const firstByBase = new Map<string, { x: number; y: number; width: number; height: number }>();
  const tpCount = new Map<string, number>();

  // Build horizontal roots based on base graph
  const inboundNext = computeInboundNextTargets(nodes);
  const baseRoots = Array.from(nodes.keys()).filter(id => !inboundNext.has(id));

  // Build chains starting from roots
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

  const multiChains = chains.filter(c => c.chain.length > 1);
  const singleChains = chains.filter(c => c.chain.length === 1);

  let cursorY = 0;

  // First, render multi-item chains (each as its own horizontal row)
  for (const { chain } of multiChains) {
    let cursorX = 0;
    let rowMaxHeight = 0;
    for (const baseId of chain) {
      const size = measure(baseId, nodes.get(baseId)?.kind || 'frame');
      const width = size.width;
      const height = size.height;
      if (!placedBases.has(baseId)) {
        // place canonical frame
        positions.frames[baseId] = { x: cursorX, y: cursorY };
        firstByBase.set(baseId, { x: cursorX, y: cursorY, width, height });
        placedBases.add(baseId);
        const childYStart = cursorY + height + options.verticalGap;
        const childStack = layoutChildrenBase(baseId, { x: cursorX, y: childYStart }, nodes, measure, options, collapse, positions, placedBases, firstByBase, tpCount, new Set());
        rowMaxHeight = Math.max(rowMaxHeight, height + childStack);
      } else {
        // create teleport chip
        const cnt = (tpCount.get(baseId) || 0) + 1;
        tpCount.set(baseId, cnt);
        positions.teleports[`tp:${baseId}:${cnt}`] = { x: cursorX, y: cursorY, width: options.groupHeader.width, height: options.groupHeader.height, targetBaseId: baseId };
        rowMaxHeight = Math.max(rowMaxHeight, options.groupHeader.height);
      }
      cursorX += width + options.horizontalGap;
    }
    cursorY += rowMaxHeight + options.verticalGap * 2;
  }

  // Then, pack isolated roots (no next) into a horizontal grid with 10 columns per row
  const maxCols = 10;
  let col = 0;
  let rowMaxHeight = 0;
  let cursorX = 0;
  for (let i = 0; i < singleChains.length; i++) {
    if (col === maxCols) {
      // wrap to next row
      cursorY += rowMaxHeight + options.verticalGap * 2;
      rowMaxHeight = 0;
      cursorX = 0;
      col = 0;
    }
    const baseId = singleChains[i].chain[0];
    const size = measure(baseId, nodes.get(baseId)?.kind || 'frame');
    const width = size.width;
    const height = size.height;
    if (!placedBases.has(baseId)) {
      positions.frames[baseId] = { x: cursorX, y: cursorY };
      firstByBase.set(baseId, { x: cursorX, y: cursorY, width, height });
      placedBases.add(baseId);
      const childYStart = cursorY + height + options.verticalGap;
      const childStack = layoutChildrenBase(baseId, { x: cursorX, y: childYStart }, nodes, measure, options, collapse, positions, placedBases, firstByBase, tpCount, new Set());
      rowMaxHeight = Math.max(rowMaxHeight, height + childStack);
    } else {
      const cnt = (tpCount.get(baseId) || 0) + 1;
      tpCount.set(baseId, cnt);
      positions.teleports[`tp:${baseId}:${cnt}`] = { x: cursorX, y: cursorY, width: options.groupHeader.width, height: options.groupHeader.height, targetBaseId: baseId };
      rowMaxHeight = Math.max(rowMaxHeight, options.groupHeader.height);
    }
    cursorX += width + options.horizontalGap;
    col++;
  }

  return positions;
}

function layoutChildrenBase(
  parentBaseId: string,
  parentPos: { x: number; y: number },
  nodes: Map<string, BaseNode>,
  measure: (baseId: string, kind: NodeKind) => { width: number; height: number },
  options: LayoutOptions,
  collapse: CollapseState,
  positions: LayoutPositions,
  placedBases: Set<string>,
  firstByBase: Map<string, { x: number; y: number; width: number; height: number }>,
  tpCount: Map<string, number>,
  path: Set<string>
): number {
  const n = nodes.get(parentBaseId);
  if (!n || !n.children || n.children.length === 0) return 0;
  let y = parentPos.y;
  for (const childBase of n.children) {
    const kind = nodes.get(childBase)?.kind || 'frame';
    const size = measure(childBase, kind);
    const x = parentPos.x;
    if (!placedBases.has(childBase) && !path.has(childBase)) {
      // Place canonical child
      positions.frames[childBase] = { x, y };
      firstByBase.set(childBase, { x, y, width: size.width, height: size.height });
      placedBases.add(childBase);
      // Recurse children under this child
      path.add(childBase);
      const subStack = layoutChildrenBase(childBase, { x, y: y + size.height + options.verticalGap }, nodes, measure, options, collapse, positions, placedBases, firstByBase, tpCount, path) || 0;
      path.delete(childBase);
      y += size.height + options.verticalGap + subStack;
    } else {
      // Teleport for duplicate or cycle
      const cnt = (tpCount.get(childBase) || 0) + 1;
      tpCount.set(childBase, cnt);
      positions.teleports[`tp:${childBase}:${cnt}`] = { x, y, width: options.groupHeader.width, height: options.groupHeader.height, targetBaseId: childBase };
      y += options.groupHeader.height + options.verticalGap;
    }
  }
  return y - parentPos.y;
}



