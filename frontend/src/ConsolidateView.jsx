import React, { useState, useRef, useEffect, useCallback } from 'react';
import AuditPanel from './AuditPanel';
import PreviewEditor from './PreviewEditor';
import { useToast } from './ToastContext';

const API_BASE = (window.location.origin === "http://localhost:5173" || window.location.origin === "http://127.0.0.1:5173")
  ? "http://127.0.0.1:8000"
  : window.location.origin;

export default function ConsolidateView() {
  const toast = useToast();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [matchResults, setMatchResults] = useState(null);
  const [allSchemas, setAllSchemas] = useState([]);
  const [manualMappings, setManualMappings] = useState({});
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [success, setSuccess] = useState(false);
  const [fileId, setFileId] = useState(null);
  const [auditLog, setAuditLog] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [auditSummary, setAuditSummary] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [batches, setBatches] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const filteredFiles = fileSearch.trim()
    ? selectedFiles.filter(f => f.name.toLowerCase().includes(fileSearch.toLowerCase()))
    : selectedFiles;

  const fileInputRef = useRef(null);
  const terminalEndRef = useRef(null);

  // Load batch history on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/batches`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBatches(data.batches || []); })
      .catch(() => {});
  }, []);

  // Refresh batches after a run
  const refreshBatches = useCallback(() => {
    fetch(`${API_BASE}/api/batches`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBatches(data.batches || []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (terminalEndRef.current && logOpen) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, logOpen]);

  const runPreview = useCallback(async (files) => {
    const names = files.map(f => f.name);
    if (!names.length) { setMatchResults(null); setAllSchemas([]); setPreviewLoading(false); return; }
    setPreviewLoading(true);
    try {
      // Read column headers from each file for column-header based matching
      const fileHeaders = {};
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          const resp = await fetch(`${API_BASE}/api/analyze-excel`, { method: "POST", body: fd });
          if (resp.ok) {
            const data = await resp.json();
            const sheets = data.sheets || [];
            if (sheets.length > 0) {
              fileHeaders[file.name] = sheets[0].columns || [];
            }
          }
        } catch (e) { /* skip if header read fails */ }
      }
      const r = await fetch(`${API_BASE}/api/preview-matching`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: names, file_headers: fileHeaders }),
      });
      if (r.ok) {
        const data = await r.json();
        setMatchResults(data);
        setAllSchemas(data.all_schemas || []);
      } else {
        setMatchResults({ matches: {} });
        setAllSchemas([]);
        toast("Template matching service unavailable", "warning");
      }
    } catch (e) {
      setMatchResults({ matches: {} });
      setAllSchemas([]);
      toast(`File matching failed: ${e.message}`, "error");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => { runPreview(selectedFiles); }, [selectedFiles, runPreview]);

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (files) => {
    const validFiles = files.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
    if (validFiles.length === 0) {
      toast("Please upload only Excel spreadsheets (.xlsx, .xls)!", "warning");
      return;
    }
    setSelectedFiles(prev => {
      const existingNames = prev.map(p => p.name);
      const uniqueNew = validFiles.filter(f => !existingNames.includes(f.name));
      return [...prev, ...uniqueNew];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index) => {
    const removed = selectedFiles[index];
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    if (removed && manualMappings[removed.name]) {
      setManualMappings(prev => { const n = {...prev}; delete n[removed.name]; return n; });
    }
  };

  const clearAll = () => {
    if (!window.confirm("Remove all files and reset the workspace?")) return;
    setSelectedFiles([]); setMatchResults(null); setAllSchemas([]);
    setManualMappings({}); setSuccess(false);
    setFileId(null); setAuditLog(null); setAuditSummary(null); setLogs([]); setLogOpen(false);
    toast("Workspace cleared", "info");
  };

  const clearHistory = async () => {
    if (!window.confirm("Clear all run history?")) return;
    try {
      await fetch(`${API_BASE}/api/batches`, { method: "DELETE" });
      setBatches([]);
      toast("Run history cleared", "success");
    } catch (e) { toast("Failed to clear run history", "error"); }
  };

  // Keyboard: Enter to run
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Enter' && canRun && !e.repeat) runConsolidation();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canRun, runConsolidation]);

  // Auto-scroll terminal

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024; const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const getFileMatch = (name) => matchResults?.matches?.[name] || [];
  const hasManualMapping = (name) => !!manualMappings[name];
  const matchedCount = matchResults ? selectedFiles.filter(f => getFileMatch(f.name).length > 0).length : 0;
  const unmatchedCount = matchResults ? selectedFiles.filter(f => !getFileMatch(f.name).length).length : 0;
  const mappedUnmatched = matchResults ? selectedFiles.filter(f => !getFileMatch(f.name).length && hasManualMapping(f.name)).length : 0;
  const totalSize = selectedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const canRun = selectedFiles.length > 0 && !running && !previewLoading && (matchedCount > 0 || mappedUnmatched > 0);

  const runConsolidation = async () => {
    if (!canRun) return;
    setRunning(true); setSuccess(false); setFileId(null); setAuditLog(null);
    setLogs(["[SYSTEM] Initializing HTTP payload...", "[SYSTEM] Uploading spreadsheets..."]);
    setLogOpen(true);

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append("files", file));
    // Include any manual template selections
    if (Object.keys(manualMappings).length > 0) {
      formData.append("manual_mappings", JSON.stringify(manualMappings));
    }

    try {
      const response = await fetch(`${API_BASE}/api/consolidate`, { method: "POST", body: formData });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.logs) setLogs(result.logs.split("\n"));
      if (result.success) {
        setSuccess(true); setFileId(result.file_id); setAuditLog(result.audit_log);
        setAuditSummary(result.audit_summary);
        setLogs(prev => [...prev, "[SYSTEM] Pipeline executed successfully!", "[SYSTEM] Ready to download."]);
      } else {
        setSuccess(false);
        toast(`Consolidation failed: ${result.error || "Unknown error"}`, "error");
      }
    } catch (err) {
      setSuccess(false);
      setLogs(prev => [...prev, `[ERROR] ${err.message}`]);
    } finally {
      setRunning(false);
      refreshBatches();
      setHistoryOpen(true);
    }
  };

  const triggerDownload = (id) => { if (id) window.open(`${API_BASE}/api/download/${id}`, '_blank'); };
  const compactDrop = selectedFiles.length > 0;

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <div className="consolidate-header">
        <h1>Consolidation Workspace</h1>
        {selectedFiles.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span className="consolidate-file-count">{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} · {formatBytes(totalSize)}</span>
            {matchResults && (
              <span className="consolidate-file-count" style={{ background: matchedCount > 0 ? 'rgba(16,185,129,0.08)' : undefined, color: matchedCount > 0 ? 'var(--accent-success)' : undefined }}>
                {matchedCount} matched
              </span>
            )}
            {matchResults && unmatchedCount > 0 && (
              <span className="consolidate-file-count" style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--accent-warning)' }}>
                {unmatchedCount} unmatched
              </span>
            )}
          </div>
        )}
      </div>

      {/* Quick tip bar */}
      <div className="consolidate-tip-bar">
        <span>Drag & drop Excel files · Press <kbd>Enter</kbd> to consolidate</span>
      </div>

      <div className="consolidate-single-col">

        <div className={`consolidate-dropzone ${compactDrop ? 'has-files' : ''} ${dragActive ? 'active' : ''}`}
          onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current.click()}>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple accept=".xlsx, .xls" onChange={handleFileInputChange} />
          {compactDrop ? (
            <div className="consolidate-dropzone-bar">
              <span>📁 <strong>{selectedFiles.length}</strong> file{selectedFiles.length > 1 ? 's' : ''} queued</span>
              <div className="consolidate-dropzone-actions">
                <span className="consolidate-drop-hint">Drop more or click</span>
                <button className="btn-clear" onClick={e => { e.stopPropagation(); clearAll(); }}>Clear</button>
              </div>
            </div>
          ) : (
            <div className="consolidate-dropzone-empty">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', marginBottom: '12px', opacity: 0.35 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <h3>Drop spreadsheets here</h3>
              <p>or click to browse · .xlsx / .xls</p>
            </div>
          )}
        </div>

        {selectedFiles.length > 0 && (
          <div className="consolidate-file-list">
            {selectedFiles.length > 3 && (
              <div style={{ padding: '0 0 8px 0' }}>
                <input className="col-filter-input" type="text" placeholder="Filter files..."
                  value={fileSearch} onChange={e => setFileSearch(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', boxSizing: 'border-box' }} />
              </div>
            )}
            <div className="consolidate-file-list-header">
              <span>Selected files{fileSearch ? ` (${filteredFiles.length})` : ''}</span>
              <button className="btn-sm consolidate-add-btn" onClick={() => fileInputRef.current.click()}
                title="Add more files">+ Add files</button>
            </div>
            {filteredFiles.map((file, idx) => {
              const match = getFileMatch(file.name);
              const matched = match.length > 0;
              const manual = manualMappings[file.name];
              return (
                <div key={idx} className={`consolidate-file-item ${matched || manual ? 'matched' : 'unmatched'}`}>
                  <span className="consolidate-file-icon">{matched || manual ? '📊' : '⚠️'}</span>
                  <span className="consolidate-file-name" title={file.name}>{file.name}</span>
                  {matched ? (
                    <span className="consolidate-file-match" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ background: 'rgba(16,185,129,0.08)', padding: '0 6px', borderRadius: '3px', fontSize: '0.7rem', color: 'var(--accent-success)', fontWeight: 500 }}>{match[0].client_display_name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{file.size ? formatBytes(file.size) : ''}</span>
                    </span>
                  ) : (
                    <span className="consolidate-file-nomatch">
                      {manual ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ background: 'rgba(245,158,11,0.10)', padding: '0 6px', borderRadius: '3px', fontSize: '0.7rem', color: 'var(--accent-warning)', fontWeight: 500 }}>
                            {allSchemas.find(s => s.client_id === manual)?.client_display_name || manual}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{file.size ? formatBytes(file.size) : ''}</span>
                        </span>
                      ) : (
                        <>
                          no template matched
                          {file.size ? <span style={{ fontSize: '0.7rem', marginLeft: '6px', color: 'var(--text-muted)' }}>{formatBytes(file.size)}</span> : null}
                        </>
                      )}
                    </span>
                  )}
                  {!matched && (
                    <select className="template-select"
                      value={manual || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setManualMappings(prev => {
                          const next = { ...prev };
                          if (val) next[file.name] = val;
                          else delete next[file.name];
                          return next;
                        });
                      }}
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: '0.7rem', maxWidth: 160, padding: '1px 4px', marginLeft: 6 }}
                    >
                      <option value="">— Select template —</option>
                      {allSchemas.map(s => (
                        <option key={s.client_id} value={s.client_id}>{s.client_display_name}</option>
                      ))}
                    </select>
                  )}
                  <button className="btn-remove" onClick={() => removeFile(idx)} aria-label={`Remove ${file.name}`}>✕</button>
                </div>
              );
            })}
            {filteredFiles.length === 0 && fileSearch && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                No files match "<strong style={{ color: 'var(--text-secondary)' }}>{fileSearch}</strong>"
              </div>
            )}
          </div>
        )}

        {matchResults && unmatchedCount > 0 && (
          <div className="consolidate-warn-bar">
            ⚠ {unmatchedCount} file(s) did not match any template
            {unmatchedCount - mappedUnmatched > 0
              ? ` — ${unmatchedCount - mappedUnmatched} will be skipped without manual assignment`
              : ' — use the dropdowns above to assign a template'}
          </div>
        )}

        {selectedFiles.length > 0 && (
          <button className="btn-primary consolidate-run-btn" disabled={!canRun} onClick={runConsolidation}
            style={{ opacity: canRun ? 1 : 0.5 }}>
            {running ? (
              <><span className="spinner"></span> Processing...</>
            ) : previewLoading ? (
              <><span className="spinner"></span> Analyzing files...</>
            ) : !matchResults ? (
              "Ready"
            ) : (
              "▶ Run Consolidation"
            )}
          </button>
        )}

        {success && (
          <div className="panel" style={{ padding: '22px 24px', background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 'var(--radius-md)', animation: 'fadeSlideDown 0.35s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
              <div className="consolidate-checkmark" style={{ width: '36px', height: '36px', borderRadius: '99px', background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-success)', flexShrink: 0 }}>✓</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#fff' }}>Consolidation Complete</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} processed{auditSummary?.health_score !== undefined ? ` · Health: ${auditSummary.health_score}%` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-primary" style={{ flex: 1, padding: '12px 18px', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={() => triggerDownload(fileId)}>
                ↓ Download
              </button>
              <button className="btn-secondary" style={{ flex: 1, padding: '12px 18px', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={() => setShowPreview(true)}>
                👁 Preview & Edit
              </button>
            </div>
          </div>
        )}

        {success && auditLog && (
          <AuditPanel auditLog={auditLog} auditSummary={auditSummary} />
        )}

        {logs.length > 0 && (
          <div className="consolidate-logs" style={{ animation: 'fadeSlideUp 0.3s ease' }}>
            <div className="consolidate-logs-header" onClick={() => setLogOpen(!logOpen)}>
              <span className="consolidate-logs-toggle">{logOpen ? '▼' : '▶'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>🖥 Console ({logs.length} lines)</span>
              {!logOpen && <span className="consolidate-logs-preview">{logs.slice(-1).join(' • ')}</span>}
            </div>
            {logOpen && (
              <div className="terminal">
                {logs.map((line, idx) => {
                  let lineClass = "";
                  if (line.startsWith("ERROR") || line.includes("[ERROR]")) lineClass = "error";
                  if (line.includes("SUCCESS") || line.includes("DONE") || line.includes("successfully")) lineClass = "success";
                  return <div className={`terminal-line ${lineClass}`} key={idx}>{line}</div>;
                })}
                <div ref={terminalEndRef} />
              </div>
            )}
          </div>
        )}

        <div className="consolidate-history" style={{ animation: 'fadeSlideUp 0.35s ease' }}>
          <div className="consolidate-logs-header" onClick={() => setHistoryOpen(!historyOpen)}
            style={{ borderBottom: historyOpen && batches.length > 0 ? 'none' : undefined, borderRadius: historyOpen || batches.length > 0 ? '5px 5px 0 0' : '5px' }}>
            <span className="consolidate-logs-toggle">{historyOpen ? '▼' : '▶'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>📋 Run History ({batches.length})</span>
            {batches.length > 0 && <span className="consolidate-logs-preview">{formatTime(batches[0]?.timestamp)}</span>}
            {batches.length > 0 && (
                <button className="btn-sm" onClick={e => { e.stopPropagation(); clearHistory(); }}
                  style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '1px 6px' }}>Clear</button>
              )}
            </div>
            {historyOpen && (
              <div className="consolidate-history-list">
                {batches.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    No runs yet — upload files and run consolidation to see history here
                  </div>
                ) : batches.map((b, i) => {
                  const sc = b.health_score ?? 100;
                  const scColor = sc >= 90 ? 'var(--accent-success)' : sc >= 60 ? 'var(--accent-warning)' : 'var(--accent-error)';
                  const isLatest = i === 0 && fileId === b.file_id;
                  return (
                    <div key={b.id} className={`consolidate-history-item ${isLatest ? 'latest' : ''}`}>
                      <div className="consolidate-history-item-top">
                        <span className="consolidate-history-status"
                          style={{ color: b.status === 'SUCCESS' ? 'var(--accent-success)' : 'var(--accent-error)' }}>
                          {b.status === 'SUCCESS' ? '✓' : '✗'}
                        </span>
                        <span className="consolidate-history-time">{formatTime(b.timestamp)}</span>
                        <span className="consolidate-history-score" style={{ color: scColor }}>
                          {sc}%
                        </span>
                        <span className="consolidate-history-files">
                          {b.filenames?.join(', ') || '—'}
                        </span>
                        {b.file_id && (
                          <div className="consolidate-history-actions">
                            <button className="btn-sm" onClick={() => triggerDownload(b.file_id)}
                              title="Download">↓</button>
                            <button className="btn-sm" onClick={() => {
                              setSuccess(true); setFileId(b.file_id);
                              setShowPreview(true);
                            }} title="Preview">👁</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          </div>
        </div>

      {showPreview && fileId && (
        <PreviewEditor fileId={fileId} onClose={(newFileId) => {
          if (newFileId) setFileId(newFileId);
          setShowPreview(false);
        }} />
      )}
    </>
  );
}
