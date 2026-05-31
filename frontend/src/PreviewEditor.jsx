import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';

const API_BASE = (window.location.origin === "http://localhost:5173" || window.location.origin === "http://127.0.0.1:5173")
  ? "http://127.0.0.1:8000"
  : window.location.origin;

const SourceSheetView = memo(function SourceSheetView({ headers, rows, issues }) {
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [currentIssueIdx, setCurrentIssueIdx] = useState(0);

  const hasSrcIssue = useCallback((ri, col) => {
    if (!issues || !issues[ri]) return null;
    const info = issues[ri][col];
    if (!info) return null;
    if (Array.isArray(info)) return info[0]; // take first issue
    return typeof info === 'string' ? { type: 'warning', message: info } : info;
  }, [issues]);

  // Compute flattened issue list + counts (mirrors consolidated view)
  const allSrcIssues = useMemo(() => {
    const list = [];
    const counts = { missing: 0, outlier: 0, pattern: 0, inconsistency: 0, warning: 0 };
    if (!issues) return Object.assign(list, { counts });
    for (const [ri, cellIssues] of Object.entries(issues)) {
      for (const [col, info] of Object.entries(cellIssues)) {
        const item = Array.isArray(info) ? info[0] : (typeof info === 'string' ? { type: 'warning', message: info } : info);
        const type = item?.type || 'warning';
        const msg = item?.message || '';
        list.push({ row: parseInt(ri), col, message: msg, type });
        if (counts[type] !== undefined) counts[type]++;
        else counts.warning++;
      }
    }
    list.sort((a, b) => a.row - b.row || a.col.localeCompare(b.col));
    return Object.assign(list, { counts });
  }, [issues]);

  const srcIssueCountByCol = useMemo(() => {
    const map = {};
    for (const iss of allSrcIssues) map[iss.col] = (map[iss.col] || 0) + 1;
    return map;
  }, [allSrcIssues]);

  const displayRows = useMemo(() => {
    if (!showIssuesOnly) return rows;
    return rows.filter((_, ri) => {
      const cellIssues = issues?.[ri] || issues?.[String(ri)];
      return cellIssues && Object.keys(cellIssues).length > 0;
    });
  }, [rows, showIssuesOnly, issues]);

  const navigateToSrcIssue = useCallback((dir) => {
    if (allSrcIssues.length === 0) return;
    const next = (currentIssueIdx + dir + allSrcIssues.length) % allSrcIssues.length;
    setCurrentIssueIdx(next);
    const issue = allSrcIssues[next];
    const cell = document.querySelector(`.source-view [data-src-issue-row="${issue.row}"][data-src-issue-col="${CSS.escape(issue.col)}"]`);
    if (cell) cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [allSrcIssues, currentIssueIdx]);

  return (
    <>
      {allSrcIssues.length > 0 && (
        <div className="preview-issue-bar">
          <span className="preview-issue-count">{allSrcIssues.length}</span>
          <span>issue{allSrcIssues.length !== 1 ? 's' : ''}</span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {allSrcIssues.counts.missing > 0 && (
              <span className="issue-type-badge issue-type-missing" title="Missing values">{allSrcIssues.counts.missing} missing</span>
            )}
            {allSrcIssues.counts.outlier > 0 && (
              <span className="issue-type-badge issue-type-outlier" title="Statistical outliers">{allSrcIssues.counts.outlier} outlier</span>
            )}
            {allSrcIssues.counts.pattern > 0 && (
              <span className="issue-type-badge issue-type-pattern" title="Pattern mismatches">{allSrcIssues.counts.pattern} pattern</span>
            )}
            {allSrcIssues.counts.inconsistency > 0 && (
              <span className="issue-type-badge issue-type-inconsistency" title="Data inconsistencies">{allSrcIssues.counts.inconsistency} inconsistent</span>
            )}
          </div>
          <button className={`btn-sm preview-issue-filter ${showIssuesOnly ? 'active' : ''}`}
            onClick={() => { setShowIssuesOnly(v => !v); setCurrentIssueIdx(0); }}
            title="Show only rows with issues">
            {showIssuesOnly ? 'All rows' : 'Issues only'}
          </button>
          <div className="preview-issue-nav">
            <button className="btn-sm" onClick={() => navigateToSrcIssue(-1)} aria-label="Previous issue">◀</button>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: '32px', textAlign: 'center' }}>
              {allSrcIssues.length > 0 ? currentIssueIdx + 1 : 0}/{allSrcIssues.length}
            </span>
            <button className="btn-sm" onClick={() => navigateToSrcIssue(1)} aria-label="Next issue">▶</button>
          </div>
        </div>
      )}
      <div className="preview-table-wrap source-view">
        <table className="preview-table">
          <thead>
            <tr>
              <th className="preview-rownum" style={{ minWidth: '32px', width: '32px' }}>#</th>
              {headers.map(h => (
                <th key={h}>
                  <div className="preview-th-content">
                    <span className="preview-th-label" title={h}>{h}</span>
                    {srcIssueCountByCol[h] > 0 && (
                      <span className="preview-col-issue-badge" title={`${srcIssueCountByCol[h]} issue(s) in this column`}>
                        {srcIssueCountByCol[h]}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 && (
              <tr><td colSpan={headers.length + 1} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No matching rows</td></tr>
            )}
            {displayRows.map((row, ri) => {
              const actualRi = showIssuesOnly ? rows.indexOf(row) : ri;
              const rowHasIssue = !!(issues?.[actualRi] || issues?.[String(actualRi)]);
              return (
                <tr key={ri} className={`preview-row${rowHasIssue ? ' has-issue-row' : ''}`}>
                  <td className="preview-rownum" style={{ fontSize: '0.72rem' }}>
                    <div className="preview-rownum-inner">
                      <span>{actualRi + 1}</span>
                      {rowHasIssue && <span className="preview-issue-dot"></span>}
                    </div>
                  </td>
                  {headers.map(h => {
                    const issueInfo = hasSrcIssue(actualRi, h);
                    let tdClass = "preview-cell";
                    if (issueInfo) tdClass += ` has-issue issue-${issueInfo.type}`;
                    return (
                      <td key={h} className={tdClass}
                        title={issueInfo ? `⚠ ${issueInfo.type}: ${issueInfo.message}` : undefined}
                        {...(issueInfo ? { 'data-src-issue-row': actualRi, 'data-src-issue-col': h } : {})}
                        style={{ fontSize: '0.76rem', padding: '1px 4px' }}>
                        {row[h] !== null && row[h] !== undefined ? String(row[h]) : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
});

const PreviewRow = memo(function PreviewRow({ row, ri, headers, zoom, issues, cellChanges, focusedCell, hasIssue, isCellEdited, rowIssueCount, rowEditCount, updateCell, resetCell, handleCellClick, handleKeyNav, setFocusedCell }) {
  const issuesCnt = rowIssueCount(ri);
  const editsCnt = rowEditCount(ri);
  let rowClass = "preview-row";
  if (issuesCnt > 0) rowClass += " has-issue-row";
  if (editsCnt > 0) rowClass += " has-edit-row";

  return (
    <tr className={rowClass}>
      <td className="preview-rownum">
        <div className="preview-rownum-inner">
          <span>{ri + 1}</span>
          {issuesCnt > 0 && <span className="preview-issue-dot"></span>}
          {editsCnt > 0 && <span className="preview-edit-dot"></span>}
        </div>
      </td>
      {headers.map((h, ci) => {
        const val = row[h];
        const issueInfo = hasIssue(ri, h);
        const issueType = issueInfo ? issueInfo.type : null;
        const issueMsg = issueInfo ? issueInfo.message : null;
        const edited = isCellEdited(ri, h);
        const isFocused = focusedCell && focusedCell.row === ri && focusedCell.col === ci;
        const showInput = isFocused || edited;

        // Issue resolution: if the cell has been edited, check if the issue is resolved
        const resolvedIssue = edited && issueType && (() => {
          const newVal = val;
          if (issueType === 'missing' && newVal !== null && newVal !== undefined && String(newVal).trim() !== '' && String(newVal).trim() !== '-' && String(newVal).trim() !== 'N/A') return true;
          return false;
        })();

        let tdClass = "preview-cell";
        if (issueType && !resolvedIssue) tdClass += ` has-issue issue-${issueType}`;
        if (resolvedIssue) tdClass += " is-resolved";
        if (edited) tdClass += " is-edited";

        return (
          <td key={h} className={tdClass}
            title={issueType && !resolvedIssue ? `⚠ ${issueType}: ${issueMsg}` : resolvedIssue ? '✓ Issue resolved by your edit' : undefined}
            {...(issueType && !resolvedIssue ? { 'data-issue-row': ri, 'data-issue-col': h } : {})}
            onClick={() => handleCellClick(ri, h, issueInfo)}>
            {showInput ? (
              <>
                <input className="preview-input"
                  defaultValue={val !== null && val !== undefined ? String(val) : ''}
                  onChange={e => updateCell(ri, h, e.target.value)}
                  onKeyDown={e => handleKeyNav(e, ri, ci)}
                  onClick={e => { setFocusedCell({ row: ri, col: ci }); e.stopPropagation(); }}
                  onFocus={() => setFocusedCell({ row: ri, col: ci })}
                  onBlur={() => { if (!edited) setFocusedCell(null); }}
                  style={{ fontSize: `${0.78 * zoom}rem` }} />
                {edited && (
                  <button className="preview-reset-cell" aria-label={`Reset cell ${h} row ${ri + 1}`}
                    onMouseDown={e => { e.stopPropagation(); resetCell(ri, h); }}>↩</button>
                )}
              </>
            ) : (
              <span className="preview-cell-value"
                onMouseDown={e => { e.stopPropagation(); setFocusedCell({ row: ri, col: ci }); }}
                style={{ fontSize: `${0.78 * zoom}rem` }}>
                {val !== null && val !== undefined ? String(val) : ''}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
});

export default function PreviewEditor({ fileId, onClose }) {
  const [sheets, setSheets] = useState({});
  const [sheetNames, setSheetNames] = useState([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [sources, setSources] = useState({});
  const [sourceFileNames, setSourceFileNames] = useState([]);
  const [activeSourceFile, setActiveSourceFile] = useState("");
  const [activeSourceSheet, setActiveSourceSheet] = useState("");
  const [mode, setMode] = useState("consolidated");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedCell, setFocusedCell] = useState(null);
  const [bulkCol, setBulkCol] = useState(null);
  const [showWarningSidebar, setShowWarningSidebar] = useState(false);
  const [selectedWarning, setSelectedWarning] = useState(null);
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [currentIssueIdx, setCurrentIssueIdx] = useState(0);

  // Per-sheet edit tracking via ref — survives sheet switches
  const editsRef = useRef({}); // {sheetName: {rows: [...], changes: {"ri:col": original}}}

  // Force re-render when edits change (for counters etc.)
  const [editVersion, setEditVersion] = useState(0);
  const bump = useCallback(() => setEditVersion(v => v + 1), []);

  // Current sheet's edits
  const currentEdits = editsRef.current[activeSheet] || { rows: null, changes: {} };

  const current = sheets[activeSheet] || {};
  const headers = current.headers || [];
  const rows = current.rows || [];
  const issues = current.issues || {};

  // Normalise consolidated issues keys to integers for robust lookup (identical to source issues)
  const consolidatedIssues = useMemo(() => {
    const normalised = {};
    for (const [k, v] of Object.entries(issues)) {
      normalised[parseInt(k)] = v;
    }
    return normalised;
  }, [issues]);

  // The actual rows to display (edited or original)
  const displayRows = useMemo(() => {
    const base = currentEdits.rows || rows;
    const searchActive = searchQuery.trim().length > 0;
    if (!searchActive && !showIssuesOnly) return base;
    return base.filter((row, ri) => {
      if (searchActive) {
        const q = searchQuery.toLowerCase();
        const match = headers.some(h => {
          const v = row[h];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
        });
        if (!match) return false;
      }
      if (showIssuesOnly) {
        const cellIssues = consolidatedIssues[ri];
        if (!cellIssues || Object.keys(cellIssues).length === 0) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, currentEdits.rows, searchQuery, headers, editVersion, showIssuesOnly, consolidatedIssues]);

  const cellChanges = currentEdits.changes;

  const allIssues = useMemo(() => {
    const list = [];
    const counts = { missing: 0, outlier: 0, pattern: 0, inconsistency: 0, warning: 0 };
    for (const [ri, cellIssues] of Object.entries(consolidatedIssues)) {
      for (const [col, info] of Object.entries(cellIssues)) {
        const msg = typeof info === 'string' ? info : info.message || '';
        const type = typeof info === 'string' ? 'warning' : info.type || 'warning';
        list.push({ row: parseInt(ri), col, message: msg, type });
        if (counts[type] !== undefined) counts[type]++;
        else counts.warning++;
      }
    }
    list.sort((a, b) => a.row - b.row || a.col.localeCompare(b.col));
    list.counts = counts;
    return list;
  }, [consolidatedIssues]);

  const issueCountByCol = useMemo(() => {
    const map = {};
    for (const iss of allIssues) {
      map[iss.col] = (map[iss.col] || 0) + 1;
    }
    return map;
  }, [allIssues]);

  const issueTypeCounts = allIssues.counts;

  // Source view data
  const currentSrcFile = sources[activeSourceFile] || {};
  const currentSrcSheet = currentSrcFile[activeSourceSheet] || {};
  const srcHeaders = currentSrcSheet.headers || [];
  const srcRows = currentSrcSheet.rows || [];
  const srcError = sources[activeSourceFile]?.error;

  // Use backend-provided issues when available (more accurate), fallback to client-side
  const sourceIssues = useMemo(() => {
    // Check if backend already provided issues for this source sheet
    const backendIssues = currentSrcSheet.issues;
    if (backendIssues && Object.keys(backendIssues).length > 0) {
      // Backend keys may be string or int — normalise to int keys
      const normalised = {};
      for (const [k, v] of Object.entries(backendIssues)) {
        normalised[parseInt(k)] = v;
      }
      return normalised;
    }

    // Fallback: lightweight client-side detection
    const result = {};
    if (!srcRows.length || !srcHeaders.length) return result;

    const dateRe = /^\d{2,4}[-\/]\d{1,2}[-\/]\d{2,4}$/;
    const numRe = /^-?\d+(\.\d+)?$/;
    const codeRe = /^[A-Z0-9\-_]+$/i;

    const colMeta = {};
    for (const h of srcHeaders) {
      const vals = srcRows.map(r => r[h]);
      const filled = vals.filter(v => v != null && v !== '');
      const fillRate = filled.length / vals.length;
      const numCount = filled.filter(v => numRe.test(String(v))).length;
      const dateCount = filled.filter(v => dateRe.test(String(v))).length;
      const codeCount = filled.filter(v => codeRe.test(String(v))).length;

      colMeta[h] = { fillRate, numCount, dateCount, codeCount };
      if (filled.length > 0) {
        if (numCount > filled.length * 0.7) colMeta[h].type = 'numeric';
        else if (dateCount > filled.length * 0.7) colMeta[h].type = 'date';
        else if (codeCount > filled.length * 0.5) colMeta[h].type = 'code';
        else colMeta[h].type = 'text';
      } else colMeta[h].type = 'text';
    }

    for (let ri = 0; ri < srcRows.length; ri++) {
      for (const h of srcHeaders) {
        const val = srcRows[ri][h];
        const meta = colMeta[h];
        // Missing
        if ((val == null || val === '') && meta.fillRate > 0.5) {
          result[ri] = result[ri] || {};
          result[ri][h] = { type: 'missing', message: 'Missing value' };
          continue;
        }
        // Pattern mismatch
        if (val != null && val !== '' && meta.type !== 'text') {
          const s = String(val);
          if (meta.type === 'numeric' && !numRe.test(s)) {
            result[ri] = result[ri] || {};
            result[ri][h] = { type: 'pattern', message: `Expected numeric, got "${s}"` };
          } else if (meta.type === 'date' && !dateRe.test(s)) {
            result[ri] = result[ri] || {};
            result[ri][h] = { type: 'pattern', message: `Expected date format, got "${s}"` };
          }
        }
      }
    }
    return result;
  }, [srcRows, srcHeaders, currentSrcSheet.issues]);

  useEffect(() => {
    if (!fileId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/preview/${fileId}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          throw new Error(`Preview failed (HTTP ${r.status}): ${body.slice(0, 200)}`);
        }
        return r.json();
      })
      .then(data => {
        const names = Object.keys(data.sheets || {});
        setSheets(data.sheets);
        setSheetNames(names);
        if (names.length > 0) setActiveSheet(names[0]);
        const srcData = data.sources || {};
        setSources(srcData);
        const srcNames = Object.keys(srcData).filter(k => !srcData[k].error);
        setSourceFileNames(srcNames);
        if (srcNames.length > 0) {
          setActiveSourceFile(srcNames[0]);
          const firstSrcSheets = Object.keys(srcData[srcNames[0]] || {});
          if (firstSrcSheets.length > 0) setActiveSourceSheet(firstSrcSheets[0]);
        }
        setLoading(false);
      })
      .catch(e => { alert(String(e)); setLoading(false); });
  }, [fileId]);

  const getOriginalValue = useCallback((rowIdx, col) => {
    return rows[rowIdx] ? rows[rowIdx][col] : "";
  }, [rows]);

  const isCellEdited = useCallback((rowIdx, col) => {
    return `${rowIdx}:${col}` in (currentEdits.changes || {});
  }, [currentEdits.changes]);

  const updateCell = useCallback((rowIdx, colName, val) => {
    editsRef.current[activeSheet] = editsRef.current[activeSheet] || { rows: null, changes: {} };
    const sheet = editsRef.current[activeSheet];

    // Initialize edited rows from original if first edit
    if (!sheet.rows) {
      sheet.rows = rows.map(r => ({ ...r }));
    }
    sheet.rows[rowIdx] = { ...sheet.rows[rowIdx], [colName]: val };

    // Track original value
    const key = `${rowIdx}:${colName}`;
    if (!(key in sheet.changes)) {
      sheet.changes[key] = getOriginalValue(rowIdx, colName);
    }

    bump();
  }, [rows, activeSheet, getOriginalValue, bump]);

  const resetCell = useCallback((rowIdx, colName) => {
    const sheet = editsRef.current[activeSheet];
    if (!sheet) return;
    const key = `${rowIdx}:${colName}`;
    const origVal = sheet.changes[key];
    if (origVal === undefined) return;
    if (sheet.rows) {
      sheet.rows[rowIdx] = { ...sheet.rows[rowIdx], [colName]: origVal };
    }
    delete sheet.changes[key];
    bump();
  }, [activeSheet, bump]);

  const resetSheetEdits = useCallback(() => {
    delete editsRef.current[activeSheet];
    setFocusedCell(null);
    bump();
  }, [activeSheet, bump]);

  const hasIssue = useCallback((ri, col) => {
    const cellIssues = consolidatedIssues[ri];
    if (!cellIssues) return null;
    for (const [field, info] of Object.entries(cellIssues)) {
      if (field === col) {
        if (typeof info === 'string') return { type: 'warning', message: info };
        return info;
      }
    }
    return null;
  }, [consolidatedIssues]);

  const rowIssueCount = useCallback((ri) => {
    const cellIssues = consolidatedIssues[ri];
    return cellIssues ? Object.keys(cellIssues).length : 0;
  }, [consolidatedIssues]);

  const rowEditCount = useCallback((ri) => {
    const sheet = editsRef.current[activeSheet];
    if (!sheet) return 0;
    let count = 0;
    for (const key of Object.keys(sheet.changes)) {
      if (key.startsWith(`${ri}:`)) count++;
    }
    return count;
  }, [activeSheet, editVersion]);

  /* DOM-based keyboard navigation (Excel-like navigation engine) */
  const handleKeyNav = useCallback((e, ri, ci) => {
    const { key, shiftKey } = e;
    
    // Support Tab, Enter, Escape, and Arrow Up/Down/Left/Right keys
    const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key);
    if (key !== "Tab" && key !== "Enter" && key !== "Escape" && !isArrow) return;

    const input = e.currentTarget;
    
    if (key === "Escape") {
      e.preventDefault();
      input.blur();
      setFocusedCell(null);
      return;
    }

    e.preventDefault();

    const td = input.closest('td');
    if (!td) return;
    const tr = td.closest('tr');
    if (!tr) return;

    let nextTd = null;

    if (key === "Tab") {
      nextTd = shiftKey ? td.previousElementSibling : td.nextElementSibling;
      if (!nextTd || nextTd.classList.contains('preview-rownum')) {
        const nextTr = shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
        if (nextTr) {
          const tds = nextTr.querySelectorAll('td:not(.preview-rownum)');
          nextTd = shiftKey ? tds[tds.length - 1] : tds[0];
        }
      }
    } else if (key === "Enter") {
      const nextTr = shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
      if (nextTr) {
        const tds = nextTr.querySelectorAll('td');
        nextTd = tds[ci + 1] || tds[tds.length - 1];
      }
    } else if (key === "ArrowUp") {
      const nextTr = tr.previousElementSibling;
      if (nextTr) {
        const tds = nextTr.querySelectorAll('td');
        nextTd = tds[ci + 1];
      }
    } else if (key === "ArrowDown") {
      const nextTr = tr.nextElementSibling;
      if (nextTr) {
        const tds = nextTr.querySelectorAll('td');
        nextTd = tds[ci + 1];
      }
    } else if (key === "ArrowLeft") {
      nextTd = td.previousElementSibling;
      if (nextTd && nextTd.classList.contains('preview-rownum')) {
        const nextTr = tr.previousElementSibling;
        if (nextTr) {
          const tds = nextTr.querySelectorAll('td:not(.preview-rownum)');
          nextTd = tds[tds.length - 1];
        } else {
          nextTd = null;
        }
      }
    } else if (key === "ArrowRight") {
      nextTd = td.nextElementSibling;
      if (!nextTd) {
        const nextTr = tr.nextElementSibling;
        if (nextTr) {
          const tds = nextTr.querySelectorAll('td:not(.preview-rownum)');
          nextTd = tds[0];
        }
      }
    }

    if (nextTd) {
      const nextInput = nextTd.querySelector('input.preview-input');
      const nextSpan = nextTd.querySelector('.preview-cell-value');
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      } else if (nextSpan) {
        nextSpan.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    }
  }, [setFocusedCell]);

  const handleCellClick = useCallback((ri, col, issueInfo) => {
    if (issueInfo) {
      setSelectedWarning({ row: ri, col, message: issueInfo.message || issueInfo, type: issueInfo.type || 'warning' });
      setShowWarningSidebar(true);
    }
  }, []);

  /* ── Save: iterate ALL sheets ── */
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {};
      sheetNames.forEach(name => {
        const sheetEdit = editsRef.current[name];
        payload[name] = { rows: sheetEdit?.rows || sheets[name]?.rows || [] };
      });
      const r = await fetch(`${API_BASE}/api/preview/${fileId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets: payload }),
      });
      if (!r.ok) throw new Error("Save failed");
      const result = await r.json();
      setSaveDone(true);
      setTimeout(() => {
        window.open(`${API_BASE}/api/download/${result.file_id}`, '_blank');
        onClose();
      }, 600);
    } catch (e) { alert(`Save failed: ${e.message}`); setSaving(false); }
  };

  const handleClose = useCallback(() => {
    const totalEdits = Object.values(editsRef.current).reduce((sum, s) => sum + Object.keys(s.changes || {}).length, 0);
    if (totalEdits > 0 && !window.confirm("You have unsaved edits. Discard them?")) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  /* ── Bulk operations ── */
  const applyBulkEdits = useCallback((colName, fn) => {
    editsRef.current[activeSheet] = editsRef.current[activeSheet] || { rows: null, changes: {} };
    const sheet = editsRef.current[activeSheet];
    if (!sheet.rows) {
      sheet.rows = rows.map(r => ({ ...r }));
    }
    sheet.rows.forEach((r, ri) => {
      const orig = rows[ri]?.[colName];
      const result = fn(r[colName], orig);
      if (result !== undefined) {
        r[colName] = result;
      }
      const key = `${ri}:${colName}`;
      if (r[colName] !== orig && !(key in sheet.changes)) {
        sheet.changes[key] = orig;
      }
    });
    setBulkCol(null);
    bump();
  }, [rows, activeSheet, bump]);

  const handleBulkReplace = useCallback((colName) => {
    const searchVal = prompt("Replace this value (leave empty for any):") || "";
    const replaceVal = prompt("With this value:") || "";
    if (replaceVal === "") return;
    applyBulkEdits(colName, (cur) => {
      if (cur !== null && cur !== undefined && String(cur).toLowerCase().includes(searchVal.toLowerCase())) {
        return replaceVal;
      }
    });
  }, [applyBulkEdits]);

  const handleBulkFill = useCallback((colName) => {
    const val = prompt("Fill all cells in this column with:") || "";
    if (val === "") return;
    applyBulkEdits(colName, () => val);
  }, [applyBulkEdits]);

  const handleBulkClear = useCallback((colName) => {
    if (!confirm(`Clear all values in column "${colName}"?`)) return;
    applyBulkEdits(colName, () => "");
  }, [applyBulkEdits]);

  /* ── Switch sheets: save edits to ref, load next ── */
  const switchSheet = useCallback((name) => {
    setActiveSheet(name);
    setSearchQuery("");
    setBulkCol(null);
    setShowWarningSidebar(false);
    setFocusedCell(null);
    setSaveDone(false);
  }, []);

  const totalEditCount = useMemo(() => {
    return Object.values(editsRef.current).reduce((sum, s) => sum + Object.keys(s.changes || {}).length, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editVersion]);

  const navigateToIssue = useCallback((dir) => {
    if (allIssues.length === 0) return;
    const next = (currentIssueIdx + dir + allIssues.length) % allIssues.length;
    setCurrentIssueIdx(next);
    const issue = allIssues[next];
    setFocusedCell({ row: issue.row, col: headers.indexOf(issue.col) });
    const cell = document.querySelector(`[data-issue-row="${issue.row}"][data-issue-col="${CSS.escape(issue.col)}"]`);
    if (cell) {
      cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const input = cell.querySelector('input');
      if (input) setTimeout(() => input.focus(), 100);
    }
  }, [allIssues, currentIssueIdx, headers]);

  return (
    <div className="overlay">
      <div className="overlay-content wide preview-overlay" onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>Preview & Edit — Consolidated Report</h2>
            <span className="preview-badge">
              {sheetNames.length} sheet{sheetNames.length !== 1 ? 's' : ''}
              {sourceFileNames.length > 0 && ` · ${sourceFileNames.length} source`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button className="btn-sm" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} aria-label="Zoom out">−</button>
            <span className="preview-zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="btn-sm" onClick={() => setZoom(z => Math.min(2, z + 0.1))} aria-label="Zoom in">+</button>
            <button className="overlay-close" onClick={handleClose} aria-label="Close preview">✕</button>
          </div>
        </div>

        <div className="preview-mode-bar">
          <div className={`preview-mode-tab ${mode === 'consolidated' ? 'active' : ''}`}
            onClick={() => setMode('consolidated')}>Consolidated</div>
          <div className={`preview-mode-tab ${mode === 'sources' ? 'active' : ''}`}
            onClick={() => setMode('sources')}>Source Files {sourceFileNames.length > 0 && `(${sourceFileNames.length})`}</div>
        </div>

        {loading ? (
          <div className="preview-empty-state">Loading preview...</div>
        ) : mode === 'consolidated' ? (
          /* ── CONSOLIDATED VIEW ── */
          <>
            <div className="preview-toolbar">
              <div className="map-sheet-tabs" style={{ marginBottom: 0 }}>
                {sheetNames.map(name => {
                  const s = sheets[name];
                  const totalIssues = s ? Object.keys(s.issues || {}).reduce((acc, ri) => acc + Object.keys(s.issues[ri]).length, 0) : 0;
                  const hasEdits = editsRef.current[name] && Object.keys(editsRef.current[name].changes || {}).length > 0;
                  return (
                    <div key={name} className={`sheet-tab ${name === activeSheet ? 'active' : ''}`}
                      onClick={() => switchSheet(name)}>
                      {name}
                      {totalIssues > 0 && <span className="preview-issue-dot" style={{ marginLeft: 4 }}></span>}
                      {hasEdits && <span className="preview-edit-dot" style={{ marginLeft: 3 }}></span>}
                      <span className="preview-row-count">({s?.rows?.length || 0})</span>
                    </div>
                  );
                })}
              </div>
              <div className="preview-toolbar-actions">
                <div className="preview-search-wrap">
                  <input className="create-input preview-search-input"
                    placeholder="Search…" value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)} />
                  {searchQuery && <button className="preview-search-clear" onClick={() => setSearchQuery("")}>✕</button>}
                </div>
                {Object.keys(currentEdits.changes || {}).length > 0 && (
                  <button className="btn-sm" onClick={resetSheetEdits}>↺ Reset sheet</button>
                )}
              </div>
            </div>

            {allIssues.length > 0 && (
              <div className="preview-issue-bar">
                <span className="preview-issue-count">{allIssues.length}</span>
                <span>issue{allIssues.length !== 1 ? 's' : ''}</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {issueTypeCounts.missing > 0 && (
                    <span className="issue-type-badge issue-type-missing" title="Missing values">{issueTypeCounts.missing} missing</span>
                  )}
                  {issueTypeCounts.outlier > 0 && (
                    <span className="issue-type-badge issue-type-outlier" title="Statistical outliers">{issueTypeCounts.outlier} outlier</span>
                  )}
                  {issueTypeCounts.pattern > 0 && (
                    <span className="issue-type-badge issue-type-pattern" title="Pattern mismatches">{issueTypeCounts.pattern} pattern</span>
                  )}
                  {issueTypeCounts.inconsistency > 0 && (
                    <span className="issue-type-badge issue-type-inconsistency" title="Data inconsistencies">{issueTypeCounts.inconsistency} inconsistent</span>
                  )}
                  {issueTypeCounts.warning > 0 && (
                    <span className="issue-type-badge" title="Validation warnings">{issueTypeCounts.warning} warning</span>
                  )}
                </div>
                <button className={`btn-sm preview-issue-filter ${showIssuesOnly ? 'active' : ''}`}
                  onClick={() => { setShowIssuesOnly(v => !v); setCurrentIssueIdx(0); }}
                  title="Show only rows with issues">
                  {showIssuesOnly ? 'All rows' : 'Issues only'}
                </button>
                <div className="preview-issue-nav">
                  <button className="btn-sm" onClick={() => navigateToIssue(-1)} aria-label="Previous issue">◀</button>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: '32px', textAlign: 'center' }}>
                    {allIssues.length > 0 ? currentIssueIdx + 1 : 0}/{allIssues.length}
                  </span>
                  <button className="btn-sm" onClick={() => navigateToIssue(1)} aria-label="Next issue">▶</button>
                </div>
              </div>
            )}

            <div className="preview-body">
              <div className={`preview-table-wrap ${showWarningSidebar ? 'with-sidebar' : ''}`} tabIndex={-1}>
                <table className="preview-table" style={{ fontSize: `${0.8 * zoom}rem` }}>
                  <thead>
                    <tr>
                      <th className="preview-rownum" style={{ minWidth: '36px', width: '36px' }}>#</th>
                      {headers.map(h => (
                        <th key={h}>
                          <div className="preview-th-content">
                            <span className="preview-th-label" title={h}>{h}</span>
                            {issueCountByCol[h] > 0 && (
                              <span className="preview-col-issue-badge" title={`${issueCountByCol[h]} issue(s) in this column`}>
                                {issueCountByCol[h]}
                              </span>
                            )}
                            <div className="preview-th-actions">
                              <button className="preview-bulk-btn"
                                onClick={e => { e.stopPropagation(); setBulkCol(bulkCol === h ? null : h); }}>⋮</button>
                              {bulkCol === h && (
                                <div className="preview-bulk-menu" onClick={e => e.stopPropagation()}>
                                  <div className="preview-bulk-menu-item" onClick={() => handleBulkReplace(h)}>Replace values…</div>
                                  <div className="preview-bulk-menu-item" onClick={() => handleBulkFill(h)}>Fill all…</div>
                                  <div className="preview-bulk-menu-item preview-bulk-menu-danger" onClick={() => handleBulkClear(h)}>Clear all</div>
                                </div>
                              )}
                            </div>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.length === 0 && (
                      <tr><td colSpan={headers.length + 1} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No matching rows</td></tr>
                    )}
                    {displayRows.map((row, ri) => {
                      const actualRi = (currentEdits.rows || rows).indexOf(row);
                      return (
                        <PreviewRow key={ri} row={row} ri={actualRi}
                          headers={headers} zoom={zoom} issues={consolidatedIssues}
                          cellChanges={cellChanges} focusedCell={focusedCell}
                          hasIssue={hasIssue} isCellEdited={isCellEdited}
                          rowIssueCount={rowIssueCount} rowEditCount={rowEditCount}
                          updateCell={updateCell} resetCell={resetCell}
                          handleCellClick={handleCellClick} handleKeyNav={handleKeyNav}
                          setFocusedCell={setFocusedCell} />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {showWarningSidebar && selectedWarning && (
                <div className="preview-warning-sidebar">
                  <div className="preview-warning-sidebar-header">
                    <span>⚠ Cell Warning</span>
                    <button className="overlay-close" onClick={() => setShowWarningSidebar(false)} aria-label="Close warning sidebar">✕</button>
                  </div>
                  <div className="preview-warning-sidebar-body">
                    <div className="preview-warning-detail-row">
                      <span className="preview-warning-detail-label">Issue Type</span>
                      <span className="preview-warning-detail-value" style={{ textTransform: 'capitalize' }}>
                        <span className={`issue-type-badge issue-type-${selectedWarning.type || 'warning'}`}>
                          {selectedWarning.type || 'warning'}
                        </span>
                      </span>
                    </div>
                    <div className="preview-warning-detail-row">
                      <span className="preview-warning-detail-label">Row</span>
                      <span className="preview-warning-detail-value">{selectedWarning.row + 1}</span>
                    </div>
                    <div className="preview-warning-detail-row">
                      <span className="preview-warning-detail-label">Column</span>
                      <span className="preview-warning-detail-value">{selectedWarning.col}</span>
                    </div>
                    <div className="preview-warning-detail-row">
                      <span className="preview-warning-detail-label">Message</span>
                      <span className="preview-warning-detail-value">{selectedWarning.message}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* ── SOURCE FILES VIEW ── */
          sourceFileNames.length === 0 ? (
            <div className="preview-empty-state">No source file data available</div>
          ) : (
            <>
              <div className="preview-toolbar">
                <div className="map-sheet-tabs" style={{ marginBottom: 0 }}>
                  {sourceFileNames.map(fname => (
                    <div key={fname} className={`sheet-tab ${fname === activeSourceFile ? 'active' : ''}`}
                      onClick={() => {
                        setActiveSourceFile(fname);
                        const ss = Object.keys(sources[fname] || {});
                        if (ss.length > 0) setActiveSourceSheet(ss[0]);
                      }}>
                      {fname}
                      <span className="preview-row-count">({Object.keys(sources[fname] || {}).length})</span>
                    </div>
                  ))}
                </div>
                {srcError && <span style={{ color: 'var(--accent-error)', fontSize: '0.8rem' }}>⚠ {srcError}</span>}
              </div>

              {srcHeaders.length > 0 && (
                <div className="preview-toolbar" style={{ marginTop: 0 }}>
                  <div className="map-sheet-tabs" style={{ marginBottom: 0 }}>
                    {Object.keys(currentSrcFile).map(sname => (
                      <div key={sname} className={`sheet-tab ${sname === activeSourceSheet ? 'active' : ''}`}
                        onClick={() => setActiveSourceSheet(sname)}>
                        {sname}
                        <span className="preview-row-count">({(currentSrcFile[sname]?.rows || []).length})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <SourceSheetView headers={srcHeaders} rows={srcRows} issues={sourceIssues} />
            </>
          )
        )}

        <div className="preview-footer">
          <div className="preview-footer-left">
            {mode === 'consolidated' && totalEditCount > 0 && (
              <span className="preview-footer-edits">{totalEditCount} cell{totalEditCount !== 1 ? 's' : ''} edited across {Object.keys(editsRef.current).filter(k => Object.keys(editsRef.current[k]?.changes || {}).length > 0).length} sheet(s)</span>
            )}
          </div>
          <div className="preview-footer-right">
            <button className="btn-secondary" onClick={handleClose} disabled={saving}>Close</button>
            {mode === 'consolidated' && (
              <button className="btn-primary" disabled={saving || loading || saveDone} onClick={handleSave}
                style={{ background: saveDone ? 'var(--accent-success)' : undefined, borderColor: saveDone ? 'var(--accent-success)' : undefined }}>
                {saveDone ? "✓ Saved & Downloaded" : saving ? "Saving..." : "Save & Download"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
