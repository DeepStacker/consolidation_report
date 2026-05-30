import re
import pandas as pd

class ReconciliationException(Exception):
    """Raised when pipeline reconciliation checks fail."""
    pass

def validate_row_regex(val, pattern, field_name, row_idx):
    """Checks if a value matches a regex pattern, returning True or raising a warning/error."""
    if pd.isna(val) or val is None:
        return True  # Let mandatory checks handle nulls
    
    val_str = str(val).strip()
    if not re.match(pattern, val_str):
        print(f"Validation Warning: Row {row_idx} field '{field_name}' value '{val}' does not match pattern {pattern}")
        return False
    return True

def run_type_and_regex_validations(df, sheet_name):
    """Runs regex checks for PAN, IFSC, and Assayer Code columns if present in the DataFrame."""
    if df.empty:
        return True

    validation_patterns = {
        "Assayer Code": r"^AS[0-9]{4}$|^AD[0-9]{4}$",
        "PAN Number": r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$",
        "Assayer PAN": r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$",
        "IFSC Code": r"^[A-Z]{4}0[A-Z0-9]{6}$"
    }

    for idx, row in df.iterrows():
        for col_name, pattern in validation_patterns.items():
            if col_name in df.columns:
                val = row[col_name]
                validate_row_regex(val, pattern, col_name, idx + 2)

    return True

class PipelineReconciler:
    def __init__(self, axis_pt_in, rbl_pt_in, axis_md_in, rbl_md_in):
        self.axis_pt = axis_pt_in
        self.rbl_pt = rbl_pt_in
        self.axis_md = axis_md_in
        self.rbl_md = rbl_md_in

    def verify_pt_reconciliation(self, cons_pt):
        """Verifies the Payment Tracker row count and monetary sums match standalone inputs."""
        # Clean counts
        len_axis = len(self.axis_pt)
        len_rbl = len(self.rbl_pt)
        len_cons = len(cons_pt)
        
        print("\n" + "="*50)
        print("PAYMENT TRACKER RECONCILIATION AUDIT")
        print("="*50)
        print(f"Axis Input Rows: {len_axis} | RBL Input Rows: {len_rbl} | Target Rows: {len_cons}")
        
        # 1. Count check
        if len_axis + len_rbl != len_cons:
            raise ReconciliationException(
                f"PT Count Mismatch! Axis: {len_axis} + RBL: {len_rbl} = {len_axis + len_rbl} != Target: {len_cons}"
            )
            
        # 2. Sum checks
        axis_sum = self.axis_pt["Total pay"].sum()
        rbl_sum = self.rbl_pt["Total pay"].sum()
        cons_sum = cons_pt["Total pay"].sum()
        
        print(f"Axis Pay Sum: {axis_sum:.2f} | RBL Pay Sum: {rbl_sum:.2f} | Consolidated: {cons_sum:.2f}")
        
        if round(axis_sum + rbl_sum, 2) != round(cons_sum, 2):
            raise ReconciliationException(
                f"PT Payment Sum Mismatch! Axis Pay: {axis_sum:.2f} + RBL Pay: {rbl_sum:.2f} = {axis_sum + rbl_sum:.2f} != Target: {cons_sum:.2f}"
            )

        # 3. Base Pay checks
        axis_base_sum = self.axis_pt["Total pay (Base)"].sum()
        rbl_base_sum = self.rbl_pt["Total pay (Base)"].sum()
        cons_base_sum = cons_pt["Total pay (Base)"].sum()
        
        print(f"Axis Base Sum: {axis_base_sum:.2f} | RBL Base Sum: {rbl_base_sum:.2f} | Consolidated: {cons_base_sum:.2f}")
        
        if round(axis_base_sum + rbl_base_sum, 2) != round(cons_base_sum, 2):
            raise ReconciliationException(
                f"PT Base Sum Mismatch! Axis: {axis_base_sum:.2f} + RBL: {rbl_base_sum:.2f} = {axis_base_sum + rbl_base_sum:.2f} != Target: {cons_base_sum:.2f}"
            )
            
        print("Payment Tracker Reconciliation: PASSED (100% Match)")
        return True

    def verify_md_reconciliation(self, cons_md):
        """Verifies the Master Data row count matches standalone inputs (including Gold Loan fallback)."""
        len_axis = len(self.axis_md)
        len_rbl = len(self.rbl_md) # In rules.py, RBL MD was concatenated with Gold Loan rows if existing cons file was read.
        len_cons = len(cons_md)
        
        print("\n" + "="*50)
        print("MASTER DATA RECONCILIATION AUDIT")
        print("="*50)
        print(f"Axis Input Rows: {len_axis} | RBL Input Rows (incl GL): {len_rbl} | Target Rows: {len_cons}")
        
        # 1. Count check
        if len_axis + len_rbl != len_cons:
            raise ReconciliationException(
                f"MD Count Mismatch! Axis: {len_axis} + RBL (incl GL): {len_rbl} = {len_axis + len_rbl} != Target: {len_cons}"
            )
            
        print("Master Data Reconciliation: PASSED (100% Match)")
        return True
