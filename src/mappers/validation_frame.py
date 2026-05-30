"""
Type Normalization and Formatting Validation Framework for Sprint 2 Mapping Engine.
Ensures correct datatype conversions and regular expression validation format checks.
"""

import re
import math
from datetime import datetime, date, time
from typing import Any, Optional

def is_nan(val: Any) -> bool:
    """
    Checks if a value is a float NaN safely without numpy dependency.
    """
    if isinstance(val, float):
        return math.isnan(val)
    return False

def clean_and_normalize_type(val: Any, datatype: str, default_val: Any = None) -> Any:
    """
    Sanitizes raw cell values, strips rupee signs and thousands separators, 
    and casts precise values into system-safe target Python datatypes.
    """
    if val is None or is_nan(val):
        return default_val
        
    if isinstance(val, str):
        clean_str = val.strip()
        if clean_str == "" or clean_str.lower() in ["nan", "null", "none"]:
            return default_val
            
    # Normalize datatype casting
    if datatype == "integer":
        if isinstance(val, (int, float)):
            return int(val)
        try:
            # Strip commas or decimals if string represents a float
            s_val = str(val).strip().replace(",", "")
            if "." in s_val:
                return int(float(s_val))
            return int(s_val)
        except Exception:
            return default_val if default_val is not None else 0
            
    elif datatype == "decimal":
        if isinstance(val, (int, float)):
            return float(val)
        try:
            # Strip commas, spaces, rupee symbols
            s_val = str(val).strip().replace(",", "").replace("₹", "").replace(" ", "")
            return float(s_val)
        except Exception:
            return default_val if default_val is not None else 0.0
            
    elif datatype == "string":
        # P0 Precision: Cast float integers to exact string representations
        if isinstance(val, float) and val.is_integer():
            return str(int(val))
        if isinstance(val, float):
            return str(val)
        if isinstance(val, (datetime, date)):
            return val.strftime("%Y-%m-%d")
        return str(val).strip()
        
    elif datatype == "date":
        if isinstance(val, (datetime, date)):
            return val.strftime("%Y-%m-%d")
        # Attempt common date parsing
        s_val = str(val).strip()
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%Y", "%b %d, %Y", "%d %b %Y"):
            try:
                dt = datetime.strptime(s_val, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return s_val  # Keep as-is if parsing fails; regex validation will capture errors
        
    elif datatype == "time":
        if isinstance(val, time):
            return val.strftime("%H:%M:%S")
        if isinstance(val, datetime):
            return val.time().strftime("%H:%M:%S")
        return str(val).strip()
        
    return val

def validate_regex_pattern(val: Any, pattern: Optional[str]) -> bool:
    """
    Validates a normalized value against a regular expression pattern.
    """
    if not pattern or val is None:
        return True
        
    s_val = str(val).strip()
    if s_val == "" or s_val.lower() in ["n.a", "na", "0", "n.a."]:
        return True # Treat null indicators as valid (or optionally checked at mandatory levels)
        
    try:
        return bool(re.match(pattern, s_val))
    except Exception:
        return False
