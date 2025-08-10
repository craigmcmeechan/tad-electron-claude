import React from 'react';
import { DesignFile, GridPosition, FrameDimensions, ViewportMode, WebviewMessage } from '../types/canvas.types';
import { RefreshIcon } from './Icons';
import { MobileIcon, TabletIcon, DesktopIcon, GlobeIcon } from './Icons';

    // Import logo images (handled via webview URIs in context)

interface DesignFrameProps {
    file: DesignFile;
    position: GridPosition;
    dimensions: FrameDimensions;
    isSelected: boolean;
    onSelect: (fileName: string) => void;
    renderMode?: 'placeholder' | 'iframe' | 'html';
    showMetadata?: boolean;
    viewport?: ViewportMode;
    viewportDimensions?: FrameDimensions;
    onViewportChange?: (fileName: string, viewport: ViewportMode) => void;
    useGlobalViewport?: boolean;
    onDragStart?: (fileName: string, startPos: GridPosition, mouseEvent: React.MouseEvent) => void;
    isDragging?: boolean;
    nonce?: string | null;
    onSendToChat?: (fileName: string, prompt: string) => void;
    onRefresh?: (filePath: string) => void;
    vscode?: any;
    onMountRef?: (fileName: string, el: HTMLElement | null) => void;
}

const DEBUG = false;

