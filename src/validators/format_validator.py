import re
from typing import List, Dict, Any, Tuple
from src.models.domain_models import SheetDefinition


def check_mandatory_fields(row: Dict[str, Any], mandatory_fields: List[str], row_idx: int) -> List[Dict[str, Any]]:
    warnings = []
    for field in mandatory_fields:
        val = row.get(field, None)
        if val is None or (isinstance(val, str) and val.strip() == ""):
            warnings.append({
                "field": field,
                "row_idx": row_idx,
                "message": f"Mandatory field '{field}' is missing or empty at Row {row_idx}"
            })
    return warnings


def run_regex_matches(row: Dict[str, Any], regex_rules: Dict[str, Dict], row_idx: int) -> List[Dict[str, Any]]:
    warnings = []
    for field_name, config in regex_rules.items():
        if field_name in row:
            val = row[field_name]
            if val is not None and str(val).strip() != "":
                val_str = str(val).strip()
                if val_str in config.get("exceptions", []):
                    continue
                if not re.match(config["pattern"], val_str):
                    msg = f"Format Warning: Field '{field_name}' value '{val_str}' at Row {row_idx} does not match pattern '{config['pattern']}'"
                    warnings.append({"field": field_name, "row_idx": row_idx, "message": msg})
    return warnings


def detect_duplicate_records(records: List[Dict[str, Any]], unique_keys: List[str]) -> List[str]:
    seen_keys = set()
    duplicates_found = []
    for idx, row in enumerate(records, 2):
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


def validate_sheet(records: List[Dict[str, Any]], sheet_def: SheetDefinition,
                   duplicate_keys: List[str] = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    clean_records = []
    warnings = []

    mandatory_fields = [c.canonical_name for c in sheet_def.columns if c.mandatory]
    regex_rules = {}
    for c in sheet_def.columns:
        if c.validation_regex:
            regex_rules[c.canonical_name] = {
                "pattern": c.validation_regex,
                "exceptions": c.validation_exceptions or []
            }

    for idx, row in enumerate(records, 2):
        mandatory_warnings = check_mandatory_fields(row, mandatory_fields, idx)
        warnings.extend(mandatory_warnings)
        row_warnings = run_regex_matches(row, regex_rules, idx)
        warnings.extend(row_warnings)
        clean_records.append(row)

    if duplicate_keys:
        duplicates = detect_duplicate_records(clean_records, duplicate_keys)
        for d in duplicates:
            warnings.append({"field": "DUPLICATE", "row_idx": 0, "message": d})

    return clean_records, warnings
