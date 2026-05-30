"""
Domain Models for the Excel Consolidation Platform.
Defines the canonical schema formats and configuration structures.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict

class ColumnDefinition(BaseModel):
    """
    Schema definition for an individual column.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    canonical_name: str = Field(description="The final target column name in the consolidated workbook.")
    synonyms: List[str] = Field(default_factory=list, description="List of recognized variations of the header name.")
    datatype: str = Field(description="Target datatype. Expected: 'integer', 'decimal', 'date', 'time', 'string'.")
    mandatory: bool = Field(default=False, description="Flag indicating if the column is strictly required.")
    default_value: Any = Field(default=None, description="Fallback value if optional column is missing or blank.")
    validation_regex: Optional[str] = Field(default=None, description="Optional regular expression for format checking.")
    validation_exceptions: List[str] = Field(default_factory=list, description="Optional list of allowed values that bypass regex validation.")
    copy_from_column: Optional[str] = Field(default=None, description="Optional source column name to copy data from.")

class SheetDefinition(BaseModel):
    """
    Configuration definition for a single workbook sheet.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    header_row: int = Field(default=1, description="Row index (1-based) where headers are located.")
    data_start_row: int = Field(default=2, description="Row index (1-based) where data ingestion begins.")
    columns: List[ColumnDefinition] = Field(default_factory=list, description="List of columns to map and validate.")
    sum_columns: List[str] = Field(default_factory=list, description="Column names to inject SUM formulas for in the output.")
    hidden_columns: List[int] = Field(default_factory=list, description="1-based column indices to hide in the output sheet.")
    client_column: Optional[str] = Field(default=None, description="Column name that identifies the client/bank.")
    s_no_column: Optional[str] = Field(default=None, description="Column name for sequential numbering.")

class SchemaDefinition(BaseModel):
    """
    Unified client configuration schema loaded from YAML mappings.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    client_id: str = Field(description="Unique system identifier for the client format.")
    client_display_name: str = Field(description="Human-readable client name.")
    filename_pattern: str = Field(description="Glob-style pattern to discover the raw files.")
    active: bool = Field(default=True, description="Flag indicating if this configuration is active.")
    sheets: Dict[str, SheetDefinition] = Field(default_factory=dict, description="Dictionary mapping sheet names to definitions.")

class RuleDefinition(BaseModel):
    """
    Configuration schema for business rule metadata and prioritization.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    rule_id: str = Field(description="Unique business rule identifier.")
    client_id: str = Field(description="Client target of this rule.")
    scope: str = Field(description="Target scope: 'Payment Tracker' or 'Master Data'.")
    priority: int = Field(default=1, description="Priority weight. Higher runs first.")
    description: str = Field(description="Plain text description of the transformation.")

class AuditLogDefinition(BaseModel):
    """
    Structure of the monthly run structured JSON audit log.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    run_id: str = Field(description="Unique execution run UUID.")
    execution_timestamp: str = Field(description="Timestamp of processing closing cycle.")
    reconciliation_status: str = Field(description="Status of financial sum audits (e.g. SUCCESS/FAILED).")
    error_message: Optional[str] = Field(default=None, description="Captured exception details if aborted.")
    row_counts: Dict[str, Dict[str, int]] = Field(default_factory=dict, description="Reconciled row counts.")
    financial_sums: Dict[str, Dict[str, float]] = Field(default_factory=dict, description="Reconciled payment totals.")
    files_processed: List[Dict[str, str]] = Field(default_factory=list, description="Trace details of ingested workbooks.")
    rules_applied: List[Dict[str, str]] = Field(default_factory=list, description="Traces of applied rules overrides.")
    validation_warnings: List[Dict[str, Any]] = Field(default_factory=list, description="Warnings log generated.")
