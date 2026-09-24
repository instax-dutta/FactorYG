import { useEffect, useRef } from 'react';
import { mountScene, type SceneHandle } from './render/SceneView';
import Hud from './ui/Hud';
import BuildPanel from './ui/BuildPanel';
import InfoPanel from './ui/InfoPanel';
import OfflineModal from './ui/OfflineModal';
import PrestigePanel from './ui/PrestigePanel';
import NodeLegendPanel from './ui/NodeLegendPanel';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let handle: SceneHandle | undefined;
    let disposed = false;
    const abortController = new AbortController();

    mountScene(container, { signal: abortController.signal })
      .then((mounted) => {
        if (disposed) mounted.dispose({ save: false });
        else handle = mounted;
      })
      .catch((error: unknown) => {
        if (!disposed) console.error('Failed to mount scene', error);
      });

    return () => {
      disposed = true;
      abortController.abort();
      handle?.dispose();
    };
  }, []);

  return (
    <div className="app-shell" style={{ position: 'fixed', inset: 0, background: 'var(--color-canvas)' }}>
      <div ref={containerRef} className="scene-layer" />
      <Hud />
      <div data-testid="right-rail" className="right-rail">
        <PrestigePanel />
        <InfoPanel />
      </div>
      <div data-testid="bottom-layout" className="bottom-layout">
        <NodeLegendPanel />
        <BuildPanel />
      </div>
      <OfflineModal />
    </div>
  );
}
