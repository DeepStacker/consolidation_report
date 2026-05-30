import os
import sys
import shutil
import pandas as pd
from typing import Dict, Any, List

# Core pipeline imports
from src.schema_loader import load_schema_config
from src.readers.excel_reader import ingest_raw_rows
from src.mappers.structure_mapper import map_raw_to_canonical
from src.validators.format_validator import (
    validate_and_cast_payment_tracker, 
    validate_and_cast_master_data,
    detect_duplicate_records
)
from src.rules.overrides import global_rules_engine, try_ingest_rbl_gold_loan_fallback
from src.reconciliation.engine import PipelineReconciler
from src.run_logging.logger import RunAuditLogger
from src.writers.excel_writer import write_consolidated_workbook
from src.models.exceptions import ConsolidationPlatformException

def execute_e2e_consolidation(workspace_path: str, output_path: str):
    print("="*80)
    print("RUNNING ENTERPRISE excel CONSOLIDATION PIPELINE (ARCHITECTURE C)")
    print("="*80)

    # Initialize Audit Logger
    logger = RunAuditLogger()
    logger.log_rule("INIT", "Pipeline E2E execution initialized under Architecture C.")

    # Paths Setup
    config_dir = os.path.join(workspace_path, "config", "schemas")
    axis_schema_path = os.path.join(config_dir, "axis_poa.yaml")
    rbl_schema_path = os.path.join(config_dir, "rbl_poa.yaml")

    # Verify Config files
    if not os.path.exists(axis_schema_path) or not os.path.exists(rbl_schema_path):
        err_msg = f"Mandatory configurations schemas not found in: {config_dir}"
        logger.finalize("FAILED", error=Exception(err_msg))
        logger.write_log(workspace_path)
        raise FileNotFoundError(err_msg)

    try:
        # 1. Load YAML Schema Configurations (Module 3)
        print("\n[Step 1] Loading YAML Schema Mappings...")
        axis_schema = load_schema_config(axis_schema_path)
        rbl_schema = load_schema_config(rbl_schema_path)
        logger.log_rule("SCHEMA_LOAD", "Axis and RBL YAML Schemas loaded successfully.")

        # 2. Locate client bank workbooks in workspace
        # Locate Axis POA workbook
        axis_file = None
        for f in os.listdir(workspace_path):
            if f.endswith(".xlsx") and "Axis Bank POA" in f and " 2.xlsx" not in f:
                axis_file = os.path.join(workspace_path, f)
                break
        if not axis_file:
            raise FileNotFoundError(f"Workbook matching Axis Bank POA pattern not found in {workspace_path}")
            
        # Locate RBL POA workbook
        rbl_file = None
        for f in os.listdir(workspace_path):
            if f.endswith(".xlsx") and "RBL(Muthoot Fincorp)" in f:
                rbl_file = os.path.join(workspace_path, f)
                break
        if not rbl_file:
            raise FileNotFoundError(f"Workbook matching RBL Bank Muthoot pattern not found in {workspace_path}")

        logger.log_file("axis_poa", axis_file)
        logger.log_file("rbl_poa", rbl_file)

        # 3. Ingestion & Boundary clean scanning (Module 4)
        print("\n[Step 2] Reading bank worksheets (Dynamic row boundary filtering)...")
        # Ingest Axis PT and MD
        axis_pt_raw = ingest_raw_rows(axis_file, "Payment Tracker", axis_schema.sheets["Payment Tracker"].header_row, axis_schema.sheets["Payment Tracker"].data_start_row)
        axis_md_raw = ingest_raw_rows(axis_file, "Master Data", axis_schema.sheets["Master Data"].header_row, axis_schema.sheets["Master Data"].data_start_row)
        
        # Ingest RBL PT and MD
        rbl_pt_raw = ingest_raw_rows(rbl_file, "Payment Tracker", rbl_schema.sheets["Payment Tracker"].header_row, rbl_schema.sheets["Payment Tracker"].data_start_row)
        rbl_md_raw = ingest_raw_rows(rbl_file, "Master Data", rbl_schema.sheets["Master Data"].header_row, rbl_schema.sheets["Master Data"].data_start_row)

        # 4. Synonym Structure Mapping (Module 5)
        print("\n[Step 3] Mapping synonym column headers to canonical business fields...")
        axis_pt_mapped = map_raw_to_canonical(axis_pt_raw, "Payment Tracker", axis_schema)
        axis_md_mapped = map_raw_to_canonical(axis_md_raw, "Master Data", axis_schema)
        rbl_pt_mapped = map_raw_to_canonical(rbl_pt_raw, "Payment Tracker", rbl_schema)
        rbl_md_mapped = map_raw_to_canonical(rbl_md_raw, "Master Data", rbl_schema)

        # 5. Rules Engine execution overrides (Modules 7 and 8)
        print("\n[Step 4] Executing bank-specific overrides and rule checks...")
        # Axis transformations (State Seeding)
        axis_pt_transformed = global_rules_engine.execute_rules_on_records(axis_pt_mapped, "axis_poa", "Payment Tracker")
        axis_md_transformed = global_rules_engine.execute_rules_on_records(axis_md_mapped, "axis_poa", "Master Data")
        
        # RBL transformations (Duplicate day counts, cancellation redirection)
        rbl_pt_transformed = global_rules_engine.execute_rules_on_records(rbl_pt_mapped, "rbl_poa", "Payment Tracker")
        rbl_md_transformed = global_rules_engine.execute_rules_on_records(rbl_md_mapped, "rbl_poa", "Master Data")

        # Ingest RBL Gold Loan rows using fallback reader since no standalone GL workbook exists
        rbl_gl_rows = try_ingest_rbl_gold_loan_fallback(workspace_path)
        if rbl_gl_rows:
            rbl_md_transformed.extend(rbl_gl_rows)
            logger.log_rule("HR-004", f"Successfully extracted {len(rbl_gl_rows)} Gold Loan rows from backup file.")

        logger.log_counts("Axis POA - Payment Tracker Ingested", 0, len(axis_pt_transformed))
        logger.log_counts("RBL Muthoot - Payment Tracker Ingested", 0, len(rbl_pt_transformed))
        logger.log_counts("Axis POA - Master Data Ingested", 0, len(axis_md_transformed))
        logger.log_counts("RBL Muthoot - Master Data Ingested (incl GL)", 0, len(rbl_md_transformed))

        # 6. Type validating & regex check formatting warnings (Module 6)
        print("\n[Step 5] Running Pydantic casts and character regex validations...")
        # Validate Payment Tracker records
        axis_pt_models, axis_pt_warns = validate_and_cast_payment_tracker(axis_pt_transformed)
        rbl_pt_models, rbl_pt_warns = validate_and_cast_payment_tracker(rbl_pt_transformed)
        
        # Validate Master Data records
        axis_md_models, axis_md_warns = validate_and_cast_master_data(axis_md_transformed)
        rbl_md_models, rbl_md_warns = validate_and_cast_master_data(rbl_md_transformed)

        # Log format warnings
        for w in axis_pt_warns + rbl_pt_warns + axis_md_warns + rbl_md_warns:
            logger.log_warning(w["field"], w["row_idx"], w["message"])

        # Detect duplicates on composites
        duplicates = detect_duplicate_records(axis_pt_transformed + rbl_pt_transformed, ["Assayer Code", "Audit Month & Year"])
        if duplicates:
            print("\nValidation Notice: Duplicates assayer payment records found in this cycle:")
            for d in duplicates[:5]:
                print(f"  {d}")

        # Convert clean models back to DataFrames for reconciliation and openpyxl write
        axis_pt_df = pd.DataFrame([m.model_dump(by_alias=True) for m in axis_pt_models])
        rbl_pt_df = pd.DataFrame([m.model_dump(by_alias=True) for m in rbl_pt_models])
        axis_md_df = pd.DataFrame([m.model_dump(by_alias=True) for m in axis_md_models])
        rbl_md_df = pd.DataFrame([m.model_dump(by_alias=True) for m in rbl_md_models])

        # Consolidated Target sheets
        cons_pt_df = pd.concat([axis_pt_df, rbl_pt_df], ignore_index=True) if not axis_pt_df.empty or not rbl_pt_df.empty else pd.DataFrame()
        cons_md_df = pd.concat([axis_md_df, rbl_md_df], ignore_index=True) if not axis_md_df.empty or not rbl_md_df.empty else pd.DataFrame()

        # 7. Mathematical Reconciliation circuit breaker (Module 9)
        print("\n[Step 6] Running E2E mathematical reconciliation checks...")
        reconciler = PipelineReconciler(axis_pt_df, rbl_pt_df, axis_md_df, rbl_md_df)
        reconciler.verify_pt_reconciliation(cons_pt_df)
        reconciler.verify_md_reconciliation(cons_md_df)
        
        logger.finalize("SUCCESS")
        logger.log_counts("Consolidated Target - Payment Tracker", len(axis_pt_transformed) + len(rbl_pt_transformed), len(cons_pt_df))
        logger.log_counts("Consolidated Target - Master Data", len(axis_md_transformed) + len(rbl_md_transformed), len(cons_md_df))
        logger.log_sums("Consolidated Target - Total Pay Amount", axis_pt_df["Total pay"].sum() + rbl_pt_df["Total pay"].sum(), cons_pt_df["Total pay"].sum())
        logger.log_sums("Consolidated Target - Base Pay Amount", axis_pt_df["Total pay (Base)"].sum() + rbl_pt_df["Total pay (Base)"].sum(), cons_pt_df["Total pay (Base)"].sum())

        # 8. Safeguard Backup Original Consolidated workbook
        if os.path.exists(output_path):
            backup_path = output_path.replace(".xlsx", "_backup.xlsx")
            print(f"\nSafeguard: Backing up existing consolidated workbook to: {os.path.basename(backup_path)}...")
            shutil.copy2(output_path, backup_path)
            logger.log_rule("SAFEGUARD", f"Backed up original file to {os.path.basename(backup_path)}")

        # 9. Output compilation & Dynamic SUM injection (Module 11)
        print("\n[Step 7] Compiling consolidated Excel output workbook...")
        write_consolidated_workbook(axis_pt_df, rbl_pt_df, axis_md_df, rbl_md_df, output_path)
        logger.log_rule("WRITE", f"Saved consolidated Excel workbook at: {os.path.basename(output_path)}")

        # 10. Write JSON Log
        logger.write_log(workspace_path)
        print("\n==============================================================")
        print("CONSOLIDATION SUCCESSFUL! 100% RECONCILIATION MATCH VERIFIED.")
        print("==============================================================")

    except Exception as e:
        print(f"\nPipeline execution aborted due to error: {e}", file=sys.stderr)
        logger.finalize("FAILED", error=e)
        logger.write_log(workspace_path)
        raise e

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.dirname(current_dir)
    
    target_xlsx = os.path.join(workspace_dir, "Feb'26 consolidated.xlsx")
    execute_e2e_consolidation(workspace_dir, target_xlsx)
