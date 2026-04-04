import { useState, useCallback } from 'react';
import BabylonReceiver, { type ReceiverStats } from './receiver/BabylonReceiver';
import './index.css';

export default function App() {
  const [stats, setStats] = useState<ReceiverStats>({
    interceptCount: 0,
    lastVertexCount: 0,
    falsified: false,
  });

  const handleStats = useCallback((s: ReceiverStats) => setStats(s), []);

  return (
    <>
      {/* The transparent BabylonJS canvas overlay */}
      <BabylonReceiver onStats={handleStats} />

      {/* Debug HUD — top-right corner */}
      <div id="debug-hud" className={`hud ${stats.falsified ? 'hud--falsified' : ''}`}>
        <div className="hud__title">
          <span className="hud__dot" />
          Miris·Babylon Bridge
        </div>
        <div className="hud__row">
          <span className="hud__label">Intercepts</span>
          <span className="hud__value hud__value--count">{stats.interceptCount}</span>
        </div>
        <div className="hud__row">
          <span className="hud__label">Last chunk</span>
          <span className="hud__value">
            {stats.lastVertexCount > 0
              ? `${stats.lastVertexCount.toLocaleString()} verts`
              : '—'}
          </span>
        </div>
        {stats.falsified && (
          <div className="hud__warning">
            ⚠ FALSIFIED — No geometry intercepted
          </div>
        )}
        {!stats.falsified && stats.interceptCount > 0 && (
          <div className="hud__success">
            ✓ TAP ACTIVE
          </div>
        )}
      </div>
    </>
  );
}
