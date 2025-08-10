import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import DesignFrame from './DesignFrame';
import { calculateGridPosition, calculateFitToView, getGridMetrics, generateResponsiveConfig, buildHierarchyTree, calculateHierarchyPositions, getHierarchicalPosition, detectDesignRelationships } from '../utils/gridLayout';
import { 
    DesignFile, 
    CanvasState, 
    WebviewMessage, 
    ExtensionToWebviewMessage,
    CanvasConfig,
    ViewportMode,
    FrameViewportState,
    FramePositionState,
    DragState,
    GridPosition,
    LayoutMode,
    HierarchyTree,
    ConnectionLine
    } from '../types/canvas.types';
import ConnectionLines from './ConnectionLines';
import {
    ZoomInIcon,
    ZoomOutIcon,
    HomeIcon,
    ScaleIcon,
    RefreshIcon,
    GlobeIcon,
    MobileIcon,
    TabletIcon,
    DesktopIcon,
    TreeIcon,
    LinkIcon
} from './Icons';

interface CanvasViewProps {
    vscode: any;
    nonce: string | null;
}

const CANVAS_CONFIG: CanvasConfig = {
    frameSize: { width: 320, height: 400 }, // Smaller default frame size for better density
    gridSpacing: 50, // Much tighter spacing between frames
    framesPerRow: 4, // Fit 4 frames per row by default
    minZoom: 0.1,
    maxZoom: 5,
    responsive: {
        enableScaling: true,
        minFrameSize: { width: 160, height: 200 }, // Reduced minimum size
        maxFrameSize: { width: 400, height: 500 }, // Reduced maximum size
        scaleWithZoom: false
    },
    viewports: {
        desktop: { width: 1000, height: 600 }, // More compact desktop view
        tablet: { width: 640, height: 800 }, // Smaller tablet view
        mobile: { width: 320, height: 550 } // More compact mobile view
    },
    hierarchy: {
        horizontalSpacing: 180, // Reduced horizontal spacing for hierarchy
        verticalSpacing: 120, // Reduced vertical spacing for hierarchy
        connectionLineWidth: 2,
        connectionLineColor: 'var(--vscode-textLink-foreground)',
        showConnections: true
    }
};

const DEBUG = false;

