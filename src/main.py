import os
import sys
import glob
import shutil
import pandas as pd
from typing import Dict, Any, List, Tuple

from src.schema_loader import load_schema_config
from src.readers.excel_reader import ingest_raw_rows
from src.mappers.structure_mapper import map_raw_to_canonical
from src.validators.format_validator import validate_sheet
from src.rules.overrides import global_rules_engine, try_ingest_client_fallback
from src.reconciliation.engine import PipelineReconciler
from src.run_logging.logger import RunAuditLogger
from src.writers.excel_writer import write_consolidated_workbook
from src.models.domain_models import SchemaDefinition
from src.models.exceptions import ConsolidationPlatformException


def discover_clients(config_dir: str) -> List[Tuple[str, SchemaDefinition]]:
    schemas = []
    for f in os.listdir(config_dir):
        if f.endswith(".yaml") or f.endswith(".yml"):
            path = os.path.join(config_dir, f)
            try:
                schema = load_schema_config(path)
                if schema.active:
                    schemas.append((path, schema))
            except Exception as e:
                print(f"  [Warning] Skipping schema {f}: {e}")
    return schemas


def find_client_file(workspace_path: str, schema: SchemaDefinition) -> str:
    pattern = os.path.join(workspace_path, schema.filename_pattern)
    matches = glob.glob(pattern)
    if not matches:
        all_files = os.listdir(workspace_path)
        pattern_lower = schema.filename_pattern.replace("*", "").lower()
        matches = [
            os.path.join(workspace_path, f) for f in all_files
            if f.endswith(".xlsx") and pattern_lower in f.lower()
        ]
    if not matches:
        raise FileNotFoundError(
            f"No file matching pattern '{schema.filename_pattern}' for client '{schema.client_id}'"
        )
    # Prefer files that don't have " 2" suffix
    best = matches[0]
    for m in matches:
        base = os.path.basename(m)
        if " 2.xlsx" not in base:
            best = m
            break
    return best


