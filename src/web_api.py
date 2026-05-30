import os
import shutil
import tempfile
import uuid
import sys
import io
from io import StringIO
from typing import List, Dict, Any
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from src.main import execute_e2e_consolidation

app = FastAPI(title="Consolidation Pipeline API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from datetime import datetime

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
frontend_dist = os.path.join(base_dir, "frontend", "dist")


# In-memory store for output files (keyed by session UUID)
# File bytes are held in RAM only and deleted immediately after download.
# No data is written to persistent disk outside the ephemeral workspace.
FILE_STORE: Dict[str, dict] = {}  # { file_id: {"bytes": bytes, "audit": dict} }
BATCH_STORE: List[dict] = []  # ordered list of batch records

class LogCapture:
    def __init__(self):
        self.stream = StringIO()
        self.orig_stdout = sys.stdout

    def __enter__(self):
        sys.stdout = self.stream
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stdout = self.orig_stdout

    def get_logs(self) -> str:
        return self.stream.getvalue()

@app.post("/api/consolidate")
async def consolidate(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    # Create a temporary workspace directory
    tmp_dir = tempfile.mkdtemp(prefix="web_consolidation_")
    try:
        # Copy global config schemas to the temp workspace
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        config_src = os.path.join(base_dir, "config", "schemas")
        if os.path.exists(config_src):
            config_dst = os.path.join(tmp_dir, "config", "schemas")
            os.makedirs(config_dst, exist_ok=True)
            for f in os.listdir(config_src):
                shutil.copy2(os.path.join(config_src, f), os.path.join(config_dst, f))

        # Write uploaded files to temp workspace
        uploaded_files_log = []
        for file in files:
            file_path = os.path.join(tmp_dir, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            uploaded_files_log.append(file.filename)

        output_path = os.path.join(tmp_dir, "Consolidated_Report.xlsx")
        
        # Execute the pipeline while capturing standard output
        with LogCapture() as capturer:
            print("✓ Preparing workspace...")
            for f in uploaded_files_log:
                print(f"  ✓ {f}")
            print("✓ Running consolidation pipeline...\n")
            
            try:
                execute_e2e_consolidation(tmp_dir, output_path)
                success = True
                error_msg = None
            except Exception as e:
                success = False
                error_msg = str(e)
                print(f"\nERROR: {e}")

        logs = capturer.get_logs()

        if not success:
            BATCH_STORE.insert(0, {
                "id": str(uuid.uuid4()),
                "timestamp": datetime.now().isoformat(),
                "filenames": uploaded_files_log,
                "file_id": None,
                "health_score": 0,
                "status": "FAILED",
                "error": error_msg,
            })
            if len(BATCH_STORE) > 50:
                BATCH_STORE.pop()
            return {
                "success": False,
                "logs": logs,
                "error": error_msg
            }

        # Read output file into RAM (never touches persistent disk)
        file_id = str(uuid.uuid4())
        with open(output_path, "rb") as f:
            file_bytes = f.read()

        # Capture audit log data from the ephemeral workspace
        audit_data = {}
        for f in os.listdir(tmp_dir):
            if f.startswith("run_audit_log") and f.endswith(".json"):
                import json
                with open(os.path.join(tmp_dir, f), "r") as log_file:
                    audit_data = json.load(log_file)
                break

        # Parse source file data for in-app comparison
        source_data = {}
        for f in os.listdir(tmp_dir):
            if f.endswith((".xlsx", ".xls")) and f != "Consolidated_Report.xlsx":
                try:
                    import openpyxl
                    src_path = os.path.join(tmp_dir, f)
                    src_wb = openpyxl.load_workbook(src_path, data_only=True, read_only=True)
                    src_sheets = {}
                    for sname in src_wb.sheetnames:
                        sws = src_wb[sname]
                        src_headers = []
                        for cell in next(sws.iter_rows(min_row=1, max_row=1, values_only=True), []):
                            src_headers.append(str(cell).strip() if cell is not None else "")
                        src_rows = []
                        for row in sws.iter_rows(min_row=2, values_only=True):
                            row_data = {}
                            has_data = False
                            for ci, val in enumerate(row):
                                if ci < len(src_headers):
                                    if hasattr(val, 'isoformat'):
                                        val = val.isoformat()
                                    elif not isinstance(val, (str, int, float, bool, type(None))):
                                        val = str(val) if val is not None else None
                                    row_data[src_headers[ci]] = val
                                    if val is not None and val != "":
                                        has_data = True
                            if has_data:
                                src_rows.append(row_data)
                        src_sheets[sname] = {"headers": src_headers, "rows": src_rows}
                    src_wb.close()
                    source_data[f] = src_sheets
                except Exception as e:
                    source_data[f] = {"error": str(e)}

        # Store file bytes + audit data together
        FILE_STORE[file_id] = {"bytes": file_bytes, "audit": audit_data, "sources": source_data}

        # Create batch record for run history
        batch_record = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now().isoformat(),
            "filenames": uploaded_files_log,
            "file_id": file_id,
            "health_score": _compute_audit_summary(audit_data).get("health_score", 100),
            "status": "SUCCESS",
        }
        BATCH_STORE.insert(0, batch_record)  # newest first
        # Keep max 50 batches in memory
        if len(BATCH_STORE) > 50:
            BATCH_STORE.pop()

        # Compute enriched audit summary
        audit_summary = _compute_audit_summary(audit_data)

        return {
            "success": True,
            "logs": logs,
            "file_id": file_id,
            "audit_log": audit_data,
            "audit_summary": audit_summary,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        if os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)

@app.get("/api/download/{file_id}")
async def download_file(file_id: str):
    entry = FILE_STORE.pop(file_id, None)
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found or already downloaded")
    file_bytes = entry["bytes"] if isinstance(entry, dict) else entry
    
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Consolidated_Report.xlsx"}
    )

def _compute_audit_summary(audit: dict) -> dict:
    """Enrich raw audit log with computed stats and a health score."""
    files = audit.get("files_processed", [])
    row_counts = audit.get("row_counts", {})
    fin_sums = audit.get("financial_sums", {})
    warnings = audit.get("validation_warnings", [])
    status = audit.get("reconciliation_status", "UNKNOWN")

    total_rows = sum(v.get("output", 0) for v in row_counts.values())
    total_sums = len(fin_sums)
    matched_sums = sum(
        1 for v in fin_sums.values()
        if abs(float(v.get("standalone", 0)) - float(v.get("consolidated", 0))) < 0.01
    )

    # Build per-client breakdown
    clients = {}
    for f in files:
        cid = f.get("client_id", "unknown")
        if cid not in clients:
            clients[cid] = {"files": [], "rows": 0, "sheets": set()}
        clients[cid]["files"].append(f.get("filename", ""))
    for key, val in row_counts.items():
        parts = key.split(" - ", 1)
        cid = parts[0].lower() if len(parts) > 1 else "unknown"
        sheet = parts[1] if len(parts) > 1 else key
        if cid in clients:
            clients[cid]["sheets"].add(sheet)
            clients[cid]["rows"] += val.get("output", 0)

    client_list = []
    for cid, data in clients.items():
        client_list.append({
            "client_id": cid,
            "files": data["files"],
            "sheets": sorted(data["sheets"]),
            "total_rows": data["rows"],
        })
    client_list.sort(key=lambda x: x["client_id"])

    # Health score (0-100)
    score = 100
    if status != "SUCCESS":
        score -= 40
    if warnings:
        score -= min(len(warnings) * 3, 30)
    if total_sums > 0 and matched_sums < total_sums:
        score -= 20
    if total_rows == 0 and status == "SUCCESS":
        score -= 20
    score = max(0, score)

    return {
        "status": status,
        "health_score": score,
        "total_files": len(files),
        "total_clients": len(clients),
        "total_rows": total_rows,
        "total_sums": total_sums,
        "matched_sums": matched_sums,
        "total_warnings": len(warnings),
        "clients": client_list,
    }


# ──────────────────────────────────────────────
# SCHEMA CRUD API
# ──────────────────────────────────────────────

import yaml

SCHEMAS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "schemas")


