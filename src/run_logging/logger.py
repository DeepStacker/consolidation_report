import os
import json
import uuid
from datetime import datetime
from typing import Dict, Any, List

class RunAuditLogger:
    def __init__(self):
        self.run_id = str(uuid.uuid4())
        self.execution_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.files_processed: List[Dict[str, str]] = []
        self.row_counts: Dict[str, Dict[str, int]] = {}
        self.financial_sums: Dict[str, Dict[str, float]] = {}
        self.rules_applied: List[Dict[str, str]] = []
        self.validation_warnings: List[Dict[str, Any]] = []
        self.reconciliation_status = "PENDING"
        self.error_message = None

    def log_file(self, client_id: str, filepath: str):
        """Logs details of ingested source files."""
        self.files_processed.append({
            "client_id": client_id,
            "filename": os.path.basename(filepath),
            "full_path": filepath
        })

    def log_counts(self, category: str, input_count: int, output_count: int):
        """Logs row count changes."""
        self.row_counts[category] = {
            "input": input_count,
            "output": output_count
        }

    def log_sums(self, category: str, standalone_sum: float, consolidated_sum: float):
        """Logs financial payment totals validations."""
        self.financial_sums[category] = {
            "standalone": round(float(standalone_sum), 2),
            "consolidated": round(float(consolidated_sum), 2)
        }

    def log_rule(self, rule_id: str, description: str):
        """Logs custom or declarative rules transformations."""
        self.rules_applied.append({
            "rule_id": rule_id,
            "description": description,
            "timestamp": datetime.now().strftime("%H:%M:%S")
        })

    def log_warning(self, field: str, row_idx: int, message: str):
        """Logs format check validation warnings."""
        self.validation_warnings.append({
            "field": field,
            "row_idx": row_idx,
            "message": message
        })

    def finalize(self, status: str, error: Exception = None):
        """Finalizes reconciliation status."""
        self.reconciliation_status = status
        if error:
            self.error_message = str(error)

    def write_log(self, output_dir: str) -> str:
        """Saves run audit data into a formatted JSON log in output directory."""
        log_filename = f"run_audit_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        log_path = os.path.join(output_dir, log_filename)
        
        log_data = {
            "run_id": self.run_id,
            "execution_timestamp": self.execution_timestamp,
            "reconciliation_status": self.reconciliation_status,
            "error_message": self.error_message,
            "row_counts": self.row_counts,
            "financial_sums": self.financial_sums,
            "files_processed": self.files_processed,
            "rules_applied": self.rules_applied,
            "validation_warnings": self.validation_warnings
        }
        
        os.makedirs(output_dir, exist_ok=True)
        with open(log_path, 'w') as f:
            json.dump(log_data, f, indent=4)
            
        print(f"Structured Run Audit Log saved successfully to: {log_path}")
        return log_path