const CanvasView: React.FC<CanvasViewProps> = ({ vscode, nonce }) => {
    if (DEBUG) console.log('🎨 CanvasView component starting...');
    if (DEBUG) console.log('📞 CanvasView props - vscode:', !!vscode, 'nonce:', nonce);
    
    const [designFiles, setDesignFiles] = useState<DesignFile[]>([]);
    const [selectedFrames, setSelectedFrames] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentZoom, setCurrentZoom] = useState(1);
    const [currentConfig, setCurrentConfig] = useState<CanvasConfig>(CANVAS_CONFIG);
    const [globalViewportMode, setGlobalViewportMode] = useState<ViewportMode>('tablet');
    const [frameViewports, setFrameViewports] = useState<FrameViewportState>({});
    const [useGlobalViewport, setUseGlobalViewport] = useState(true);
    const [customPositions, setCustomPositions] = useState<FramePositionState>({});
    const [dragState, setDragState] = useState<DragState>({
        isDragging: false,
        draggedFrame: null,
        startPosition: { x: 0, y: 0 },
        currentPosition: { x: 0, y: 0 },
        offset: { x: 0, y: 0 }
    });
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('grid');
    const [distMode, setDistMode] = useState<'pages' | 'components' | 'groups'>(() => {
        try {
            const saved = vscode?.getState?.() || {};
            return saved?.canvasDistMode || 'pages';
        } catch {
            return 'pages';
        }
    });
    const [hierarchyTree, setHierarchyTree] = useState<HierarchyTree | null>(null);
    const [showConnections, setShowConnections] = useState(true);
    const [showDebug, setShowDebug] = useState<boolean>(false);
    const [focusDebug, setFocusDebug] = useState<null | {
        fileName: string;
        layoutMode: LayoutMode;
        viewportMode: ViewportMode;
        frameWidth: number;
        frameHeight: number;
        index: number;
        positionXComputed: number;
        positionYComputed: number;
        domOffsetX: number;
        domOffsetY: number;
        finalX: number;
        finalY: number;
        targetCenterX: number;
        targetCenterY: number;
        containerWidth: number;
        containerHeight: number;
        desiredScale: number;
        clampedScale: number;
        positionX: number;
        positionY: number;
    }>(null);
    const transformRef = useRef<ReactZoomPanPinchRef>(null);
    const rafZoomStateRef = useRef<{ scheduled: boolean; nextScale: number } | null>(null);
    const savedStateRef = useRef<any>(null);
    const rafPersistRef = useRef<{ scheduled: boolean; scale: number; x: number; y: number } | null>(null);
    const dragRafRef = useRef<number | null>(null);
    const pendingDragPosRef = useRef<GridPosition | null>(null);
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isTransformReady, setIsTransformReady] = useState<boolean>(false);
    // Force render a specific frame to ensure it mounts for measurement
    const [forceRenderFrame, setForceRenderFrame] = useState<string | null>(null);
    // Search state
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    // (Optional) a ref registry could be added here; using querySelector for minimal change

    // Build manifest-backed search index from loaded design files
    type SearchItem = { name: string; kind: 'page' | 'component' | 'element'; frame: string; path?: string };
    const searchIndex: SearchItem[] = useMemo(() => {
        const items: SearchItem[] = [];
        for (const file of designFiles) {
            const t = file.templates;
            if (t) {
                if (t.page?.name) {
                    items.push({ name: t.page.name, kind: 'page', frame: file.name, path: t.page.path });
                }
                if (Array.isArray(t.components)) {
                    for (const c of t.components) {
                        if (c?.name) items.push({ name: c.name, kind: 'component', frame: file.name, path: c.path });
                    }
                }
                if (Array.isArray(t.elements)) {
                    for (const el of t.elements) {
                        if (el?.name) items.push({ name: el.name, kind: 'element', frame: file.name, path: el.path });
                    }
                }
            }
            // Fallbacks if manifest missing: allow searching by frame name as last resort
            if (!t || (!t.page?.name && (!t.components || t.components.length === 0))) {
                items.push({ name: file.name, kind: file.fileType === 'html' ? 'page' : 'component', frame: file.name, path: file.path });
            }
        }
        return items;
    }, [designFiles]);

    const searchResults: SearchItem[] = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return [];
        const startsWith: SearchItem[] = [];
        const includes: SearchItem[] = [];
        for (const item of searchIndex) {
            const name = item.name.toLowerCase();
            if (name.startsWith(q)) startsWith.push(item);
            else if (name.includes(q)) includes.push(item);
        }
        // De-duplicate by (name, frame, kind)
        const dedup: SearchItem[] = [];
        const seen = new Set<string>();
        for (const it of [...startsWith, ...includes]) {
            const key = `${it.kind}|${it.name}|${it.frame}`;
            if (!seen.has(key)) {
                seen.add(key);
                dedup.push(it);
            }
        }
        return dedup.slice(0, 25);
    }, [searchIndex, searchQuery]);

    if (DEBUG) console.log('✅ CanvasView state initialized successfully');
    
    // Memoized connections (must be declared at top level; hooks cannot be inside conditionals)
    const hierarchyConnections: ConnectionLine[] = useMemo(() => {
        if (!hierarchyTree) return [];
        try {
            return updateConnectionPositions(hierarchyTree.connections, designFiles);
        } catch {
            return [];
        }
    }, [hierarchyTree, designFiles, customPositions, frameViewports, useGlobalViewport, currentConfig, layoutMode]);

    const nextConnections: ConnectionLine[] = useMemo(() => {
        try {
            return buildNextRelationshipConnections();
        } catch {
            return [];
        }
    }, [designFiles, customPositions, frameViewports, useGlobalViewport, currentConfig, layoutMode]);

    // Performance optimization: Switch render modes based on zoom level
    const LOD_IFRAME_THRESHOLD = 0.35; // below this, render placeholders
    const getOptimalRenderMode = (zoom: number): 'placeholder' | 'iframe' => {
        return zoom < LOD_IFRAME_THRESHOLD ? 'placeholder' : 'iframe';
    };

    // Helper function to transform mouse coordinates to canvas space
    const transformMouseToCanvasSpace = (clientX: number, clientY: number, canvasRect: DOMRect): GridPosition => {
        // Get current transform state from the TransformWrapper
        const transformState = transformRef.current?.instance?.transformState;
        const currentScale = transformState?.scale || 1;
        const currentTranslateX = transformState?.positionX || 0;
        const currentTranslateY = transformState?.positionY || 0;
        
        // Calculate mouse position relative to canvas, then adjust for zoom and pan
        const rawMouseX = clientX - canvasRect.left;
        const rawMouseY = clientY - canvasRect.top;
        
        // Transform mouse coordinates to canvas space (inverse of current transform)
        return {
            x: (rawMouseX - currentTranslateX) / currentScale,
            y: (rawMouseY - currentTranslateY) / currentScale
        };
    };

    // Viewport management functions
    const getFrameViewport = (fileName: string): ViewportMode => {
        if (useGlobalViewport) {
            return globalViewportMode;
        }
        return frameViewports[fileName] || 'desktop';
    };

    const handleFrameViewportChange = (fileName: string, viewport: ViewportMode) => {
        setFrameViewports(prev => ({
            ...prev,
            [fileName]: viewport
        }));
    };

    const handleGlobalViewportChange = (viewport: ViewportMode) => {
        setGlobalViewportMode(viewport);
        if (useGlobalViewport) {
            // Update all frames to the new global viewport
            const newFrameViewports: FrameViewportState = {};
            designFiles.forEach(file => {
                newFrameViewports[file.name] = viewport;
            });
            setFrameViewports(newFrameViewports);
            
            // Update hierarchy positioning when viewport changes to adjust connection spacing
            if (hierarchyTree && designFiles.length > 0) {
                // Recalculate frame dimensions for new viewport
                let totalWidth = 0;
                let totalHeight = 0;
                let frameCount = 0;
                
                designFiles.forEach(file => {
                    const viewportDimensions = currentConfig.viewports[viewport];
                    totalWidth += viewportDimensions.width;
                    totalHeight += viewportDimensions.height + 50; // Add header space
                    frameCount++;
                });
                
                const avgFrameDimensions = frameCount > 0 ? {
                    width: Math.round(totalWidth / frameCount),
                    height: Math.round(totalHeight / frameCount)
                } : { width: 400, height: 550 };
                
                const updatedTree = calculateHierarchyPositions(hierarchyTree, currentConfig, avgFrameDimensions);
                setHierarchyTree(updatedTree);
            }
        }
    };

    // Compute average frame dimensions for current viewport usage (used by hierarchy layout)
    const computeAverageFrameDimensions = (): { width: number; height: number } => {
        let totalWidth = 0;
        let totalHeight = 0;
        let frameCount = 0;
        for (const file of designFiles) {
            const vp = getFrameViewport(file.name);
            const d = currentConfig.viewports[vp];
            totalWidth += d.width;
            totalHeight += d.height + 50;
            frameCount++;
        }
        return frameCount > 0
            ? { width: Math.round(totalWidth / frameCount), height: Math.round(totalHeight / frameCount) }
            : { width: 400, height: 550 };
    };

    // Focus the view on a specific frame by name
    const focusOnFrame = (fileName: string) => {
        if (!transformRef.current) return;
        const wrapper = document.querySelector('.canvas-transform-wrapper') as HTMLElement | null;
        const content = document.querySelector('.canvas-transform-content') as HTMLElement | null;
        // Use viewport size for centering to avoid picking up oversized content width
        // In some layouts (e.g., panel), the wrapper can expand with content min-width.
        // Always prefer the viewport dimensions for centering math.
        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;

        const index = designFiles.findIndex(f => f.name === fileName);
        if (index === -1) return;

        // Use avg dims in hierarchy mode to match how positions were computed
        let frameWidth: number;
        let frameHeight: number;
        let viewportModeForFrame: ViewportMode = getFrameViewport(fileName);
        if (layoutMode === 'hierarchy' && hierarchyTree) {
            const avg = computeAverageFrameDimensions();
            frameWidth = avg.width;
            frameHeight = avg.height;
        } else {
            const dims = currentConfig.viewports[viewportModeForFrame];
            frameWidth = dims.width;
            frameHeight = dims.height + 50; // header space
        }

        const position = getFramePosition(fileName, index);

        // Ensure the target frame is mounted for measurement
        setForceRenderFrame(fileName);

        // If we can read actual DOM position, prefer that over computed grid position
        // Use NaN sentinel so we only adopt DOM offsets when a node is actually found
        let domOffsetX = Number.NaN;
        let domOffsetY = Number.NaN;
        if (content) {
            const node = content.querySelector(`.design-frame[data-frame-name="${CSS.escape(fileName)}"]`) as HTMLElement | null;
            if (node) {
                const rect = node.getBoundingClientRect();
                const contentRect = content.getBoundingClientRect();
                const currentScale = transformRef.current?.instance?.transformState?.scale || 1;
                // Convert from screen px to content-space coordinates (pre-transform)
                domOffsetX = (rect.left - contentRect.left) / currentScale;
                domOffsetY = (rect.top - contentRect.top) / currentScale;
            }
        }

        const finalX = Number.isFinite(domOffsetX) ? domOffsetX : position.x;
        const finalY = Number.isFinite(domOffsetY) ? domOffsetY : position.y;

        const targetCenterX = finalX + frameWidth / 2;
        const targetCenterY = finalY + frameHeight / 2;

        // Compute a scale that fits the frame nicely within the viewport with padding
        const padFactor = 0.85; // show with some padding
        const scaleX = (containerWidth * padFactor) / frameWidth;
        const scaleY = (containerHeight * padFactor) / frameHeight;
        const desiredScale = Math.min(scaleX, scaleY, 1);
        const clampedScale = Math.max(currentConfig.minZoom, Math.min(currentConfig.maxZoom, desiredScale));

        // Compute translate so that target center maps to viewport center
        // react-zoom-pan-pinch uses content transform: translate(positionX, positionY) scale(scale)
        // With our absolute coordinates inside content, the correct translation is:
        // positionX = containerCenterX - targetCenterX * scale
        const positionX = (containerWidth / 2) - (targetCenterX * clampedScale);
        const positionY = (containerHeight / 2) - (targetCenterY * clampedScale);

        // Capture debug info
        setFocusDebug({
            fileName,
            layoutMode,
            viewportMode: viewportModeForFrame,
            frameWidth,
            frameHeight,
            index,
            positionXComputed: position.x,
            positionYComputed: position.y,
            domOffsetX,
            domOffsetY,
            finalX,
            finalY,
            targetCenterX,
            targetCenterY,
            containerWidth,
            containerHeight,
            desiredScale,
            clampedScale,
            positionX,
            positionY,
        });

        // Double RAF to ensure DOM nodes and transform context are fully updated before centering
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                transformRef.current?.setTransform(positionX, positionY, clampedScale);
                setCurrentZoom(clampedScale);
                setPan({ x: positionX, y: positionY });

                // Settle pass: re-measure and apply a tiny correction if needed, then clear force flag
                requestAnimationFrame(() => {
                    const contentEl = document.querySelector('.canvas-transform-content') as HTMLElement | null;
                    const node = contentEl?.querySelector(`.design-frame[data-frame-name="${CSS.escape(fileName)}"]`) as HTMLElement | null;
                    if (contentEl && node) {
                        const rect = node.getBoundingClientRect();
                        const contentRect = contentEl.getBoundingClientRect();
                        const scaleNow = transformRef.current?.instance?.transformState?.scale || clampedScale;
                        const domXNow = (rect.left - contentRect.left) / scaleNow;
                        const domYNow = (rect.top - contentRect.top) / scaleNow;
                        const finalXNow = Number.isFinite(domXNow) ? domXNow : finalX;
                        const finalYNow = Number.isFinite(domYNow) ? domYNow : finalY;
                        const targetCenterXNow = finalXNow + frameWidth / 2;
                        const targetCenterYNow = finalYNow + frameHeight / 2;
                        const correctedX = (containerWidth / 2) - (targetCenterXNow * clampedScale);
                        const correctedY = (containerHeight / 2) - (targetCenterYNow * clampedScale);
                        const dx = Math.abs((transformRef.current?.instance?.transformState?.positionX || 0) - correctedX);
                        const dy = Math.abs((transformRef.current?.instance?.transformState?.positionY || 0) - correctedY);
                        if (dx > 0.5 || dy > 0.5) {
                            transformRef.current?.setTransform(correctedX, correctedY, clampedScale);
                            setPan({ x: correctedX, y: correctedY });
                        }
                    }
                    setForceRenderFrame(null);
                });
            });
        });
    };

    const handleSelectFromSearch = (item: SearchItem) => {
        // Focus the frame that contains this page/component/element
        setSelectedFrames([item.frame]);
        focusOnFrame(item.frame);
        setShowSearchDropdown(false);
        // Keep the query for next time, but blur input
        searchInputRef.current?.blur();
    };

    const toggleGlobalViewport = () => {
        const newUseGlobal = !useGlobalViewport;
        setUseGlobalViewport(newUseGlobal);
        
        if (newUseGlobal) {
            // Set all frames to current global viewport
            const newFrameViewports: FrameViewportState = {};
            designFiles.forEach(file => {
                newFrameViewports[file.name] = globalViewportMode;
            });
            setFrameViewports(newFrameViewports);
        }
    };

    // Responsive config update
    useEffect(() => {
        const updateConfig = () => {
            const responsive = generateResponsiveConfig(CANVAS_CONFIG, window.innerWidth);
            setCurrentConfig(responsive);
        };

        updateConfig();
        window.addEventListener('resize', updateConfig);
        return () => window.removeEventListener('resize', updateConfig);
    }, []);

    useEffect(() => {
        // Load any previously saved webview state
        try {
            savedStateRef.current = vscode?.getState?.() || {};
        } catch (e) {
            savedStateRef.current = {};
        }

        // Request design files from extension
        const loadMessage: any = {
            command: 'loadDesignFiles',
            data: { source: 'dist', kind: distMode }
        };
        vscode.postMessage(loadMessage);

        // Listen for messages from extension and internal navigation requests
        const messageHandler = (event: MessageEvent) => {
            const message: ExtensionToWebviewMessage = event.data;
            
            switch (message.command) {
                case 'designFilesLoaded':
                    // Convert date strings back to Date objects
                    const filesWithDates = message.data.files.map(file => ({
                        ...file,
                        modified: new Date(file.modified)
                    }));
                    
                    // Detect design relationships and build hierarchy
                    const filesWithRelationships = detectDesignRelationships(filesWithDates);
                    setDesignFiles(filesWithRelationships);
                    
                    // Build hierarchy tree
                    const tree = buildHierarchyTree(filesWithRelationships);
                    
                    // Calculate average frame dimensions based on viewport usage
                    let totalWidth = 0;
                    let totalHeight = 0;
                    let frameCount = 0;
                    
                    filesWithRelationships.forEach(file => {
                        const frameViewport = getFrameViewport(file.name);
                        const viewportDimensions = currentConfig.viewports[frameViewport];
                        totalWidth += viewportDimensions.width;
                        totalHeight += viewportDimensions.height + 50; // Add header space
                        frameCount++;
                    });
                    
                    const avgFrameDimensions = frameCount > 0 ? {
                        width: Math.round(totalWidth / frameCount),
                        height: Math.round(totalHeight / frameCount)
                    } : { width: 400, height: 550 };
                    
                    const positionedTree = calculateHierarchyPositions(tree, currentConfig, avgFrameDimensions);
                    setHierarchyTree(positionedTree);
                    
                    setIsLoading(false);

                    // Restore previous transform if available; otherwise center
                    setTimeout(() => {
                        if (transformRef.current) {
                            const saved = savedStateRef.current || vscode?.getState?.() || {};
                            const savedTransform = saved?.canvasTransform;
                            const savedPositions = saved?.canvasCustomPositions;
                            if (savedTransform && typeof savedTransform.scale === 'number') {
                                const sx = typeof savedTransform.positionX === 'number' ? savedTransform.positionX : 0;
                                const sy = typeof savedTransform.positionY === 'number' ? savedTransform.positionY : 0;
                                const sc = savedTransform.scale > 0 ? savedTransform.scale : 1;
                                transformRef.current.setTransform(sx, sy, sc);
                                setCurrentZoom(sc);
                                setPan({ x: sx, y: sy });
                                setIsTransformReady(true);
                            } else {
                                // Center to fit current canvas bounds more predictably
                                // Compute a fit-to-view for the overall canvas based on grid sizing
                                try {
                                    const wrapperEl = document.querySelector('.canvas-transform-wrapper') as HTMLElement | null;
                                    const w = wrapperEl?.clientWidth || window.innerWidth;
                                    const h = wrapperEl?.clientHeight || window.innerHeight;
                                    // Estimate canvas bounds from last item's position and per-row metrics
                                    // Fallback: just reset transform if anything fails
                                    transformRef.current.resetTransform();
                                    const ts = transformRef.current?.instance?.transformState;
                                    if (ts) {
                                        setCurrentZoom(ts.scale);
                                        setPan({ x: ts.positionX, y: ts.positionY });
                                    }
                                } catch {
                                    transformRef.current.resetTransform();
                                }
                                setIsTransformReady(true);
                            }

                            if (savedPositions && typeof savedPositions === 'object') {
                                setCustomPositions(savedPositions as FramePositionState);
                            }
                        }
                    }, 100);
                    break;
                    
                case 'error':
                    setError(message.data.error);
                    setIsLoading(false);
                    break;

                case 'fileChanged':
                    // Handle file system changes (will implement in Task 2.3)
                    if (DEBUG) console.log('File changed:', message.data);
                    // Re-request files when changes occur
                    vscode.postMessage({ command: 'loadDesignFiles', data: { source: 'dist', kind: distMode } });
                    break;

                case 'designFileRefreshed':
                    // Update a single design file in place
                    {
                        const updated = message.data.file;
                        setDesignFiles(prev => prev.map(f => (f.path === updated.path ? {
                            ...f,
                            content: updated.content,
                            size: updated.size,
                            modified: new Date(updated.modified),
                            fileType: updated.fileType
                        } : f)));
                    }
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        // Internal navigation bridge from DesignFrame
        const navHandler = (event: MessageEvent) => {
            const data: any = event.data;
            if (data && typeof data === 'object' && data.__canvasNavigateTo__) {
                const targetName = String(data.__canvasNavigateTo__);
                // Ensure the target exists in current files, then focus
                const exists = designFiles.some(f => f.name === targetName);
                if (exists) {
                    setSelectedFrames([targetName]);
                    focusOnFrame(targetName);
                }
            }
        };
        window.addEventListener('message', navHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, [vscode]); // Removed currentConfig dependency to prevent constant re-renders

    // Persist and reload when dist mode changes
    useEffect(() => {
        try {
            const prev = savedStateRef.current || vscode?.getState?.() || {};
            const next = { ...prev, canvasDistMode: distMode };
            savedStateRef.current = next;
            vscode?.setState?.(next);
        } catch {}

        vscode.postMessage({ command: 'loadDesignFiles', data: { source: 'dist', kind: distMode } });
    }, [distMode]);

    const persistTransformState = (scale: number, x: number, y: number) => {
        // Schedule persistence to avoid spamming setState
        if (!rafPersistRef.current) rafPersistRef.current = { scheduled: false, scale, x, y };
        rafPersistRef.current.scale = scale;
        rafPersistRef.current.x = x;
        rafPersistRef.current.y = y;
        if (!rafPersistRef.current.scheduled) {
            rafPersistRef.current.scheduled = true;
            requestAnimationFrame(() => {
                const toSave = rafPersistRef.current!;
                rafPersistRef.current = { ...toSave, scheduled: false };
                try {
                    const prev = savedStateRef.current || vscode?.getState?.() || {};
                    const next = {
                        ...prev,
                        canvasTransform: {
                            scale: toSave.scale,
                            positionX: toSave.x,
                            positionY: toSave.y
                        }
                    };
                    savedStateRef.current = next;
                    vscode?.setState?.(next);
                } catch (e) {
                    // ignore persistence errors
                }
            });
        }
    };

    const handleFrameSelect = (fileName: string) => {
        setSelectedFrames([fileName]); // Single selection for now
        
        // Find the selected file to get its full path
        const selectedFile = designFiles.find(file => file.name === fileName);
        const filePath = selectedFile ? selectedFile.path : fileName;
        
        const selectMessage: WebviewMessage = {
            command: 'selectFrame',
            data: { fileName }
        };
        vscode.postMessage(selectMessage);

        // Also send context to chat interface with full path
        const contextMessage: WebviewMessage = {
            command: 'setContextFromCanvas',
            data: { fileName: filePath, type: 'frame' }
        };
        vscode.postMessage(contextMessage);
    };

    const handleSendToChat = (fileName: string, prompt: string) => {
        // Find the selected file to get its full path
        const selectedFile = designFiles.find(file => file.name === fileName);
        const filePath = selectedFile ? selectedFile.path : fileName;
        
        // Set context first
        const contextMessage: WebviewMessage = {
            command: 'setContextFromCanvas',
            data: { fileName: filePath, type: 'frame' }
        };
        vscode.postMessage(contextMessage);
        
        // Then send the prompt to the chat input
        const promptMessage: WebviewMessage = {
            command: 'setChatPrompt',
            data: { prompt }
        };
        vscode.postMessage(promptMessage);
    };

    // Canvas control functions
    const handleZoomIn = () => {
        if (transformRef.current) {
            const currentState = transformRef.current.instance?.transformState;
            if (DEBUG) console.log('🔍 ZOOM IN - Before:', {
                scale: currentState?.scale,
                positionX: currentState?.positionX,
                positionY: currentState?.positionY,
                step: 0.05,
                minScale: 0.1,
                maxScale: 3,
                smooth: false
            });
            
            transformRef.current.zoomIn(0.05);
            
            // Log after zoom (with small delay to capture the change)
            setTimeout(() => {
                const newState = transformRef.current?.instance?.transformState;
                if (DEBUG) console.log('🔍 ZOOM IN - After:', {
                    scale: newState?.scale,
                    positionX: newState?.positionX,
                    positionY: newState?.positionY,
                    scaleDiff: newState?.scale ? (newState.scale - (currentState?.scale || 1)) : 0,
                    positionXDiff: newState?.positionX ? (newState.positionX - (currentState?.positionX || 0)) : 0,
                    positionYDiff: newState?.positionY ? (newState.positionY - (currentState?.positionY || 0)) : 0
                });
            }, 50);
        }
    };

    const handleZoomOut = () => {
        if (transformRef.current) {
            const currentState = transformRef.current.instance?.transformState;
            if (DEBUG) console.log('🔍 ZOOM OUT - Before:', {
                scale: currentState?.scale,
                positionX: currentState?.positionX,
                positionY: currentState?.positionY,
                step: 0.05
            });
            
            transformRef.current.zoomOut(0.05);
            
            // Log after zoom (with small delay to capture the change)
            setTimeout(() => {
                const newState = transformRef.current?.instance?.transformState;
                if (DEBUG) console.log('🔍 ZOOM OUT - After:', {
                    scale: newState?.scale,
                    positionX: newState?.positionX,
                    positionY: newState?.positionY,
                    scaleDiff: newState?.scale ? (newState.scale - (currentState?.scale || 1)) : 0,
                    positionXDiff: newState?.positionX ? (newState.positionX - (currentState?.positionX || 0)) : 0,
                    positionYDiff: newState?.positionY ? (newState.positionY - (currentState?.positionY || 0)) : 0
                });
            }, 50);
        }
    };

    const handleResetZoom = () => {
        if (transformRef.current) {
            const currentState = transformRef.current.instance?.transformState;
            if (DEBUG) console.log('🔍 RESET ZOOM - Before:', {
                scale: currentState?.scale,
                positionX: currentState?.positionX,
                positionY: currentState?.positionY
            });
            
            transformRef.current.resetTransform();
            
            setTimeout(() => {
                const newState = transformRef.current?.instance?.transformState;
                if (DEBUG) console.log('🔍 RESET ZOOM - After:', {
                    scale: newState?.scale,
                    positionX: newState?.positionX,
                    positionY: newState?.positionY
                });
            }, 50);
        }
    };

    const handleReloadAll = () => {
        vscode.postMessage({ command: 'loadDesignFiles', data: { source: 'dist', kind: distMode } });
    };

    const handleTransformChange = (ref: ReactZoomPanPinchRef) => {
        const state = ref.state;
        
        // Prevent negative or zero scales
        if (state.scale <= 0) {
            console.error('🚨 INVALID SCALE DETECTED:', state.scale, '- Resetting to minimum');
            ref.setTransform(state.positionX, state.positionY, 0.1);
            return;
        }
        
        if (DEBUG) console.log('🔄 TRANSFORM CHANGE:', {
            scale: state.scale,
            positionX: state.positionX,
            positionY: state.positionY,
            previousScale: currentZoom
        });
        // Throttle setState with RAF
        if (!rafZoomStateRef.current) rafZoomStateRef.current = { scheduled: false, nextScale: state.scale };
        rafZoomStateRef.current.nextScale = state.scale;
        if (!rafZoomStateRef.current.scheduled) {
            rafZoomStateRef.current.scheduled = true;
            requestAnimationFrame(() => {
                if (rafZoomStateRef.current) {
                    setCurrentZoom(rafZoomStateRef.current.nextScale);
                    rafZoomStateRef.current.scheduled = false;
                }
            });
        }

        // Persist latest transform
        persistTransformState(state.scale, state.positionX, state.positionY);
        setPan({ x: state.positionX, y: state.positionY });
    };

    // Basic viewport culling: determine visible area in canvas space and filter frames
        const visibleBounds = useMemo(() => {
        const transformState = transformRef.current?.instance?.transformState;
        const scale = transformState?.scale || 1;
        const x = transformState?.positionX || 0;
        const y = transformState?.positionY || 0;
        // Use viewport size instead of wrapper element which may stretch with content
        const width = window.innerWidth;
        const height = window.innerHeight;
        const left = (-x) / scale;
        const top = (-y) / scale;
        const right = left + width / scale;
        const bottom = top + height / scale;
        // Add buffer to reduce mount thrash
        const buffer = 400;
        return { left: left - buffer, top: top - buffer, right: right + buffer, bottom: bottom + buffer };
    }, [currentZoom, pan.x, pan.y, dragState.isDragging]);

    // Get frame position (custom, hierarchy, or default grid position)
    const getFramePosition = (fileName: string, index: number): GridPosition => {
        if (customPositions[fileName]) {
            return customPositions[fileName];
        }
        
        // Use hierarchy layout if in hierarchy mode and tree is available
        if (layoutMode === 'hierarchy' && hierarchyTree) {
            return getHierarchicalPosition(fileName, hierarchyTree);
        }
        
        // Default grid position calculation
        const viewportMode = getFrameViewport(fileName);
        const viewportDimensions = currentConfig.viewports[viewportMode];
        const actualWidth = viewportDimensions.width;
        const actualHeight = viewportDimensions.height + 50;
        
        const col = index % currentConfig.framesPerRow;
        const row = Math.floor(index / currentConfig.framesPerRow);
        
        const x = col * (Math.max(actualWidth, currentConfig.frameSize.width) + currentConfig.gridSpacing);
        const y = row * (Math.max(actualHeight, currentConfig.frameSize.height) + currentConfig.gridSpacing);
        
        return { x, y };
    };

    // Drag handlers
    const handleDragStart = (fileName: string, startPos: GridPosition, mouseEvent: React.MouseEvent) => {
        // Get canvas grid element for proper coordinate calculation
        const canvasGrid = document.querySelector('.canvas-grid') as HTMLElement;
        if (!canvasGrid) return;
        
        const canvasRect = canvasGrid.getBoundingClientRect();
        const canvasMousePos = transformMouseToCanvasSpace(mouseEvent.clientX, mouseEvent.clientY, canvasRect);
        
        // Also ensure this frame is selected
        if (!selectedFrames.includes(fileName)) {
            setSelectedFrames([fileName]);
        }
        
        setDragState({
            isDragging: true,
            draggedFrame: fileName,
            startPosition: startPos,
            currentPosition: startPos,
            offset: {
                x: canvasMousePos.x - startPos.x,
                y: canvasMousePos.y - startPos.y
            }
        });
    };

    const handleDragMove = (mousePos: GridPosition) => {
        if (!dragState.isDragging || !dragState.draggedFrame) return;
        
        const newPosition = {
            x: mousePos.x - dragState.offset.x,
            y: mousePos.y - dragState.offset.y
        };
        
        setDragState(prev => ({
            ...prev,
            currentPosition: newPosition
        }));
    };

    const handleDragEnd = () => {
        if (!dragState.isDragging || !dragState.draggedFrame) return;
        
        // Snap to grid (optional - makes positioning cleaner)
        const gridSize = 25;
        const snappedPosition = {
            x: Math.round(dragState.currentPosition.x / gridSize) * gridSize,
            y: Math.round(dragState.currentPosition.y / gridSize) * gridSize
        };
        
        // Save the new position
        setCustomPositions(prev => {
            const nextPositions = {
                ...prev,
                [dragState.draggedFrame!]: snappedPosition
            } as FramePositionState;
            try {
                const prevState = savedStateRef.current || vscode?.getState?.() || {};
                const nextState = {
                    ...prevState,
                    canvasCustomPositions: nextPositions
                };
                savedStateRef.current = nextState;
                vscode?.setState?.(nextState);
            } catch (e) {
                // ignore persistence errors
            }
            return nextPositions;
        });
        
        // Reset drag state
        setDragState({
            isDragging: false,
            draggedFrame: null,
            startPosition: { x: 0, y: 0 },
            currentPosition: { x: 0, y: 0 },
            offset: { x: 0, y: 0 }
        });
    };

    // Reset positions to grid
    const handleResetPositions = () => {
        setCustomPositions({});
    };

    // Update connection positions based on current frame positions
    const updateConnectionPositions = (connections: ConnectionLine[], files: DesignFile[]): ConnectionLine[] => {
        return connections.map(connection => {
            const fromIndex = files.findIndex(f => f.name === connection.fromFrame);
            const toIndex = files.findIndex(f => f.name === connection.toFrame);
            
            if (fromIndex === -1 || toIndex === -1) {
                return connection; // Keep original if frame not found
            }
            
            // Get current positions (custom or calculated)
            const fromPosition = getFramePosition(connection.fromFrame, fromIndex);
            const toPosition = getFramePosition(connection.toFrame, toIndex);
            
            // Get frame dimensions for connection point calculation
            const fromViewport = getFrameViewport(connection.fromFrame);
            const toViewport = getFrameViewport(connection.toFrame);
            const fromDimensions = currentConfig.viewports[fromViewport];
            const toDimensions = currentConfig.viewports[toViewport];
            
            // Calculate connection points (center-right of from frame to center-left of to frame)
            const fromConnectionPoint = {
                x: fromPosition.x + fromDimensions.width,
                y: fromPosition.y + (fromDimensions.height + 50) / 2 // +50 for header
            };
            
            const toConnectionPoint = {
                x: toPosition.x,
                y: toPosition.y + (toDimensions.height + 50) / 2 // +50 for header
            };
            
            return {
                ...connection,
                fromPosition: fromConnectionPoint,
                toPosition: toConnectionPoint
            };
        });
    };

    // Build directional connection lines from manifest relationships (next only)
    const buildNextRelationshipConnections = (): ConnectionLine[] => {
        const conns: ConnectionLine[] = [];
        // Only consider pages relationships
        const pageFiles = designFiles.filter(f => f.name.startsWith('pages/'));
        const mapByName = new Map(pageFiles.map(f => [f.name, f] as const));
        for (const file of pageFiles) {
            const nexts = file.relationships?.next || [];
            for (const target of nexts) {
                const toFile = mapByName.get(target);
                if (!toFile) continue;
                conns.push({
                    id: `next:${file.name}->${toFile.name}`,
                    fromFrame: file.name,
                    toFrame: toFile.name,
                    fromPosition: { x: 0, y: 0 },
                    toPosition: { x: 0, y: 0 },
                    color: 'var(--vscode-textLink-foreground)',
                    width: 2
                });
            }
        }
        return updateConnectionPositions(conns, designFiles);
    };

    // Keyboard shortcuts for zoom
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
                switch (e.key) {
                    case '=':
                    case '+':
                        e.preventDefault();
                        handleZoomIn();
                        break;
                    case '-':
                        e.preventDefault();
                        handleZoomOut();
                        break;
                    case '0':
                        e.preventDefault();
                        handleResetZoom();
                        break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    if (isLoading) {
        return (
            <div className="canvas-loading">
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Loading design files...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="canvas-error">
                <div className="error-message">
                    <h3>Error loading canvas</h3>
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (designFiles.length === 0) {
        return (
            <div className="canvas-empty">
                <div className="empty-state">
                    <h3>No design files found in <code>.superdesign/design_iterations/</code></h3>
                    <p>Prompt Superdesign or your preferred AI tool to design UI like <kbd>Help me design a calculator UI</kbd> and preview the UI here</p>
                </div>
            </div>
        );
    }

    return (
        <div className="canvas-container">
            {/* Canvas Controls - Clean Minimal Design */}
            <div className="canvas-toolbar">
                {/* Search Section */}
                <div className="toolbar-section canvas-search-section">
                    <div className="control-group">
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="canvas-search-input"
                            placeholder={`Search ${distMode === 'pages' ? 'pages' : distMode === 'components' ? 'components' : 'groups'}...`}
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setShowSearchDropdown(true);
                            }}
                            onFocus={() => setShowSearchDropdown(true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && searchResults.length > 0) {
                                    handleSelectFromSearch(searchResults[0]);
                                } else if (e.key === 'Escape') {
                                    setShowSearchDropdown(false);
                                    (e.target as HTMLInputElement).blur();
                                }
                            }}
                        />
                    </div>
                    {showSearchDropdown && searchResults.length > 0 && (
                        <div
                            className="canvas-search-dropdown"
                            onMouseDown={(e) => {
                                // Prevent input blur before click
                                e.preventDefault();
                            }}
                        >
                            {searchResults.map(item => (
                                <button
                                    key={`${item.kind}:${item.name}:${item.frame}`}
                                    className="canvas-search-item"
                                    title={item.path || item.frame}
                                    onClick={() => handleSelectFromSearch(item)}
                                >
                                    <span className="canvas-search-name">{item.name}</span>
                                    <span className="canvas-search-type">{item.kind.toUpperCase()}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Navigation Section */}
                <div className="toolbar-section">
                <div className="control-group">
                        <button className="toolbar-btn zoom-btn" onClick={handleZoomOut} title="Zoom Out (Cmd/Ctrl + -)">
                            <ZoomOutIcon />
                        </button>
                        <div className="zoom-display">
                            <span className="zoom-value">{Math.round(currentZoom * 100)}%</span>
                        </div>
                        <button className="toolbar-btn zoom-btn" onClick={handleZoomIn} title="Zoom In (Cmd/Ctrl + +)">
                        <ZoomInIcon />
                    </button>
                        <div className="toolbar-divider"></div>
                        <button className="toolbar-btn" onClick={handleResetZoom} title="Reset Zoom (Cmd/Ctrl + 0)">
                            <HomeIcon />
                        </button>
                        <button className="toolbar-btn" onClick={handleResetPositions} title="Reset Frame Positions">
                            <RefreshIcon />
                        </button>
                        <button className="toolbar-btn" onClick={handleReloadAll} title="Reload All from Source">
                            <RefreshIcon />
                        </button>
                    </div>
                </div>

                {/* Layout Section */}
                <div className="toolbar-section">
                <div className="control-group">
                        <div className="layout-toggle">
                            <button 
                                className={`toggle-btn ${layoutMode === 'grid' ? 'active' : ''}`}
                                onClick={() => setLayoutMode('grid')}
                                title="Grid Layout"
                            >
                                <ScaleIcon />
                            </button>
                            <button 
                                className={`toggle-btn ${layoutMode === 'hierarchy' ? 'active' : ''}`}
                                onClick={() => setLayoutMode('hierarchy')}
                                title="Hierarchy Layout"
                                disabled={!hierarchyTree || hierarchyTree.nodes.size === 0}
                            >
                                <TreeIcon />
                    </button>
                        </div>
                        {layoutMode === 'hierarchy' && (
                            <button 
                                className={`toolbar-btn connection-btn ${showConnections ? 'active' : ''}`}
                                onClick={() => setShowConnections(!showConnections)}
                                title="Toggle Connection Lines"
                            >
                                <LinkIcon />
                    </button>
                        )}
                        <button 
                            className={`toolbar-btn ${showDebug ? 'active' : ''}`}
                            onClick={() => setShowDebug(prev => !prev)}
                            title="Toggle Debug Overlay"
                        >
                            DBG
                        </button>
                    </div>
                </div>

                {/* Dist Source Section */}
                <div className="toolbar-section">
                    <div className="control-group">
                        <div className="layout-toggle">
                            <button
                                className={`toggle-btn ${distMode === 'pages' ? 'active' : ''}`}
                                onClick={() => setDistMode('pages')}
                                title="Show built Pages (.superdesign/dist/pages)"
                            >
                                Pages
                            </button>
                            <button
                                className={`toggle-btn ${distMode === 'components' ? 'active' : ''}`}
                                onClick={() => setDistMode('components')}
                                title="Show built Components (.superdesign/dist/components)"
                            >
                                Components
                            </button>
                            <button
                                className={`toggle-btn ${distMode === 'groups' ? 'active' : ''}`}
                                onClick={() => setDistMode('groups')}
                                title="Show tag Groups (from manifest/canvas-metadata tags)"
                            >
                                Groups
                            </button>
                        </div>
                    </div>
                </div>

                {/* Viewport Section */}
                <div className="toolbar-section">
                <div className="control-group">
                    <button 
                            className={`toolbar-btn viewport-mode-btn ${useGlobalViewport ? 'active' : ''}`}
                        onClick={toggleGlobalViewport}
                        title="Toggle Global Viewport Mode"
                    >
                        <GlobeIcon />
                    </button>
                        <div className="viewport-selector">
                        <button 
                                className={`viewport-btn ${globalViewportMode === 'mobile' && useGlobalViewport ? 'active' : ''}`}
                            onClick={() => handleGlobalViewportChange('mobile')}
                            title="Mobile View (375×667)"
                            disabled={!useGlobalViewport}
                        >
                            <MobileIcon />
                        </button>
                        <button 
                                className={`viewport-btn ${globalViewportMode === 'tablet' && useGlobalViewport ? 'active' : ''}`}
                            onClick={() => handleGlobalViewportChange('tablet')}
                            title="Tablet View (768×1024)"
                            disabled={!useGlobalViewport}
                        >
                            <TabletIcon />
                        </button>
                        <button 
                                className={`viewport-btn ${globalViewportMode === 'desktop' && useGlobalViewport ? 'active' : ''}`}
                            onClick={() => handleGlobalViewportChange('desktop')}
                            title="Desktop View (1200×800)"
                            disabled={!useGlobalViewport}
                        >
                            <DesktopIcon />
                        </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Debug Overlay (fixed to viewport, not transformed) */}
            {showDebug && (
                (() => {
                    const ts = transformRef.current?.instance?.transformState;
                    const overlayData: any = {
                        layoutMode,
                        useGlobalViewport,
                        globalViewportMode,
                        currentZoom,
                        pan,
                        selectedFrames,
                        transformState: ts ? {
                            scale: ts.scale,
                            positionX: ts.positionX,
                            positionY: ts.positionY
                        } : null,
                        focus: focusDebug || null
                    };
                    return (
                        <div
                            style={{
                                position: 'absolute',
                                top: 16,
                                right: 16,
                                background: 'rgba(0,0,0,0.75)',
                                color: '#fff',
                                padding: '10px 12px',
                                borderRadius: 8,
                                fontSize: 11,
                                zIndex: 5000,
                                maxWidth: 460,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <strong>Canvas Debug</strong>
                                <span style={{ opacity: 0.8 }}>Click DBG to hide</span>
                            </div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(overlayData, null, 2)}</pre>
                        </div>
                    );
                })()
            )}

            {/* Infinite Canvas */}
            <TransformWrapper
                ref={transformRef}
                initialScale={1}
                minScale={0.1}                  // Lower min scale to prevent negative values
                maxScale={3}                    // Higher max scale for more zoom range
                limitToBounds={false}
                smooth={false}                  // Disable smooth for better performance
                disablePadding={true}           // Disable padding to prevent position jumps
                doubleClick={{
                    disabled: false,
                    mode: "zoomIn",
                    step: 50,                   // Moderate double-click zoom step
                    animationTime: 150          // Quick double-click zoom
                }}
                wheel={{
                    wheelDisabled: true,        // Disable wheel zoom
                    touchPadDisabled: false,    // Enable trackpad pan
                    step: 0.05                  // Even smaller zoom steps
                }}
                panning={{
                    disabled: dragState.isDragging,
                    velocityDisabled: true,     // Disable velocity for immediate response
                    wheelPanning: true          // Enable trackpad panning
                }}
                pinch={{
                    disabled: false,            // Keep pinch zoom enabled
                    step: 1                     // Ultra-fine pinch steps
                }}
                centerOnInit={true}
                onTransformed={(ref) => handleTransformChange(ref)}
                onZoom={(ref) => {
                    const state = ref.state;
                    
                    // Check for invalid scale and fix it
                    if (state.scale <= 0) {
                        if (DEBUG) console.error('🚨 ZOOM EVENT - Invalid scale:', state.scale, '- Fixing...');
                        ref.setTransform(state.positionX, state.positionY, 0.1);
                        return;
                    }
                    
                    if (DEBUG) console.log('📏 ZOOM EVENT:', {
                        scale: state.scale,
                        positionX: state.positionX,
                        positionY: state.positionY,
                        event: 'onZoom'
                    });
                }}
                onPanning={(ref) => {
                    if (DEBUG) console.log('👆 PAN EVENT:', {
                        scale: ref.state.scale,
                        positionX: ref.state.positionX,
                        positionY: ref.state.positionY,
                        event: 'onPanning'
                    });
                }}
                onZoomStart={(ref) => {
                    if (DEBUG) console.log('🔍 ZOOM START:', {
                        scale: ref.state.scale,
                        positionX: ref.state.positionX,
                        positionY: ref.state.positionY,
                        event: 'onZoomStart'
                    });
                }}
                onZoomStop={(ref) => {
                    if (DEBUG) console.log('🔍 ZOOM STOP:', {
                        scale: ref.state.scale,
                        positionX: ref.state.positionX,
                        positionY: ref.state.positionY,
                        event: 'onZoomStop'
                    });
                }}
            >
                <TransformComponent
                    wrapperClass="canvas-transform-wrapper"
                    contentClass="canvas-transform-content"
                >
                    <div 
                        className={`canvas-grid ${dragState.isDragging ? 'dragging' : ''}`}
                        onMouseMove={(e) => {
                            if (dragState.isDragging) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const mousePos = transformMouseToCanvasSpace(e.clientX, e.clientY, rect);
                                // Throttle drag updates via RAF
                                pendingDragPosRef.current = mousePos;
                                if (dragRafRef.current === null) {
                                    dragRafRef.current = requestAnimationFrame(() => {
                                        if (pendingDragPosRef.current) {
                                            handleDragMove(pendingDragPosRef.current);
                                        }
                                        dragRafRef.current = null;
                                    });
                                }
                            }
                        }}
                        onMouseUp={handleDragEnd}
                        onMouseLeave={handleDragEnd}
                        onClick={(e) => {
                            // Clear selection when clicking on empty space
                            if (e.target === e.currentTarget) {
                                setSelectedFrames([]);
                                
                                // Also clear context in chat
                                const clearContextMessage: WebviewMessage = {
                                    command: 'setContextFromCanvas',
                                    data: { fileName: '', type: 'clear' }
                                };
                                vscode.postMessage(clearContextMessage);
                            }
                        }}
                    >
                        {/* Connection Lines (render behind frames) */}
                        {layoutMode === 'hierarchy' && hierarchyTree && showConnections && (
                            <ConnectionLines
                                connections={hierarchyConnections}
                                containerBounds={hierarchyTree.bounds}
                                isVisible={showConnections}
                                zoomLevel={currentZoom}
                            />
                        )}
                        {/* Next-relationship arrows (rendered when viewing pages) */}
                        {distMode === 'pages' && (
                            <ConnectionLines
                                connections={nextConnections}
                                containerBounds={{ width: 10000, height: 10000 }}
                                isVisible={true}
                                zoomLevel={currentZoom}
                            />
                        )}
                        {(distMode !== 'groups' ? designFiles : (() => {
                            // Build groups from tags (union of pages/components)
                            const groups: { [tag: string]: DesignFile[] } = {};
                            for (const f of designFiles) {
                                const tagList = Array.isArray(f.tags) ? f.tags : [];
                                for (const t of tagList) {
                                    if (!groups[t]) groups[t] = [];
                                    groups[t].push(f);
                                }
                            }
                            // Flatten to an array with labeled group header items
                            const flattened: Array<{ _kind: 'group' | 'file'; _tag?: string; _file?: DesignFile }> = [];
                            const sortedTags = Object.keys(groups).sort((a, b) => a.localeCompare(b));
                            for (const tag of sortedTags) {
                                flattened.push({ _kind: 'group', _tag: tag });
                                for (const f of groups[tag]) flattened.push({ _kind: 'file', _file: f, _tag: tag });
                            }
                            // Map to pseudo design files with injected positions later
                            // We'll render headers as special frames
                            return flattened;
                        })()).map((item, index) => {
                            if (distMode === 'groups') {
                                const g = item as any;
                                if (g._kind === 'group') {
                                    // Render group label as a sticky header frame placeholder
                                    const position = getFramePosition(`__group__${g._tag}`, index);
                                    const dims = { width: 300, height: 40 };
                                    return (
                                        <div
                                            key={`group-${g._tag}-${index}`}
                                            className="group-label"
                                            style={{ position: 'absolute', left: position.x, top: position.y, width: dims.width, height: dims.height }}
                                        >
                                            <div className="group-label-badge">Group: {g._tag}</div>
                                        </div>
                                    );
                                }
                                // File within a group
                                const file = (g._file as DesignFile);
                                const isForced = forceRenderFrame === file.name;
                                const frameViewport = getFrameViewport(file.name);
                                const viewportDimensions = currentConfig.viewports[frameViewport];
                                const actualWidth = viewportDimensions.width;
                                const actualHeight = viewportDimensions.height + 50;
                                const position = getFramePosition(`${file.name}__${g._tag}`, index);
                                const finalPosition = position;
                                const frameLeft = finalPosition.x;
                                const frameTop = finalPosition.y;
                                const frameRight = frameLeft + actualWidth;
                                const frameBottom = frameTop + actualHeight;
                                const isInView = frameRight >= visibleBounds.left && frameLeft <= visibleBounds.right && frameBottom >= visibleBounds.top && frameTop <= visibleBounds.bottom;
                                const computedRenderMode = isTransformReady ? getOptimalRenderMode(currentZoom) : 'placeholder';
                                if (!isInView && computedRenderMode !== 'placeholder' && !isForced) return null;
                                return (
                                    <DesignFrame
                                        key={`${file.name}::${g._tag}`}
                                        file={file}
                                        position={finalPosition}
                                        dimensions={{ width: actualWidth, height: actualHeight }}
                                        isSelected={selectedFrames.includes(file.name)}
                                        onSelect={handleFrameSelect}
                                        renderMode={isInView ? computedRenderMode : 'placeholder'}
                                        viewport={frameViewport}
                                        viewportDimensions={viewportDimensions}
                                        onViewportChange={handleFrameViewportChange}
                                        useGlobalViewport={useGlobalViewport}
                                        onDragStart={handleDragStart}
                                        isDragging={dragState.isDragging && dragState.draggedFrame === file.name}
                                        nonce={nonce}
                                        onSendToChat={handleSendToChat}
                                        vscode={vscode}
                                        onRefresh={(filePath) => {
                                            const msg: WebviewMessage = {
                                                command: 'reloadDesignFile',
                                                data: { filePath }
                                            } as any;
                                            vscode.postMessage(msg);
                                        }}
                                    />
                                );
                            }
                            // Default pages/components rendering
                            const file = item as any as DesignFile;
                            const isForced = forceRenderFrame === file.name;
                            const frameViewport = getFrameViewport(file.name);
                            const viewportDimensions = currentConfig.viewports[frameViewport];
                            
                            // Use actual viewport dimensions (add frame border/header space)
                            const actualWidth = viewportDimensions.width;
                            const actualHeight = viewportDimensions.height + 50; // Add space for header
                            
                            // Get position (custom or default grid)
                            const position = getFramePosition(file.name, index);
                            
                            // If this frame is being dragged, use current drag position
                            const finalPosition = dragState.isDragging && dragState.draggedFrame === file.name 
                                ? dragState.currentPosition 
                                : position;
                            
                            // Viewport culling: skip render if outside visible bounds
                            const frameLeft = finalPosition.x;
                            const frameTop = finalPosition.y;
                            const frameRight = frameLeft + actualWidth;
                            const frameBottom = frameTop + actualHeight;
                            const isInView = frameRight >= visibleBounds.left && frameLeft <= visibleBounds.right && frameBottom >= visibleBounds.top && frameTop <= visibleBounds.bottom;

                            const computedRenderMode = isTransformReady ? getOptimalRenderMode(currentZoom) : 'placeholder';

                            if (!isInView && computedRenderMode !== 'placeholder' && !isForced) {
                                // If we're above LOD threshold (would iframe), but offscreen, render nothing
                                return null;
                            }

                            return (
                                <DesignFrame
                                    key={file.name}
                                    file={file}
                                    position={finalPosition}
                                    dimensions={{ width: actualWidth, height: actualHeight }}
                                    isSelected={selectedFrames.includes(file.name)}
                                    onSelect={handleFrameSelect}
                                    renderMode={isInView ? computedRenderMode : 'placeholder'}
                                    viewport={frameViewport}
                                    viewportDimensions={viewportDimensions}
                                    onViewportChange={handleFrameViewportChange}
                                    useGlobalViewport={useGlobalViewport}
                                    onDragStart={handleDragStart}
                                    isDragging={dragState.isDragging && dragState.draggedFrame === file.name}
                                    nonce={nonce}
                                    onSendToChat={handleSendToChat}
                                    vscode={vscode}
                                    onRefresh={(filePath) => {
                                        const msg: WebviewMessage = {
                                            command: 'reloadDesignFile',
                                            data: { filePath }
                                        } as any;
                                        vscode.postMessage(msg);
                                    }}
                                />
                            );
                        })}
                    </div>
                </TransformComponent>
            </TransformWrapper>
        </div>
    );
};

export default CanvasView; 