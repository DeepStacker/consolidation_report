import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

const API_BASE = (window.location.origin === "http://localhost:5173" || window.location.origin === "http://127.0.0.1:5173")
  ? "http://127.0.0.1:8000"
  : window.location.origin;

// Fuzzy logic for auto-matching Excel headers to database canonical fields
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

// Inferred datatype heuristics
function guessType(name) {
  const n = name.toLowerCase();
  if (n.includes('date') || n.includes('schedule') || n.includes('end ')) return 'date';
  if (n.includes('time')) return 'time';
  if (n.includes('no') || n.includes('count') || n.includes('visit') || n.includes('packet') || n.includes('day') || n.includes('sr')) return 'integer';
  if (n.includes('fee') || n.includes('pay') || n.includes('amount') || n.includes('total') || n.includes('charge') || n.includes('deduction') || n.includes('cost') || n.includes('rate') || n.includes('sum')) return 'decimal';
  return 'string';
}

// Cleaned standard sequence list
const CLEAN_ORDER = [
  // Core / Identifiers / Demographics
  "sno",
  "sr no",
  "client",
  "month",
  "audit month & year",
  "zone",
  "sol id",
  "branch code",
  "branch",
  "branchname",
  "branch name",
  "location",
  "state",
  
  // Auditing / Assayer Demographics
  "total noof a/cs",
  "total no of a/cs",
  "assayer name",
  "assayer code",
  "assayer phone",
  "assayerphone",
  "assayer pan",
  "pan number",
  "contact person",
  "process manager",
  
  // Schedule / Times
  "schedule date",
  "audit schedule date",
  "audit status",
  "audit completion date",
  "end date",
  "assayer reporting time at branch",
  "audit start time",
  "audit end time",
  
  // Audit Counts / Audited Details
  "no of days audited",
  "no of days audited for client",
  "no of visits",
  "no of visit",
  "no of packets audited",
  "additional packet",
  
  // Payment Tracker Specific Fees & Expenses
  "type of audit",
  "base audit fee",
  "total pay (base)",
  "travel charges",
  "travel charges(if any)",
  "cancelled visits",
  "audit cancellation fees",
  "branch cancellation charges",
  "andaman & nicobar branch expenses",
  "error deduction",
  "total pay",
  "remarks (if any)",
  "bank name",
  "a/c number",
  "account number",
  "ifsc code",
  "ifsc",
  
  // Master Data Specific Fees & Financials
  "client fee",
  "client fees",
  "additional",
  "final client fees",
  "assayer fee",
  "assayer fees",
  "additional fee",
  "additional fees",
  "distance",
  "base location",
  "assayer base location",
  "remarks",
  "assayer fee1",
  "assayer fees1",
  "additional fee1",
  "additional fees1",
  "cancelled",
  "cancellation",
  "error deduciton",
  "total",
  "audit remarks",
  "other remarks",
  
  // Pouch details / Extra Auditing details
  "seeding status",
  "report",
  "total pouches suggested for audit",
  "already audited",
  "a/c closed",
  "a/c auctioned",
  "packet missing",
  "actual audited (except already audited & a/c closed)",
  "extra audited pouches",
  "total noof packets actually audited",
  "total no of packets actually audited",
  "type oof audit",
  "aadhar no",
  "remarks1",
  "urban/ rural",
  "t & f client fee",
  "poa client fees",
  "cancelled client fee",
  "billing remarks",
  "touch and feel audit packet count",
  "poa packet count",
  "additional packet t& f",
  "additional packet poa",
  "oracleid",
  "address"
];

const getCanonicalIndex = (name) => {
  if (!name) return Infinity;
  const clean = String(name)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[._]/g, '')
    .trim();
  const idx = CLEAN_ORDER.indexOf(clean);
  return idx === -1 ? Infinity : idx;
};

const sortCanonicalsBySequence = (list) => {
  const unique = [...new Set(list)];
  return unique.sort((a, b) => {
    const idxA = getCanonicalIndex(a);
    const idxB = getCanonicalIndex(b);
    if (idxA !== idxB) return idxA - idxB;
    return String(a).localeCompare(String(b));
  });
};

