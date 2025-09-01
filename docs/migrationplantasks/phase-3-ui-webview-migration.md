# Phase 3: UI and Webview Migration (Weeks 6-8)

## Overview

Phase 3 focuses on migrating the user interface components from the VS Code extension to the Electron application. This includes creating the main application UI, implementing the canvas component, migrating the chat interface, and establishing the visual design that users will interact with.

## Objectives

- Create the main application interface with sidebar and canvas areas
- Migrate the CanvasView component with all its functionality
- Implement the chat interface with AI integration
- Establish responsive design and modern UI patterns
- Ensure seamless integration between all UI components

## Timeline
**Duration:** 3 weeks (Weeks 6-8)
**Team:** Frontend Developer (lead), Lead Developer, UI/UX Designer
**Dependencies:** Phase 2 completion

## Detailed Task Breakdown

### 3.1 Main Application UI
**Priority:** High
**Effort:** 3-4 days
**Owner:** Frontend Developer

#### Tasks:
- [ ] Create main application HTML structure and CSS framework
- [ ] Implement sidebar chat interface container
- [ ] Create canvas panel container with proper layout
- [ ] Setup main application navigation and menu integration
- [ ] Implement responsive design for different screen sizes
- [ ] Create loading states and error boundaries
- [ ] Setup global UI state management

#### Deliverables:
- [ ] `src/renderer/index.html` - Main application HTML
- [ ] `src/renderer/styles/main.css` - Global styles and layout
- [ ] `src/renderer/components/App.js` - Main application component
- [ ] `src/renderer/components/Layout.js` - Layout management
- [ ] `src/renderer/components/Sidebar.js` - Sidebar container
- [ ] `src/renderer/components/CanvasPanel.js` - Canvas container

#### Success Criteria:
- [ ] Main UI displays correctly with proper layout
- [ ] Sidebar and canvas areas are properly sized and positioned
- [ ] Responsive design works on different screen sizes
- [ ] Loading states provide clear user feedback
- [ ] Error boundaries catch and display errors gracefully

#### Technical Implementation:

**Main Application Structure:**
```html
<!-- src/renderer/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TAD - Template-Assisted Design</title>
    <link rel="stylesheet" href="styles/main.css">
</head>
<body>
    <div id="app">
        <!-- Application content will be rendered here by React -->
    </div>
    <script src="js/app.js"></script>
</body>
</html>
```

**Main Application Component:**
```javascript
// src/renderer/components/App.js
import React, { useState, useEffect } from 'react';
import Layout from './Layout';
import Sidebar from './Sidebar';
import CanvasPanel from './CanvasPanel';
import ErrorBoundary from './ErrorBoundary';
import LoadingScreen from './LoadingScreen';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Get app info
      const appInfo = await window.tadAPI.getAppInfo();

      // Check for existing workspace
      const workspaceInfo = await window.tadAPI.getWorkspaceInfo();

      if (workspaceInfo.path) {
        setWorkspace(workspaceInfo);
      }

      setIsLoading(false);
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (error) {
    return <ErrorBoundary error={error} />;
  }

  return (
    <ErrorBoundary>
      <Layout>
        <Sidebar workspace={workspace} />
        <CanvasPanel workspace={workspace} />
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
```

**Layout Component:**
```javascript
// src/renderer/components/Layout.js
import React, { useState } from 'react';
import './Layout.css';

function Layout({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className={`layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="header">
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <h1 className="app-title">TAD - Template-Assisted Design</h1>
        <div className="header-actions">
          {/* Header actions will be added here */}
        </div>
      </header>

      <div className="main-content">
        {React.Children.map(children, (child, index) => {
          if (index === 0) { // Sidebar
            return React.cloneElement(child, {
              collapsed: sidebarCollapsed,
              onToggle: toggleSidebar
            });
          }
          return child;
        })}
      </div>
    </div>
  );
}

export default Layout;
```

### 3.2 Canvas Component Migration
**Priority:** High
**Effort:** 5-7 days
**Owner:** Frontend Developer

#### Tasks:
- [ ] Migrate CanvasView React component from VS Code extension
- [ ] Implement zoom and pan functionality with transform handling
- [ ] Create design frame rendering with iframe and placeholder modes
- [ ] Setup connection lines and relationship visualization
- [ ] Implement drag-and-drop functionality with snap-to-grid
- [ ] Create viewport controls and responsive design modes
- [ ] Integrate with workspace file system for template loading

#### Deliverables:
- [ ] `src/renderer/components/CanvasView.js` - Main canvas component
- [ ] `src/renderer/components/DesignFrame.js` - Individual frame component
- [ ] `src/renderer/components/ConnectionLines.js` - Relationship visualization
- [ ] `src/renderer/components/ViewportControls.js` - Zoom and pan controls
- [ ] `src/renderer/utils/canvasUtils.js` - Canvas utility functions
- [ ] Canvas state management and persistence

#### Success Criteria:
- [ ] Canvas displays design frames correctly
- [ ] Zoom and pan functionality works smoothly
- [ ] Frame selection and interaction is responsive
- [ ] Relationship visualization shows connections properly
- [ ] Drag-and-drop repositioning works with grid snapping
- [ ] Viewport controls provide intuitive navigation

#### Technical Implementation:

**CanvasView Component:**
```javascript
// src/renderer/components/CanvasView.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import DesignFrame from './DesignFrame';
import ConnectionLines from './ConnectionLines';
import ViewportControls from './ViewportControls';
import './CanvasView.css';