def execute_e2e_consolidation(workspace_path: str, output_path: str):
    print("=" * 80)
    print("DYNAMIC CONSOLIDATION PIPELINE")
    print("=" * 80)

    logger = RunAuditLogger()
    logger.log_rule("INIT", "Dynamic consolidation pipeline initialized.")

    config_dir = os.path.join(workspace_path, "config", "schemas")
    if not os.path.exists(config_dir):
        err_msg = f"Schema config directory not found: {config_dir}"
        logger.finalize("FAILED", error=Exception(err_msg))
        logger.write_log(workspace_path)
        raise FileNotFoundError(err_msg)

    try:
        # 1. Discover and load all active schemas
        print("\n[Step 1] Discovering client schemas...")
        discovered = discover_clients(config_dir)
        if not discovered:
            raise FileNotFoundError(f"No active schemas found in {config_dir}")
        print(f"  Found {len(discovered)} active client schema(s).")
        for path, schema in discovered:
            print(f"    - {schema.client_id} ({schema.client_display_name})")

        # 2. Process each client: find file, ingest, map, apply rules
        print("\n[Step 2] Processing client workbooks...")
        client_data: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        all_schemas = []

        for schema_path, schema in discovered:
            all_schemas.append(schema)
            print(f"\n  Processing: {schema.client_id}...")

            filepath = find_client_file(workspace_path, schema)
            logger.log_file(schema.client_id, filepath)
            print(f"    Source: {os.path.basename(filepath)}")

            client_sheets = {}
            for sheet_name, sheet_def in schema.sheets.items():
                print(f"    Reading sheet: {sheet_name}")
                raw = ingest_raw_rows(
                    filepath, sheet_name,
                    sheet_def.header_row, sheet_def.data_start_row
                )
                mapped = map_raw_to_canonical(raw, sheet_name, schema)
                transformed = global_rules_engine.execute_rules_on_records(
                    mapped, schema.client_id, sheet_name
                )
                client_sheets[sheet_name] = transformed
                print(f"      Rows: {len(transformed)}")

            client_data[schema.client_id] = client_sheets

        # 3. Client-specific fallbacks (e.g. Gold Loan)
        try_ingest_client_fallback(workspace_path, client_data, logger)

        # 4. Validate and log counts
        print("\n[Step 3] Validating records...")
        all_validated: Dict[str, List[Dict[str, Any]]] = {}
        all_warnings = []

        for schema in all_schemas:
            for sheet_name, sheet_def in schema.sheets.items():
                records = client_data.get(schema.client_id, {}).get(sheet_name, [])
                validated, warnings = validate_sheet(records, sheet_def)
                all_validated.setdefault(sheet_name, []).extend(validated)
                all_warnings.extend(warnings)
                logger.log_counts(
                    f"{schema.client_id} - {sheet_name}",
                    0, len(validated)
                )

        for w in all_warnings:
            logger.log_warning(w["field"], w["row_idx"], w["message"])

        dup_warnings = [w for w in all_warnings if w["field"] == "DUPLICATE"]
        if dup_warnings:
            print(f"\nValidation Notice: {len(dup_warnings)} duplicate records found.")
            for d in dup_warnings[:5]:
                print(f"  {d['message']}")

        # 5. Build consolidated DataFrames per sheet (once per sheet)
        print("\n[Step 4] Building consolidated DataFrames...")
        cons_dfs: Dict[str, pd.DataFrame] = {}
        sheets_done = set()
        for schema in all_schemas:
            for sheet_name in schema.sheets:
                if sheet_name in sheets_done or sheet_name not in all_validated:
                    continue
                sheets_done.add(sheet_name)
                cons_dfs[sheet_name] = pd.DataFrame(all_validated[sheet_name])

        # 6. Reconciliation
        print("\n[Step 5] Running reconciliation checks...")
        client_dfs: Dict[str, Dict[str, pd.DataFrame]] = {}
        for schema in all_schemas:
            cid = schema.client_id
            client_dfs[cid] = {}
            for sheet_name in schema.sheets:
                records = client_data.get(cid, {}).get(sheet_name, [])
                client_dfs[cid][sheet_name] = pd.DataFrame(records)

        reconciler = PipelineReconciler(client_dfs)
        sheets_done.clear()
        for schema in all_schemas:
            for sheet_name, sheet_def in schema.sheets.items():
                if sheet_name in sheets_done or sheet_name not in cons_dfs:
                    continue
                sheets_done.add(sheet_name)
                reconciler.verify_sheet_reconciliation(
                    sheet_name, cons_dfs[sheet_name],
                    sum_columns=sheet_def.sum_columns
                )

        logger.finalize("SUCCESS")

        # Log sums from all schemas (once per sheet)
        sheets_done.clear()
        for schema in all_schemas:
            for sheet_name, sheet_def in schema.sheets.items():
                if sheet_name in sheets_done or sheet_name not in cons_dfs:
                    continue
                sheets_done.add(sheet_name)
                for sum_col in sheet_def.sum_columns:
                    if sum_col in cons_dfs[sheet_name].columns:
                        input_sum = 0.0
                        for cid in client_dfs:
                            df = client_dfs[cid].get(sheet_name, pd.DataFrame())
                            if sum_col in df.columns:
                                input_sum += df[sum_col].sum()
                        cons_sum = cons_dfs[sheet_name][sum_col].sum()
                        logger.log_sums(
                            f"{sheet_name} - {sum_col}",
                            input_sum, cons_sum
                        )

        # 7. Backup
        if os.path.exists(output_path):
            backup_path = output_path.replace(".xlsx", "_backup.xlsx")
            print(f"\nSafeguard: Backing up existing file to: {os.path.basename(backup_path)}...")
            shutil.copy2(output_path, backup_path)
            logger.log_rule("SAFEGUARD", f"Backed up original file to {os.path.basename(backup_path)}")

        # 8. Write output
        print("\n[Step 6] Writing consolidated Excel workbook...")
        write_consolidated_workbook(cons_dfs, all_schemas, output_path)
        logger.log_rule("WRITE", f"Saved consolidated workbook at: {os.path.basename(output_path)}")

        logger.write_log(workspace_path)
        print("\n" + "=" * 80)
        print("CONSOLIDATION SUCCESSFUL! 100% RECONCILIATION MATCH VERIFIED.")
        print("=" * 80)

    except Exception as e:
        print(f"\nPipeline aborted: {e}", file=sys.stderr)
        logger.finalize("FAILED", error=e)
        logger.write_log(workspace_path)
        raise e


if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.dirname(current_dir)
    target_xlsx = os.path.join(workspace_dir, "Feb'26 consolidated.xlsx")
    execute_e2e_consolidation(workspace_dir, target_xlsx)
