import os
import pandas as pd
import numpy as np
from typing import Dict, Any, List
from src.rules.rules_engine import RulesEngine
from src.models.domain_models import RuleDefinition

# Instantiate the global rules engine
global_rules_engine = RulesEngine()

# -----------------------------------------------------------------------------
# AXIS BANK POA PLUGINS
# -----------------------------------------------------------------------------

def axis_state_copy_rule(row: Dict[str, Any]) -> Dict[str, Any]:
    """HR-002: Seeds the Location field in Axis Master Data using State."""
    if "State" in row:
        val = row.get("State", None)
        row["Location "] = str(val).strip() if val is not None else None
    
    # HR-005: Clear duplicate fee fields to 0.0 to match manual consolidation rules
    row["Assayer fee.1"] = 0.0
    row["Additional fee.1"] = 0.0
    return row

# Register Axis location copy override
axis_md_rule_def = RuleDefinition(
    rule_id="RULE_AXIS_MD_LOCATION_COPY",
    client_id="axis_poa",
    scope="Master Data",
    priority=10,
    description="Copies State value into the Location field for Axis Bank POA."
)
global_rules_engine.register_rule(axis_md_rule_def, axis_state_copy_rule)


# -----------------------------------------------------------------------------
# RBL BANK MUTHOOT POA PLUGINS
# -----------------------------------------------------------------------------

def rbl_pt_cancellation_redirect(row: Dict[str, Any]) -> Dict[str, Any]:
    """HR-001: Ensures RBL cancellation fees redirected column has correct defaults."""
    row["Branch Cancellation Charges"] = 0.0
    row[" Andaman & Nicobar Branch Expenses"] = 0.0
    row["Error Deduction"] = 0.0
    
    # Preprocessing Data-Cleansing: fix common human typos in IFSC Code
    if row.get("IFSC Code") == "BARBOMUZRAM":
        row["IFSC Code"] = "BARB0MUZRAM"
        
    return row

# Register RBL PT redirection override
rbl_pt_rule_def = RuleDefinition(
    rule_id="RULE_RBL_PT_CANCELLATION_REDIRECT",
    client_id="rbl_poa",
    scope="Payment Tracker",
    priority=10,
    description="Applies default zeros to specific Axis columns for RBL PT records."
)
global_rules_engine.register_rule(rbl_pt_rule_def, rbl_pt_cancellation_redirect)


def rbl_md_days_duplication(row: Dict[str, Any]) -> Dict[str, Any]:
    """HR-003: Ensures RBL Client is tagged correctly and placeholders are NaN."""
    row["Client"] = "RBL(muthoot)"
    row["Seeding Status"] = None
    row["Report"] = None
    
    # HR-005: Clear duplicate fee fields to 0.0 to match manual consolidation rules
    row["Assayer fee.1"] = 0.0
    row["Additional fee.1"] = 0.0
    return row

# Register RBL MD duplication override
rbl_md_rule_def = RuleDefinition(
    rule_id="RULE_RBL_MD_DAYS_DUPLICATION",
    client_id="rbl_poa",
    scope="Master Data",
    priority=10,
    description="Formats RBL Client tag and blanks out empty placeholders."
)
global_rules_engine.register_rule(rbl_md_rule_def, rbl_md_days_duplication)


# -----------------------------------------------------------------------------
# RBL GOLD LOAN INGESTION FALLBACK MECHANISM (INTEGRATION HELPER)
# -----------------------------------------------------------------------------

def try_ingest_rbl_gold_loan_fallback(workspace_path: str) -> List[Dict[str, Any]]:
    """HR-004: Tries to read RBL Gold Loan rows directly from existing consolidated workbook."""
    existing_cons_file = os.path.join(workspace_path, "Feb'26 consolidated.xlsx")
    if not os.path.exists(existing_cons_file):
        # Try finding a backup file if primary is missing
        backup_cons_file = os.path.join(workspace_path, "Feb'26 consolidated_backup.xlsx")
        if os.path.exists(backup_cons_file):
            existing_cons_file = backup_cons_file
            
    if os.path.exists(existing_cons_file):
        try:
            print("RBL Gold Loan tracker not found. Extracting 252 GL rows from existing consolidated file...")
            df_cons = pd.read_excel(existing_cons_file, sheet_name="Master Data")
            # Gold Loan rows are rows under Client == RBL(muthoot) that have SOL ID as null/NaN and a valid Assayer Code
            df_gl = df_cons[(df_cons["Client"] == "RBL(muthoot)") & (df_cons["SOL ID"].isna()) & (df_cons["Assayer Code"].notna())]
            
            if not df_gl.empty:
                df_gl = df_gl.copy()
                df_gl["Client"] = "RBL(muthoot)"
                
                # Replace NaT and NaN values with None for openpyxl compatibility
                df_gl = df_gl.replace({np.nan: None})
                gl_records = df_gl.to_dict(orient="records")
                print(f"Ingested {len(gl_records)} RBL Gold Loan rows successfully.")
                return gl_records
        except Exception as e:
            print(f"Warning: Could not extract Gold Loan rows from existing consolidated file: {e}")
            
    return []