const DesignFrame: React.FC<DesignFrameProps> = ({
    file,
    position,
    dimensions,
    isSelected,
    onSelect,
    renderMode = 'placeholder',
    showMetadata = true,
    viewport = 'desktop',
    viewportDimensions,
    onViewportChange,
    useGlobalViewport = false,
    onDragStart,
    isDragging = false,
    nonce = null,
    onSendToChat
    , onRefresh
    , vscode
    , onMountRef
}) => {
    const [isLoading, setIsLoading] = React.useState(renderMode === 'iframe');
    const [hasError, setHasError] = React.useState(false);
    const [dragPreventOverlay, setDragPreventOverlay] = React.useState(false);
    const [showCopyDropdown, setShowCopyDropdown] = React.useState(false);
    const [copyButtonState, setCopyButtonState] = React.useState<{ text: string; isSuccess: boolean }>({ text: 'Copy prompt', isSuccess: false });
    const [copyPathButtonState, setCopyPathButtonState] = React.useState<{ text: string; isSuccess: boolean }>({ text: 'Copy design path', isSuccess: false });

    const handleClick = () => {
        onSelect(file.name);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (onDragStart && e.button === 0) { // Left mouse button only
            e.preventDefault();
            e.stopPropagation();
            
            // Show overlay to prevent iframe interaction during potential drag
            setDragPreventOverlay(true);
            
            onDragStart(file.name, position, e);
        }
    };

    const handleRefresh = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (onRefresh) {
            onRefresh(file.path);
        }
    };

    // Clear drag prevention overlay when dragging ends
    React.useEffect(() => {
        if (!isDragging) {
            setDragPreventOverlay(false);
        }
    }, [isDragging]);

    // Close dropdowns when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (showCopyDropdown) {
                const el = target.closest('.copy-prompt-dropdown');
                if (!el) setShowCopyDropdown(false);
            }
        };
        if (showCopyDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showCopyDropdown]);

    const handleViewportToggle = (newViewport: ViewportMode) => {
        if (onViewportChange && !useGlobalViewport) {
            onViewportChange(file.name, newViewport);
        }
    };

    const handleCopyPrompt = async (e: React.MouseEvent, platform?: string) => {
        e.preventDefault();
        e.stopPropagation();
        
        let promptText = '';
        let platformName = '';
        
        switch (platform) {
            case 'cursor':
                promptText = `${file.content}\n\nAbove is the design implementation, please use that as a reference to build a similar UI component. Make sure to follow modern React and TypeScript best practices.`;
                platformName = 'Cursor';
                break;
            case 'windsurf':
                promptText = `${file.content}\n\nAbove is the design implementation. Please analyze this design and create a similar UI component using modern web technologies and best practices.`;
                platformName = 'Windsurf';
                break;
            case 'lovable':
                promptText = `${file.content}\n\nAbove is the design implementation. Please recreate this design as a responsive React component with modern styling.`;
                platformName = 'Lovable';
                break;
            case 'bolt':
                promptText = `${file.content}\n\nAbove is the design implementation. Please create a similar UI using this as reference. Make it production-ready with proper styling.`;
                platformName = 'Bolt';
                break;
            default:
                promptText = `${file.content}\n\nAbove is the design implementation, please use that as a reference`;
                platformName = '';
        }
        
        try {
            await navigator.clipboard.writeText(promptText);
            if (DEBUG) console.log(`✅ Copied ${platformName} prompt to clipboard for:`, file.name);
            
            // Show success state on button
            setCopyButtonState({ text: `Copied for ${platformName}!`, isSuccess: true });
            setTimeout(() => {
                setCopyButtonState({ text: 'Copy prompt', isSuccess: false });
            }, 2000);
            
            // Hide dropdown
            setShowCopyDropdown(false);
        } catch (err) {
            if (DEBUG) console.error('❌ Failed to copy to clipboard:', err);
            
            // Fallback: create a temporary textarea and copy
            const textarea = document.createElement('textarea');
            textarea.value = promptText;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            
            if (DEBUG) console.log(`✅ Copied ${platformName} prompt using fallback method for:`, file.name);
            
            // Show success state on button
            setCopyButtonState({ text: `Copied for ${platformName}!`, isSuccess: true });
            setTimeout(() => {
                setCopyButtonState({ text: 'Copy prompt', isSuccess: false });
            }, 2000);
            
            // Hide dropdown
            setShowCopyDropdown(false);
        }
    };

    const handleCopyDropdownToggle = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (DEBUG) console.log('Dropdown toggle clicked. Current context:', (window as any).__WEBVIEW_CONTEXT__);
        if (DEBUG) console.log('Logo URIs available:', (window as any).__WEBVIEW_CONTEXT__?.logoUris);
        setShowCopyDropdown(!showCopyDropdown);
    };

    const handleCopyDesignPath = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const designPath = `Design file: ${file.path}`;
        
        try {
            await navigator.clipboard.writeText(designPath);
            if (DEBUG) console.log(`✅ Copied design path to clipboard:`, designPath);
            
            // Show success state on button
            setCopyPathButtonState({ text: 'Copied!', isSuccess: true });
            setTimeout(() => {
                setCopyPathButtonState({ text: 'Copy design path', isSuccess: false });
            }, 2000);
            
        } catch (err) {
            if (DEBUG) console.error('❌ Failed to copy design path to clipboard:', err);
            
            // Fallback: create a temporary textarea and copy
            const textarea = document.createElement('textarea');
            textarea.value = designPath;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            
            if (DEBUG) console.log(`✅ Copied design path using fallback method:`, designPath);
            
            // Show success state on button
            setCopyPathButtonState({ text: 'Copied!', isSuccess: true });
            setTimeout(() => {
                setCopyPathButtonState({ text: 'Copy design path', isSuccess: false });
            }, 2000);
        }
    };

    const handleCreateVariations = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (onSendToChat) {
            onSendToChat(file.name, 'Create more variations based on this style');
        }
    };

    const handleIterateWithFeedback = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (onSendToChat) {
            onSendToChat(file.name, 'Please create a few variations with this feedback: ');
        }
    };

    const getViewportIcon = (mode: ViewportMode): React.ReactElement => {
        switch (mode) {
            case 'mobile': return <MobileIcon />;
            case 'tablet': return <TabletIcon />;
            case 'desktop': return <DesktopIcon />;
            default: return <DesktopIcon />;
        }
    };

    const getViewportLabel = (mode: ViewportMode): string => {
        switch (mode) {
            case 'mobile': return 'Mobile';
            case 'tablet': return 'Tablet';
            case 'desktop': return 'Desktop';
            default: return 'Desktop';
        }
    };

    const renderContent = () => {
        switch (renderMode) {
            case 'iframe':
                // Handle SVG files differently than HTML files
                if (file.fileType === 'svg') {
                    // For SVG files, wrap in HTML with proper viewport
                    const svgHtml = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            ${viewportDimensions ? `<meta name="viewport" content="width=${viewportDimensions.width}, height=${viewportDimensions.height}, initial-scale=1.0">` : ''}
                            <style>
                                body { 
                                    margin: 0; 
                                    padding: 20px; 
                                    display: flex; 
                                    align-items: center; 
                                    justify-content: center; 
                                    min-height: 100vh; 
                                    background: white;
                                    box-sizing: border-box;
                                }
                                svg { 
                                    max-width: 100%; 
                                    max-height: 100%; 
                                    height: auto; 
                                    width: auto;
                                }
                                img {
                                    max-width: 100%;
                                    height: auto;
                                }
                            </style>
                        </head>
                        <body>
                            ${file.content}
                            <script>
                                // Auto-render images in SVG context
                                document.addEventListener('DOMContentLoaded', function() {
                                    const images = document.querySelectorAll('img');
                                    images.forEach(function(img) {
                                        img.loading = 'eager';
                                        if (!img.complete || img.naturalWidth === 0) {
                                            const originalSrc = img.src;
                                            img.src = '';
                                            img.src = originalSrc;
                                        }
                                    });
                                });
                            </script>
                        </body>
                        </html>
                    `;
                    
                    return (
                        <iframe
                            srcDoc={svgHtml}
                            title={`${file.name} - SVG`}
                            style={{
                                width: viewportDimensions ? `${viewportDimensions.width}px` : '100%',
                                height: viewportDimensions ? `${viewportDimensions.height}px` : '100%',
                                border: 'none',
                                background: 'white',
                                borderRadius: '0 0 6px 6px',
                                pointerEvents: (isSelected && !dragPreventOverlay && !isDragging) ? 'auto' : 'none'
                            }}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            onLoad={() => {
                                setIsLoading(false);
                                setHasError(false);
                                if (DEBUG) console.log(`SVG Frame loaded: ${file.name}`);
                            }}
                            onError={(e) => {
                                setIsLoading(false);
                                setHasError(true);
                                if (DEBUG) console.error(`SVG Frame error for ${file.name}:`, e);
                            }}
                        />
                    );
                }

                // HTML file handling (existing logic)
                // Function to inject nonce into script tags
                const injectNonce = (html: string, nonce: string | null) => {
                    if (!nonce) return html;
                    return html.replace(/<script/g, `<script nonce="${nonce}"`);
                };
                // Inject viewport meta tag if we have viewport dimensions
                let modifiedContent = file.content;
                if (viewportDimensions) {
                    const viewportMeta = `<meta name="viewport" content="width=${viewportDimensions.width}, height=${viewportDimensions.height}, initial-scale=1.0">`;
                    if (modifiedContent.includes('<head>')) {
                        modifiedContent = modifiedContent.replace('<head>', `<head>\n${viewportMeta}`);
                    } else if (modifiedContent.includes('<html>')) {
                        modifiedContent = modifiedContent.replace('<html>', `<html><head>\n${viewportMeta}\n</head>`);
                    } else {
                        modifiedContent = `<head>\n${viewportMeta}\n</head>\n${modifiedContent}`;
                    }
                } else {
                    // No viewport to inject; leave content unchanged
                }

                // Inject nonce into all script tags
                modifiedContent = injectNonce(modifiedContent, nonce);

                return (
                    <iframe
                        srcDoc={modifiedContent}
                        title={`${file.name} - ${getViewportLabel(viewport)}`}
                        style={{
                            width: viewportDimensions ? `${viewportDimensions.width}px` : '100%',
                            height: viewportDimensions ? `${viewportDimensions.height}px` : '100%',
                            border: 'none',
                            background: 'white',
                            borderRadius: '0 0 6px 6px',
                            pointerEvents: (isSelected && !dragPreventOverlay && !isDragging) ? 'auto' : 'none'
                        }}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onLoad={() => {
                            setIsLoading(false);
                            setHasError(false);
                            if (DEBUG) console.log(`Frame loaded: ${file.name} (${viewport})`);
                        }}
                        onError={(e) => {
                            setIsLoading(false);
                            setHasError(true);
                            if (DEBUG) console.error(`Frame error for ${file.name}:`, e);
                        }}
                    />
                );

            case 'html':
                // Direct HTML/SVG rendering - USE WITH CAUTION (security risk)
                // Only use for trusted content or when iframe fails
                if (file.fileType === 'svg') {
                    return (
                        <div
                            style={{
                                width: '100%',
                                height: '100%',
                                overflow: 'hidden',
                                background: 'white',
                                border: '1px solid var(--vscode-errorForeground)',
                                borderRadius: '0 0 6px 6px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '20px',
                                boxSizing: 'border-box'
                            }}
                            title="⚠️ Direct SVG rendering - potential security risk"
                            dangerouslySetInnerHTML={{ __html: file.content }}
                        />
                    );
                }
                
                return (
                    <div
                        dangerouslySetInnerHTML={{ __html: file.content }}
                        style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden',
                            background: 'white',
                            border: '1px solid var(--vscode-errorForeground)',
                            borderRadius: '0 0 6px 6px'
                        }}
                        title="⚠️ Direct HTML rendering - potential security risk"
                    />
                );

            case 'placeholder':
            default:
                const placeholderIcon = file.fileType === 'svg' ? '🎨' : '🌐';
                const placeholderHint = file.fileType === 'svg' ? 'SVG Vector Graphics' : 'HTML Design';
                
                return (
                    <div className="frame-placeholder">
                        <div className="placeholder-icon">{placeholderIcon}</div>
                        <p className="placeholder-name">{file.name}</p>
                        <div className="placeholder-meta">
                            <span>{(file.size / 1024).toFixed(1)} KB</span>
                            <span>{file.modified.toLocaleDateString()}</span>
                            <span className="file-type">{file.fileType.toUpperCase()}</span>
                        </div>
                        {renderMode === 'placeholder' && (
                            <small className="placeholder-hint">{placeholderHint} - Zoom in to load</small>
                        )}
                    </div>
                );
        }
    };

    return (
        <div
            className={`design-frame ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            data-frame-name={file.name}
            style={{
                position: 'absolute',
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${dimensions.width}px`,
                height: `${dimensions.height}px`,
                cursor: isDragging ? 'grabbing' : 'grab',
                zIndex: isDragging ? 1000 : (isSelected ? 10 : 1),
                opacity: isDragging ? 0.8 : 1
            }}
            ref={(el) => onMountRef?.(file.name, el)}
            onClick={handleClick}
            title={`${file.name} (${(file.size / 1024).toFixed(1)} KB)`}
            onMouseDown={handleMouseDown}
        >
            <div className="frame-header">
                <span className="frame-title">{file.name}</span>
                <button
                    className="frame-refresh-btn"
                    title="Refresh from source"
                    onClick={handleRefresh}
                >
                    <RefreshIcon />
                </button>
                
                {/* Viewport Controls */}
                {onViewportChange && !useGlobalViewport && (
                    <div className="frame-viewport-controls">
                        <button
                            className={`frame-viewport-btn ${viewport === 'mobile' ? 'active' : ''}`}
                            onClick={() => handleViewportToggle('mobile')}
                            title="Mobile View"
                        >
                            <MobileIcon />
                        </button>
                        <button
                            className={`frame-viewport-btn ${viewport === 'tablet' ? 'active' : ''}`}
                            onClick={() => handleViewportToggle('tablet')}
                            title="Tablet View"
                        >
                            <TabletIcon />
                        </button>
                        <button
                            className={`frame-viewport-btn ${viewport === 'desktop' ? 'active' : ''}`}
                            onClick={() => handleViewportToggle('desktop')}
                            title="Desktop View"
                        >
                            <DesktopIcon />
                        </button>
                    </div>
                )}
                
                {/* Global viewport indicator */}
                {useGlobalViewport && (
                    <div className="frame-viewport-indicator">
                        <span className="global-indicator"><GlobeIcon /></span>
                        <span className="viewport-icon">{getViewportIcon(viewport)}</span>
                    </div>
                )}
                
                {showMetadata && (
                    <div className="frame-meta">
                        {isLoading && <span className="frame-status loading">●</span>}
                        {hasError && <span className="frame-status error">●</span>}
                        {!isLoading && !hasError && renderMode === 'iframe' && (
                            <span className="frame-status loaded">●</span>
                        )}
                    </div>
                )}
            </div>
            <div className="frame-content">
                {renderContent()}
                {/* Tags badges */}
                {Array.isArray(file.tags) && file.tags.length > 0 && (
                    <div className="frame-tags" onClick={(e) => e.stopPropagation()}>
                        {file.tags.map((tag, idx) => (
                            <span key={`tag-${idx}-${tag}`} className="frame-tag-badge">{tag}</span>
                        ))}
                    </div>
                )}
                {/* Templates dropdown (if template metadata exists) */}
                {file.templates && (file.templates.page || (file.templates.components && file.templates.components.length) || (file.templates.elements && file.templates.elements.length)) && (
                    <div className="frame-templates">
                        <details>
                            <summary>Templates</summary>
                            <div className="templates-list">
                                {file.templates.page && (
                                    <button
                                        className="template-link"
                                        title={file.templates.page.path || ''}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const target = file.templates?.page?.path;
                                            if (target && vscode) {
                                                vscode.postMessage({ command: 'openTemplateFile', data: { filePath: target } });
                                            }
                                        }}
                                    >
                                        Page: {file.templates.page.name}
                                    </button>
                                )}
                                {(file.templates.components || []).map((c, idx) => (
                                    <button
                                        key={`comp-${idx}-${c.name}`}
                                        className="template-link"
                                        title={c.path || ''}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (c.path && vscode) {
                                                vscode.postMessage({ command: 'openTemplateFile', data: { filePath: c.path } });
                                            }
                                        }}
                                    >
                                        Component: {c.name}
                                    </button>
                                ))}
                                {(file.templates.elements || []).map((el, idx) => (
                                    <button
                                        key={`el-${idx}-${el.name}`}
                                        className="template-link"
                                        title={el.path || ''}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (el.path && vscode) {
                                                vscode.postMessage({ command: 'openTemplateFile', data: { filePath: el.path } });
                                            }
                                        }}
                                    >
                                        Element: {el.name}
                                    </button>
                                ))}
                            </div>
                        </details>
                    </div>
                )}
                {/* Relationships dropdown (grouped) */}
                {(() => {
                    const rel = file.relationships || {};
                    const children = Array.isArray(file.relationships?.children)
                        ? file.relationships!.children!
                        : (Array.isArray(file.children) ? file.children : []);
                    const groups: Array<{ label: string; items: string[] }> = [
                        { label: 'Next', items: Array.isArray(rel.next) ? rel.next : [] },
                        { label: 'Prev', items: Array.isArray(rel.prev) ? rel.prev : [] },
                        { label: 'Parent', items: Array.isArray(rel.parent) ? rel.parent : [] },
                        { label: 'Children', items: Array.isArray(children) ? children : [] },
                        { label: 'Related', items: Array.isArray(rel.related) ? rel.related : [] },
                    ];
                    const hasAny = groups.some(g => g.items.length > 0);
                    if (!hasAny) return null;
                    return (
                        <div className="frame-relationships">
                            <details>
                                <summary>Relationships</summary>
                                <div className="relationships-list">
                                    {groups.map(group => (
                                        group.items.length > 0 ? (
                                            <div className="relationships-group" key={`rel-group-${group.label}`}>
                                                <div className="relationships-heading">{group.label}</div>
                                                {group.items.map((relItem, idx) => (
                                                    <button
                                                        key={`rel-${group.label}-${idx}-${relItem}`}
                                                        className="relationship-link"
                                                        title={relItem}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            window.postMessage({ __canvasNavigateTo__: relItem }, '*');
                                                        }}
                                                    >
                                                        {relItem}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null
                                    ))}
                                </div>
                            </details>
                        </div>
                    );
                })()}
                
                {/* Drag prevention overlay - prevents iframe interaction during drag */}
                {(dragPreventOverlay || isDragging) && isSelected && renderMode === 'iframe' && (
                    <div className="frame-drag-overlay">
                        {dragPreventOverlay && !isDragging && (
                            <div className="drag-ready-hint">
                                <span>✋</span>
                                <p>Ready to drag</p>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Loading overlay for iframe */}
                {isLoading && renderMode === 'iframe' && (
                    <div className="frame-loading-overlay">
                        <div className="frame-loading-spinner">
                            <div className="spinner-small"></div>
                            <span>Loading...</span>
                        </div>
                    </div>
                )}
                
                {/* Error overlay */}
                {hasError && (
                    <div className="frame-error-overlay">
                        <div className="frame-error-content">
                            <span>⚠️</span>
                            <p>Failed to load</p>
                            <small>{file.name}</small>
                        </div>
                    </div>
                )}
                
            </div>
            
            {/* Floating Action Buttons - Outside frame, top-right corner */}
            {isSelected && !isDragging && (
                <div 
                    className="floating-action-buttons"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button
                        className="floating-action-btn"
                        onClick={handleCreateVariations}
                        title="Create more variations based on this style"
                    >
                        <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="6" cy="6" r="3"/>
                            <circle cx="18" cy="18" r="3"/>
                            <circle cx="18" cy="6" r="3"/>
                            <path d="M18 9v6"/>
                            <path d="M9 6h6"/>
                        </svg>
                        <span className="btn-text">Create variations</span>
                    </button>
                    <button
                        className="floating-action-btn"
                        onClick={handleIterateWithFeedback}
                        title="Create variations with feedback"
                    >
                        <svg className="btn-icon" viewBox="0 0 24 24" fill="none">
                            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C15.73 20 18.84 17.45 19.73 14H17.65C16.83 16.33 14.61 18 12 18C8.69 18 6 15.31 6 12C6 8.69 8.69 6 12 6C13.66 6 15.14 6.69 16.22 7.78L13 11H20V4L17.65 6.35Z" fill="currentColor"/>
                        </svg>
                        <span className="btn-text">Iterate with feedback</span>
                    </button>
                    
                    {/* Copy Prompt Dropdown */}
                    <div className="copy-prompt-dropdown">
                        <button
                            className={`floating-action-btn copy-prompt-main-btn ${copyButtonState.isSuccess ? 'success' : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (DEBUG) console.log('Dropdown toggle clicked. Current context:', (window as any).__WEBVIEW_CONTEXT__);
                                if (DEBUG) console.log('Logo URIs available:', (window as any).__WEBVIEW_CONTEXT__?.logoUris);
                                setShowCopyDropdown(!showCopyDropdown);
                            }}
                            title="Copy file content with reference prompt"
                        >
                            <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                                <path d="M20 3v4"/>
                                <path d="M22 5h-4"/>
                                <path d="M4 17v2"/>
                                <path d="M5 18H3"/>
                            </svg>
                            <span className="btn-text">{copyButtonState.text}</span>
                            <svg className="dropdown-arrow" viewBox="0 0 24 24" fill="none">
                                <path d="M7 10L12 15L17 10H7Z" fill="currentColor"/>
                            </svg>
                        </button>
                        
                        {showCopyDropdown && (
                            <div className="copy-dropdown-menu">
                                <button
                                    className="copy-dropdown-item"
                                    onClick={(e) => handleCopyPrompt(e, 'cursor')}
                                >
                                    <img
                                        src={(window as any).__WEBVIEW_CONTEXT__?.logoUris?.cursor} 
                                        alt="Cursor" 
                                        className="platform-logo"
                                        onError={(e) => {
                                            if (DEBUG) console.error('Failed to load Cursor logo:', (window as any).__WEBVIEW_CONTEXT__?.logoUris?.cursor);
                                            if (DEBUG) console.error('Image error event:', e);
                                        }}
                                        onLoad={() => DEBUG && console.log('Cursor logo loaded successfully')}
                                    />
                                    <span>Cursor</span>
                                </button>
                                <button
                                    className="copy-dropdown-item"
                                    onClick={(e) => handleCopyPrompt(e, 'windsurf')}
                                >
                                    <img
                                        src={(window as any).__WEBVIEW_CONTEXT__?.logoUris?.windsurf} 
                                        alt="Windsurf" 
                                        className="platform-logo"
                                        onError={(e) => {
                                            if (DEBUG) console.error('Failed to load Windsurf logo:', (window as any).__WEBVIEW_CONTEXT__?.logoUris?.windsurf);
                                            if (DEBUG) console.error('Image error event:', e);
                                        }}
                                        onLoad={() => DEBUG && console.log('Windsurf logo loaded successfully')}
                                    />
                                    <span>Windsurf</span>
                                </button>
                                <button
                                    className="copy-dropdown-item"
                                    onClick={(e) => handleCopyPrompt(e, 'lovable')}
                                >
                                    <img
                                        src={(window as any).__WEBVIEW_CONTEXT__?.logoUris?.lovable} 
                                        alt="Lovable" 
                                        className="platform-logo"
                                        onError={(e) => {
                                            if (DEBUG) console.error('Failed to load Lovable logo:', (window as any).__WEBVIEW_CONTEXT__?.logoUris?.lovable);
                                            if (DEBUG) console.error('Image error event:', e);
                                        }}
                                        onLoad={() => DEBUG && console.log('Lovable logo loaded successfully')}
                                    />
                                    <span>Lovable</span>
                                </button>
                                <button
                                    className="copy-dropdown-item"
                                    onClick={(e) => handleCopyPrompt(e, 'bolt')}
                                >
                                    <img
                                        src={(window as any).__WEBVIEW_CONTEXT__?.logoUris?.bolt} 
                                        alt="Bolt" 
                                        className="platform-logo"
                                        onError={(e) => {
                                            if (DEBUG) console.error('Failed to load Bolt logo:', (window as any).__WEBVIEW_CONTEXT__?.logoUris?.bolt);
                                            if (DEBUG) console.error('Image error event:', e);
                                        }}
                                        onLoad={() => DEBUG && console.log('Bolt logo loaded successfully')}
                                    />
                                    <span>Bolt</span>
                                </button>
                            </div>
                        )}
                    </div>
                    
                    {/* Copy Design Path Button */}
                    <button
                        className={`floating-action-btn copy-path-btn ${copyPathButtonState.isSuccess ? 'success' : ''}`}
                        onClick={handleCopyDesignPath}
                        title="Copy absolute path of design file"
                    >
                        <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                        <span className="btn-text">{copyPathButtonState.text}</span>
                    </button>
                </div>
            )}

        </div>
    );
};

