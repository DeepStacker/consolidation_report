import os
import glob
import pandas as pd
import numpy as np
from typing import Dict, Any, List
from src.rules.rules_engine import RulesEngine
from src.models.domain_models import RuleDefinition

global_rules_engine = RulesEngine()


def axis_state_copy_rule(row: Dict[str, Any]) -> Dict[str, Any]:
    if "State" in row:
        val = row.get("State", None)
        row["Location "] = str(val).strip() if val is not None else None
    return row


axis_md_rule_def = RuleDefinition(
    rule_id="RULE_AXIS_MD_LOCATION_COPY",
    client_id="axis_poa",
    scope="Master Data",
    priority=10,
    description="Copies State value into the Location field for Axis Bank POA."
)
global_rules_engine.register_rule(axis_md_rule_def, axis_state_copy_rule)


def rbl_pt_cancellation_redirect(row: Dict[str, Any]) -> Dict[str, Any]:
    row["Branch Cancellation Charges"] = 0.0
    row[" Andaman & Nicobar Branch Expenses"] = 0.0
    row["Error Deduction"] = 0.0
    if row.get("IFSC Code") == "BARBOMUZRAM":
        row["IFSC Code"] = "BARB0MUZRAM"
    return row


rbl_pt_rule_def = RuleDefinition(
    rule_id="RULE_RBL_PT_CANCELLATION_REDIRECT",
    client_id="rbl_poa",
    scope="Payment Tracker",
    priority=10,
    description="Applies default zeros to specific Axis columns for RBL PT records."
)
global_rules_engine.register_rule(rbl_pt_rule_def, rbl_pt_cancellation_redirect)


def rbl_md_days_duplication(row: Dict[str, Any]) -> Dict[str, Any]:
    row["Client"] = "RBL(muthoot)"
    row["Seeding Status"] = None
    row["Report"] = None
    row["Assayer fee.1"] = None
    row["Additional fee.1"] = None
    days = row.get("No of days \naudited ")
    if days is not None and days != 0:
        row["No of days \naudited For client"] = days
    return row


rbl_md_rule_def = RuleDefinition(
    rule_id="RULE_RBL_MD_DAYS_DUPLICATION",
    client_id="rbl_poa",
    scope="Master Data",
    priority=10,
    description="Formats RBL Client tag and blanks out empty placeholders."
)
global_rules_engine.register_rule(rbl_md_rule_def, rbl_md_days_duplication)


def try_ingest_client_fallback(workspace_path: str,
                                client_data: Dict[str, Dict[str, List[Dict[str, Any]]]],
                                logger=None) -> None:
    from src.schema_loader import load_schema_config
    from src.readers.excel_reader import ingest_raw_rows

    gl_schema_path = os.path.join(workspace_path, "config", "schemas", "rbl_gold_loan.yaml")
    if not os.path.exists(gl_schema_path):
        return

    try:
        gl_schema = load_schema_config(gl_schema_path)
    except Exception:
        return

    rows = []

    for f in os.listdir(workspace_path):
        if f.endswith(".xlsx") and "RBL" in f and "Gold" in f:
            try:
                gl_file = os.path.join(workspace_path, f)
                raw_rows = ingest_raw_rows(
                    gl_file, "Master Data",
                    gl_schema.sheets["Master Data"].header_row,
                    gl_schema.sheets["Master Data"].data_start_row
                )
                if raw_rows:
                    rows = raw_rows
                    print(f"Ingested {len(rows)} Gold Loan rows from standalone workbook: {f}")
                    break
            except Exception:
                continue

    if not rows:
        for candidate in ["Feb'26 consolidated.xlsx", "Feb'26 consolidated_backup.xlsx"]:
            path = os.path.join(workspace_path, candidate)
            if os.path.exists(path):
                try:
                    df_cons = pd.read_excel(path, sheet_name="Master Data")
                    df_gl = df_cons[
                        (df_cons.get("Client") == "RBL(muthoot)") &
                        (df_cons.get("SOL ID", pd.Series(dtype=float)).isna()) &
                        (df_cons.get("Assayer Code", pd.Series(dtype=str)).notna())
                    ]
                    if not df_gl.empty:
                        df_gl = df_gl.copy()
                        df_gl["Client"] = "RBL(muthoot)"
                        df_gl = df_gl.replace({np.nan: None})
                        rows = df_gl.to_dict(orient="records")
                        print(f"Ingested {len(rows)} Gold Loan rows from {candidate}")
                        break
                except Exception as e:
                    print(f"Could not extract Gold Loan rows from {candidate}: {e}")

    if rows:
        if "rbl_poa" not in client_data:
            client_data["rbl_poa"] = {}
        client_data["rbl_poa"].setdefault("Master Data", []).extend(rows)
        if logger:
            logger.log_rule("HR-004", f"Successfully extracted {len(rows)} Gold Loan rows.")