def _find_schema_file(client_id: str) -> str | None:
    """Find schema YAML file by client_id."""
    if not os.path.isdir(SCHEMAS_DIR):
        return None
    for f in os.listdir(SCHEMAS_DIR):
        if f.endswith((".yaml", ".yml")):
            fp = os.path.join(SCHEMAS_DIR, f)
            with open(fp) as fh:
                try:
                    data = yaml.safe_load(fh)
                    if isinstance(data, dict) and data.get("client_id") == client_id:
                        return fp
                except Exception:
                    continue
    return None


def _read_schema_yaml(filepath: str) -> dict:
    with open(filepath) as fh:
        return yaml.safe_load(fh)


def _write_schema_yaml(filepath: str, data: dict):
    with open(filepath, "w") as fh:
        yaml.dump(data, fh, default_flow_style=False, sort_keys=False, allow_unicode=True)


@app.get("/api/schemas")
async def list_schemas():
    """List all schema YAML files with summary info."""
    results = []
    if not os.path.isdir(SCHEMAS_DIR):
        return {"schemas": results}
    for f in sorted(os.listdir(SCHEMAS_DIR)):
        if f.endswith((".yaml", ".yml")):
            fp = os.path.join(SCHEMAS_DIR, f)
            try:
                data = _read_schema_yaml(fp)
                sheets = data.get("sheets", {})
                results.append({
                    "filename": f,
                    "client_id": data.get("client_id", ""),
                    "client_display_name": data.get("client_display_name", ""),
                    "filename_pattern": data.get("filename_pattern", ""),
                    "active": data.get("active", True),
                    "sheet_names": list(sheets.keys()),
                    "column_count": sum(len(s.get("columns", [])) for s in sheets.values()),
                })
            except Exception as e:
                results.append({"filename": f, "error": str(e)})
    return {"schemas": results}


