import React, { useState, useRef, useEffect } from 'react';

export default function App() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [success, setSuccess] = useState(false);
  const [fileId, setFileId] = useState(null);
  const [auditLog, setAuditLog] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef(null);
  const terminalEndRef = useRef(null);

  const API_BASE = window.location.origin === "http://localhost:5173"
    ? "http://localhost:8000"
    : window.location.origin;

  // Auto-scroll the terminal logs
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Handle Drag Over
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // Handle Drop
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Handle File Input Selection
  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      addFiles(Array.from(e.target.files));
    }
  };

  // Add Files to State
  const addFiles = (files) => {
    const validFiles = files.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
    if (validFiles.length === 0) {
      alert("Please upload only Excel spreadsheets (.xlsx, .xls)!");
      return;
    }

    setSelectedFiles(prev => {
      // Avoid duplicate filenames in queue
      const existingNames = prev.map(p => p.name);
      const uniqueNew = validFiles.filter(f => !existingNames.includes(f.name));
      return [...prev, ...uniqueNew];
    });
    // Reset inputs
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Remove individual file
  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Clear all files
  const clearAll = () => {
    setSelectedFiles([]);
    setSuccess(false);
    setFileId(null);
    setAuditLog(null);
    setLogs([]);
  };

  // Format File Size
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Run the Consolidation pipeline
  const runConsolidation = async () => {
    if (selectedFiles.length === 0) return;
    
    setRunning(true);
    setSuccess(false);
    setFileId(null);
    setAuditLog(null);
    setLogs(["[SYSTEM] Initializing HTTP payload...", "[SYSTEM] Uploading spreadsheets..."]);

    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append("files", file);
    });

    try {
      const response = await fetch(`${API_BASE}/api/consolidate`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Consolidation HTTP request failed with status: ${response.status}`);
      }

      const result = await response.json();
      
      // Load execution logs
      if (result.logs) {
        setLogs(result.logs.split("\n"));
      }

      if (result.success) {
        setSuccess(true);
        setFileId(result.file_id);
        setAuditLog(result.audit_log);
        setLogs(prev => [...prev, "[SYSTEM] Pipeline executed successfully!", "[SYSTEM] Ready to download consolidated workbook."]);
      } else {
        setSuccess(false);
        alert(`Consolidation failed: ${result.error || "Unknown backend error"}`);
      }
    } catch (err) {
      setSuccess(false);
      setLogs(prev => [...prev, `[ERROR] Failed to connect to consolidation backend.`, `Details: ${err.message}`]);
    } finally {
      setRunning(false);
    }
  };

  // Download the resulting workbook
  const triggerDownload = () => {
    if (!fileId) return;
    window.open(`${API_BASE}/api/download/${fileId}`, '_blank');
  };

  return (
    <div className="container">
      <header>
        <h1>Consolidation Pipeline</h1>
        <p>Dynamic Schema-Driven Multi-Client Spreadsheet Consolidation Hub</p>
      </header>

      <div className="panel">
        <div className="panel-title" style={{ justifyContent: 'space-between' }}>
          <span>📂 Source Spreadsheets Queue</span>
          {selectedFiles.length > 0 && (
            <button className="btn-clear" onClick={clearAll}>Clear Queue</button>
          )}
        </div>

        {/* Drag-and-drop Dropzone */}
        <div 
          className={`dropzone ${dragActive ? 'active' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            multiple 
            accept=".xlsx, .xls"
            onChange={handleFileInputChange}
          />
          <div className="dropzone-icon">📥</div>
          <h3>Drag and drop Excel workbooks here</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>or click to browse local files</p>
        </div>

        {/* Files Queue List */}
        {selectedFiles.length > 0 && (
          <div className="file-list">
            {selectedFiles.map((file, idx) => (
              <div className="file-item" key={idx}>
                <div className="file-info">
                  <span style={{ fontSize: '1.2rem' }}>📄</span>
                  <div>
                    <div className="file-name">{file.name}</div>
                    <div className="file-size">{formatBytes(file.size)}</div>
                  </div>
                </div>
                <button className="btn-remove" onClick={() => removeFile(idx)}>❌</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedFiles.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <button 
            className="btn-primary" 
            disabled={running} 
            onClick={runConsolidation}
          >
            {running ? (
              <>
                <span className="spinner"></span>
                Processing Consolidation Engine...
              </>
            ) : (
              "🚀 Run Consolidation Pipeline"
            )}
          </button>
        </div>
      )}

      {/* Terminal log panel */}
      {logs.length > 0 && (
        <div className="panel">
          <div className="panel-title">💻 Real-Time Execution Console</div>
          <div className="terminal">
            {logs.map((line, idx) => {
              let lineClass = "";
              if (line.startsWith("ERROR") || line.includes("[ERROR]")) lineClass = "error";
              if (line.includes("SUCCESS") || line.includes("DONE") || line.includes("successfully")) lineClass = "success";
              return (
                <div className={`terminal-line ${lineClass}`} key={idx}>
                  {line}
                </div>
              );
            })}
            <div ref={terminalEndRef} />
          </div>
        </div>
      )}

      {/* Success Output panel */}
      {success && (
        <div className="panel">
          <div className="success-card">
            <div className="success-icon">🏆</div>
            <h2>Consolidation Complete!</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              All client spreadsheets have been verified, mapped, styling-formatted, and consolidated.
            </p>
            <button className="btn-download" onClick={triggerDownload}>
              📥 Download Consolidated Report
            </button>
          </div>

          {/* Audit stats display */}
          {auditLog && (
            <div style={{ marginTop: '24px' }}>
              <div className="panel-title" style={{ fontSize: '1.1rem' }}>📈 Reconciliation & Audit Summary</div>
              <div className="stats-grid">
                <div className="stat-box">
                  <div className="stat-value">{auditLog.reconciliation_status || "SUCCESS"}</div>
                  <div className="stat-label">Reconciliation Status</div>
                </div>
                {auditLog.files_processed && (
                  <div className="stat-box">
                    <div className="stat-value">{auditLog.files_processed.length}</div>
                    <div className="stat-label">Source Workbooks</div>
                  </div>
                )}
                {auditLog.row_counts && auditLog.row_counts["Master Data"] && (
                  <div className="stat-box">
                    <div className="stat-value">
                      {Object.values(auditLog.row_counts["Master Data"]).reduce((a, b) => a + b, 0)}
                    </div>
                    <div className="stat-label">Master Data Rows</div>
                  </div>
                )}
                {auditLog.row_counts && auditLog.row_counts["Payment Tracker"] && (
                  <div className="stat-box">
                    <div className="stat-value">
                      {Object.values(auditLog.row_counts["Payment Tracker"]).reduce((a, b) => a + b, 0)}
                    </div>
                    <div className="stat-label">Payment Tracker Rows</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