export default function SchemaManager() {
  const [schemas, setSchemas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Workspace UI states (replaces popups & split-pane with a widescreen 100% switcher)
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Schema creation/mapping workspace parameters
  const [createFile, setCreateFile] = useState(null);
  const [createSheets, setCreateSheets] = useState([]);
  const [canonFields, setCanonFields] = useState([]);
  const [createName, setCreateName] = useState("");
  const [createDisplay, setCreateDisplay] = useState("");
  const [createPattern, setCreatePattern] = useState("");
  const [createMappings, setCreateMappings] = useState({}); // sheetIdx -> col -> { canonical, datatype, mandatory, default_value, copy_from_column }
  const [createPreviews, setCreatePreviews] = useState({}); // sheetIdx -> col -> [samples]
  const [createSumColumns, setCreateSumColumns] = useState({}); // sheetIdx -> [canonical]
  const [createStep, setCreateStep] = useState("upload"); // upload | map | done
  const [saving, setSaving] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [expandedId, setExpandedId] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [loadingExpanded, setLoadingExpanded] = useState(false);
  const [activeSheetTab, setActiveSheetTab] = useState(0);
  const [showHelpGuide, setShowHelpGuide] = useState(true);
  const [magicFeedback, setMagicFeedback] = useState(null);
  const [virtualSearch, setVirtualSearch] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [showMagicDropdown, setShowMagicDropdown] = useState(false);
  const [runningAiMatch, setRunningAiMatch] = useState(false);
  const [targetSheet, setTargetSheet] = useState("");  // which target sheet to map to
  const [targetSheetOptions, setTargetSheetOptions] = useState([]);
  const [sheetTargetHeaders, setSheetTargetHeaders] = useState({}); // sheetName → [headers]
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [quickLookData, setQuickLookData] = useState(null); // {headers, rows} for the target sheet
  const [loadingQuickLook, setLoadingQuickLook] = useState(false);
  
  // Cross-Mapping Matrix states
  const [showMatrix, setShowMatrix] = useState(false);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [matrixData, setMatrixData] = useState([]);
  const [selectedMatrixSheet, setSelectedMatrixSheet] = useState("");
  const [expandedCanonicals, setExpandedCanonicals] = useState(new Set());

  const fileRef = useRef(null);
  const replaceRef = useRef(null);

  // Dynamically resolve all standard canonical database columns for a worksheet
  const getSheetCanonicals = useCallback((sheetName) => {
    const fields = new Set();
    
    // Gather canonicals from existing schemas for this sheet
    schemas.forEach(s => {
      if (!s.sheets) return;
      const target = String(sheetName).toLowerCase().trim();
      const matchedKey = Object.keys(s.sheets).find(k => k.toLowerCase().trim() === target);
      if (matchedKey) {
        (s.sheets[matchedKey].columns || []).forEach(c => {
          if (c.canonical_name) fields.add(c.canonical_name);
        });
      }
    });
    
    // Also add headers from the consolidated file for this specific sheet
    const targetHeaders = sheetTargetHeaders[sheetName] || [];
    targetHeaders.forEach(h => fields.add(h));
    
    // Fallback to global canonFields if no per-sheet headers found
    if (targetHeaders.length === 0) {
      canonFields.forEach(f => fields.add(f));
    }
    
    return Array.from(fields);
  }, [schemas, canonFields, sheetTargetHeaders]);

  // Load available schemas
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch(`${API_BASE}/api/schemas`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSchemas((await r.json()).schemas || []);
      setError(null);
    } catch (e) { 
      setError(e.message); 
    } finally { 
      setLoading(false); 
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Open Matrix View and fetch batch details
  const openMatrixView = async () => {
    setLoadingMatrix(true);
    setShowMatrix(true);
    try {
      const r = await fetch(`${API_BASE}/api/schemas/all-details`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const allTemplates = data.schemas || [];
      setMatrixData(allTemplates);
      
      // Select first distinct sheet name found
      const sheetNames = Array.from(new Set(
        allTemplates.flatMap(s => Object.keys(s.sheets || {}))
      ));
      if (sheetNames.length > 0) {
        setSelectedMatrixSheet(sheetNames[0]);
      }
    } catch (e) {
      alert(`Failed to load cross-mapping details: ${e.message}`);
      setShowMatrix(false);
    } finally {
      setLoadingMatrix(false);
    }
  };

  // Load canonical global fields
  useEffect(() => {
    fetch(`${API_BASE}/api/canonical-fields`)
      .then(r => r.ok ? r.json() : { fields: [] })
      .then(d => setCanonFields(d.fields || []))
      .catch(() => {});
  }, []);

  // Re-fetch target preview when sheet tab changes while Quick Look is open
  useEffect(() => {
    if (!showQuickLook) return;
    setLoadingQuickLook(true);
    const sh = createSheets[activeSheetTab];
    // Derive target sheet from source sheet name (they match: "Payment Tracker" → "Payment Tracker")
    const target = targetSheetOptions.includes(sh?.name) ? sh.name : (targetSheetOptions[0] || "Payment Tracker");
    fetch(`${API_BASE}/api/consolidated-preview?sheet_name=${encodeURIComponent(target)}`)
      .then(r => r.ok ? r.json() : { headers: [], rows: [] })
      .then(d => setQuickLookData(d))
      .catch(() => {})
      .finally(() => setLoadingQuickLook(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheetTab, targetSheet, showQuickLook]);

  // Load available target sheets from consolidated report
  useEffect(() => {
    fetch(`${API_BASE}/api/consolidated-sheets`)
      .then(r => r.ok ? r.json() : { sheets: [] })
      .then(d => {
        setTargetSheetOptions(d.sheets || []);
        if (d.sheets?.length > 0) setTargetSheet(d.sheets[0]);
      })
      .catch(() => {});
  }, []);

  // Load per-sheet headers from consolidated file
  useEffect(() => {
    fetch(`${API_BASE}/api/consolidated-headers`)
      .then(r => r.ok ? r.json() : {})
      .then(d => setSheetTargetHeaders(d || {}))
      .catch(() => {});
  }, []);

  // Quick toggle schema active status
  const handleToggle = async (e, cid) => {
    e.stopPropagation();
    try {
      const r = await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}/toggle`, { method: "PUT" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSchemas(prev => prev.map(s => s.client_id === cid ? { ...s, active: d.active } : s));
    } catch (e) { 
      alert(`Failed to toggle template status: ${e.message}`); 
    }
  };

  // Delete schema definition
  const handleDelete = async (e, cid) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to permanently delete template "${cid}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/schemas/${encodeURIComponent(cid)}`, { method: "DELETE" });
      if (editingId === cid) resetCreate();
      load();
    } catch (e) { 
      alert(`Delete failed: ${e.message}`); 
    }
  };

  // Safe Workspace reset
  const resetCreate = () => {
    setEditingId(null);
    setCreateFile(null);
    setCreateSheets([]);
    setCreateName("");
    setCreateDisplay("");
    setCreatePattern("");
    setCreateMappings({});
    setCreateSumColumns({});
    setCreatePreviews({});
    setCreateStep("upload");
    setActiveSheetTab(0);
    setShowCreate(false);
  };

  // Edit action - loads full schema into workspace
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
      
      const sheetNames = Object.keys(schema.sheets || {});
      const sheets = sheetNames.map(name => {
        // Physical columns have configured Excel synonym variations
        const physical = (schema.sheets[name]?.columns || []).filter(c => c.synonyms && c.synonyms.length > 0);
        return {
          name,
          columns: physical.map(c => c.synonyms[0]),
        };
      });
      
      const maps = {};
      const sums = {};
      sheetNames.forEach((name, si) => {
        maps[si] = {};
        sums[si] = schema.sheets[name]?.sum_columns || [];
        (schema.sheets[name]?.columns || []).forEach(c => {
          const isVirtual = !c.synonyms || c.synonyms.length === 0;
          const srcCol = isVirtual ? "" : c.synonyms[0];
          maps[si][c.canonical_name] = {
            source_column: srcCol,
            datatype: c.datatype || 'string',
            mandatory: c.mandatory || false,
            default_value: c.default_value !== undefined ? String(c.default_value) : '',
            copy_from_column: c.copy_from_column || '',
            validation_regex: c.validation_regex || '',
            validation_exceptions: c.validation_exceptions || [],
            header_name: c.header_name || '',
          };
        });
      });
      setCreateSheets(sheets);
      setCreateMappings(maps);
      setCreateSumColumns(sums);
      setCreateStep("map");
      setActiveSheetTab(0);
      setShowCreate(true);
    } catch (e) { 
      alert(`Failed to load schema details: ${e.message}`); 
    }
  };

  // Copy/Duplicate schema
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
      const sheets = sheetNames.map(name => {
        // Physical columns have configured Excel synonym variations
        const physical = (schema.sheets[name]?.columns || []).filter(c => c.synonyms && c.synonyms.length > 0);
        return {
          name,
          columns: physical.map(c => c.synonyms[0]),
        };
      });
      
      const maps = {};
      const sums = {};
      sheetNames.forEach((name, si) => {
        maps[si] = {};
        sums[si] = schema.sheets[name]?.sum_columns || [];
        (schema.sheets[name]?.columns || []).forEach(c => {
          const isVirtual = !c.synonyms || c.synonyms.length === 0;
          const srcCol = isVirtual ? "" : c.synonyms[0];
          maps[si][c.canonical_name] = {
            source_column: srcCol,
            datatype: c.datatype || 'string',
            mandatory: c.mandatory || false,
            default_value: c.default_value !== undefined ? String(c.default_value) : '',
            copy_from_column: c.copy_from_column || '',
            validation_regex: c.validation_regex || '',
            validation_exceptions: c.validation_exceptions || [],
            header_name: c.header_name || '',
          };
        });
      });
      setCreateSheets(sheets);
      setCreateMappings(maps);
      setCreateSumColumns(sums);
      setCreateStep("map");
      setActiveSheetTab(0);
      setShowCreate(true);
    } catch (e) { 
      alert(`Duplicate failed: ${e.message}`); 
    }
  };

  // Expand Schema details directly in explorer row
  const handleToggleExpand = async (e, cid) => {
    e.stopPropagation();
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
    } catch (err) {
      setExpandedData(null);
    } finally {
      setLoadingExpanded(false);
    }
  };

  // One-click Auto align using fuzzy matching database
  const handleAutoAlign = () => {
    let matchedCount = 0;
    let totalCols = 0;

    setCreateMappings(prev => {
      const maps = { ...prev };
      createSheets.forEach((sh, si) => {
        maps[si] = maps[si] || {};
        const sheetCanonicals = getSheetCanonicals(sh.name);
        
        sheetCanonicals.forEach(canonCol => {
          totalCols++;
          const match = bestMatch(canonCol, sh.columns);
          const existing = maps[si]?.[canonCol] || {};
          
          maps[si][canonCol] = {
            source_column: match || existing.source_column || '',
            datatype: existing.datatype || guessType(canonCol),
            mandatory: existing.mandatory || false,
            default_value: existing.default_value || '',
            copy_from_column: existing.copy_from_column || ''
          };
          
          if (match) {
            matchedCount++;
          }
        });
      });
      return maps;
    });

    const msg = matchedCount > 0
      ? `🪄 Scanned standard report columns and auto-aligned ${matchedCount} matching spreadsheet fields!`
      : `🪄 Scanned standard report columns and auto-aligned fallback rules!`;
    setMagicFeedback(msg);
    setTimeout(() => { setMagicFeedback(null); }, 4000);
  };

  // One-click AI semantic auto-match using Google Gemini
  const handleAiAutoAlign = async () => {
    if (!geminiApiKey.trim()) {
      alert("Please enter a valid Gemini API Key from Google AI Studio first!");
      return;
    }
    
    const sh = createSheets[activeSheetTab];
    if (!sh) return;
    
    // Save key to localStorage
    localStorage.setItem("gemini_api_key", geminiApiKey.trim());
    
    setRunningAiMatch(true);
    setMagicFeedback("✨ Sending columns & row data to Gemini AI model...");
    
    // Construct lightweight preview rows for AI
    const previewRows = [];
    const maxRows = 20;
    for (let r = 0; r < maxRows; r++) {
      const row = {};
      let hasData = false;
      sh.columns.forEach(col => {
        const val = createPreviews[activeSheetTab]?.[col]?.[r];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          row[col] = val;
          hasData = true;
        }
      });
      if (hasData) previewRows.push(row);
    }

    try {
      const res = await fetch(`${API_BASE}/api/ai-auto-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_name: targetSheet || "Payment Tracker",
          filename: createFile?.name || "",
          columns: sh.columns,
          preview: previewRows,
          api_key: geminiApiKey.trim()
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      
      const data = await res.json();
      if (data.success) {
        const aiMappings = data.mappings || {};
        const aiRules = data.rules || {};
        const targetHeaders = data.target_headers || [];
        const matchedSheet = data.matched_sheet || targetSheet;

        setMagicFeedback(`✨ Gemini mapped to "${matchedSheet}" successfully!`);
        setShowMagicDropdown(false);
      } else {
        throw new Error("API responded with success: false");
      }
    } catch (err) {
      alert(`Gemini AI alignment failed: ${err.message}`);
      setMagicFeedback("❌ AI Mapping failed");
    } finally {
      setRunningAiMatch(false);
      setTimeout(() => { setMagicFeedback(null); }, 4000);
    }
  };

  // Upload mapping file
  const handleFileDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) { 
      alert("Please upload valid Excel workbooks (.xlsx or .xls)!"); 
      return; 
    }
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
      const sums = {};
      (data.sheets || []).forEach((sh, si) => {
        maps[si] = {};
        prevs[si] = {};
        sums[si] = [];
        
        sh.columns.forEach(col => {
          prevs[si][col] = (sh.preview || []).slice(0, 5).map(r => r[col]);
        });

        const sheetCanonicals = getSheetCanonicals(sh.name);
        sheetCanonicals.forEach(canonCol => {
          const match = bestMatch(canonCol, sh.columns);
          maps[si][canonCol] = {
            source_column: match || '',
            datatype: guessType(canonCol),
            mandatory: false,
            default_value: '',
            copy_from_column: ''
          };
        });
      });
      setCreateMappings(maps);
      setCreateSumColumns(sums);
      setCreatePreviews(prevs);
      // Auto-fill naming from filename
      const base = file.name.replace(/\.xlsx?$/i, '').replace(/[-_]/g, ' ').trim();
      setCreateDisplay(base);
      const clientMatch = base.match(/^([^-]+)/);
      if (clientMatch) {
        const cid = clientMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        setCreateName(cid);
        setCreatePattern(`*${cid}*`);
      }
      setCreateStep("map");
      setActiveSheetTab(0);
    } catch (err) { 
      alert(`Excel Analysis failed: ${err.message}`); 
    }
  };

  // Replace mapping columns with excel
  const handleReplaceExcel = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) { 
      alert("Please upload valid Excel workbooks (.xlsx or .xls)!"); 
      return; 
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`${API_BASE}/api/analyze-excel`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      
      const oldMaps = createMappings;
      const maps = {};
      const sums = {};
      const prevs = {};
      
      (data.sheets || []).forEach((sh, si) => {
        maps[si] = {};
        sums[si] = createSumColumns[si] || [];
        prevs[si] = {};
        
        sh.columns.forEach(col => {
          prevs[si][col] = (sh.preview || []).slice(0, 5).map(r => r[col]);
        });

        const sheetCanonicals = getSheetCanonicals(sh.name);
        sheetCanonicals.forEach(canonCol => {
          const existing = oldMaps[si]?.[canonCol];
          if (existing) {
            maps[si][canonCol] = existing;
          } else {
            const match = bestMatch(canonCol, sh.columns);
            maps[si][canonCol] = {
              source_column: match || '',
              datatype: guessType(canonCol),
              mandatory: false,
              default_value: '',
              copy_from_column: ''
            };
          }
        });
      });
      
      setCreateSheets(data.sheets || []);
      setCreateMappings(maps);
      setCreateSumColumns(sums);
      setCreatePreviews(prevs);
    } catch (err) { 
      alert(`Replace failed: ${err.message}`); 
    }
  };

  // Update a column field property
  const updateMapping = (si, col, field, val) => {
    setCreateMappings(prev => {
      const m = { ...prev };
      if (!m[si]) m[si] = {};
      m[si] = { ...m[si], [col]: { ...(m[si][col] || {}), [field]: val } };
      return m;
    });
  };

  // Auto Sum Toggles
  const toggleSumColumn = (si, colCanonical) => {
    setCreateSumColumns(prev => {
      const s = { ...prev };
      const currentSums = s[si] || [];
      if (currentSums.includes(colCanonical)) {
        s[si] = currentSums.filter(c => c !== colCanonical);
      } else {
        s[si] = [...currentSums, colCanonical];
      }
      return s;
    });
  };

  // Save full definition to database
  const handleSave = async () => {
    const cid = createName.trim();
    if (!cid) { alert("Please enter a unique template ID."); return; }
    if (!createSheets.length) { alert("Please upload Excel sheets to parse."); return; }
    setSaving(true);
    
    const sheetData = createSheets.map((sh, si) => {
      // Get all standard canonicals for this sheet, sorted in proper sequence
      const sheetCanonicals = sortCanonicalsBySequence(getSheetCanonicals(sh.name));

      const cols = sheetCanonicals.map(cname => {
        const m = createMappings[si]?.[cname] || {};
        let srcCol = m.source_column || "";
        const entry = {
          canonical_name: cname,
          datatype: m.datatype || 'string',
          synonyms: []
        };
        if (srcCol === "__filename__") {
          entry.default_value = "__from_filename__";
        } else {
          if (srcCol) {
            entry.synonyms = [srcCol];
            if (cname.toLowerCase() !== srcCol.toLowerCase()) {
              entry.synonyms.push(cname);
            }
          }
          if (m.default_value !== undefined && String(m.default_value).trim() !== '') {
            entry.default_value = m.default_value;
          }
        }
        if (m.mandatory) {
          entry.mandatory = true;
        }
        if (m.copy_from_column && m.copy_from_column !== '') {
          entry.copy_from_column = m.copy_from_column;
        }
        // Restore preserved regex, exceptions, and header_name
        if (m.validation_regex) {
          entry.validation_regex = m.validation_regex;
        }
        if (m.validation_exceptions && m.validation_exceptions.length > 0) {
          entry.validation_exceptions = m.validation_exceptions;
        }
        if (m.header_name) {
          entry.header_name = m.header_name;
        }
        return entry;
      });
      
      const sumCols = createSumColumns[si] || [];
      return { 
        name: sh.name, 
        header_row: 1, 
        data_start_row: 2, 
        columns: cols,
        sum_columns: sumCols 
      };
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
      if (!r.ok) { 
        const err = await r.json(); 
        throw new Error(err.detail || `HTTP ${r.status}`); 
      }
      
      setCreateStep("done");
      load();
      setTimeout(() => { resetCreate(); }, 1200);
    } catch (e) { 
      alert(`Save failed: ${e.message}`); 
    } finally { 
      setSaving(false); 
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Memoized lists
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
      {/* ================= VIEW C: GLOBAL CROSS-MAPPING MATRIX ================= */}
      {showMatrix && (
        <div className="matrix-container" style={{ animation: 'fade-in 0.25s ease' }}>
          {/* Header */}
          <div className="matrix-header">
            <div>
              <h1 style={{ fontSize: '2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>🌐</span> Global Cross-Mapping Matrix
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                A comprehensive side-by-side audit of how every client template maps to your consolidated database. Spot gaps, verify rules, and compare source definitions at a single glance.
              </p>
            </div>
            <button className="overlay-close" onClick={() => setShowMatrix(false)}
              style={{ width: '40px', height: '40px', fontSize: '1.4rem' }} title="Return to Explorer">✕</button>
          </div>

          {loadingMatrix ? (
            <div className="panel" style={{ padding: '80px 40px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}>
              <span className="spinner" style={{ marginRight: '10px' }}></span> Loading template definitions...
            </div>
          ) : matrixData.length === 0 ? (
            <div className="panel" style={{ padding: '80px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)' }}>
              <span style={{ fontSize: '2rem' }}>⚠️</span>
              <strong style={{ marginTop: '8px' }}>No active templates found</strong>
              <p style={{ fontSize: '0.85rem' }}>Create some client templates first to compare them here.</p>
            </div>
          ) : (() => {
              // Helper to normalize whitespaces, tabs, newlines and casing for strict matches
              const cleanName = (str) => {
                if (!str) return "";
                return String(str).toLowerCase().replace(/\s+/g, ' ').trim();
              };

              // Helper to find sheet name case-insensitively with whitespace normalization
              const findSheetCaseInsensitive = (sheets, sName) => {
                if (!sheets) return null;
                const target = cleanName(sName);
                const matchedKey = Object.keys(sheets).find(k => cleanName(k) === target);
                return matchedKey ? sheets[matchedKey] : null;
              };

              // Helper to find sheet's key name case-insensitively with whitespace normalization
              const findSumColumnsCaseInsensitive = (s, sName) => {
                if (!s?.sheets) return [];
                const target = cleanName(sName);
                const matchedKey = Object.keys(s.sheets).find(k => cleanName(k) === target);
                return matchedKey ? (s.sheets[matchedKey].sum_columns || []) : [];
              };

              // Helper to map column to standard canonical casing from canonFields with whitespace normalization
              const getStandardCanonicalName = (name) => {
                const target = cleanName(name);
                const matched = canonFields.find(f => cleanName(f) === target);
                return matched || name;
              };

              // Helper to find column inside a sheet case-insensitively with whitespace normalization
              const findColumnCaseInsensitive = (sheetColumns, canonName) => {
                if (!sheetColumns) return null;
                const target = cleanName(canonName);
                return sheetColumns.find(c => cleanName(c.canonical_name) === target);
              };

              // Gather worksheet names across all templates
              const rawSheetNames = Array.from(new Set(
                matrixData.flatMap(s => Object.keys(s.sheets || {}))
              ));
              
              // Unique sheet names grouped case-insensitively with whitespace normalization
              const sheetNames = [];
              rawSheetNames.forEach(sName => {
                const cleaned = cleanName(sName);
                if (!sheetNames.some(existing => cleanName(existing) === cleaned)) {
                  sheetNames.push(sName);
                }
              });
              
              const activeSheet = selectedMatrixSheet || sheetNames[0] || "";
              
              // Gather canonical columns mapped by any template for the active sheet
              const rawCanonicals = Array.from(new Set(
                matrixData.flatMap(s => {
                  const sheet = findSheetCaseInsensitive(s.sheets, activeSheet);
                  return (sheet?.columns || []).map(c => getStandardCanonicalName(c.canonical_name));
                })
              ));

              const canonicals = sortCanonicalsBySequence(rawCanonicals.reduce((acc, cName) => {
                const cleaned = cleanName(cName);
                if (!acc.some(existing => cleanName(existing) === cleaned)) {
                  acc.push(cName);
                }
                return acc;
              }, []));

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Sheet tabs selector */}
                  {sheetNames.length > 1 && (
                    <div className="map-sheet-tabs" style={{ marginBottom: 0 }}>
                      {sheetNames.map((sName) => (
                        <div key={sName}
                          className={`sheet-tab ${cleanName(sName) === cleanName(activeSheet) ? 'active' : ''}`}
                          onClick={() => setSelectedMatrixSheet(sName)}
                          style={{ fontSize: '0.85rem', padding: '8px 18px' }}>
                          📊 Sheet: "{sName}"
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Main Grid */}
                  <div className="panel" style={{ padding: '24px', overflowX: 'auto' }}>
                    <table className="schema-table" style={{ minWidth: `${260 + (matrixData.length * 280)}px` }}>
                      <thead>
                        <tr>
                          <th className="matrix-th-canonical">Consolidated Column</th>
                          {matrixData.map(s => (
                            <th key={s.client_id} style={{ width: '280px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ color: '#fff', fontSize: '0.9rem' }}>{s.client_display_name || s.client_id}</span>
                                <code style={{ fontSize: '0.72rem', color: s.active ? 'var(--accent-success)' : 'var(--text-muted)', marginTop: '2px' }}>
                                  {s.client_id} {s.active ? '(Active)' : '(Inactive)'}
                                </code>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {canonicals.map(canonCol => {
                          const isSumChecked = (s) => {
                            const sumCols = findSumColumnsCaseInsensitive(s, activeSheet);
                            const target = cleanName(canonCol);
                            return sumCols.some(c => cleanName(c) === target);
                          };

                          // Auditing discrepancies for this row
                          const mappedCols = matrixData.map(s => {
                            const sheet = findSheetCaseInsensitive(s.sheets, activeSheet);
                            return findColumnCaseInsensitive(sheet?.columns, canonCol);
                          }).filter(Boolean);

                          const datatypes = Array.from(new Set(mappedCols.map(c => c.datatype || 'string')));
                          const mandatories = Array.from(new Set(mappedCols.map(c => c.mandatory || false)));
                          const sumStatuses = Array.from(new Set(matrixData.map(isSumChecked)));

                          // Flag discrepancies
                          const hasDatatypeMismatch = datatypes.length > 1;
                          const hasPolicyMismatch = mandatories.length > 1 || sumStatuses.length > 1;

                          return (
                            <tr key={canonCol} className={hasDatatypeMismatch ? 'matrix-row-discrepancy' : ''}>
                              <td className="matrix-td-canonical">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <span>{canonCol}</span>
                                  {hasDatatypeMismatch && (
                                    <span className="mismatch-banner datatype" title="Critical: Client templates parse this column differently.">
                                      ⚠️ Format Mismatch ({datatypes.join(' vs ')})
                                    </span>
                                  )}
                                  {hasPolicyMismatch && !hasDatatypeMismatch && (
                                    <span className="mismatch-banner policy" title="Templates have different required or AutoSUM rules for this column.">
                                      ℹ️ Rule Discrepancy
                                    </span>
                                  )}
                                </div>
                              </td>
                              
                              {matrixData.map(s => {
                                const sheet = findSheetCaseInsensitive(s.sheets, activeSheet);
                                const colInfo = findColumnCaseInsensitive(sheet?.columns, canonCol);
                                const isSum = isSumChecked(s);

                                if (!colInfo) {
                                  return (
                                    <td key={s.client_id} className="matrix-cell-unmapped">
                                      <span className="matrix-pill-unmapped">— Not Aligned</span>
                                    </td>
                                  );
                                }

                                const synonyms = colInfo.synonyms || [];
                                const clientSynonym = synonyms[0] || colInfo.canonical_name;

                                return (
                                  <td key={s.client_id} style={{ verticalAlign: 'top' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                      <span className="matrix-pill-mapped" title={`Mapped from Excel header synonym: "${clientSynonym}"`}>
                                        {clientSynonym}
                                      </span>
                                      <div className="matrix-rules-wrap">
                                        <span className="matrix-badge-rule" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                          {colInfo.datatype || 'string'}
                                        </span>
                                        {isSum && <span className="matrix-badge-rule sum">Σ SUM</span>}
                                        {colInfo.mandatory && <span className="matrix-badge-rule req">Required</span>}
                                        {colInfo.default_value !== undefined && String(colInfo.default_value).trim() !== '' && (
                                          <span className="matrix-badge-rule def" title={`Default value fallback: "${colInfo.default_value}"`}>
                                            Def: {String(colInfo.default_value)}
                                          </span>
                                        )}
                                        {colInfo.copy_from_column && (
                                          <span className="matrix-badge-rule copy" title={`Copy fallback from column: "${colInfo.copy_from_column}"`}>
                                            ☞ {colInfo.copy_from_column}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()
          }
          
          <div style={{ height: '32px' }} />
        </div>
      )}

      {/* ================= VIEW A: WIDESCREEN SCHEMA REPOSITORY ================= */}
      {!showCreate && !showMatrix && (
        <div style={{ animation: 'fade-in 0.25s ease' }}>
          <header style={{ marginBottom: '24px' }}>
            <h1>Excel Templates Explorer</h1>
            <p>Configure custom workbook rules, match file naming patterns, and align columns to standard database names</p>
          </header>

          {/* Friendly Non-Tech Walkthrough Guide */}
          <div className="panel" style={{ padding: '16px 20px', marginBottom: '20px', background: 'rgba(99, 102, 241, 0.02)', border: '1px solid rgba(99, 102, 241, 0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setShowHelpGuide(!showHelpGuide)}>
              <span style={{ fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
                <span>🌟</span> New to Templates? Toggle 30-Second Quick Start Guide
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>{showHelpGuide ? '▲ Collapse' : '▼ Expand Guide'}</span>
            </div>
            
            {showHelpGuide && (
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', animation: 'fade-in 0.25s ease' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--accent-cyan)', width: '28px', height: '28px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, fontSize: '0.85rem' }}>1</div>
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: '#fff', display: 'block', marginBottom: '3px' }}>Create or Select a Template</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, display: 'block' }}>
                      Click "+ Design Template" or edit an existing one. A Template teaches the system how to read a client's specific sheet.
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-indigo)', width: '28px', height: '28px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, fontSize: '0.85rem' }}>2</div>
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: '#fff', display: 'block', marginBottom: '3px' }}>Set File Matching Rules</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, display: 'block' }}>
                      Assign a filename rule (e.g. *SVM*) so uploaded client files automatically match this template configuration.
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-success)', width: '28px', height: '28px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, fontSize: '0.85rem' }}>3</div>
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: '#fff', display: 'block', marginBottom: '3px' }}>🪄 Magic Auto-Match Columns</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, display: 'block' }}>
                      Upload an Excel sample file, then click "Magic Auto-Match Columns" to align headers and apply formulas in 1-click.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Repository Explorer Toolbar */}
          <div className="panel schema-toolbar" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div className="schema-search-wrap" style={{ flex: 1, maxWidth: '400px' }}>
              <span className="schema-search-icon">🔍</span>
              <input className="schema-search-input"
                placeholder="Search templates by name, sheet, or ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)} style={{ padding: '10px 14px 10px 38px' }} />
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {searchQuery && (
                <span className="schema-result-count" style={{ marginRight: '8px' }}>
                  Matches: {filteredSchemas.length} of {schemas.length}
                </span>
              )}
              <button className="btn-secondary" style={{ width: 'auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(99, 102, 241, 0.3)', background: 'rgba(99, 102, 241, 0.08)', color: '#fff' }} onClick={openMatrixView}>
                <span>🌐</span> Global Alignment Matrix
              </button>
              <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => { resetCreate(); setShowCreate(true); }}>
                <span>+</span> Design Template
              </button>
            </div>
          </div>

          {/* Full-Width Spacious Repository Table */}
          <div className="panel" style={{ padding: '24px', overflowX: 'auto' }}>
            {loading ? (
              <table className="schema-table">
                <thead><tr>
                  <th style={{ width: '70px' }}>Active</th>
                  <th style={{ width: '320px' }}>Template Label</th>
                  <th>Workbook Sheets</th>
                  <th style={{ width: '100px' }}>Columns</th>
                  <th style={{ width: '380px', textAlign: 'right' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {[1, 2, 3].map(i => (
                    <tr key={i} className="schema-skeleton-row" style={{ opacity: 0.5 }}>
                      <td><div className="schema-skeleton-bar" style={{ width: '36px', height: '20px', borderRadius: '10px' }}></div></td>
                      <td><div className="schema-skeleton-bar" style={{ width: '160px', height: '14px' }}></div></td>
                      <td><div className="schema-skeleton-bar" style={{ width: '60%' }}></div></td>
                      <td><div className="schema-skeleton-bar" style={{ width: '30px' }}></div></td>
                      <td><div className="schema-skeleton-bar" style={{ width: '360px', float: 'right' }}></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : filteredSchemas.length === 0 ? (
              <div className="consolidate-right-placeholder" style={{ padding: '80px 40px' }}>
                <span style={{ fontSize: '2.5rem' }}>📋</span>
                <span style={{ fontWeight: 600 }}>No templates matching filters</span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '300px', margin: '4px 0 12px' }}>
                  Adjust your search inputs or click below to build a brand new client workbook template mapping rule.
                </p>
                {searchQuery && <button className="btn-sm" onClick={() => setSearchQuery("")}>Reset search filter</button>}
              </div>
            ) : (
              <table className="schema-table">
                <thead><tr>
                  <th style={{ width: '70px' }}>Active</th>
                  <th className="schema-th-sortable" onClick={() => handleSort('name')} style={{ width: '320px' }}>
                    Template Label {sortArrow('name')}
                  </th>
                  <th className="schema-th-sortable" onClick={() => handleSort('sheets')}>
                    Workbook Sheets {sortArrow('sheets')}
                  </th>
                  <th className="schema-th-sortable" onClick={() => handleSort('columns')} style={{ width: '100px' }}>
                    Columns {sortArrow('columns')}
                  </th>
                  <th style={{ width: '380px', textAlign: 'right' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {filteredSchemas.map(s => (
                    <React.Fragment key={s.client_id}>
                      <tr>
                        <td>
                          {/* Active state switch */}
                          <label className="toggle-label">
                            <input type="checkbox" checked={s.active} onChange={(e) => handleToggle(e, s.client_id)} />
                            <span className={`toggle-indicator ${s.active ? 'on' : ''}`}></span>
                          </label>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <strong style={{ fontSize: '0.96rem', color: '#fff' }}>{s.client_display_name || s.client_id}</strong>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                              <code style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', background: 'rgba(6,182,212,0.05)', padding: '1px 5px', borderRadius: '4px' }}>{s.client_id}</code>
                              {s.filename_pattern && (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>({s.filename_pattern})</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>{(s.sheet_names || []).join(", ")}</td>
                        <td style={{ fontWeight: 600 }}>{s.column_count ?? "—"}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="schema-actions" style={{ justifyContent: 'flex-end', gap: '6px' }}>
                            <button className="btn-sm btn-sm-edit" onClick={() => handleEdit(s.client_id)} style={{ padding: '4px 12px' }}>✎ Edit Rules</button>
                            <button className="btn-sm btn-sm-copy" onClick={() => handleCopy(s.client_id)} style={{ padding: '4px 12px' }}>⧉ Copy</button>
                            <button className="btn-sm btn-danger" onClick={(e) => handleDelete(e, s.client_id)} style={{ padding: '4px 12px' }}>🗑 Delete</button>
                            <button className="btn-sm btn-sm-detail" onClick={(e) => handleToggleExpand(e, s.client_id)} style={{ padding: '4px 12px' }}>
                              {expandedId === s.client_id ? '▲ Less' : '▼ Details'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === s.client_id && (
                        <tr className="schema-detail-row">
                          <td colSpan={5}>
                            <div className="schema-detail-inner" style={{ padding: '20px 24px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', margin: '4px 12px 12px' }}>
                              {loadingExpanded ? (
                                <div className="schema-skeleton-bar" style={{ width: '50%', height: '30px' }}></div>
                              ) : expandedData ? (
                                Object.entries(expandedData.sheets || {}).length === 0 ? (
                                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No worksheets defined in this template.</div>
                                ) : (
                                  Object.entries(expandedData.sheets || {}).map(([sheetName, sheet]) => (
                                    <div key={sheetName} className="schema-detail-sheet" style={{ marginBottom: '16px' }}>
                                      <div className="schema-detail-sheet-name" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: '8px' }}>
                                        Sheet: "{sheetName}" 
                                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '10px', fontSize: '0.78rem' }}>
                                          (Header row: {sheet.header_row ?? 1}, data starts: {sheet.data_start_row ?? 2})
                                        </span>
                                      </div>
                                      <div className="schema-detail-cols" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                        {(sheet.columns || []).map(col => {
                                          const isSummed = (sheet.sum_columns || []).includes(col.canonical_name);
                                          return (
                                            <span key={col.canonical_name} 
                                              className={`schema-detail-col-chip ${col.mandatory ? 'mandatory' : ''}`}
                                              style={{ 
                                                fontSize: '0.74rem', 
                                                padding: '4px 10px', 
                                                border: isSummed ? '1px solid rgba(6,182,212,0.3)' : undefined,
                                                background: isSummed ? 'rgba(6,182,212,0.04)' : undefined
                                              }}
                                              title={`${col.canonical_name}${col.mandatory ? ' (Mandatory)' : ''}${col.default_value !== undefined ? ` | Default: "${col.default_value}"` : ''}${col.copy_from_column ? ` | Fallback: "${col.copy_from_column}"` : ''}`}>
                                              <strong>{col.canonical_name}</strong>
                                              {col.mandatory && <span style={{ color: 'var(--accent-error)', marginLeft: '2px' }}>*</span>}
                                              <span className="schema-detail-col-type" style={{ marginLeft: '4px', opacity: 0.8 }}>{col.datatype || 'string'}</span>
                                              {isSummed && <span style={{ color: 'var(--accent-cyan)', marginLeft: '4px', fontSize: '0.65rem', fontWeight: 800 }}>Σ</span>}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))
                                )
                              ) : (
                                <span style={{ color: 'var(--accent-error)' }}>Failed to load worksheet templates.</span>
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
        </div>
      )}

      {/* ================= VIEW B: MAJESTIC WIDESCREEN IN-PAGE BUILDER (100% Full Width) ================= */}
      {showCreate && !showMatrix && (
        <div style={{ animation: 'fade-in 0.25s ease' }}>
          
          {/* Builder Top Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', margin: 0 }}>
                {editingId ? `✎ ${editingId}` : "◈ New Template"}
              </h2>
            </div>
            <button className="overlay-close" onClick={resetCreate} 
              style={{ width: '32px', height: '32px', fontSize: '1.1rem' }} title="Return to Explorer">✕</button>
          </div>

          {/* BUILDER WORKSPACE STEP 1: PARSE EXCEL */}
          {createStep === "upload" && (
            <div className="panel" style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', gap: '10px' }}>
              <div className="dropzone"
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileRef.current?.click()}
                style={{ width: '100%', maxWidth: '480px', padding: '32px 24px', border: '2.5px dashed var(--accent-indigo)', background: 'rgba(99,102,241,0.015)', borderRadius: '10px' }}
              >
                <input ref={fileRef} type="file" style={{ display: 'none' }}
                  accept=".xlsx,.xls" onChange={handleFileDrop} />
                <div className="dropzone-icon" style={{ fontSize: '2.5rem' }}>📊</div>
                <h3 style={{ fontSize: '1rem', marginTop: '8px', fontWeight: 700 }}>Upload Client Spreadsheet</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', maxWidth: '360px', margin: '4px auto 0' }}>
                  The engine will scan all worksheets, headers, and column shapes.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button className="btn-secondary" style={{ width: 'auto', padding: '6px 16px' }} onClick={resetCreate}>Cancel</button>
              </div>
            </div>
          )}

          {/* BUILDER WORKSPACE STEP 2: MAJESTIC MAPPING GRID */}
          {createStep === "map" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              
              {/* Excel Re-upload panel */}
              <div className="panel replace-dropzone"
                onDragOver={e => e.preventDefault()}
                onDrop={handleReplaceExcel}
                style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.005)', borderStyle: 'solid', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.85rem' }}>🔄</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Drop a new Excel to re-parse, or click to choose file.
                  </span>
                </div>
                <input ref={replaceRef} type="file" style={{ display: 'none' }}
                  accept=".xlsx,.xls" onChange={handleReplaceExcel} />
                <button className="btn-sm btn-secondary" onClick={() => replaceRef.current?.click()} style={{ padding: '4px 10px', fontSize: '0.72rem' }}>
                  Choose file...
                </button>
              </div>

              {/* Main Definitions Form Block */}
              <div className="panel" style={{ padding: '12px 16px', marginBottom: 0 }}>
                <h3 className="modal-section-header" style={{ fontSize: '0.8rem', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '6px' }}>
                  <span className="step-badge">1</span> Template Naming
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.8fr', gap: '12px' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '0.72rem', fontWeight: 600 }}>Template ID *</label>
                    <input className="create-input" value={createName}
                      disabled={!!editingId}
                      onChange={e => setCreateName(e.target.value.replace(/\s+/g, '_').toLowerCase())}
                      placeholder="e.g. standard_financial" style={{ padding: '6px 10px', fontSize: '0.78rem' }} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '0.72rem', fontWeight: 600 }}>Client Label</label>
                    <input className="create-input" value={createDisplay}
                      onChange={e => setCreateDisplay(e.target.value)}
                      placeholder="e.g. Standard Financial Client" style={{ padding: '6px 10px', fontSize: '0.78rem' }} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '0.72rem', fontWeight: 600 }}>Filename Pattern</label>
                    <input className="create-input" value={createPattern}
                      onChange={e => setCreatePattern(e.target.value)}
                      placeholder={`*${createName || 'client'}*`} style={{ padding: '6px 10px', fontSize: '0.78rem' }} />
                  </div>
                </div>
              </div>

              {/* Column Mapping Section */}
              <div className="panel" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 0 }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '6px' }}>
                  <h3 className="modal-section-header" style={{ fontSize: '0.8rem', margin: 0 }}>
                    <span className="step-badge">2</span> Column Mapping
                  </h3>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                    <button className="btn-sm"
                      onClick={() => {
                        const next = !showQuickLook;
                        setShowQuickLook(next);
                        if (next) {
                          setLoadingQuickLook(true);
                          const sh = createSheets[activeSheetTab];
                          const target = targetSheetOptions.includes(sh?.name) ? sh.name : (targetSheetOptions[0] || "Payment Tracker");
                          fetch(`${API_BASE}/api/consolidated-preview?sheet_name=${encodeURIComponent(target)}`)
                            .then(r => r.ok ? r.json() : { headers: [], rows: [] })
                            .then(d => setQuickLookData(d))
                            .catch(() => {})
                            .finally(() => setLoadingQuickLook(false));
                        }
                      }}
                      style={{ fontSize: '0.7rem', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--accent-indigo)' }}
                      title="Preview actual data from source and target files side-by-side">
                      <span>👁</span> Quick Look
                    </button>
                    {magicFeedback && (
                      <span style={{
                        fontSize: '0.72rem',
                        color: 'var(--accent-success)',
                        background: 'rgba(16,185,129,0.08)',
                        border: '1px solid rgba(16,185,129,0.2)',
                        padding: '3px 10px',
                        borderRadius: '4px',
                        fontWeight: 600,
                      }}>
                        {magicFeedback}
                      </span>
                    )}
                    {/* Single Auto-Match Button */}
                    <button className="btn-sm btn-sm-copy"
                      onClick={async () => {
                        const savedKey = localStorage.getItem("gemini_api_key");
                        if (savedKey && savedKey.trim().length > 10) {
                          setGeminiApiKey(savedKey);
                          await handleAiAutoAlign();
                        } else {
                          handleAutoAlign();
                          const key = prompt("Enter your free Gemini API Key from https://aistudio.google.com/apikey for AI-powered matching (or leave blank to keep fuzzy match):");
                          if (key && key.trim().length > 10) {
                            setGeminiApiKey(key.trim());
                            localStorage.setItem("gemini_api_key", key.trim());
                            await handleAiAutoAlign();
                          }
                        }
                      }}
                      style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.08)', color: 'var(--accent-success)' }}
                      title="Automatically match columns using AI (Gemini) or fuzzy matching.">
                      <span>✨ Auto-Match</span>
                    </button>
                  </div>
                </div>

                {/* Quick Look Panel */}
                {showQuickLook && (
                  <div className="panel" style={{ padding: '0', marginBottom: '4px', border: '1px solid rgba(99,102,241,0.15)', background: 'rgba(99,102,241,0.01)' }}>
                    <div style={{ display: 'flex', borderBottom: '1px solid rgba(99,102,241,0.1)', padding: '4px 10px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-indigo)' }}>
                      <span style={{ flex: 1 }}>📂 {createSheets[activeSheetTab]?.name || '—'}</span>
                      <span style={{ flex: 1 }}>🎯 {targetSheetOptions.includes(createSheets[activeSheetTab]?.name) ? createSheets[activeSheetTab]?.name : (targetSheetOptions[0] || '—')}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', maxHeight: '200px', overflow: 'auto', fontSize: '0.65rem' }}>
                      <div style={{ overflowX: 'auto', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                        {(() => {
                          const sh = createSheets[activeSheetTab];
                          if (!sh) return <div style={{ padding: '8px', color: 'var(--text-muted)' }}>No source data</div>;
                          const cols = [...new Set(sh.columns)];
                          return (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  <th style={{ position: 'sticky', top: 0, background: 'var(--panel-bg)', padding: '2px 4px', borderBottom: '1px solid var(--border-color)', textAlign: 'left', fontWeight: 600, fontSize: '0.6rem', color: 'var(--text-muted)' }}>#</th>
                                  {cols.slice(0, 25).map(c => (
                                    <th key={c} style={{ position: 'sticky', top: 0, background: 'var(--panel-bg)', padding: '2px 4px', borderBottom: '1px solid var(--border-color)', textAlign: 'left', fontWeight: 600, fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {Array.from({ length: 5 }).map((_, ri) => (
                                  <tr key={ri}>
                                    <td style={{ padding: '1px 4px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: 'var(--text-muted)', fontSize: '0.6rem' }}>{ri + 1}</td>
                                    {cols.slice(0, 25).map(c => {
                                      const v = createPreviews[activeSheetTab]?.[c]?.[ri];
                                      return <td key={c} style={{ padding: '1px 4px', borderBottom: '1px solid rgba(255,255,255,0.03)', whiteSpace: 'nowrap', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v !== undefined && v !== null && String(v).trim() !== '' ? String(v).slice(0, 24) : '—'}</td>;
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        {loadingQuickLook ? (
                          <div style={{ padding: '8px', color: 'var(--text-muted)' }}>Loading...</div>
                        ) : quickLookData?.headers?.length > 0 ? (
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ position: 'sticky', top: 0, background: 'var(--panel-bg)', padding: '2px 4px', borderBottom: '1px solid var(--border-color)', textAlign: 'left', fontWeight: 600, fontSize: '0.6rem', color: 'var(--text-muted)' }}>#</th>
                                {quickLookData.headers.slice(0, 25).map(h => (
                                  <th key={h} style={{ position: 'sticky', top: 0, background: 'var(--panel-bg)', padding: '2px 4px', borderBottom: '1px solid var(--border-color)', textAlign: 'left', fontWeight: 600, fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {quickLookData.rows.slice(0, 5).map((row, ri) => (
                                <tr key={ri}>
                                  <td style={{ padding: '1px 4px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: 'var(--text-muted)', fontSize: '0.6rem' }}>{ri + 1}</td>
                                  {quickLookData.headers.slice(0, 25).map(h => {
                                    const v = row[h];
                                    return <td key={h} style={{ padding: '1px 4px', borderBottom: '1px solid rgba(255,255,255,0.03)', whiteSpace: 'nowrap', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v !== undefined && v !== null && String(v).trim() !== '' ? String(v).slice(0, 24) : '—'}</td>;
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ padding: '8px', color: 'var(--text-muted)' }}>No target data</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Multiple worksheets tab selectors */}
                  {createSheets.length > 1 && (
                    <div className="map-sheet-tabs" style={{ marginBottom: '2px' }}>
                      {createSheets.map((sh, idx) => (
                        <div key={idx}
                          className={`sheet-tab ${idx === activeSheetTab ? 'active' : ''}`}
                          onClick={() => setActiveSheetTab(idx)}
                          style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                        📊 Worksheet: "{sh.name}" <span style={{ opacity: 0.7, marginLeft: '4px' }}>({[...new Set(sh.columns)].length} columns)</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Column Map Row Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {(() => {
                    const sh = createSheets[activeSheetTab];
                    if (!sh) return null;

                    const sheetCanonicals = sortCanonicalsBySequence(getSheetCanonicals(sh.name));

                    return sheetCanonicals.map(cname => {
                      const m = createMappings[activeSheetTab]?.[cname] || {};
                      const isMandatory = m.mandatory || false;
                      const isNum = m.datatype === 'integer' || m.datatype === 'decimal';
                      const isSumChecked = (createSumColumns[activeSheetTab] || []).includes(cname);
                      
                      const sourceColSelected = m.source_column || "";
                      const samples = sourceColSelected ? (createPreviews[activeSheetTab]?.[sourceColSelected] || []) : [];

                      const showAdvanced = expandedCanonicals.has(cname);
                      const toggleAdvanced = () => {
                        setExpandedCanonicals(prev => {
                          const next = new Set(prev);
                          if (next.has(cname)) next.delete(cname);
                          else next.add(cname);
                          return next;
                        });
                      };

                      return (
                        <div key={cname} className="panel col-mapping-card"
                          style={{ 
                            padding: '6px 10px', 
                            marginBottom: 0, 
                            background: sourceColSelected ? 'rgba(16,185,129,0.005)' : 'rgba(255,255,255,0.005)',
                            border: sourceColSelected ? '1px solid rgba(16,185,129,0.2)' : '1px dashed rgba(255,255,255,0.1)',
                          }}>
                          
                          {/* Simple 2-col row: Target ↔ Source */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '8px', alignItems: 'center' }}>
                            
                            {/* Target Column Name */}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <code style={{ fontSize: '0.72rem', color: sourceColSelected ? 'var(--accent-success)' : 'var(--text-muted)', background: sourceColSelected ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)', border: sourceColSelected ? '1px solid rgba(16,185,129,0.2)' : '1px dashed rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: '3px', fontWeight: 600 }}>
                                  {cname}
                                </code>
                                {isMandatory && <span title="Required" style={{ color: 'var(--accent-error)', fontSize: '0.68rem' }}>★</span>}
                              </div>
                            </div>

                            {/* Source Column Dropdown */}
                            <div>
                              <select value={sourceColSelected}
                                onChange={e => updateMapping(activeSheetTab, cname, 'source_column', e.target.value)}
                                style={{ 
                                  padding: '2px 6px', 
                                  background: 'rgba(0,0,0,0.2)', 
                                  border: sourceColSelected ? '1px solid rgba(16,185,129,0.35)' : '1px solid var(--border-color)', 
                                  borderRadius: '3px', 
                                  color: sourceColSelected ? '#fff' : 'var(--text-muted)', 
                                  fontSize: '0.72rem', 
                                  width: '100%',
                                  fontStyle: sourceColSelected ? 'normal' : 'italic'
                                }}>
                                <option value="">(none — missing in file)</option>
                                <option value="__filename__">📄 Use filename</option>
                                {[...new Set(sh.columns)].map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                              {samples.length > 0 && (
                                <div style={{ display: 'flex', gap: '3px', marginTop: '2px', flexWrap: 'wrap' }}>
                                  {samples.slice(0, 5).map((v, vi) => (
                                    <span key={vi} style={{ fontSize: '0.6rem', background: 'rgba(255,255,255,0.04)', padding: '0 4px', borderRadius: '2px', color: 'var(--text-muted)' }}>
                                      {v !== null && v !== undefined && String(v).trim() !== '' ? String(v).slice(0, 20) : '—'}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Advanced toggle */}
                            <button onClick={toggleAdvanced}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.65rem', padding: '1px 6px', whiteSpace: 'nowrap' }}>
                              {showAdvanced ? '▲' : '⚙️'} 
                            </button>

                          </div>

                          {/* Advanced Settings (collapsible) */}
                          {showAdvanced && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 0.5fr 0.5fr', gap: '8px', marginTop: '6px', padding: '6px 8px', background: 'rgba(0,0,0,0.12)', borderRadius: '4px' }}>
                              <div>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'block', marginBottom: '1px' }}>Data Type</span>
                                <select value={m.datatype || 'string'}
                                  onChange={e => updateMapping(activeSheetTab, cname, 'datatype', e.target.value)}
                                  style={{ padding: '2px 4px', fontSize: '0.68rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '3px', color: 'var(--text-primary)', width: '100%' }}>
                                  <option value="string">Text</option>
                                  <option value="integer">Number</option>
                                  <option value="decimal">Decimal</option>
                                  <option value="date">Date</option>
                                </select>
                              </div>
                              <div>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'block', marginBottom: '1px' }}>Default</span>
                                <input value={m.default_value !== undefined ? String(m.default_value) : ''}
                                  onChange={e => updateMapping(activeSheetTab, cname, 'default_value', e.target.value)}
                                  placeholder="(none)" style={{ padding: '2px 6px', fontSize: '0.68rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '3px', color: '#fff', width: '100%' }} />
                              </div>
                              <div>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'block', marginBottom: '1px' }}>Copy From</span>
                                <select value={m.copy_from_column || ''}
                                  onChange={e => updateMapping(activeSheetTab, cname, 'copy_from_column', e.target.value)}
                                  style={{ padding: '2px 4px', fontSize: '0.68rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '3px', color: 'var(--text-primary)', width: '100%' }}>
                                  <option value="">(none)</option>
                                  {sheetCanonicals.filter(c => c !== cname).map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '1px' }}>Required</span>
                                <input type="checkbox" checked={isMandatory}
                                  onChange={e => updateMapping(activeSheetTab, cname, 'mandatory', e.target.checked)}
                                  style={{ width: '12px', height: '12px', cursor: 'pointer' }} />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: isNum ? 1 : 0.4 }}>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '1px' }}>AutoSum</span>
                                <input type="checkbox" disabled={!isNum} checked={isSumChecked}
                                  onChange={() => toggleSumColumn(activeSheetTab, cname)}
                                  style={{ width: '12px', height: '12px', cursor: isNum ? 'pointer' : 'not-allowed' }} />
                              </div>
                            </div>
                          )}

                        </div>
                      );
                    });
                  })()}
                </div>

              </div>

              {/* Builder Action Bar */}
              <div className="panel" style={{ padding: '8px 14px', display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '16px' }}>
                <button className="btn-secondary" style={{ width: 'auto', padding: '6px 16px', fontSize: '0.78rem' }} onClick={resetCreate}>Cancel</button>
                <button className="btn-primary" style={{ width: 'auto', padding: '6px 16px', fontSize: '0.78rem' }} disabled={saving} onClick={handleSave}>
                  {saving ? "Saving..." : "Save Template"}
                </button>
              </div>

            </div>
          )}

          {/* Step 3: Success */}
          {createStep === "done" && (
            <div className="panel" style={{ textAlign: 'center', padding: '40px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
              <div style={{ fontSize: '2rem', width: '48px', height: '48px', borderRadius: '99px', background: 'rgba(16,185,129,0.1)', color: 'var(--accent-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>✓</div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Template saved successfully!</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '2px' }}>Reloading client definitions and updating dashboard...</p>
            </div>
          )}

        </div>
      )}
    </>
  );
}