@app.get("/api/schemas/{client_id}")
async def get_schema(client_id: str):
    """Get full schema definition by client_id."""
    fp = _find_schema_file(client_id)
    if not fp:
        raise HTTPException(status_code=404, detail=f"Schema '{client_id}' not found")
    return _read_schema_yaml(fp)


@app.post("/api/schemas")
async def create_schema(data: dict):
    """Create a new schema YAML file."""
    client_id = data.get("client_id", "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    if _find_schema_file(client_id):
        raise HTTPException(status_code=409, detail=f"Schema '{client_id}' already exists")
    filename = f"{client_id}.yaml"
    filepath = os.path.join(SCHEMAS_DIR, filename)
    os.makedirs(SCHEMAS_DIR, exist_ok=True)
    _write_schema_yaml(filepath, data)
    return {"success": True, "client_id": client_id, "filename": filename}


@app.put("/api/schemas/{client_id}")
async def update_schema(client_id: str, data: dict):
    """Update an existing schema YAML file."""
    fp = _find_schema_file(client_id)
    if not fp:
        raise HTTPException(status_code=404, detail=f"Schema '{client_id}' not found")
    new_id = data.get("client_id", "").strip()
    if new_id and new_id != client_id:
        if _find_schema_file(new_id):
            raise HTTPException(status_code=409, detail=f"Schema '{new_id}' already exists")
        os.remove(fp)
        fp = os.path.join(SCHEMAS_DIR, f"{new_id}.yaml")
    _write_schema_yaml(fp, data)
    return {"success": True, "client_id": new_id or client_id}


@app.delete("/api/schemas/{client_id}")
async def delete_schema(client_id: str):
    """Delete a schema YAML file."""
    fp = _find_schema_file(client_id)
    if not fp:
        raise HTTPException(status_code=404, detail=f"Schema '{client_id}' not found")
    os.remove(fp)
    return {"success": True, "client_id": client_id}


@app.put("/api/schemas/{client_id}/toggle")
async def toggle_schema(client_id: str):
    """Toggle active status of a schema."""
    fp = _find_schema_file(client_id)
    if not fp:
        raise HTTPException(status_code=404, detail=f"Schema '{client_id}' not found")
    data = _read_schema_yaml(fp)
    data["active"] = not data.get("active", True)
    _write_schema_yaml(fp, data)
    return {"success": True, "client_id": client_id, "active": data["active"]}


# ──────────────────────────────────────────────
# BATCH HISTORY
# ──────────────────────────────────────────────

@app.get("/api/batches")
async def list_batches():
    """Return all consolidation run batches (newest first)."""
    return {"batches": BATCH_STORE}


@app.delete("/api/batches")
async def clear_batches():
    """Clear all batch history."""
    BATCH_STORE.clear()
    return {"success": True}


@app.get("/api/preview/{file_id}")
async def preview_file(file_id: str):
    """Return the consolidated Excel data as JSON with cell-level issue highlights."""
    try:
        entry = FILE_STORE.get(file_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="File not found")
        file_bytes = entry["bytes"] if isinstance(entry, dict) else entry
        audit = entry.get("audit", {}) if isinstance(entry, dict) else {}
        sources = entry.get("sources", {}) if isinstance(entry, dict) else {}
        warnings = audit.get("validation_warnings", [])

        import openpyxl
        from io import BytesIO
        wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True, read_only=False)
        sheets = {}
        for name in wb.sheetnames:
            ws = wb[name]
            headers = []
            for cell in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), []):
                headers.append(str(cell).strip() if cell is not None else "")
            rows = []
            issue_map = {}
            for ri, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                row_data = {}
                has_data = False
                for ci, val in enumerate(row):
                    if ci < len(headers):
                        k = headers[ci]
                        # Convert non-serializable types (datetime, date, etc.)
                        if hasattr(val, 'isoformat'):
                            val = val.isoformat()
                        elif not isinstance(val, (str, int, float, bool, type(None))):
                            val = str(val) if val is not None else None
                        row_data[k] = val
                        if val is not None and val != "":
                            has_data = True
                if has_data:
                    row_idx = len(rows)
                    rows.append(row_data)
                    for w in warnings:
                        if w.get("row_idx") == ri:
                            field = w.get("field", "")
                            issue_map.setdefault(row_idx, {})[field] = w.get("message", "")
            has_issues = bool(issue_map)
            sheets[name] = {"headers": headers, "rows": rows, "issues": issue_map, "has_issues": has_issues}
        wb.close()
        return {"sheets": sheets, "file_id": file_id, "sources": sources}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview error: {str(e)}")


