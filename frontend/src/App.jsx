import React, { useState, useEffect, lazy, Suspense } from 'react';

const ConsolidateView = lazy(() => import('./ConsolidateView'));
const SchemaManager = lazy(() => import('./SchemaManager'));

function getTabFromHash() {
  const hash = window.location.hash.replace('#', '');
  return hash === 'schemas' ? 'schemas' : 'consolidate';
}

function Fallback() {
  return <div className="container" style={{ display: 'flex', justifyContent: 'center', padding: '80px', color: 'var(--text-muted)' }}>Loading…</div>;
}

export default function App() {
  const [tab, setTab] = useState(getTabFromHash);

  useEffect(() => {
    const handler = () => setTab(getTabFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const switchTab = (t) => {
    window.location.hash = t;
    setTab(t);
  };

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="nav-brand">
          <span className="nav-logo">◈</span>
          <span className="nav-title">Consolidation Hub</span>
        </div>
        <div className="nav-tabs">
          <button
            className={`nav-tab ${tab === "consolidate" ? "active" : ""}`}
            onClick={() => switchTab("consolidate")}
          >
            Consolidate
          </button>
          <button
            className={`nav-tab ${tab === "schemas" ? "active" : ""}`}
            onClick={() => switchTab("schemas")}
          >
            Excel Templates (Schemas)
          </button>
        </div>
      </nav>
      <main className="app-main">
        <div className="container">
          <Suspense fallback={<Fallback />}>
            {tab === "consolidate" && <ConsolidateView />}
            {tab === "schemas" && <SchemaManager />}
          </Suspense>
        </div>
      </main>
    </div>
  );
}