import re
import pandas as pd
from typing import List, Dict, Any, Tuple
from src.models.exceptions import ValidationException
from src.models.domain_models import PaymentTrackerRecord, MasterDataRecord

def check_mandatory_fields(row: Dict[str, Any], mandatory_fields: List[str], row_idx: int) -> None:
    """Verifies that all required fields are populated with non-null values."""
    for field in mandatory_fields:
        val = row.get(field, None)
        if val is None or (isinstance(val, str) and val.strip() == ""):
            raise ValidationException(f"Mandatory Field '{field}' is missing or empty at Row {row_idx}")

def run_regex_matches(row: Dict[str, Any], regex_rules: Dict[str, str], row_idx: int,
                      allowed_exceptions: Dict[str, List[str]] = None) -> List[Dict[str, Any]]:
    """Runs regex checks on string fields, returning warnings if patterns are not matched."""
    warnings = []
    exceptions = allowed_exceptions or {}
    for field_name, pattern in regex_rules.items():
        if field_name in row:
            val = row[field_name]
            if val is not None and str(val).strip() != "":
                val_str = str(val).strip()
                if val_str in exceptions.get(field_name, []):
                    continue
                if not re.match(pattern, val_str):
                    msg = f"Format Warning: Field '{field_name}' value '{val_str}' at Row {row_idx} does not match pattern '{pattern}'"
                    warnings.append({
                        "field": field_name,
                        "row_idx": row_idx,
                        "message": msg
                    })
    return warnings

def detect_duplicate_records(records: List[Dict[str, Any]], unique_keys: List[str]) -> List[str]:
    """Scans clean records list for duplicates based on composite keys, returning list of duplicates details."""
    seen_keys = set()
    duplicates_found = []
    
    for idx, row in enumerate(records, 2):
        # Generate composite key
        key_parts = []
        for k in unique_keys:
            val = row.get(k, None)
            key_parts.append(str(val) if val is not None else "")
            
        composite_key = "|".join(key_parts)
        if composite_key in seen_keys:
            duplicates_found.append(f"Row {idx}: Duplicate entry found for unique keys combination {dict(zip(unique_keys, key_parts))}")
        else:
            seen_keys.add(composite_key)
            
    return duplicates_found

def validate_and_cast_payment_tracker(records: List[Dict[str, Any]]) -> Tuple[List[PaymentTrackerRecord], List[Dict[str, Any]]]:
    """Validates and casts Payment Tracker records using Pydantic V2, returning clean models and warnings."""
    clean_models = []
    warnings = []
    
    regex_rules = {
        "Assayer Code": r"^AS[0-9]{4}$|^AD[0-9]{4}$",
        "PAN Number": r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$",
        "IFSC Code": r"^[A-Z]{4}0[A-Z0-9]{6}$"
    }
    ifsc_exceptions = ["0", "N.A", "SBIN002105", "IB000T100"]
    
    for idx, row in enumerate(records, 2):
        # Run required validations
        check_mandatory_fields(row, ["S.no", "Assayer Name", "Assayer Code", "Total pay"], idx)
        
        # Capture regex warnings
        row_warnings = run_regex_matches(row, regex_rules, idx, allowed_exceptions={"IFSC Code": ifsc_exceptions})
        warnings.extend(row_warnings)
        
        # Pydantic validation & cast
        try:
            model = PaymentTrackerRecord.model_validate(row)
            clean_models.append(model)
        except Exception as e:
            raise ValidationException(f"Type validation failed at Row {idx} for Payment Tracker: {e}")
            
    return clean_models, warnings

def validate_and_cast_master_data(records: List[Dict[str, Any]]) -> Tuple[List[MasterDataRecord], List[Dict[str, Any]]]:
    """Validates and casts Master Data records using Pydantic V2, returning clean models and warnings."""
    clean_models = []
    warnings = []
    
    regex_rules = {
        "Assayer Code": r"^AS[0-9]{4}$|^AD[0-9]{4}$",
        "Assayer PAN": r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$"
    }
    
    for idx, row in enumerate(records, 2):
        # Run required validations
        check_mandatory_fields(row, ["Sr No", "Client", "BRANCH", "Assayer Name", "Assayer Code"], idx)
        
        # Capture regex warnings
        row_warnings = run_regex_matches(row, regex_rules, idx)
        warnings.extend(row_warnings)
        
        # Pydantic validation & cast
        try:
            model = MasterDataRecord.model_validate(row)
            clean_models.append(model)
        except Exception as e:
            raise ValidationException(f"Type validation failed at Row {idx} for Master Data: {e}")
            
    return clean_models, warnings