# ──────────────────────────────────────────────
# PIPELINE PREVIEW & MATCHING
# ──────────────────────────────────────────────

@app.post("/api/preview-matching")
async def preview_matching(data: dict):
    """Check which active schemas match the given filenames (dry-run matching)."""
    filenames = data.get("filenames", [])
    results = {}
    if os.path.isdir(SCHEMAS_DIR):
        for f in os.listdir(SCHEMAS_DIR):
            if not f.endswith((".yaml", ".yml")):
                continue
            try:
                schema = _read_schema_yaml(os.path.join(SCHEMAS_DIR, f))
                if not schema.get("active", True):
                    continue
                pattern = schema.get("filename_pattern", "")
                cid = schema.get("client_id", "")
                display = schema.get("client_display_name", "") or cid
                sheet_names = list(schema.get("sheets", {}).keys())
                sheet_count = len(sheet_names)
            except Exception:
                continue
            for fn in filenames:
                name_lower = fn.lower()
                # Same logic as pipeline's find_client_file
                if not name_lower.endswith((".xlsx", ".xls")):
                    continue
                match = False
                if pattern:
                    pat_lower = pattern.replace("*", "").lower()
                    if pat_lower in name_lower:
                        match = True
                if match:
                    results.setdefault(fn, []).append({
                        "client_id": cid,
                        "client_display_name": display,
                        "filename_pattern": pattern,
                        "sheet_names": sheet_names,
                        "sheet_count": sheet_count,
                    })
    # Sort matches: best match first (most sheets → higher priority)
    for fn in results:
        results[fn].sort(key=lambda s: -s["sheet_count"])
    return {"matches": results}


