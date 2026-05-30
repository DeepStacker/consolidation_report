import pandas as pd
from src.models.exceptions import ReconciliationException

class PipelineReconciler:
    def __init__(self, axis_pt: pd.DataFrame, rbl_pt: pd.DataFrame, axis_md: pd.DataFrame, rbl_md: pd.DataFrame):
        self.axis_pt = axis_pt
        self.rbl_pt = rbl_pt
        self.axis_md = axis_md
        self.rbl_md = rbl_md

    def verify_pt_reconciliation(self, cons_pt: pd.DataFrame) -> bool:
        """Verifies the Consolidated Payment Tracker row counts and payment sums match inputs."""
        len_axis = len(self.axis_pt)
        len_rbl = len(self.rbl_pt)
        len_cons = len(cons_pt)
        
        print("\n" + "="*50)
        print("RECONCILIATION AUDIT: PAYMENT TRACKER")
        print("="*50)
        print(f"Axis Ingestion Rows: {len_axis} | RBL Ingestion Rows: {len_rbl} | Target Rows: {len_cons}")
        
        # 1. Counts Match Check
        if len_axis + len_rbl != len_cons:
            raise ReconciliationException(
                f"PT Count Mismatch! Axis: {len_axis} + RBL: {len_rbl} = {len_axis + len_rbl} != Target: {len_cons}"
            )
            
        # 2. Total Pay Sum Match Check
        axis_sum = self.axis_pt["Total pay"].sum()
        rbl_sum = self.rbl_pt["Total pay"].sum()
        cons_sum = cons_pt["Total pay"].sum()
        
        print(f"Axis Total Pay: {axis_sum:.2f} | RBL Total Pay: {rbl_sum:.2f} | Consolidated: {cons_sum:.2f}")
        
        if round(axis_sum + rbl_sum, 2) != round(cons_sum, 2):
            raise ReconciliationException(
                f"PT Payment Sum Mismatch! Axis Pay: {axis_sum:.2f} + RBL Pay: {rbl_sum:.2f} = {axis_sum + rbl_sum:.2f} != Target: {cons_sum:.2f}"
            )

        # 3. Base Pay Sum Match Check
        axis_base_sum = self.axis_pt["Total pay (Base)"].sum()
        rbl_base_sum = self.rbl_pt["Total pay (Base)"].sum()
        cons_base_sum = cons_pt["Total pay (Base)"].sum()
        
        print(f"Axis Base Pay: {axis_base_sum:.2f} | RBL Base Pay: {rbl_base_sum:.2f} | Consolidated: {cons_base_sum:.2f}")
        
        if round(axis_base_sum + rbl_base_sum, 2) != round(cons_base_sum, 2):
            raise ReconciliationException(
                f"PT Base Sum Mismatch! Axis: {axis_base_sum:.2f} + RBL: {rbl_base_sum:.2f} = {axis_base_sum + rbl_base_sum:.2f} != Target: {cons_base_sum:.2f}"
            )
            
        print("Payment Tracker Reconciliation: SUCCESS (100% Match)")
        return True

    def verify_md_reconciliation(self, cons_md: pd.DataFrame) -> bool:
        """Verifies the Consolidated Master Data row counts match inputs."""
        len_axis = len(self.axis_md)
        len_rbl = len(self.rbl_md) # rbl_md contains Gold Loan fallback rows if ingested
        len_cons = len(cons_md)
        
        print("\n" + "="*50)
        print("RECONCILIATION AUDIT: MASTER DATA")
        print("="*50)
        print(f"Axis Ingestion Rows: {len_axis} | RBL Ingestion Rows (incl GL): {len_rbl} | Target Rows: {len_cons}")
        
        # 1. Count Match Check
        if len_axis + len_rbl != len_cons:
            raise ReconciliationException(
                f"MD Count Mismatch! Axis: {len_axis} + RBL (incl GL): {len_rbl} = {len_axis + len_rbl} != Target: {len_cons}"
            )
            
        print("Master Data Reconciliation: SUCCESS (100% Match)")
        return True
