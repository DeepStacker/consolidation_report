"""
Mapping Engine Orchestrator for Sprint 2.
Orchestrates raw dictionary mappings into target canonical formats, enforcing confidence scores, 
missing column assertions, and schema drift checks.
"""

from typing import List, Dict, Any, Tuple
from pydantic import BaseModel, Field
from src.models.domain_models import SchemaDefinition, ColumnDefinition
from src.models.exceptions import MappingException, MissingColumnException, SchemaDriftException
from src.mappers.synonym_engine import SynonymResolutionEngine, ResolutionMatch
from src.mappers.validation_frame import clean_and_normalize_type, validate_regex_pattern

class MappingResult(BaseModel):
    """
    Data model encapsulating the complete results, diagnostics, 
    and explainable traces of a sheet mapping run.
    """
    client_id: str = Field(description="System identifier for the client configuration.")
    sheet_name: str = Field(description="Name of the processed Excel sheet.")
    mapped_records: List[Dict[str, Any]] = Field(description="Aligned canonical records dictionaries.")
    unmapped_columns: List[str] = Field(default_factory=list, description="List of source columns that could not be mapped.")
    missing_mandatory_columns: List[str] = Field(default_factory=list, description="Required target columns that are absent in the source.")
    column_map: Dict[str, str] = Field(default_factory=dict, description="Resolved mapping registry (raw_header -> canonical_name).")
    resolution_ledger: List[ResolutionMatch] = Field(default_factory=list, description="Trace details explaining every column mapping decision.")
    average_confidence: float = Field(default=0.0, description="Average confidence score across all resolved headers.")

def map_sheet_records(raw_records: List[Dict[str, Any]], 
                      sheet_name: str, 
                      schema_def: SchemaDefinition,
                      strict_drift_detection: bool = False,
                      confidence_threshold: float = 0.85) -> MappingResult:
    """
    Orchestrates the conversion of raw, messy dictionaries into aligned, normalized canonical records.
    
    Args:
        raw_records: Raw ingested row dictionaries.
        sheet_name: Active sheet name target.
        schema_def: Loaded client SchemaDefinition structure.
        strict_drift_detection: If True, halts the pipeline with SchemaDriftException on any unknown columns.
        confidence_threshold: Strict boundary limit below which automatic synonym matching aborts.
        
    Returns:
        A MappingResult structure containing the mapped data and rich explainable audit traces.
        
    Raises:
        MappingException: On low confidence maps or invalid configurations.
        MissingColumnException: If a mandatory canonical column is missing.
        SchemaDriftException: If strict drift detection is enabled and new columns are found.
    """
    if sheet_name not in schema_def.sheets:
        raise MappingException(f"Sheet '{sheet_name}' is not configured in client schema '{schema_def.client_id}'")
        
    sheet_config = schema_def.sheets[sheet_name]
    columns_config = sheet_config.columns
    
    # 1. Initialize Synonym Resolution Engine
    resolution_engine = SynonymResolutionEngine(columns_config, fuzzy_threshold=confidence_threshold)
    
    # 2. Extract Raw Column Headers from Ingested Rows
    raw_headers = list(raw_records[0].keys()) if raw_records else []
    
    # 3. Resolve Columns
    resolution_ledger: List[ResolutionMatch] = []
    column_map: Dict[str, str] = {}
    unmapped_columns: List[str] = []
    
    total_resolved_confidence = 0.0
    resolved_count = 0
    
    for header in raw_headers:
        match = resolution_engine.resolve(header)
        resolution_ledger.append(match)
        
        if match.canonical_name:
            column_map[header] = match.canonical_name
            total_resolved_confidence += match.confidence
            resolved_count += 1
            
            # Ensure mapped confidence satisfies minimum requirements
            if match.confidence < confidence_threshold:
                raise MappingException(
                    f"Low mapping confidence ({match.confidence}) resolved for column '{header}' to "
                    f"canonical '{match.canonical_name}' in sheet '{sheet_name}'. Threshold is {confidence_threshold}."
                )
        else:
            unmapped_columns.append(header)
            
    # Compute Average Confidence Score
    avg_confidence = round(total_resolved_confidence / resolved_count, 4) if resolved_count > 0 else 0.0
    
    # 4. Assert Schema Drift Constraints
    if unmapped_columns and strict_drift_detection:
        raise SchemaDriftException(
            f"Schema drift detected on sheet '{sheet_name}'. Unknown columns found in source Excel: {unmapped_columns}"
        )
        
    # 5. Assert Mandatory Canonical Columns
    missing_mandatory = []
    mapped_canonicals = set(column_map.values())
    
    for col_def in columns_config:
        if col_def.mandatory and col_def.canonical_name not in mapped_canonicals:
            # Check if this column is configured to be copied from another column (which is present!)
            if col_def.copy_from_column:
                # Find if the copy-source column is mapped
                resolved_source = False
                for raw, canonical in column_map.items():
                    if canonical == col_def.copy_from_column:
                        resolved_source = True
                        break
                if resolved_source:
                    continue # copy source is present, so field can be resolved later in rules
            missing_mandatory.append(col_def.canonical_name)
            
    if missing_mandatory:
        raise MissingColumnException(
            f"Mandatory target columns are missing in source sheet '{sheet_name}': {missing_mandatory}"
        )
        
    # 6. Map and Normalize Raw Data Rows
    mapped_records: List[Dict[str, Any]] = []
    
    for r_idx, row in enumerate(raw_records, 1):
        mapped_row = {}
        
        for col_def in columns_config:
            canonical_name = col_def.canonical_name
            
            # Find the raw column that maps to this canonical name
            raw_key_found = None
            for raw, canonical in column_map.items():
                if canonical == canonical_name:
                    raw_key_found = raw
                    break
                    
            if raw_key_found is not None:
                raw_value = row[raw_key_found]
            else:
                # Value is missing in the source. Fall back to default
                raw_value = col_def.default_value
                
            # Dynamic Fallback: Auto-assign sequential indexes for S.no or Sr No if missing in raw data
            if canonical_name in ["S.no", "Sr No"] and (raw_value is None or str(raw_value).strip() == ""):
                raw_value = r_idx
                
            # Perform Type Normalization
            normalized_val = clean_and_normalize_type(raw_value, col_def.datatype, col_def.default_value)
            mapped_row[canonical_name] = normalized_val
            
        mapped_records.append(mapped_row)
        
    return MappingResult(
        client_id=schema_def.client_id,
        sheet_name=sheet_name,
        mapped_records=mapped_records,
        unmapped_columns=unmapped_columns,
        missing_mandatory_columns=missing_mandatory,
        column_map=column_map,
        resolution_ledger=resolution_ledger,
        average_confidence=avg_confidence
    )
