"""
Domain Models for the Excel Consolidation Platform.
Defines the canonical schema formats, validation, and serialization structures using Pydantic V2.
"""

from datetime import date, time, datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator, ConfigDict
import re

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

class PaymentTrackerRecord(BaseModel):
    """
    Canonical Domain Model representing a single transaction row in the consolidated Payment Tracker sheet.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    s_no: int = Field(alias="S.no", description="Sequential index.")
    client: str = Field(default="Axis Bank POA", description="Target bank client designation.")
    assayer_name: str = Field(alias="Assayer Name", description="Auditor name.")
    assayer_code: str = Field(alias="Assayer Code", description="Unique code.")
    assayer_phone: Optional[str] = Field(default=None, alias="Assayer Phone")
    location: Optional[str] = Field(default=None, alias="Location")
    state: Optional[str] = Field(default=None, alias="State")
    zone: Optional[str] = Field(default=None, alias="Zone")
    audit_month_year: str = Field(alias="Audit Month & Year")
    type_of_audit: str = Field(alias="Type of Audit")
    no_of_visits: Optional[int] = Field(default=0, alias="No. of Visits")
    base_audit_fee: Optional[float] = Field(default=0.0, alias="Base Audit Fee")
    total_pay_base: Optional[float] = Field(default=0.0, alias="Total pay (Base)")
    travel_charges: Optional[float] = Field(default=0.0, alias=" Travel charges(If any)")
    cancelled_visits: Optional[float] = Field(default=0.0, alias="Cancelled visits")
    branch_cancellation_charges: Optional[float] = Field(default=0.0, alias="Branch Cancellation Charges")
    an_expenses: Optional[float] = Field(default=0.0, alias=" Andaman & Nicobar Branch Expenses")
    error_deduction: Optional[float] = Field(default=0.0, alias="Error Deduction")
    total_pay: Optional[float] = Field(default=0.0, alias="Total pay")
    remarks: Optional[str] = Field(default=None, alias="Remarks (if any)")
    pan_number: Optional[str] = Field(default=None, alias="PAN Number")
    bank_name: Optional[str] = Field(default=None, alias="Bank Name")
    ac_number: Optional[str] = Field(default=None, alias="A/c Number")
    ifsc_code: Optional[str] = Field(default=None, alias="IFSC Code")

    @field_validator("assayer_code")
    @classmethod
    def check_assayer_code(cls, v: str) -> str:
        """Validates that the Assayer Code conforms to ASxxxx or ADxxxx structures."""
        if not re.match(r"^AS[0-9]{4}$|^AD[0-9]{4}$", v):
            raise ValueError(f"Invalid Assayer Code format: {v}")
        return v

    @field_validator("pan_number")
    @classmethod
    def check_pan(cls, v: Optional[str]) -> Optional[str]:
        """Validates that the PAN Number matches the Indian Income Tax standard alpha-numeric layout."""
        if v and not re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$", v):
            raise ValueError(f"Invalid PAN format: {v}")
        return v

    @field_validator("ifsc_code")
    @classmethod
    def check_ifsc(cls, v: Optional[str]) -> Optional[str]:
        """Validates bank IFSC routing codes layout requirements."""
        if v and v != "0" and v != "N.A" and v != "SBIN002105" and v != "IB000T100" and not re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", v):
            raise ValueError(f"Invalid IFSC format: {v}")
        return v

class MasterDataRecord(BaseModel):
    """
    Canonical Domain Model representing a single transaction row in the consolidated Master Data sheet.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    sr_no: float = Field(alias="Sr No")
    client: str = Field(alias="Client")
    month: str = Field(alias="Month")
    zone: Optional[str] = Field(default=None, alias="Zone")
    sol_id: Optional[str] = Field(default=None, alias="SOL ID")
    branch: str = Field(alias="BRANCH")
    location: Optional[str] = Field(default=None, alias="Location ")
    state: Optional[str] = Field(default=None, alias="State")
    total_accounts: Optional[float] = Field(default=0.0, alias="Total No.of A/cs")
    assayer_name: str = Field(alias="Assayer Name")
    assayer_code: str = Field(alias="Assayer Code")
    assayer_phone: Optional[str] = Field(default=None, alias="AssayerPhone")
    assayer_pan: Optional[str] = Field(default=None, alias="Assayer PAN")
    contact_person: Optional[str] = Field(default=None, alias="Contact Person")
    schedule_date: Optional[str] = Field(default=None, alias="Schedule date")
    audit_status: Optional[str] = Field(default=None, alias="Audit \nStatus")
    audit_completion_date: Optional[str] = Field(default=None, alias="Audit \ncompletion date")
    days_audited: Optional[float] = Field(default=0.0, alias="No of days \naudited ")
    days_audited_client: Optional[float] = Field(default=0.0, alias="No of days \naudited For client")
    packets_audited: Optional[float] = Field(default=0.0, alias="No of Packets \naudited")
    additional_packet: Optional[float] = Field(default=0.0, alias="Additional Packet")
    reporting_time: Optional[str] = Field(default=None, alias="Assayer Reporting time at Branch")
    start_time: Optional[str] = Field(default=None, alias="Audit start time")
    end_time: Optional[str] = Field(default=None, alias="Audit End Time")
    client_fee: Optional[float] = Field(default=0.0, alias="Client fee")
    additional: Optional[float] = Field(default=0.0, alias="Additional")
    final_client_fees: Optional[float] = Field(default=0.0, alias="Final Client Fees")
    assayer_fee: Optional[float] = Field(default=0.0, alias="Assayer fee")
    additional_fee: Optional[float] = Field(default=0.0, alias="Additional fee")
    distance: Optional[str] = Field(default=None, alias="Distance")
    base_location: Optional[str] = Field(default=None, alias="Base Location")
    remarks: Optional[str] = Field(default=None, alias="Remarks")
    assayer_fee_1: Optional[float] = Field(default=0.0, alias="Assayer fee.1")
    additional_fee_1: Optional[float] = Field(default=0.0, alias="Additional fee.1")
    cancelled: Optional[float] = Field(default=0.0, alias="Cancelled")
    error_deduction: Optional[float] = Field(default=0.0, alias="Error Deduciton")
    total: Optional[float] = Field(default=0.0, alias="Total")
    audit_remarks: Optional[str] = Field(default=None, alias="Audit Remarks")
    seeding_status: Optional[float] = Field(default=None, alias="Seeding Status")
    report: Optional[float] = Field(default=None, alias="Report")

    # Client specific metrics fields
    total_pouches_suggested: Optional[float] = Field(default=None, alias="Total pouches suggested for audit")
    already_audited: Optional[float] = Field(default=None, alias="Already Audited")
    ac_closed: Optional[float] = Field(default=None, alias="A/C Closed")
    ac_auctioned: Optional[float] = Field(default=None, alias="A/C Auctioned")
    packet_missing: Optional[float] = Field(default=None, alias="Packet Missing")
    actual_audited: Optional[float] = Field(default=None, alias="Actual Audited (except already audited & A/C closed)  ")
    extra_audited_pouches: Optional[float] = Field(default=None, alias="Extra audited pouches")
    total_packets_audited: Optional[float] = Field(default=None, alias="Total No.of packets actually audited")