# ──────────────────────────────────────────────
# EXCEL ANALYSIS & CANONICAL FIELDS
# ──────────────────────────────────────────────

import openpyxl


@app.post("/api/preview/{file_id}/save")
async def save_preview(file_id: str, data: dict):
    """Accept edited rows, generate a new Excel file, return a new download file_id."""
    entry = FILE_STORE.get(file_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found")
    orig_bytes = entry["bytes"] if isinstance(entry, dict) else entry

    import openpyxl
    from io import BytesIO
    wb = openpyxl.load_workbook(BytesIO(orig_bytes))

    edited_sheets = data.get("sheets", {})
    for name, sheet_data in edited_sheets.items():
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        headers = []
        for cell in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), []):
            headers.append(str(cell).strip() if cell is not None else "")

        edited_rows = sheet_data.get("rows", [])
        # Clear existing data rows (keep header)
        for row in ws.iter_rows(min_row=2, max_row=ws.max_row or 2):
            for cell in row:
                cell.value = None

        # Write edited data starting at row 2
        for ri, row_data in enumerate(edited_rows, start=2):
            for ci, h in enumerate(headers):
                if h in row_data:
                    ws.cell(row=ri, column=ci + 1, value=row_data[h])

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    new_id = str(uuid.uuid4())
    FILE_STORE[new_id] = {"bytes": buf.getvalue(), "audit": entry.get("audit", {}) if isinstance(entry, dict) else {}, "sources": entry.get("sources", {}) if isinstance(entry, dict) else {}}
    wb.close()
    return {"success": True, "file_id": new_id}


@app.post("/api/analyze-excel")
async def analyze_excel(file: UploadFile = File(...)):
    """Upload an Excel file and return sheet names, column headers, and preview data rows."""
    if not (file.filename or "").endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx/.xls files are supported")
    tmp = tempfile.mkdtemp(prefix="excel_analyze_")
    try:
        path = os.path.join(tmp, file.filename)
        with open(path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        sheets = []
        for name in wb.sheetnames:
            ws = wb[name]
            headers = []
            for cell in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), []):
                if cell is not None:
                    h = str(cell).strip()
                    if h:
                        headers.append(h)
            # Read up to 5 data rows for preview
            preview = []
            for row in ws.iter_rows(min_row=2, max_row=min(6, ws.max_row or 2), values_only=True):
                row_data = {}
                for i, val in enumerate(row):
                    if i < len(headers):
                        row_data[headers[i]] = val if val is not None else ""
                if any(v != "" for v in row_data.values()):
                    preview.append(row_data)
            sheets.append({"name": name, "columns": headers, "preview": preview})
        wb.close()
        return {"sheets": sheets, "filename": file.filename}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.get("/api/canonical-fields")
async def canonical_fields():
    """Return union of all canonical field names across all schemas plus defaults."""
    fields = set()
    if os.path.isdir(SCHEMAS_DIR):
        for f in os.listdir(SCHEMAS_DIR):
            if f.endswith((".yaml", ".yml")):
                try:
                    data = _read_schema_yaml(os.path.join(SCHEMAS_DIR, f))
                    for sd in data.get("sheets", {}).values():
                        for col in sd.get("columns", []):
                            if col.get("canonical_name"):
                                fields.add(col["canonical_name"])
                except Exception:
                    continue
    defaults = [
        "S.no", "Sr No", "Client", "Assayer Name", "Assayer Code", "Assayer Phone",
        "Assayer PAN", "Location", "State", "Zone", "Branch", "Branch Code",
        "Month", "Audit Month & Year", "Type of Audit", "No. of Visits",
        "Base Audit Fee", "Total pay (Base)", "Travel charges",
        "Cancelled visits", "Branch Cancellation Charges",
        "Andaman & Nicobar Branch Expenses", "Error Deduction",
        "Total pay", "Remarks", "PAN Number", "Bank Name",
        "A/c Number", "IFSC Code", "Schedule date", "Audit Status",
        "Audit completion date", "No of days audited", "No of Packets audited",
        "Client fee", "Additional", "Final Client Fees", "Assayer fee",
        "Additional fee", "Distance", "Base Location", "Cancelled",
        "Total", "Audit Remarks", "Contact Person", "SOL ID",
    ]
    for d in defaults:
        fields.add(d)
    return {"fields": sorted(fields)}


