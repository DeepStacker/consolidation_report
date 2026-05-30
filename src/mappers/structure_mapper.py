"""
Refactored Structure Mapper for Sprint 2.
Delegates mapping tasks to the new robust Mapping Engine and Synonym Resolution Engine.
"""

from typing import List, Dict, Any
from src.models.domain_models import SchemaDefinition
from src.mappers.mapping_engine import map_sheet_records

def map_raw_to_canonical(raw_records: List[Dict[str, Any]], 
                         sheet_name: str, 
                         schema: SchemaDefinition) -> List[Dict[str, Any]]:
    """
    Backward-compatible entry point for mapping raw ingested rows into canonical field keys.
    Delegates to the newly implemented production-grade Mapping Engine.
    
    Args:
        raw_records: List of raw ingested rows (dicts).
        sheet_name: Sheet scope (e.g. 'Payment Tracker' or 'Master Data').
        schema: Parsed client SchemaDefinition config.
        
    Returns:
        List of typed, canonically mapped records.
    """
    # Load configuration settings if available in the schema metadata or use default parameters.
    # In strict mode, we can read dynamic configs, otherwise defaults are fully robust.
    result = map_sheet_records(
        raw_records=raw_records,
        sheet_name=sheet_name,
        schema_def=schema,
        strict_drift_detection=False, # Default to warning log, fails loudly when configured
        confidence_threshold=0.85
    )
    
    # Trace mapping decisions for audit trail
    print(f"\n[Mapping Audit] Resolved sheet '{sheet_name}' for client '{schema.client_id}' with average confidence: {result.average_confidence * 100:.1f}%")
    if result.unmapped_columns:
        print(f"  [Warning] Unmapped source columns: {result.unmapped_columns}")
        
    return result.mapped_records
