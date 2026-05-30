import React, { useState } from 'react';

export default function AuditPanel({ auditLog, auditSummary }) {
  const summary = auditSummary || {};
  const [showWarnings, setShowWarnings] = useState(false);
  const [showClients, setShowClients] = useState(false);

  const score = summary.health_score ?? 100;
  const status = summary.status || auditLog?.reconciliation_status || 'UNKNOWN';
  const warnings = auditLog?.validation_warnings || [];
  const finSums = auditLog?.financial_sums || {};
  const rules = auditLog?.rules_applied || [];
  const clients = summary.clients || [];
  const rowCounts = auditLog?.row_counts || {};

  const scoreColor = score >= 90 ? 'var(--accent-success)' : score >= 60 ? 'var(--accent-warning)' : 'var(--accent-error)';

  return (
    <div className="audit-panel-compact">

      {/* Stats row */}
      <div className="audit-stats-row">
        <div className="audit-stat">
          <span className="audit-stat-value" style={{ color: scoreColor }}>{score}%</span>
          <span className="audit-stat-label">Health</span>
        </div>
        <div className="audit-stat">
          <span className="audit-stat-value">{summary.total_clients ?? 0}</span>
          <span className="audit-stat-label">Clients</span>
        </div>
        <div className="audit-stat">
          <span className="audit-stat-value">{summary.total_files ?? 0}</span>
          <span className="audit-stat-label">Files</span>
        </div>
        <div className="audit-stat">
          <span className="audit-stat-value">{summary.total_rows ?? 0}</span>
          <span className="audit-stat-label">Rows</span>
        </div>
        <div className="audit-stat">
          <span className="audit-stat-value" style={{ color: warnings.length ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
            {warnings.length}
          </span>
          <span className="audit-stat-label">Warn</span>
        </div>
        <div className="audit-stat">
          <span className="audit-stat-value">
            {summary.matched_sums ?? 0}/{summary.total_sums ?? 0}
          </span>
          <span className="audit-stat-label">Sums ✓</span>
        </div>
      </div>

      {/* Per-Client Breakdown — collapsible */}
      {clients.length > 0 && (
        <div className="audit-section">
          <div className="audit-section-header" onClick={() => setShowClients(!showClients)}>
            <span>{showClients ? '▼' : '▶'} Per-Client</span>
            <span className="audit-section-meta">{clients.length} client{clients.length > 1 ? 's' : ''}</span>
          </div>
          {showClients && (
            <div className="audit-clients-list">
              {clients.map(c => {
                const totalRows = c.total_rows || 0;
                return (
                  <div key={c.client_id} className="audit-client-row">
                    <span className="audit-client-name">{c.client_id}</span>
                    <span className="audit-client-meta">{c.files.length} file{c.files.length > 1 ? 's' : ''} · {c.sheets.length} sheet{c.sheets.length > 1 ? 's' : ''} · {totalRows} rows</span>
                    <span className="audit-client-files">
                      {c.files.map((fn, i) => <code key={i}>{fn}</code>)}
                    </span>
                    <span className="audit-client-sheets">
                      {c.sheets.map(sh => {
                        const key = `${c.client_id} - ${sh}`;
                        const rc = rowCounts[key] || {};
                        return <span key={sh} className="audit-sheet-chip">{sh}: {rc.output || 0}r</span>;
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Financial Sum Validation — compact row */}
      {Object.keys(finSums).length > 0 && (
        <div className="audit-section">
          <div className="audit-section-header">
            <span>▶ Financial Sums</span>
            <span className="audit-section-meta">{Object.keys(finSums).length} column{Object.keys(finSums).length > 1 ? 's' : ''}</span>
          </div>
          <div className="audit-sums-row">
            {Object.entries(finSums).map(([key, val]) => {
              const s = parseFloat(val.standalone) || 0;
              const c = parseFloat(val.consolidated) || 0;
              const match = Math.abs(s - c) < 0.01;
              return (
                <div key={key} className={`audit-sum-chip ${match ? 'pass' : 'fail'}`}>
                  <span className="audit-sum-label">{key}</span>
                  <span className="audit-sum-diff">
                    {s.toLocaleString()} → {c.toLocaleString()}
                  </span>
                  <span className={`audit-sum-badge ${match ? 'pass' : 'fail'}`}>{match ? '✓' : '✗'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Validation Warnings — collapsible */}
      {warnings.length > 0 && (
        <div className="audit-section">
          <div className="audit-section-header" onClick={() => setShowWarnings(!showWarnings)}>
            <span style={{ color: 'var(--accent-warning)' }}>
              {showWarnings ? '▼' : '▶'} {warnings.length} Warning{warnings.length > 1 ? 's' : ''}
            </span>
          </div>
          {showWarnings && (
            <div className="audit-warnings-list">
              {warnings.map((w, i) => (
                <div key={i} className="audit-warning-item">
                  <strong>{w.field || '?'}</strong> (row {w.row_idx}): {w.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rules Applied */}
      {rules.length > 0 && (
        <div className="audit-section">
          <div className="audit-section-header">
            <span>▶ Rules</span>
            <span className="audit-section-meta">{rules.length} rule{rules.length > 1 ? 's' : ''}</span>
          </div>
          <div className="audit-rules-row">
            {rules.map((r, i) => (
              <span key={i} className="audit-rule-chip" title={r.description}>{r.rule_id}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
