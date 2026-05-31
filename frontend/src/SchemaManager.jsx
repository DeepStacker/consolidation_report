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
  const [createActive, setCreateActive] = useState(true);
  const [createMappings, setCreateMappings] = useState({}); // destSheet -> canonCol -> { mapping_type, source_sheet_idx, source_column, static_value, copy_from_column, datatype, mandatory, default_value }
  const [createPreviews, setCreatePreviews] = useState({}); // sheetIdx -> col -> [samples]
  const [createSumColumns, setCreateSumColumns] = useState({}); // destSheet -> [canonical]
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
  const [hasServerApiKey, setHasServerApiKey] = useState(false);
  const [showMagicDropdown, setShowMagicDropdown] = useState(false);
  const [runningAiMatch, setRunningAiMatch] = useState(false);
  const [aiMatchLoadingText, setAiMatchLoadingText] = useState("Matching...");
  const [targetSheet, setTargetSheet] = useState("");  // which target sheet to map to
  const [targetSheetOptions, setTargetSheetOptions] = useState([]);
  const [sheetTargetHeaders, setSheetTargetHeaders] = useState({}); // sheetName → [headers]
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [quickLookData, setQuickLookData] = useState(null); // {headers, rows} for the target sheet
  const [loadingQuickLook, setLoadingQuickLook] = useState(false);
  
  // Mapping Redesign states
  const [activeDestination, setActiveDestination] = useState(""); // "Payment Tracker" | "Master Data" | ...
  const [dialogColumn, setDialogColumn] = useState(null); // which canonical column is being edited in the dialog
  const [dialogTemp, setDialogTemp] = useState(null); // temporary mapping state while dialog is open
  const [colFilter, setColFilter] = useState(""); // filter columns in the mapping view
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "mapped" | "required" | "unmapped"
  
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
    
    // Always include global canonical fields (not just as fallback)
    canonFields.forEach(f => fields.add(f));
    
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

  useEffect(() => {
    fetch(`${API_BASE}/api/ai-status`)
      .then(r => r.ok ? r.json() : { configured: false })
      .then(d => setHasServerApiKey(d.configured))
      .catch(() => {});
  }, []);

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
        if (d.sheets?.length > 0) {
          setTargetSheet(d.sheets[0]);
          if (!activeDestination) setActiveDestination(d.sheets[0]);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setCreateActive(true);
    setCreateMappings({});
    setCreateSumColumns({});
    setCreatePreviews({});
    setCreateStep("upload");
    setActiveSheetTab(0);
    setShowCreate(false);
    setDialogColumn(null);
    setDialogTemp(null);
    setColFilter("");
    if (targetSheetOptions.length > 0) setActiveDestination(targetSheetOptions[0]);
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
      setCreateActive(schema.active !== false);
      
      const sheetNames = Object.keys(schema.sheets || {});
      const sheets = sheetNames.map(name => {
        // Physical columns have configured Excel synonym variations
        const physical = (schema.sheets[name]?.columns || []).filter(c => c.synonyms && c.synonyms.length > 0);
        return {
          name,
          columns: physical.map(c => c.synonyms[0]),
        };
      });
      
      // Build destination-keyed mappings
      const maps = {};
      const sums = {};
      sheetNames.forEach((name, si) => {
        maps[name] = maps[name] || {};
        sums[name] = schema.sheets[name]?.sum_columns || [];
        (schema.sheets[name]?.columns || []).forEach(c => {
          const isVirtual = !c.synonyms || c.synonyms.length === 0;
          const srcCol = isVirtual ? "" : c.synonyms[0];
          
          // Determine mapping type from existing data
          let mapping_type = "direct";
          if (c.default_value === "__from_filename__") {
            mapping_type = "filename";
          } else if (c.copy_from_column && !srcCol) {
            mapping_type = "derived";
          } else if (!srcCol && c.default_value) {
            mapping_type = "static";
          }
          
          maps[name][c.canonical_name] = {
            mapping_type,
            source_sheet_idx: si,
            source_column: srcCol,
            static_value: mapping_type === "static" ? String(c.default_value || '') : '',
            datatype: c.datatype || 'string',
            mandatory: c.mandatory || false,
            default_value: c.default_value !== undefined && mapping_type !== "static" && mapping_type !== "filename" ? String(c.default_value) : '',
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
      if (sheetNames.length > 0) setActiveDestination(sheetNames[0]);
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
        const physical = (schema.sheets[name]?.columns || []).filter(c => c.synonyms && c.synonyms.length > 0);
        return {
          name,
          columns: physical.map(c => c.synonyms[0]),
        };
      });
      
      const maps = {};
      const sums = {};
      sheetNames.forEach((name, si) => {
        maps[name] = maps[name] || {};
        sums[name] = schema.sheets[name]?.sum_columns || [];
        (schema.sheets[name]?.columns || []).forEach(c => {
          const isVirtual = !c.synonyms || c.synonyms.length === 0;
          const srcCol = isVirtual ? "" : c.synonyms[0];
          
          let mapping_type = "direct";
          if (c.default_value === "__from_filename__") mapping_type = "filename";
          else if (c.copy_from_column && !srcCol) mapping_type = "derived";
          else if (!srcCol && c.default_value) mapping_type = "static";
          
          maps[name][c.canonical_name] = {
            mapping_type,
            source_sheet_idx: si,
            source_column: srcCol,
            static_value: mapping_type === "static" ? String(c.default_value || '') : '',
            datatype: c.datatype || 'string',
            mandatory: c.mandatory || false,
            default_value: c.default_value !== undefined && mapping_type !== "static" && mapping_type !== "filename" ? String(c.default_value) : '',
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
      if (sheetNames.length > 0) setActiveDestination(sheetNames[0]);
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

    setCreateMappings(prev => {
      const maps = { ...prev };
      // For each destination sheet, try to match canonicals against ALL source sheets
      targetSheetOptions.forEach(destName => {
        maps[destName] = maps[destName] || {};
        const sheetCanonicals = getSheetCanonicals(destName);
        
        sheetCanonicals.forEach(canonCol => {
          const existing = maps[destName]?.[canonCol] || {};
          // Try matching from each source sheet
          let foundMatch = null;
          let foundSheetIdx = 0;
          for (let si = 0; si < createSheets.length; si++) {
            const match = bestMatch(canonCol, createSheets[si].columns);
            if (match) { foundMatch = match; foundSheetIdx = si; break; }
          }
          
          maps[destName][canonCol] = {
            mapping_type: foundMatch ? 'direct' : (existing.mapping_type || 'direct'),
            source_sheet_idx: foundMatch ? foundSheetIdx : (existing.source_sheet_idx || 0),
            source_column: foundMatch || existing.source_column || '',
            static_value: existing.static_value || '',
            datatype: existing.datatype || guessType(canonCol),
            mandatory: existing.mandatory || false,
            default_value: existing.default_value || '',
            copy_from_column: existing.copy_from_column || ''
          };
          
          if (foundMatch) matchedCount++;
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

  // Clear all mappings and properties in the active template builder
  const handleResetMappings = () => {
    if (!window.confirm("Are you sure you want to clear all configured column mappings for this template?")) return;
    
    setCreateMappings(prev => {
      const maps = { ...prev };
      targetSheetOptions.forEach(destName => {
        maps[destName] = {};
        const sheetCanonicals = getSheetCanonicals(destName);
        sheetCanonicals.forEach(canonCol => {
          maps[destName][canonCol] = {
            mapping_type: 'direct',
            source_sheet_idx: 0,
            source_column: '',
            static_value: '',
            datatype: guessType(canonCol),
            mandatory: false,
            default_value: '',
            copy_from_column: ''
          };
        });
      });
      return maps;
    });
    setMagicFeedback("🧹 All mappings cleared successfully!");
    setTimeout(() => { setMagicFeedback(null); }, 4000);
  };

  // One-click AI semantic auto-match using Google Gemini
  const handleAiAutoAlign = async () => {
    if (!geminiApiKey.trim() && !hasServerApiKey) {
      alert("Please enter a valid API Key (Gemini, Groq, or OpenRouter) first!");
      return;
    }
    
    // Gather ALL columns and previews from all source sheets
    const allColumns = [];
    const allPreviewRows = [];
    createSheets.forEach((sh, si) => {
      sh.columns.forEach(col => {
        if (!allColumns.includes(col)) allColumns.push(col);
      });
      const maxRows = 20;
      for (let r = 0; r < maxRows; r++) {
        const row = {};
        let hasData = false;
        sh.columns.forEach(col => {
          const val = createPreviews[si]?.[col]?.[r];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            row[col] = val;
            hasData = true;
          }
        });
        if (hasData) allPreviewRows.push(row);
      }
    });
    
    // Save key to localStorage
    localStorage.setItem("gemini_api_key", geminiApiKey.trim());
    
    setRunningAiMatch(true);
    setAiMatchLoadingText("Scanning Excel...");

    const phrases = [
      "Scanning Excel...",
      "Analyzing columns...",
      "Finding semantic matches...",
      "Mapping fields...",
      "Inferring data types...",
      "Checking required fields...",
      "Resolving fallbacks...",
      "Applying alignment...",
      "Applying final template..."
    ];
    let phraseIndex = 0;
    const intervalId = setInterval(() => {
      setAiMatchLoadingText(phrases[phraseIndex]);
      phraseIndex = (phraseIndex + 1) % phrases.length;
    }, 1000);

    try {
      // Execute a single global multi-sheet AI mapping request
      const res = await fetch(`${API_BASE}/api/ai-auto-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: createFile?.name || "",
          columns: allColumns,
          preview: allPreviewRows.slice(0, 10), // Latency optimization: limit preview to 10 rows
          api_key: geminiApiKey.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        const sheetsData = data.sheets || {};

        setCreateMappings(prev => {
          const maps = { ...prev };
          
          Object.entries(sheetsData).forEach(([dest, destData]) => {
            const aiMappings = destData.mappings || {};
            const aiRules = destData.rules || {};
            
            maps[dest] = maps[dest] || {};
            const sheetCanonicals = getSheetCanonicals(dest);
            
            sheetCanonicals.forEach(targetCol => {
              const sourceCol = aiMappings[targetCol] || '';
              const rule = aiRules[targetCol] || {};
              
              let foundIdx = 0;
              if (sourceCol) {
                for (let si = 0; si < createSheets.length; si++) {
                  if (createSheets[si].columns.includes(sourceCol)) {
                    foundIdx = si;
                    break;
                  }
                }
              }
              
              const existing = maps[dest][targetCol] || {};
              
              // Determine mapping type based on matching column, copy_from, or client static naming rules
              let mappingType = 'direct';
              if (sourceCol) {
                mappingType = 'direct';
              } else if (rule.copy_from_column) {
                mappingType = 'derived';
              } else if (rule.default_value && (targetCol.toLowerCase() === 'client' || targetCol.toLowerCase() === 'client name')) {
                mappingType = 'static';
              }
              
              maps[dest][targetCol] = {
                ...existing,
                mapping_type: mappingType,
                source_sheet_idx: foundIdx,
                source_column: sourceCol,
                static_value: mappingType === 'static' ? rule.default_value : (existing.static_value || ''),
                datatype: rule.datatype || existing.datatype || guessType(targetCol),
                mandatory: rule.mandatory !== undefined ? rule.mandatory : (existing.mandatory || false),
                default_value: rule.default_value || existing.default_value || '',
                copy_from_column: rule.copy_from_column || existing.copy_from_column || '',
                is_ai_matched: true
              };
            });
          });
          
          return maps;
        });

        const matchedNames = Object.keys(sheetsData).join(" & ");
        setMagicFeedback(`✨ Gemini successfully auto-mapped ${matchedNames}!`);
      } else {
        throw new Error("API responded with success: false");
      }
    } catch (err) {
      alert(`Gemini AI alignment failed: ${err.message}`);
      setMagicFeedback("❌ AI Mapping failed");
    } finally {
      clearInterval(intervalId);
      setRunningAiMatch(false);
      setAiMatchLoadingText("Matching...");
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
      
      // Build previews indexed by source sheet
      const prevs = {};
      (data.sheets || []).forEach((sh, si) => {
        prevs[si] = {};
        sh.columns.forEach(col => {
          prevs[si][col] = (sh.preview || []).slice(0, 5).map(r => r[col]);
        });
      });
      
      // Build destination-keyed mappings  
      const maps = {};
      const sums = {};
      targetSheetOptions.forEach(destName => {
        maps[destName] = {};
        sums[destName] = [];
        const sheetCanonicals = getSheetCanonicals(destName);
        sheetCanonicals.forEach(canonCol => {
          // Try fuzzy match across all source sheets
          let foundMatch = null;
          let foundSheetIdx = 0;
          for (let si = 0; si < (data.sheets || []).length; si++) {
            const match = bestMatch(canonCol, data.sheets[si].columns);
            if (match) { foundMatch = match; foundSheetIdx = si; break; }
          }
          maps[destName][canonCol] = {
            mapping_type: 'direct',
            source_sheet_idx: foundSheetIdx,
            source_column: foundMatch || '',
            static_value: '',
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
      if (targetSheetOptions.length > 0) setActiveDestination(targetSheetOptions[0]);
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
        prevs[si] = {};
        sh.columns.forEach(col => {
          prevs[si][col] = (sh.preview || []).slice(0, 5).map(r => r[col]);
        });
      });

      // Rebuild destination-keyed mappings, preserving old ones
      targetSheetOptions.forEach(destName => {
        maps[destName] = {};
        sums[destName] = createSumColumns[destName] || [];
        const sheetCanonicals = getSheetCanonicals(destName);
        sheetCanonicals.forEach(canonCol => {
          const existing = oldMaps[destName]?.[canonCol];
          if (existing) {
            maps[destName][canonCol] = existing;
          } else {
            let foundMatch = null;
            let foundSheetIdx = 0;
            for (let si = 0; si < (data.sheets || []).length; si++) {
              const match = bestMatch(canonCol, data.sheets[si].columns);
              if (match) { foundMatch = match; foundSheetIdx = si; break; }
            }
            maps[destName][canonCol] = {
              mapping_type: 'direct',
              source_sheet_idx: foundSheetIdx,
              source_column: foundMatch || '',
              static_value: '',
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

  // Update a column field property (destination-keyed)
  const updateMapping = (destSheet, col, field, val) => {
    setCreateMappings(prev => {
      const m = { ...prev };
      if (!m[destSheet]) m[destSheet] = {};
      m[destSheet] = { ...m[destSheet], [col]: { ...(m[destSheet][col] || {}), [field]: val } };
      return m;
    });
  };

  // Auto Sum Toggles (destination-keyed)
  const toggleSumColumn = (destSheet, colCanonical) => {
    setCreateSumColumns(prev => {
      const s = { ...prev };
      const currentSums = s[destSheet] || [];
      if (currentSums.includes(colCanonical)) {
        s[destSheet] = currentSums.filter(c => c !== colCanonical);
      } else {
        s[destSheet] = [...currentSums, colCanonical];
      }
      return s;
    });
  };

  // Open mapping dialog for a specific column
  const openMappingDialog = (cname) => {
    const m = createMappings[activeDestination]?.[cname] || {};
    setDialogColumn(cname);
    setDialogTemp({
      mapping_type: m.mapping_type || 'direct',
      source_sheet_idx: m.source_sheet_idx || 0,
      source_column: m.source_column || '',
      static_value: m.static_value || '',
      datatype: m.datatype || guessType(cname),
      mandatory: m.mandatory || false,
      default_value: m.default_value || '',
      copy_from_column: m.copy_from_column || '',
    });
  };

  // Save mapping dialog changes
  const saveMappingDialog = () => {
    if (!dialogColumn || !dialogTemp) return;
    setCreateMappings(prev => {
      const m = { ...prev };
      if (!m[activeDestination]) m[activeDestination] = {};
      m[activeDestination] = { ...m[activeDestination], [dialogColumn]: { ...dialogTemp } };
      return m;
    });
    setDialogColumn(null);
    setDialogTemp(null);
  };

  // Save full definition to database
  const handleSave = async () => {
    const cid = createName.trim();
    if (!cid) { alert("Please enter a unique template ID."); return; }
    if (!createSheets.length && Object.keys(createMappings).length === 0) { alert("Please upload Excel sheets to parse."); return; }
    setSaving(true);
    
    // Build sheet data from destination-keyed mappings
    const destSheetNames = targetSheetOptions.length > 0 
      ? targetSheetOptions 
      : Object.keys(createMappings);
    
    const sheetData = destSheetNames.map(destName => {
      const sheetCanonicals = sortCanonicalsBySequence(getSheetCanonicals(destName));
      const destMappings = createMappings[destName] || {};

      const cols = sheetCanonicals.map(cname => {
        const m = destMappings[cname] || {};
        const entry = {
          canonical_name: cname,
          datatype: m.datatype || 'string',
          synonyms: []
        };
        
        if (m.mapping_type === 'filename') {
          entry.default_value = "__from_filename__";
        } else if (m.mapping_type === 'static') {
          entry.default_value = m.static_value || '';
        } else if (m.mapping_type === 'derived') {
          if (m.copy_from_column) entry.copy_from_column = m.copy_from_column;
        } else {
          // direct mapping
          const srcCol = m.source_column || "";
          if (srcCol) {
            entry.synonyms = [srcCol];
            if (cname.toLowerCase() !== srcCol.toLowerCase()) {
              entry.synonyms.push(cname);
            }
          }
          if (m.default_value !== undefined && String(m.default_value).trim() !== '') {
            entry.default_value = m.default_value;
          }
          if (m.copy_from_column && m.copy_from_column !== '') {
            entry.copy_from_column = m.copy_from_column;
          }
        }
        
        if (m.mandatory) entry.mandatory = true;
        // Restore preserved regex, exceptions, and header_name
        if (m.validation_regex) entry.validation_regex = m.validation_regex;
        if (m.validation_exceptions && m.validation_exceptions.length > 0) entry.validation_exceptions = m.validation_exceptions;
        if (m.header_name) entry.header_name = m.header_name;
        return entry;
      });
      
      const sumCols = createSumColumns[destName] || [];
      return { 
        name: destName, 
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
          active: createActive,
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

          {/* BUILDER WORKSPACE STEP 2: REDESIGNED MAPPING EXPERIENCE */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {createSheets.length > 0 && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {createSheets.length} sheet{createSheets.length > 1 ? 's' : ''}: {createSheets.map(s => `"${s.name}"`).join(', ')}
                    </span>
                  )}
                  <button className="btn-sm btn-secondary" onClick={() => replaceRef.current?.click()} style={{ padding: '4px 10px', fontSize: '0.72rem' }}>
                    Choose file...
                  </button>
                </div>
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
              <div className="panel" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: 0 }}>
                
                {/* Section Header with Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '6px' }}>
                  <h3 className="modal-section-header" style={{ fontSize: '0.8rem', margin: 0 }}>
                    <span className="step-badge">2</span> Column Mapping
                  </h3>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                    <button className="btn-sm btn-sm-copy"
                      onClick={async () => {
                        const savedKey = localStorage.getItem("gemini_api_key");
                        if ((savedKey && savedKey.trim().length > 10) || hasServerApiKey) {
                          if (savedKey) setGeminiApiKey(savedKey);
                          await handleAiAutoAlign();
                        } else {
                          handleAutoAlign();
                          const key = prompt("Enter your free API Key for AI-powered matching (or leave blank to keep fuzzy match):\n\n• Google Gemini starts with 'AIzaSy...'\n• Groq starts with 'gsk_...'\n• OpenRouter starts with 'sk-or-...'");
                          if (key && key.trim().length > 10) {
                            setGeminiApiKey(key.trim());
                            localStorage.setItem("gemini_api_key", key.trim());
                            await handleAiAutoAlign();
                          }
                        }
                      }}
                      disabled={runningAiMatch}
                      style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.08)', color: 'var(--accent-success)' }}
                      title="Automatically match columns using AI (Gemini) or fuzzy matching.">
                      {runningAiMatch ? <><span className="spinner" style={{ width: 10, height: 10 }} /> {aiMatchLoadingText}</> : <span>✨ Auto-Match</span>}
                    </button>
                    <button className="btn-sm btn-danger"
                      onClick={handleResetMappings}
                      style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '6px', width: 'auto' }}
                      title="Clear all mappings and start fresh.">
                      <span>🧹 Reset Mappings</span>
                    </button>
                  </div>
                </div>

                {/* Destination Context Tabs */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <div className="dest-tabs">
                    {targetSheetOptions.map(destName => {
                      const destMappings = createMappings[destName] || {};
                      const total = Object.keys(destMappings).length;
                      const mapped = Object.values(destMappings).filter(m => m.source_column || m.static_value || m.mapping_type === 'filename' || (m.mapping_type === 'derived' && m.copy_from_column)).length;
                      return (
                        <div key={destName}
                          className={`dest-tab ${activeDestination === destName ? 'active' : ''}`}
                          onClick={() => { setActiveDestination(destName); setColFilter(''); setStatusFilter('all'); }}>
                          <span>{destName === 'Payment Tracker' ? '💰' : '📊'}</span>
                          <span>{destName}</span>
                          <span className="dest-tab-count">{mapped}/{total}</span>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Column Filter */}
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>🔍</span>
                    <input 
                      className="col-filter-input"
                      placeholder="Filter columns..."
                      value={colFilter}
                      onChange={e => setColFilter(e.target.value)} />
                  </div>
                </div>

                {/* Mapping Progress Bar */}
                {(() => {
                  const progressItems = targetSheetOptions.map(destName => {
                    const destMappings = createMappings[destName] || {};
                    const total = Object.keys(destMappings).length;
                    const mapped = Object.values(destMappings).filter(m => m.source_column || m.static_value || m.mapping_type === 'filename' || (m.mapping_type === 'derived' && m.copy_from_column)).length;
                    const pct = total > 0 ? Math.round((mapped / total) * 100) : 0;
                    return { destName, total, mapped, pct };
                  });
                  return (
                    <div className="mapping-progress-wrap">
                      {progressItems.map(p => (
                        <div key={p.destName} className="mapping-progress-item">
                          <div className="mapping-progress-label">
                            <span>{p.destName}</span>
                            <span className="prog-count">{p.mapped}/{p.total} ({p.pct}%)</span>
                          </div>
                          <div className="mapping-progress-bar">
                            <div className={`mapping-progress-fill ${p.pct === 100 ? 'complete' : ''}`} style={{ width: `${p.pct}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Status Filters Bar */}
                {(() => {
                  const destMappings = createMappings[activeDestination] || {};
                  const sheetCanonicals = getSheetCanonicals(activeDestination);
                  
                  let totalCount = sheetCanonicals.length;
                  let mappedCount = 0;
                  let requiredCount = 0;
                  let optionalCount = 0;
                  
                  sheetCanonicals.forEach(cname => {
                    const m = destMappings[cname] || {};
                    const isMapped = !!(m.source_column || m.static_value || m.mapping_type === 'filename' || (m.mapping_type === 'derived' && m.copy_from_column));
                    const isMandatory = m.mandatory || false;
                    
                    if (isMapped) mappedCount++;
                    else if (isMandatory) requiredCount++;
                    else optionalCount++;
                  });

                  return (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px', background: 'rgba(0,0,0,0.15)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                      {[
                        { id: 'all', label: 'All Columns', color: 'var(--text-primary)', count: totalCount },
                        { id: 'mapped', label: '🟢 Mapped', color: 'var(--accent-success)', count: mappedCount },
                        { id: 'required', label: '🔴 Required Unmapped', color: 'var(--accent-error)', count: requiredCount },
                        { id: 'unmapped', label: '⬜ Optional Unmapped', color: 'var(--text-muted)', count: optionalCount }
                      ].map(filter => (
                        <button key={filter.id}
                          onClick={() => setStatusFilter(filter.id)}
                          style={{
                            background: statusFilter === filter.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                            border: '1px solid',
                            borderColor: statusFilter === filter.id ? 'var(--accent-indigo)' : 'transparent',
                            color: statusFilter === filter.id ? '#fff' : 'var(--text-muted)',
                            padding: '3px 12px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            borderRadius: '16px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          onMouseEnter={e => { if (statusFilter !== filter.id) e.target.style.background = 'rgba(255,255,255,0.03)'; }}
                          onMouseLeave={e => { if (statusFilter !== filter.id) e.target.style.background = 'transparent'; }}>
                          <span style={{ color: filter.color }}>{filter.label}</span>
                          <span style={{ 
                            fontSize: '0.65rem', 
                            padding: '1px 5px', 
                            borderRadius: '4px', 
                            background: statusFilter === filter.id ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                            color: statusFilter === filter.id ? '#fff' : 'var(--text-muted)'
                          }}>{filter.count}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {/* Mapping Cards Grid */}
                <div className="mapping-cards-grid">
                  {(() => {
                    const destMappings = createMappings[activeDestination] || {};
                    const sheetCanonicals = sortCanonicalsBySequence(getSheetCanonicals(activeDestination));
                    const filterLower = colFilter.toLowerCase().trim();
                    const filtered = sheetCanonicals.filter(cname => {
                      const m = destMappings[cname] || {};
                      const isMapped = !!(m.source_column || m.static_value || m.mapping_type === 'filename' || (m.mapping_type === 'derived' && m.copy_from_column));
                      const isMandatory = m.mandatory || false;
                      
                      const matchesSearch = cname.toLowerCase().includes(filterLower);
                      let matchesStatus = true;
                      if (statusFilter === 'mapped') matchesStatus = isMapped;
                      else if (statusFilter === 'required') matchesStatus = (!isMapped && isMandatory);
                      else if (statusFilter === 'unmapped') matchesStatus = (!isMapped && !isMandatory);
                      
                      return matchesSearch && matchesStatus;
                    });

                    if (filtered.length === 0) {
                      return (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', gridColumn: '1 / -1' }}>
                          No columns match your search and status filters.
                        </div>
                      );
                    }

                    return filtered.map(cname => {
                      const m = destMappings[cname] || {};
                      const isMapped = !!(m.source_column || m.static_value || m.mapping_type === 'filename' || (m.mapping_type === 'derived' && m.copy_from_column));
                      const hasDefault = !!(m.default_value && String(m.default_value).trim());
                      const isMandatory = m.mandatory || false;
                      const isNum = m.datatype === 'integer' || m.datatype === 'decimal';
                      const isSumChecked = (createSumColumns[activeDestination] || []).includes(cname);

                      // Status
                      let statusClass = 'status-unmapped';
                      let dotClass = 'gray';
                      if (isMapped) { statusClass = 'status-mapped'; dotClass = 'green'; }
                      else if (hasDefault) { statusClass = 'status-default-only'; dotClass = 'yellow'; }
                      else if (isMandatory) { statusClass = 'status-required-unmapped'; dotClass = 'red'; }

                      // Mapping description
                      let mappingDesc = '— Not configured';
                      let mappingTypeBadge = '';
                      if (m.mapping_type === 'direct' && m.source_column) {
                        const shName = createSheets[m.source_sheet_idx || 0]?.name || '';
                        mappingDesc = `${shName ? shName + ' → ' : ''}${m.source_column}`;
                        mappingTypeBadge = 'direct';
                      } else if (m.mapping_type === 'static' && m.static_value) {
                        mappingDesc = `"${m.static_value}"`;
                        mappingTypeBadge = 'static';
                      } else if (m.mapping_type === 'filename') {
                        mappingDesc = 'Extract from filename';
                        mappingTypeBadge = 'filename';
                      } else if (m.mapping_type === 'derived' && m.copy_from_column) {
                        mappingDesc = `Copy from "${m.copy_from_column}"`;
                        mappingTypeBadge = 'derived';
                      }

                      // Preview samples
                      const samples = (m.mapping_type === 'direct' && m.source_column) 
                        ? (createPreviews[m.source_sheet_idx || 0]?.[m.source_column] || []).slice(0, 3)
                        : [];

                      return (
                        <div key={cname} className={`mapping-card ${statusClass}`}
                          onClick={() => openMappingDialog(cname)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className={`mapping-card-status-dot ${dotClass}`} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <code style={{ fontSize: '0.74rem', fontWeight: 700, color: isMapped ? '#fff' : 'var(--text-secondary)' }}>{cname}</code>
                                {isMandatory && <span style={{ color: 'var(--accent-error)', fontSize: '0.65rem', fontWeight: 800 }}>★ Required</span>}
                                {isNum && isSumChecked && <span style={{ color: 'var(--accent-cyan)', fontSize: '0.6rem', fontWeight: 800 }}>Σ</span>}
                                {mappingTypeBadge && <span className={`mapping-type-badge ${mappingTypeBadge}`}>{mappingTypeBadge}</span>}
                                {m.is_ai_matched && (
                                  <span style={{ 
                                    background: 'rgba(139, 92, 246, 0.12)', 
                                    color: '#c084fc', 
                                    border: '1px solid rgba(139, 92, 246, 0.25)', 
                                    fontSize: '0.62rem', 
                                    fontWeight: 700, 
                                    padding: '1px 6px', 
                                    borderRadius: '4px',
                                    textTransform: 'uppercase',
                                    boxShadow: '0 0 10px rgba(139, 92, 246, 0.15)'
                                  }}>✨ AI</span>
                                )}
                                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginLeft: 'auto', textTransform: 'capitalize' }}>{m.datatype || 'string'}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                <span style={{ fontSize: '0.68rem', color: isMapped ? 'var(--text-secondary)' : 'var(--text-muted)', fontStyle: isMapped ? 'normal' : 'italic' }}>
                                  {mappingDesc}
                                </span>
                                {samples.length > 0 && (
                                  <div style={{ display: 'flex', gap: '3px', marginLeft: '8px' }}>
                                    {samples.map((v, vi) => (
                                      <span key={vi} className="dialog-preview-chip">
                                        {v !== null && v !== undefined && String(v).trim() !== '' ? String(v).slice(0, 16) : '—'}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); openMappingDialog(cname); }}
                              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.68rem', padding: '3px 8px', borderRadius: '4px', whiteSpace: 'nowrap', transition: 'all 0.15s ease' }}
                              onMouseEnter={e => { e.target.style.borderColor = 'rgba(99,102,241,0.3)'; e.target.style.color = '#fff'; }}
                              onMouseLeave={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.color = 'var(--text-muted)'; }}>
                              Configure ▸
                            </button>
                          </div>
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

          {/* ========= MAPPING DIALOG (Slide-Over Panel) ========= */}
          {dialogColumn && dialogTemp && (
            <div className="mapping-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setDialogColumn(null); setDialogTemp(null); } }}>
              <div className="mapping-dialog-panel">
                
                {/* Dialog Header */}
                <div className="mapping-dialog-header">
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>Configure Target Column</div>
                    <code style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginTop: '2px', display: 'block' }}>{dialogColumn}</code>
                  </div>
                  <button className="overlay-close" onClick={() => { setDialogColumn(null); setDialogTemp(null); }}
                    style={{ width: '28px', height: '28px', fontSize: '0.9rem' }}>✕</button>
                </div>

                {/* Dialog Body */}
                <div className="mapping-dialog-body">
                  
                  {/* Mapping Type Selector */}
                  <div className="dialog-section">
                    <div className="dialog-section-title">Mapping Type</div>
                    <div className="mapping-type-grid">
                      {[
                        { key: 'direct', icon: '📎', label: 'Direct Column', desc: 'Map from source Excel' },
                        { key: 'static', icon: '📝', label: 'Static Value', desc: 'Fixed constant value' },
                        { key: 'filename', icon: '📄', label: 'File Metadata', desc: 'Extract from filename' },
                        { key: 'derived', icon: '🔗', label: 'Derived / Copy', desc: 'Copy from another column' },
                      ].map(opt => (
                        <div key={opt.key}
                          className={`mapping-type-option ${dialogTemp.mapping_type === opt.key ? 'selected' : ''}`}
                          onClick={() => setDialogTemp(prev => ({ ...prev, mapping_type: opt.key }))}>
                          <span className="type-icon">{opt.icon}</span>
                          <div>
                            <div className="type-label">{opt.label}</div>
                            <div className="type-desc">{opt.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Configuration Panel — changes based on mapping type */}
                  <div className="dialog-section">
                    <div className="dialog-section-title">Configuration</div>
                    
                    {/* Direct Column */}
                    {dialogTemp.mapping_type === 'direct' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Source Sheet</span>
                            <select value={dialogTemp.source_sheet_idx || 0}
                              onChange={e => setDialogTemp(prev => ({ ...prev, source_sheet_idx: parseInt(e.target.value), source_column: '' }))}
                              style={{ padding: '5px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '5px', color: '#fff', fontSize: '0.75rem', width: '100%', fontFamily: 'inherit' }}>
                              {createSheets.map((sh, si) => (
                                <option key={si} value={si}>{sh.name} ({[...new Set(sh.columns)].length} cols)</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ flex: 1.5 }}>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Source Column</span>
                            <select value={dialogTemp.source_column || ''}
                              onChange={e => setDialogTemp(prev => ({ ...prev, source_column: e.target.value }))}
                              style={{ padding: '5px 8px', background: 'rgba(0,0,0,0.3)', border: dialogTemp.source_column ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--border-color)', borderRadius: '5px', color: dialogTemp.source_column ? '#fff' : 'var(--text-muted)', fontSize: '0.75rem', width: '100%', fontFamily: 'inherit' }}>
                              <option value="">(none — not mapped)</option>
                              {[...new Set(createSheets[dialogTemp.source_sheet_idx || 0]?.columns || [])].map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {/* Sample preview */}
                        {dialogTemp.source_column && (
                          <div>
                            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>Preview Data</span>
                            <div className="dialog-preview-grid">
                              {(createPreviews[dialogTemp.source_sheet_idx || 0]?.[dialogTemp.source_column] || []).slice(0, 12).map((v, vi) => (
                                <span key={vi} className="dialog-preview-chip">
                                  {v !== null && v !== undefined && String(v).trim() !== '' ? String(v).slice(0, 24) : '—'}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Static Value */}
                    {dialogTemp.mapping_type === 'static' && (
                      <div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Fixed Value</span>
                        <input value={dialogTemp.static_value || ''}
                          onChange={e => setDialogTemp(prev => ({ ...prev, static_value: e.target.value }))}
                          placeholder='e.g. "Axis Bank POA"'
                          style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '5px', color: '#fff', fontSize: '0.78rem', width: '100%', fontFamily: 'inherit' }} />
                      </div>
                    )}

                    {/* File Metadata */}
                    {dialogTemp.mapping_type === 'filename' && (
                      <div style={{ padding: '10px', background: 'rgba(245,158,11,0.03)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '6px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--accent-warning)', fontWeight: 600 }}>📄 Extract from Filename</span>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                          The value for this column will be automatically extracted from the uploaded file's name during consolidation.
                        </p>
                        {createFile?.name && (
                          <div style={{ marginTop: '6px', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            Current file: <code style={{ color: 'var(--accent-cyan)' }}>{createFile.name}</code>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Derived / Copy */}
                    {dialogTemp.mapping_type === 'derived' && (
                      <div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Copy Value From</span>
                        <select value={dialogTemp.copy_from_column || ''}
                          onChange={e => setDialogTemp(prev => ({ ...prev, copy_from_column: e.target.value }))}
                          style={{ padding: '5px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '5px', color: dialogTemp.copy_from_column ? '#fff' : 'var(--text-muted)', fontSize: '0.75rem', width: '100%', fontFamily: 'inherit' }}>
                          <option value="">(select a target column)</option>
                          {sortCanonicalsBySequence(getSheetCanonicals(activeDestination)).filter(c => c !== dialogColumn).map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          If the source doesn't have this column, copy from the selected target column's resolved value.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Column Properties */}
                  <div className="dialog-section">
                    <div className="dialog-section-title">Properties</div>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: (dialogTemp.mapping_type === 'direct' && dialogTemp.source_column) ? '1fr 1fr 1.2fr' : '1fr 1fr', 
                      gap: '12px' 
                    }}>
                      <div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Data Type</span>
                        <select value={dialogTemp.datatype || 'string'}
                          onChange={e => setDialogTemp(prev => ({ ...prev, datatype: e.target.value }))}
                          style={{ padding: '5px 8px', fontSize: '0.75rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '5px', color: '#fff', width: '100%', fontFamily: 'inherit' }}>
                          <option value="string">Text</option>
                          <option value="integer">Number</option>
                          <option value="decimal">Decimal</option>
                          <option value="date">Date</option>
                          <option value="time">Time</option>
                        </select>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Default Value</span>
                        <input value={dialogTemp.default_value || ''}
                          onChange={e => setDialogTemp(prev => ({ ...prev, default_value: e.target.value }))}
                          placeholder="(none)"
                          style={{ padding: '5px 8px', fontSize: '0.75rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '5px', color: '#fff', width: '100%', fontFamily: 'inherit' }} />
                      </div>
                      {dialogTemp.mapping_type === 'direct' && dialogTemp.source_column && (
                        <div>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Fallback Copy From (if direct is empty)</span>
                          <select value={dialogTemp.copy_from_column || ''}
                            onChange={e => setDialogTemp(prev => ({ ...prev, copy_from_column: e.target.value }))}
                            style={{ padding: '5px 8px', fontSize: '0.75rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '5px', color: dialogTemp.copy_from_column ? '#fff' : 'var(--text-muted)', width: '100%', fontFamily: 'inherit' }}>
                            <option value="">(none)</option>
                            {sortCanonicalsBySequence(getSheetCanonicals(activeDestination)).filter(c => c !== dialogColumn).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={dialogTemp.mandatory || false}
                          onChange={e => setDialogTemp(prev => ({ ...prev, mandatory: e.target.checked }))}
                          style={{ width: '13px', height: '13px', cursor: 'pointer' }} />
                        Required
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: (dialogTemp.datatype === 'integer' || dialogTemp.datatype === 'decimal') ? 1 : 0.4 }}>
                        <input type="checkbox" 
                          disabled={dialogTemp.datatype !== 'integer' && dialogTemp.datatype !== 'decimal'}
                          checked={(createSumColumns[activeDestination] || []).includes(dialogColumn)}
                          onChange={() => toggleSumColumn(activeDestination, dialogColumn)}
                          style={{ width: '13px', height: '13px', cursor: (dialogTemp.datatype === 'integer' || dialogTemp.datatype === 'decimal') ? 'pointer' : 'not-allowed' }} />
                        AutoSum
                      </label>
                    </div>
                  </div>

                </div>

                {/* Dialog Footer */}
                <div className="mapping-dialog-footer">
                  <button className="btn-secondary" style={{ width: 'auto', padding: '6px 16px', fontSize: '0.78rem' }}
                    onClick={() => { setDialogColumn(null); setDialogTemp(null); }}>Cancel</button>
                  <button className="btn-primary" style={{ width: 'auto', padding: '6px 16px', fontSize: '0.78rem' }}
                    onClick={saveMappingDialog}>Apply Mapping</button>
                </div>

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
