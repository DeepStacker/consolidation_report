import React, { useState, useEffect } from 'react';
import ConsolidateView from './ConsolidateView';
import SchemaManager from './SchemaManager';

function getTabFromHash() {
  const hash = window.location.hash.replace('#', '');
  return hash === 'schemas' ? 'schemas' : 'consolidate';
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
            Schema Manager
          </button>
        </div>
      </nav>
      <main className="app-main">
        <div className="container">
          {tab === "consolidate" && <ConsolidateView />}
          {tab === "schemas" && <SchemaManager />}
        </div>
      </main>
    </div>
  );
}