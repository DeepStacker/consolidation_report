import pytest
from src.rules.overrides import global_rules_engine

def test_axis_location_state_copy_override():
    """Tests if Axis location state override seeds the Location field correctly."""
    row = {
        "Sr No": 1.0,
        "Client": "Axis Bank POA",
        "BRANCH": "Swasthya Vihar",
        "State": "Delhi",
        "Location ": None # Target field to copy to
    }
    
    # Run the overrides engine for Axis POA Master Data
    transformed_records = global_rules_engine.execute_rules_on_records([row], "axis_poa", "Master Data")
    
    assert len(transformed_records) == 1
    assert transformed_records[0]["Location "] == "Delhi"

def test_rbl_pt_cancellation_override():
    """Tests if RBL cancellation redirect resets specific Axis columns to 0."""
    row = {
        "S.no": 1,
        "client": "RBL(muthoot)",
        "Cancelled visits": 1000.0, # Contains monetary fee
        "Branch Cancellation Charges": 2300.0, # Pre-existing
        " Andaman & Nicobar Branch Expenses": 500.0,
        "Error Deduction": 100.0
    }
    
    # Run overrides engine for RBL POA Payment Tracker
    transformed_records = global_rules_engine.execute_rules_on_records([row], "rbl_poa", "Payment Tracker")
    
    assert len(transformed_records) == 1
    assert transformed_records[0]["Cancelled visits"] == 1000.0 # Untouched redirection
    assert transformed_records[0]["Branch Cancellation Charges"] == 0.0
    assert transformed_records[0][" Andaman & Nicobar Branch Expenses"] == 0.0
    assert transformed_records[0]["Error Deduction"] == 0.0