@app.post("/api/schemas/from-mapping")
async def create_schema_from_mapping(data: dict):
    """Create a schema from a simplified drag-drop mapping result."""
    client_id = data.get("client_id", "").strip()
    if not client_id:
        raise HTTPException(400, "client_id is required")
    if _find_schema_file(client_id):
        raise HTTPException(409, f"Schema '{client_id}' already exists")

    sheets_in = data.get("sheets", [])
    if not sheets_in:
        raise HTTPException(400, "At least one sheet is required")

    sheets_out = {}
    for sh in sheets_in:
        sname = sh.get("name", "").strip()
        if not sname:
            continue
        col_defs = []
        for col in sh.get("columns", []):
            cname = col.get("canonical_name", "").strip()
            if not cname:
                continue
            entry = {"canonical_name": cname, "datatype": col.get("datatype", "string")}
            syns = [s.strip() for s in col.get("synonyms", []) if s.strip()]
            if syns:
                entry["synonyms"] = syns
            if col.get("mandatory"):
                entry["mandatory"] = True
            dv = col.get("default_value")
            if dv is not None and dv != "":
                try:
                    entry["default_value"] = int(dv) if "." not in str(dv) else float(dv)
                except (ValueError, TypeError):
                    entry["default_value"] = dv
            rx = col.get("validation_regex", "").strip()
            if rx:
                entry["validation_regex"] = rx
            excs = [e.strip() for e in col.get("validation_exceptions", []) if e.strip()]
            if excs:
                entry["validation_exceptions"] = excs
            cfc = col.get("copy_from_column", "").strip()
            if cfc:
                entry["copy_from_column"] = cfc
            hn = col.get("header_name", "").strip()
            if hn:
                entry["header_name"] = hn
            col_defs.append(entry)

        sheet_def = {
            "header_row": sh.get("header_row", 1),
            "data_start_row": sh.get("data_start_row", 2),
        }
        if sh.get("client_column"):
            sheet_def["client_column"] = sh["client_column"]
        if sh.get("s_no_column"):
            sheet_def["s_no_column"] = sh["s_no_column"]
        sheet_def["columns"] = col_defs

        sum_cols = [s.strip() for s in sh.get("sum_columns", []) if s.strip()]
        if sum_cols:
            sheet_def["sum_columns"] = sum_cols
        hidden = sh.get("hidden_columns", [])
        if hidden:
            sheet_def["hidden_columns"] = hidden
        order = sh.get("column_order", [])
        if order:
            sheet_def["column_order"] = order

        sheets_out[sname] = sheet_def

    schema = {
        "client_id": client_id,
        "client_display_name": data.get("client_display_name", "").strip() or client_id,
        "filename_pattern": data.get("filename_pattern", f"*{client_id}*"),
        "active": data.get("active", True),
        "sheets": sheets_out,
    }

    # Store rules as inline metadata if provided
    rules = data.get("rules", [])
    if rules:
        schema["rules"] = rules

    fp = os.path.join(SCHEMAS_DIR, f"{client_id}.yaml")
    os.makedirs(SCHEMAS_DIR, exist_ok=True)
    _write_schema_yaml(fp, schema)
    return {"success": True, "client_id": client_id, "filename": f"{client_id}.yaml"}


# Mount static files for the React frontend when built
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.web_api:app", host="0.0.0.0", port=8000, reload=True)

