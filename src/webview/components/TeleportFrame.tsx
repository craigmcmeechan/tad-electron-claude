import React from 'react';

interface TeleportFrameProps {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  onJump: () => void;
}

const TeleportFrame: React.FC<TeleportFrameProps> = ({ x, y, width, height, label, onJump }) => {
  return (
    <div
      className="teleport-chip"
      style={{ position: 'absolute', left: x, top: y, width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 6, border: '1px dashed var(--vscode-textLink-foreground)', color: 'var(--vscode-textLink-foreground)', background: 'rgba(0,0,0,0.05)', fontSize: 12 }}
      title={`Jump to ${label}`}
      onClick={(e) => { e.stopPropagation(); onJump(); }}
    >
      ↪ {label}
    </div>
  );
};

export default TeleportFrame;