function areDesignFramePropsEqual(prev: Readonly<React.ComponentProps<typeof DesignFrame>>, next: Readonly<React.ComponentProps<typeof DesignFrame>>): boolean {
    // Compare props that affect rendering/positioning
    if (prev.isSelected !== next.isSelected) return false;
    if (prev.isDragging !== next.isDragging) return false;
    if (prev.renderMode !== next.renderMode) return false;
    if (prev.useGlobalViewport !== next.useGlobalViewport) return false;
    if (prev.viewport !== next.viewport) return false;
    if (prev.dimensions.width !== next.dimensions.width || prev.dimensions.height !== next.dimensions.height) return false;
    if (prev.position.x !== next.position.x || prev.position.y !== next.position.y) return false;
    // File identity changes
    if (prev.file.name !== next.file.name) return false;
    if (prev.file.path !== next.file.path) return false;
    if (prev.file.fileType !== next.file.fileType) return false;
    // Shallow check viewportDimensions
    if (!!prev.viewportDimensions !== !!next.viewportDimensions) return false;
    if (prev.viewportDimensions && next.viewportDimensions) {
        if (prev.viewportDimensions.width !== next.viewportDimensions.width || prev.viewportDimensions.height !== next.viewportDimensions.height) return false;
    }
    return true;
}

export default React.memo(DesignFrame, areDesignFramePropsEqual);