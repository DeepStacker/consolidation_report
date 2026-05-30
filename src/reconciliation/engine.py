import pandas as pd
from typing import Dict, List
from src.models.exceptions import ReconciliationException


class PipelineReconciler:
    def __init__(self, client_data: Dict[str, Dict[str, pd.DataFrame]]):
        self.client_data = client_data

    def verify_sheet_reconciliation(self, sheet_name: str, cons_df: pd.DataFrame,
                                     sum_columns: List[str] = None) -> bool:
        total_input = 0
        print("\n" + "=" * 50)
        print(f"RECONCILIATION AUDIT: {sheet_name.upper()}")
        print("=" * 50)

        parts = []
        for client_id, sheets in self.client_data.items():
            if sheet_name in sheets:
                df = sheets[sheet_name]
                n = len(df)
                total_input += n
                parts.append(f"{client_id}: {n}")
                print(f"  {client_id} Rows: {n}")

        print(f"  Total Input Rows: {total_input} | Consolidated Rows: {len(cons_df)}")

        if total_input != len(cons_df):
            raise ReconciliationException(
                f"{sheet_name} Count Mismatch! Input: {total_input} != Consolidated: {len(cons_df)}"
            )

        if sum_columns:
            for col in sum_columns:
                if col not in cons_df.columns:
                    continue
                input_sum = 0.0
                for client_id, sheets in self.client_data.items():
                    if sheet_name in sheets and col in sheets[sheet_name].columns:
                        input_sum += sheets[sheet_name][col].sum()
                cons_sum = cons_df[col].sum()
                print(f"  {col}: Input={input_sum:.2f} | Consolidated={cons_sum:.2f}")
                if round(input_sum, 2) != round(cons_sum, 2):
                    raise ReconciliationException(
                        f"{sheet_name} Sum Mismatch for '{col}'! Input: {input_sum:.2f} != Consolidated: {cons_sum:.2f}"
                    )

        print(f"{sheet_name} Reconciliation: SUCCESS (100% Match)")
        return True
