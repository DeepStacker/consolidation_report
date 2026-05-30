import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

const API_BASE = (window.location.origin === "http://localhost:5173" || window.location.origin === "http://127.0.0.1:5173")
  ? "http://127.0.0.1:8000"
  : window.location.origin;

function bestMatch(src, targets) {
  const s = src.toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = null, bestScore = Infinity;
  for (const t of targets) {
    const n = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    let score = 0;
    for (let i = 0; i < Math.min(s.length, n.length); i++) if (s[i] !== n[i]) score++;
    score += Math.abs(s.length - n.length);
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return bestScore <= 4 ? best : null;
}

function guessType(name) {
  const n = name.toLowerCase();
  if (n.includes('date') || n.includes('schedule') || n.includes('end ')) return 'date';
  if (n.includes('time')) return 'time';
  if (n.includes('no') || n.includes('count') || n.includes('visit') || n.includes('packet') || n.includes('day') || n.includes('sr')) return 'integer';
  if (n.includes('fee') || n.includes('pay') || n.includes('amount') || n.includes('total') || n.includes('charge') || n.includes('deduction') || n.includes('cost') || n.includes('rate') || n.includes('sum')) return 'decimal';
  return 'string';
}

export default function SchemaManager() {
  const [schemas, setSchemas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Creation overlay state
  const [createFile, setCreateFile] = useState(null);
  const [createSheets, setCreateSheets] = useState([]);
  const [canonFields, setCanonFields] = useState([]);
  const [createName, setCreateName] = useState("");
  const [createDisplay, setCreateDisplay] = useState("");
  const [createPattern, setCreatePattern] = useState("");
  const [createMappings, setCreateMappings] = useState({}); // sheetIdx -> col -> { canonical, datatype }
  const [createPreviews, setCreatePreviews] = useState({}); // sheetIdx -> col -> [samples]
  const [createStep, setCreateStep] = useState("upload"); // upload | map | done
  const [saving, setSaving] = useState(false);
  const [rulesSchema, setRulesSchema] = useState(null); // full schema data for rules editor
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [expandedId, setExpandedId] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [loadingExpanded, setLoadingExpanded] = useState(false);
  const fileRef = useRef(null);
  const replaceRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch(`${API_BASE}/api/schemas`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSchemas((await r.json()).schemas || []);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch(`${API_BASE}/api/canonical-fields`)
      .then(r => r.ok ? r.json() : { fields: [] })
      .then(d => setCanonFields(d.fields || []))
      .catch(() => {});
  }, []);

  const handleToggle = async (cid) => {
    try {
      const r = await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}/toggle`, { method: "PUT" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSchemas(prev => prev.map(s => s.client_id === cid ? { ...s, active: d.active } : s));
    } catch (e) { alert(`Failed: ${e.message}`); }
  };

  const handleDelete = async (cid) => {
    if (!window.confirm(`Delete "${cid}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}`, { method: "DELETE" });
      load();
    } catch (e) { alert(`Failed: ${e.message}`); }
  };

  const handleEdit = async (cid) => {
    try {
      const r = await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const schema = await r.json();
      resetCreate();
      setEditingId(cid);
      setCreateName(schema.client_id || cid);
      setCreateDisplay(schema.client_display_name || schema.client_id || cid);
      setCreatePattern(schema.filename_pattern || `*${cid}*`);
      // Convert schema sheets to overlay format
      const sheetNames = Object.keys(schema.sheets || {});
      const sheets = sheetNames.map(name => ({
        name,
        columns: (schema.sheets[name]?.columns || []).map(c => c.synonyms?.[0] || c.canonical_name),
      }));
      const maps = {};
      sheetNames.forEach((name, si) => {
        maps[si] = {};
        (schema.sheets[name]?.columns || []).forEach(c => {
          const srcCol = c.synonyms?.[0] || c.canonical_name;
          maps[si][srcCol] = {
            canonical: c.canonical_name,
            datatype: c.datatype || 'string',
            mandatory: c.mandatory || false,
          };
        });
      });
      setCreateSheets(sheets);
      setCreateMappings(maps);
      setCreateStep("map");
      setShowCreate(true);
    } catch (e) { alert(`Load failed: ${e.message}`); }
  };

  const handleCopy = async (cid) => {
    try {
      const r = await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const schema = await r.json();
      resetCreate();
      setEditingId(null);
      setCreateName(schema.client_id + "_copy");
      setCreateDisplay((schema.client_display_name || schema.client_id) + " (Copy)");
      setCreatePattern(schema.filename_pattern || `*${schema.client_id}*`);
      const sheetNames = Object.keys(schema.sheets || {});
      const sheets = sheetNames.map(name => ({
        name,
        columns: (schema.sheets[name]?.columns || []).map(c => c.synonyms?.[0] || c.canonical_name),
      }));
      const maps = {};
      sheetNames.forEach((name, si) => {
        maps[si] = {};
        (schema.sheets[name]?.columns || []).forEach(c => {
          const srcCol = c.synonyms?.[0] || c.canonical_name;
          maps[si][srcCol] = {
            canonical: c.canonical_name,
            datatype: c.datatype || 'string',
            mandatory: c.mandatory || false,
          };
        });
      });
      setCreateSheets(sheets);
      setCreateMappings(maps);
      setCreateStep("map");
      setShowCreate(true);
    } catch (e) { alert(`Copy failed: ${e.message}`); }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleToggleExpand = async (cid) => {
    if (expandedId === cid) {
      setExpandedId(null);
      setExpandedData(null);
      return;
    }
    setExpandedId(cid);
    setLoadingExpanded(true);
    setExpandedData(null);
    try {
      const r = await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setExpandedData(await r.json());
    } catch (e) {
      setExpandedData(null);
    }
    setLoadingExpanded(false);
  };

  // ── Creation overlay ──
  const openCreate = () => {
    resetCreate();
    setShowCreate(true);
  };

  const resetCreate = () => {
    setEditingId(null);
    setCreateFile(null);
    setCreateSheets([]);
    setCreateName("");
    setCreateDisplay("");
    setCreatePattern("");
    setCreateMappings({});
    setCreatePreviews({});
    setCreateStep("upload");
  };

  const handleFileDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) { alert("Only .xlsx/.xls files"); return; }
    setCreateFile(file);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`${API_BASE}/api/analyze-excel`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCreateSheets(data.sheets || []);
      const maps = {};
      const prevs = {};
      (data.sheets || []).forEach((sh, si) => {
        maps[si] = {};
        prevs[si] = {};
        sh.columns.forEach(col => {
          const match = bestMatch(col, canonFields);
          maps[si][col] = { canonical: match || col, datatype: guessType(col), mandatory: false };
          prevs[si][col] = (sh.preview || []).slice(0, 5).map(r => r[col]);
        });
      });
      setCreateMappings(maps);
      setCreatePreviews(prevs);
      setCreateStep("map");
    } catch (e) { alert(`Analysis failed: ${e.message}`); }
  };

  const handleReplaceExcel = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) { alert("Only .xlsx/.xls files"); return; }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`${API_BASE}/api/analyze-excel`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      // Preserve existing mappings where column names match
      const oldMaps = createMappings;
      const oldSheets = createSheets;
      const maps = {};
      const oldColToMap = {};
      Object.keys(oldMaps).forEach(si => {
        Object.entries(oldMaps[si] || {}).forEach(([col, m]) => { oldColToMap[col] = m; });
      });
      (data.sheets || []).forEach((sh, si) => {
        maps[si] = {};
        sh.columns.forEach(col => {
          const existing = oldColToMap[col];
          maps[si][col] = existing || {
            canonical: bestMatch(col, canonFields) || col,
            datatype: guessType(col),
            mandatory: false,
          };
        });
      });
      setCreateSheets(data.sheets || []);
      setCreateMappings(maps);
      const prevs = {};
      (data.sheets || []).forEach((sh, si) => {
        prevs[si] = {};
        sh.columns.forEach(col => {
          prevs[si][col] = (sh.preview || []).slice(0, 5).map(r => r[col]);
        });
      });
      setCreatePreviews(prevs);
    } catch (e) { alert(`Analysis failed: ${e.message}`); }
  };

  const updateMapping = (si, col, field, val) => {
    setCreateMappings(prev => {
      const m = { ...prev };
      if (!m[si]) m[si] = {};
      m[si] = { ...m[si], [col]: { ...(m[si][col] || {}), [field]: val } };
      return m;
    });
  };

  // ── Dedicated Rules Editor ──
  const openRules = async (cid) => {
    try {
      const r = await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const schema = await r.json();
      setRulesSchema(schema);
    } catch (e) { alert(`Load failed: ${e.message}`); }
  };

  const closeRules = () => setRulesSchema(null);

  useEffect(() => {
    const handler = e => {
      if (e.key !== 'Escape') return;
      if (rulesSchema) closeRules();
      else if (showCreate) setShowCreate(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rulesSchema, showCreate]);

  const updateDefault = (sheetName, canonical, val) => {
    setRulesSchema(prev => {
      const s = { ...prev };
      const cols = [...(s.sheets[sheetName]?.columns || [])];
      const idx = cols.findIndex(c => c.canonical_name === canonical);
      if (idx >= 0) {
        cols[idx] = { ...cols[idx] };
        if (val) cols[idx].default_value = val;
        else delete cols[idx].default_value;
      }
      s.sheets[sheetName] = { ...s.sheets[sheetName], columns: cols };
      return s;
    });
  };

  const updateCopyFrom = (sheetName, canonical, val) => {
    setRulesSchema(prev => {
      const s = { ...prev };
      const cols = [...(s.sheets[sheetName]?.columns || [])];
      const idx = cols.findIndex(c => c.canonical_name === canonical);
      if (idx >= 0) {
        cols[idx] = { ...cols[idx] };
        if (val) cols[idx].copy_from_column = val;
        else delete cols[idx].copy_from_column;
      }
      s.sheets[sheetName] = { ...s.sheets[sheetName], columns: cols };
      return s;
    });
  };

  const toggleSumCol = (sheetName, canonical) => {
    setRulesSchema(prev => {
      const s = { ...prev };
      const sheet = { ...s.sheets[sheetName] };
      const cur = sheet.sum_columns || [];
      sheet.sum_columns = cur.includes(canonical) ? cur.filter(x => x !== canonical) : [...cur, canonical];
      s.sheets[sheetName] = sheet;
      return s;
    });
  };

  const saveRules = async () => {
    if (!rulesSchema) return;
    try {
      const r = await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(rulesSchema.client_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rulesSchema),
      });
      if (!r.ok) { const err = await r.json(); throw new Error(err.detail || `HTTP ${r.status}`); }
      load();
      setRulesSchema(null);
    } catch (e) { alert(`Save failed: ${e.message}`); }
  };

  const handleSave = async () => {
    const cid = createName.trim();
    if (!cid) { alert("Enter a name"); return; }
    if (!createSheets.length) { alert("No sheets"); return; }
    setSaving(true);
    const sheetData = createSheets.map((sh, si) => {
      const cols = sh.columns.map(col => {
        const m = createMappings[si]?.[col] || {};
        const cname = m.canonical || col;
        const entry = { canonical_name: cname, datatype: m.datatype || 'string', synonyms: [col] };
        if (cname.toLowerCase() !== col.toLowerCase() && !entry.synonyms.includes(cname))
          entry.synonyms.push(cname);
        if (m.mandatory) entry.mandatory = true;
        return entry;
      });
      return { name: sh.name, header_row: 1, data_start_row: 2, columns: cols };
    });
    try {
      const body = (() => {
        const base = {
          client_id: cid,
          client_display_name: createDisplay.trim() || cid,
          filename_pattern: createPattern.trim() || `*${cid}*`,
          active: true,
        };
        if (editingId) {
          // PUT expects sheets as a keyed object (name is the key)
          const sheetsObj = {};
          sheetData.forEach(sh => {
            const { name, ...rest } = sh;
            sheetsObj[name] = rest;
          });
          base.sheets = sheetsObj;
        } else {
          base.sheets = sheetData;
        }
        return base;
      })();
      const url = editingId
        ? `${API_BASE}/api/schemas/${encodeURIComponent(editingId)}`
        : `${API_BASE}/api/schemas/from-mapping`;
      const r = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const err = await r.json(); throw new Error(err.detail || `HTTP ${r.status}`); }
      load();
      setCreateStep("done");
      setTimeout(() => { setShowCreate(false); resetCreate(); setEditingId(null); }, 1500);
    } catch (e) { alert(`Save failed: ${e.message}`); }
    finally { setSaving(false); }
  };

  const filteredSchemas = useMemo(() => {
    let list = schemas;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        (s.client_display_name || '').toLowerCase().includes(q) ||
        (s.client_id || '').toLowerCase().includes(q) ||
        (s.sheet_names || []).some(n => n.toLowerCase().includes(q))
      );
    }
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = (a.client_display_name || a.client_id || '').localeCompare(b.client_display_name || b.client_id || '');
      } else if (sortField === 'sheets') {
        cmp = (a.sheet_names || []).length - (b.sheet_names || []).length;
      } else if (sortField === 'columns') {
        cmp = (a.column_count || 0) - (b.column_count || 0);
      } else if (sortField === 'active') {
        cmp = (a.active ? 1 : 0) - (b.active ? 1 : 0);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [schemas, searchQuery, sortField, sortDir]);

  const sortArrow = (field) => {
    if (sortField !== field) return <span className="schema-sort-arrow">↕</span>;
    return <span className="schema-sort-arrow active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <>
      <header>
        <h1>Schemas</h1>
        <p>Manage client workbook definitions</p>
      </header>

      <div className="schema-toolbar">
        <div className="schema-search-wrap">
          <span className="schema-search-icon">🔍</span>
          <input className="schema-search-input"
            placeholder="Search by name, ID, or sheet…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={openCreate}>
          + New Schema
        </button>
        {searchQuery && (
          <span className="schema-result-count">
            {filteredSchemas.length} of {schemas.length}
          </span>
        )}
      </div>

      <div className="panel">
        {loading ? (
          <table className="schema-table">
            <thead><tr>
              <th style={{ width: '60px' }}>Active</th>
              <th>Name</th>
              <th>Sheets</th>
              <th>Columns</th>
              <th style={{ width: 'auto' }}>Actions</th>
            </tr></thead>
            <tbody>
              {[1,2,3,4].map(i => (
                <tr key={i} className="schema-skeleton-row">
                  <td><div className="schema-skeleton-bar" style={{ width: '36px', height: '20px', borderRadius: '10px' }}></div></td>
                  <td><div className="schema-skeleton-bar short"></div></td>
                  <td><div className="schema-skeleton-bar" style={{ width: '40%' }}></div></td>
                  <td><div className="schema-skeleton-bar" style={{ width: '30px' }}></div></td>
                  <td><div className="schema-skeleton-bar" style={{ width: '240px' }}></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : error ? (
          <div className="schema-empty">
            <div className="schema-empty-icon" style={{ fontSize: '2rem' }}>⚠️</div>
            <h3>Failed to load</h3>
            <p style={{ color: 'var(--accent-error)' }}>{error}</p>
          </div>
        ) : filteredSchemas.length === 0 && searchQuery.trim() ? (
          <div className="schema-empty">
            <div className="schema-empty-icon">🔍</div>
            <h3>No matches</h3>
            <p>No schemas match "<strong>{searchQuery}</strong>"</p>
            <button className="btn-sm" onClick={() => setSearchQuery("")}>Clear filter</button>
          </div>
        ) : schemas.length === 0 ? (
          <div className="schema-empty">
            <div className="schema-empty-icon">📋</div>
            <h3>No schemas yet</h3>
            <p>Create your first schema by uploading an Excel file and mapping its columns to canonical fields.</p>
            <div className="schema-empty-steps">
              <div className="schema-empty-step">
                <span className="schema-empty-step-num">1</span>
                <span className="schema-empty-step-label">Upload Excel</span>
              </div>
              <div className="schema-empty-step">
                <span className="schema-empty-step-num">2</span>
                <span className="schema-empty-step-label">Map columns</span>
              </div>
              <div className="schema-empty-step">
                <span className="schema-empty-step-num">3</span>
                <span className="schema-empty-step-label">Save schema</span>
              </div>
            </div>
          </div>
        ) : (
          <table className="schema-table">
            <thead><tr>
              <th style={{ width: '60px' }}>Active</th>
              <th className="schema-th-sortable" onClick={() => handleSort('name')}>
                Name {sortArrow('name')}
              </th>
              <th className="schema-th-sortable" onClick={() => handleSort('sheets')}>
                Sheets {sortArrow('sheets')}
              </th>
              <th className="schema-th-sortable" onClick={() => handleSort('columns')}>
                Columns {sortArrow('columns')}
              </th>
              <th style={{ width: 'auto' }}>Actions</th>
            </tr></thead>
            <tbody>
              {filteredSchemas.map(s => (
                <React.Fragment key={s.client_id}>
                  <tr>
                    <td>
                      <label className="toggle-label">
                        <input type="checkbox" checked={s.active} onChange={() => handleToggle(s.client_id)} />
                        <span className={`toggle-indicator ${s.active ? 'on' : ''}`}></span>
                      </label>
                    </td>
                    <td>
                      <strong>{s.client_display_name || s.client_id}</strong>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <code>{s.client_id}</code>
                        {s.filename_pattern && (
                          <span style={{ marginLeft: '8px', fontSize: '0.72rem' }}>{s.filename_pattern}</span>
                        )}
                      </div>
                    </td>
                    <td>{(s.sheet_names || []).join(", ")}</td>
                    <td>{s.column_count ?? "—"}</td>
                    <td>
                      <div className="schema-actions">
                        <button className="btn-sm btn-sm-edit" onClick={() => handleEdit(s.client_id)} title="Edit">✎ Edit</button>
                        <button className="btn-sm btn-sm-rules" onClick={() => openRules(s.client_id)} title="Rules">⚙ Rules</button>
                        <button className="btn-sm btn-sm-copy" onClick={() => handleCopy(s.client_id)} title="Duplicate">⧉ Copy</button>
                        <button className="btn-sm btn-danger" onClick={() => handleDelete(s.client_id)} title="Delete">🗑 Delete</button>
                        <button className="btn-sm btn-sm-detail" onClick={() => handleToggleExpand(s.client_id)}
                          title={expandedId === s.client_id ? 'Collapse details' : 'View details'}>
                          {expandedId === s.client_id ? '▲' : '▼'} Detail
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === s.client_id && (
                    <tr className="schema-detail-row">
                      <td colSpan={5}>
                        <div className="schema-detail-inner">
                          {loadingExpanded ? (
                            <div style={{ display: 'flex', gap: '16px' }}>
                              <div className="schema-skeleton-bar medium" style={{ height: '60px' }}></div>
                            </div>
                          ) : expandedData ? (
                            Object.entries(expandedData.sheets || {}).length === 0 ? (
                              <div className="schema-detail-empty">No sheets defined</div>
                            ) : (
                              Object.entries(expandedData.sheets || {}).map(([sheetName, sheet]) => (
                                <div key={sheetName} className="schema-detail-sheet">
                                  <div className="schema-detail-sheet-name">
                                    {sheetName}
                                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '8px', fontSize: '0.75rem' }}>
                                      header row {sheet.header_row ?? 1}, data starts {sheet.data_start_row ?? 2}
                                    </span>
                                  </div>
                                  <div className="schema-detail-cols">
                                    {(sheet.columns || []).map(col => (
                                      <span key={col.canonical_name}
                                        className={`schema-detail-col-chip ${col.mandatory ? 'mandatory' : ''}`}
                                        title={col.canonical_name + (col.default_value !== undefined ? ` (default: ${col.default_value})` : '')}>
                                        {col.canonical_name}
                                        {col.mandatory && <span style={{ color: 'var(--accent-error)' }}>*</span>}
                                        <span className="schema-detail-col-type">{col.datatype || 'string'}</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))
                            )
                          ) : (
                            <div className="schema-detail-empty">Failed to load details</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── CREATION OVERLAY ── */}
      {showCreate && (
        <div className="overlay" onClick={() => { if (createStep !== "done") setShowCreate(false); }}>
          <div className={`overlay-content ${createStep === "map" ? "wide" : ""}`} onClick={e => e.stopPropagation()}>
            <div className="overlay-header">
              <h2>{editingId ? `Edit: ${editingId}` : createStep === "upload" ? "Create Schema" : createStep === "map" ? "Map Columns" : "Saved!"}</h2>
              {createStep !== "done" && (
                <button className="overlay-close" onClick={() => setShowCreate(false)} aria-label="Close create schema overlay">✕</button>
              )}
            </div>

            {createStep === "upload" && (
              <div className="dropzone"
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileRef.current?.click()}
                style={{ margin: '20px 0' }}
              >
                <input ref={fileRef} type="file" style={{ display: 'none' }}
                  accept=".xlsx,.xls" onChange={handleFileDrop} />
                <div className="dropzone-icon" style={{ fontSize: '2rem' }}>📊</div>
                <h3>Drop an Excel file</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Columns will be detected automatically
                </p>
              </div>
            )}

            {createStep === "map" && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {/* Fixed header section */}
                <div style={{ flexShrink: 0 }}>
                  {editingId && (
                    <div className="replace-dropzone"
                      onDragOver={e => e.preventDefault()}
                      onDrop={handleReplaceExcel}>
                      <input ref={replaceRef} type="file" style={{ display: 'none' }}
                        accept=".xlsx,.xls" onChange={handleReplaceExcel} />
                      <button className="btn-sm" onClick={() => replaceRef.current?.click()}
                        style={{ width: 'auto' }}>
                        Replace from Excel
                      </button>
                      <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        or drop file here
                      </span>
                    </div>
                  )}
                  <div className="modal-section">
                    <div className="modal-section-header">
                      <span className="step-badge">1</span>
                      Schema Details
                    </div>
                    <div className="form-grid">
                      <div className="form-field">
                        <label>Name *</label>
                        <input className="create-input" value={createName}
                          onChange={e => setCreateName(e.target.value.replace(/\s+/g, '_'))}
                          placeholder="e.g. my_client" />
                      </div>
                      <div className="form-field">
                        <label>Display Name</label>
                        <input className="create-input" value={createDisplay}
                          onChange={e => setCreateDisplay(e.target.value)}
                          placeholder="e.g. My Client" />
                      </div>
                      <div className="form-field full-width">
                        <label>Filename Pattern <span className="field-hint">glob pattern to match source files</span></label>
                        <input className="create-input" value={createPattern}
                          onChange={e => setCreatePattern(e.target.value)}
                          placeholder={`*${createName || 'client'}*`} />
                      </div>
                    </div>
                  </div>
                  {createSheets.length > 1 && (
                    <div className="map-sheet-tabs" style={{ marginTop: '8px' }}>
                      {createSheets.map((sh, i) => (
                        <div key={i} className="sheet-tab active" style={{ cursor: 'default' }}>
                          {sh.name} ({sh.columns.length})
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="modal-section-header" style={{ marginTop: '12px', marginBottom: '6px', paddingLeft: '4px' }}>
                    <span className="step-badge">2</span>
                    Column Mapping
                  </div>
                </div>

                {/* Scrollable body */}
                <div className="map-body">
                  {createSheets.map((sh, si) => (
                    <div key={si} style={{ marginBottom: si < createSheets.length - 1 ? '16px' : 0 }}>
                      {createSheets.length > 1 && (
                        <h4 className="map-sheet-title">{sh.name}</h4>
                      )}
                      <table className="map-table">
                        <thead>
                          <tr>
                            <th className="col-source">Excel Column</th>
                            <th className="col-preview">Sample Data</th>
                            <th className="col-target">Map to Field</th>
                            <th className="col-type">Type</th>
                            <th className="col-required">Req</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sh.columns.map(col => {
                            const m = createMappings[si]?.[col] || {};
                            return (
                              <tr key={col}>
                                <td className="col-source"><code title={col}>{col}</code></td>
                                <td className="col-preview">
                                  {(createPreviews[si]?.[col] || []).length > 0
                                    ? createPreviews[si][col].slice(0, 3).map((v, vi) => (
                                        <span key={vi} title={String(v)} className="preview-chip">
                                          {String(v).length > 10 ? String(v).slice(0, 10) + '\u2026' : String(v) || '\u00a0'}
                                        </span>
                                      ))
                                    : <span className="preview-empty">\u2014</span>
                                  }
                                </td>
                                <td className="col-target">
                                  <input className="create-input" value={m.canonical || col}
                                    onChange={e => updateMapping(si, col, 'canonical', e.target.value)}
                                    list={`cf-${si}`} placeholder="Search..." />
                                  <datalist id={`cf-${si}`}>
                                    {canonFields.map(f => <option key={f} value={f} />)}
                                  </datalist>
                                </td>
                                <td className="col-type">
                                  <select value={m.datatype || 'string'}
                                    onChange={e => updateMapping(si, col, 'datatype', e.target.value)}
                                    className="map-select">
                                    <option value="string">string</option>
                                    <option value="integer">int</option>
                                    <option value="decimal">decimal</option>
                                    <option value="date">date</option>
                                    <option value="time">time</option>
                                  </select>
                                </td>
                                <td className="col-required">
                                  <input type="checkbox" checked={m.mandatory || false}
                                    onChange={e => updateMapping(si, col, 'mandatory', e.target.checked)} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>

                {/* Fixed footer */}
                <div className="form-actions map-footer">
                  <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                  <button className="btn-primary" style={{ width: 'auto' }} disabled={saving} onClick={handleSave}>
                    {saving ? "Saving..." : "Save Schema"}
                  </button>
                </div>
              </div>
            )}

            {createStep === "done" && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>✓</div>
                <h3>Schema saved!</h3>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RULES EDITOR OVERLAY ── */}
      {rulesSchema && (
        <div className="overlay" onClick={closeRules}>
          <div className="overlay-content wide" onClick={e => e.stopPropagation()}>
            <div className="overlay-header">
              <h2>Rules: {rulesSchema.client_display_name || rulesSchema.client_id}</h2>
              <button className="overlay-close" onClick={closeRules} aria-label="Close rules editor">✕</button>
            </div>
            <div style={{ maxHeight: '65vh', overflowY: 'auto', padding: '4px 0' }}>
              {Object.entries(rulesSchema.sheets || {}).map(([sheetName, sheet]) => (
                <div key={sheetName} style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', color: 'var(--accent-cyan)' }}>{sheetName}</h3>

                  {/* Default Values */}
                  <div className="modal-section" style={{ marginBottom: '14px' }}>
                    <div className="modal-section-header">Default Values</div>
                    <table className="map-table">
                      <thead><tr><th style={{ width: '40%' }}>Field</th><th>Default Value</th></tr></thead>
                      <tbody>
                        {(sheet.columns || []).map(col => (
                          <tr key={col.canonical_name}>
                            <td><code style={{ fontSize: '0.85rem' }}>{col.canonical_name}</code></td>
                            <td>
                              <input className="create-input"
                                value={col.default_value !== undefined ? String(col.default_value) : ''}
                                onChange={e => updateDefault(sheetName, col.canonical_name, e.target.value)}
                                placeholder="(no default)" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Copy if Blank */}
                  <div className="modal-section" style={{ marginBottom: '14px' }}>
                    <div className="modal-section-header">Copy if Blank</div>
                    <table className="map-table">
                      <thead><tr><th style={{ width: '40%' }}>Target Field</th><th>Copy From</th></tr></thead>
                      <tbody>
                        {(sheet.columns || []).map(col => {
                          const others = (sheet.columns || []).filter(c => c.canonical_name !== col.canonical_name).map(c => c.canonical_name);
                          return (
                            <tr key={col.canonical_name}>
                              <td><code style={{ fontSize: '0.85rem' }}>{col.canonical_name}</code></td>
                              <td>
                                <select value={col.copy_from_column || ''}
                                  onChange={e => updateCopyFrom(sheetName, col.canonical_name, e.target.value)}
                                  style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', width: '100%' }}>
                                  <option value="">(none)</option>
                                  {others.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* SUM Columns */}
                  <div className="modal-section">
                    <div className="modal-section-header">Auto SUM at Bottom</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', paddingTop: '4px' }}>
                      {(sheet.columns || []).map(col => {
                        const isNum = col.datatype === 'integer' || col.datatype === 'decimal';
                        const checked = (sheet.sum_columns || []).includes(col.canonical_name);
                        return (
                          <label key={col.canonical_name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', cursor: 'pointer', opacity: isNum ? 1 : 0.4 }}>
                            <input type="checkbox" disabled={!isNum} checked={checked}
                              onChange={() => toggleSumCol(sheetName, col.canonical_name)} />
                            {col.canonical_name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="form-actions" style={{ marginTop: '16px' }}>
              <button className="btn-secondary" onClick={closeRules}>Cancel</button>
              <button className="btn-primary" style={{ width: 'auto' }} onClick={saveRules}>Save Rules</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const labelStyle = {
  display: 'block', fontSize: '0.8rem', fontWeight: 500,
  color: 'var(--text-secondary)', marginBottom: '4px',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};

const selectStyle = {
  padding: '6px 6px', background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border-color)', borderRadius: '4px',
  color: 'var(--text-primary)', fontSize: '0.8rem', width: '100%',
  fontFamily: 'var(--font-sans)',
};