function CanvasView({ workspace }) {
  const [designFiles, setDesignFiles] = useState([]);
  const [selectedFrames, setSelectedFrames] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [connections, setConnections] = useState([]);

  const transformRef = useRef();

  useEffect(() => {
    if (workspace) {
      loadDesignFiles();
    }
  }, [workspace]);

  const loadDesignFiles = async () => {
    setIsLoading(true);
    try {
      const files = await window.tadAPI.loadDesignFiles({
        workspace: workspace.path,
        kind: 'pages' // or 'components', 'groups'
      });
      setDesignFiles(files);
      setConnections(calculateConnections(files));
    } catch (error) {
      console.error('Failed to load design files:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateConnections = (files) => {
    // Calculate connection lines based on file relationships
    // This would implement the relationship visualization logic
    return [];
  };

  const handleFrameSelect = useCallback((frameId, multiSelect = false) => {
    setSelectedFrames(prev => {
      if (multiSelect) {
        return prev.includes(frameId)
          ? prev.filter(id => id !== frameId)
          : [...prev, frameId];
      }
      return [frameId];
    });
  }, []);

  const handleTransformChange = useCallback((newTransform) => {
    setTransform(newTransform);
  }, []);

  const handleFrameDrag = useCallback((frameId, newPosition) => {
    // Update frame position in state and persist
    setDesignFiles(prev => prev.map(frame =>
      frame.id === frameId
        ? { ...frame, position: newPosition }
        : frame
    ));

    // Persist to backend
    window.tadAPI.saveFramePosition(frameId, newPosition);
  }, []);

  if (isLoading) {
    return <div className="canvas-loading">Loading design files...</div>;
  }

  return (
    <div className="canvas-view">
      <ViewportControls
        transform={transform}
        onTransformChange={setTransform}
        transformRef={transformRef}
      />

      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.1}
        maxScale={3}
        limitToBounds={false}
        onTransformed={handleTransformChange}
        panning={{ disabled: false }}
        pinch={{ disabled: false }}
        wheel={{ disabled: false }}
      >
        <TransformComponent>
          <div className="canvas-content">
            <ConnectionLines connections={connections} />

            {designFiles.map(frame => (
              <DesignFrame
                key={frame.id}
                frame={frame}
                isSelected={selectedFrames.includes(frame.id)}
                onSelect={handleFrameSelect}
                onDrag={handleFrameDrag}
                transform={transform}
              />
            ))}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

export default CanvasView;
```

**DesignFrame Component:**
```javascript
// src/renderer/components/DesignFrame.js
import React, { useState, useRef, useCallback } from 'react';
import './DesignFrame.css';

function DesignFrame({ frame, isSelected, onSelect, onDrag, transform }) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef();

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return; // Only left mouse button

    const rect = frameRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    setIsDragging(true);

    // Add global mouse event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;

    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;

    // Snap to grid (25px)
    const snappedX = Math.round(newX / 25) * 25;
    const snappedY = Math.round(newY / 25) * 25;

    onDrag(frame.id, { x: snappedX, y: snappedY });
  }, [isDragging, dragOffset, frame.id, onDrag]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleClick = useCallback((e) => {
    if (!isDragging) {
      onSelect(frame.id, e.ctrlKey || e.metaKey);
    }
  }, [frame.id, onSelect, isDragging]);

  return (
    <div
      ref={frameRef}
      className={`design-frame ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        left: frame.position.x,
        top: frame.position.y,
        width: frame.dimensions.width,
        height: frame.dimensions.height
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className="frame-header">
        <h3 className="frame-title">{frame.name}</h3>
        <div className="frame-controls">
          <button onClick={() => window.tadAPI.openTemplate(frame.path)}>
            Open
          </button>
        </div>
      </div>

      <div className="frame-content">
        {frame.type === 'iframe' ? (
          <iframe
            src={frame.url}
            width="100%"
            height="100%"
            frameBorder="0"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="frame-placeholder">
            <div className="placeholder-content">
              <h4>{frame.name}</h4>
              <p>{frame.description}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DesignFrame;
```

### 3.2 Chat Interface Migration
**Priority:** Medium
**Effort:** 3-4 days
**Owner:** Frontend Developer

#### Tasks:
- [ ] Migrate chat React components from VS Code extension
- [ ] Implement message streaming with real-time updates
- [ ] Create chat history management and persistence
- [ ] Setup AI provider selection and configuration
- [ ] Implement chat error handling and retry logic
- [ ] Create chat UI with modern design patterns

#### Deliverables:
- [ ] `src/renderer/components/ChatInterface.js` - Main chat component
- [ ] `src/renderer/components/ChatMessage.js` - Individual message component
- [ ] `src/renderer/components/ProviderSelector.js` - AI provider selection
- [ ] Chat state management and persistence
- [ ] Message streaming implementation

#### Success Criteria:
- [ ] Chat interface displays correctly with modern UI
- [ ] Message sending and receiving works smoothly
- [ ] AI provider switching is seamless
- [ ] Chat history persists between sessions
- [ ] Error handling provides clear user feedback

## Quality Assurance

### Testing Requirements:
- [ ] Unit tests for all React components
- [ ] Integration tests for component interactions
- [ ] UI tests for responsive design
- [ ] Performance tests for canvas rendering
- [ ] Accessibility tests for keyboard navigation

### Code Quality:
- [ ] React best practices and hooks usage
- [ ] CSS modules or styled-components for styling
- [ ] Error boundaries for component isolation
- [ ] Performance optimization with React.memo
- [ ] TypeScript integration for type safety

## Risks and Mitigations

### Technical Risks:
- **Canvas Performance:** Complex rendering with many frames
  - *Mitigation:* Virtualization, level-of-detail rendering, performance monitoring
- **React Integration:** Differences from VS Code webview environment
  - *Mitigation:* Thorough testing, gradual migration, fallback components
- **Styling Challenges:** Consistent design across platforms
  - *Mitigation:* CSS custom properties, platform-specific stylesheets

### Schedule Risks:
- **UI Complexity:** Multiple interconnected components
  - *Mitigation:* Component-driven development, regular integration testing
- **Design Iterations:** UI/UX refinements and changes
  - *Mitigation:* Early user testing, iterative design process

## Success Criteria

### Functional Requirements:
- [ ] Main application UI displays correctly with all components
- [ ] Canvas component renders frames with full functionality
- [ ] Chat interface provides complete AI interaction experience
- [ ] All UI components are responsive and accessible
- [ ] Error states are handled gracefully with user feedback

### Quality Requirements:
- [ ] UI follows modern design principles and accessibility standards
- [ ] Performance meets targets for smooth interactions
- [ ] Cross-platform consistency in appearance and behavior
- [ ] Code is maintainable and well-documented

### User Experience Requirements:
- [ ] Intuitive navigation between different views
- [ ] Clear visual feedback for all user actions
- [ ] Consistent interaction patterns throughout the application
- [ ] Loading states and error messages are informative

## Deliverables Summary

### Core UI Components:
- [ ] Main application layout with sidebar and canvas
- [ ] CanvasView with zoom, pan, and frame management
- [ ] DesignFrame with iframe rendering and interactions
- [ ] ChatInterface with streaming and provider management
- [ ] Connection visualization for template relationships

### Supporting Components:
- [ ] ViewportControls for navigation
- [ ] Error boundaries and loading states
- [ ] Responsive design utilities
- [ ] Theme and styling system

### Integration:
- [ ] IPC communication with main process
- [ ] Workspace integration for file operations
- [ ] Build system integration for template updates
- [ ] Configuration system for UI preferences

## Phase 3 Checklist

### Pre-Phase Preparation:
- [ ] Phase 2 deliverables reviewed and approved
- [ ] UI design mockups and specifications ready
- [ ] React and frontend development environment prepared
- [ ] Component library and design system established

### During Phase Execution:
- [ ] Daily UI reviews and user feedback sessions
- [ ] Regular performance testing and optimization
- [ ] Cross-platform compatibility testing
- [ ] Accessibility compliance verification

### Phase Completion:
- [ ] All UI components functional and tested
- [ ] Performance benchmarks met
- [ ] Accessibility requirements satisfied
- [ ] User acceptance testing completed
- [ ] Documentation updated
- [ ] Ready for Phase 4 handoff

## Next Phase Dependencies

Phase 3 establishes the user interface that subsequent phases enhance:

- **Phase 4** depends on the canvas and chat interfaces for LSP integration
- **Phase 5** requires the UI components for security status display
- **Phase 6** needs the complete UI for comprehensive testing
- **All subsequent phases** depend on the established UI framework

This phase transforms the Electron application from functional backend to a complete, user-friendly desktop application with modern UI and full feature set.