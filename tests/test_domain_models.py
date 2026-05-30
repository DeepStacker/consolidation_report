import pytest
from pydantic import ValidationError
from src.models.domain_models import PaymentTrackerRecord, MasterDataRecord

def test_valid_payment_tracker_record():
    """Tests that a structurally valid Payment Tracker record parses successfully."""
    valid_data = {
        "S.no": 1,
        "client": "Axis Bank POA",
        "Assayer Name": "Guruprasad R Shet",
        "Assayer Code": "AS0701",
        "Assayer Phone": "9731605556",
        "Location": "Koramangala",
        "State": "Karnataka",
        "Zone": "South",
        "Audit Month & Year": "Feb'26",
        "Type of Audit": "AXIS Bank POA",
        "No. of Visits": 1,
        "Base Audit Fee": 1000.0,
        "Total pay (Base)": 1000.0,
        " Travel charges(If any)": 0.0,
        "Cancelled visits": 0.0,
        "Branch Cancellation Charges": 0.0,
        " Andaman & Nicobar Branch Expenses": 0.0,
        "Error Deduction": 0.0,
        "Total pay": 1000.0,
        "Remarks (if any)": "Payment as per approval",
        "PAN Number": "DWUPS3353D",
        "Bank Name": "Indian Overseas Bank",
        "A/c Number": "284801000003273",
        "IFSC Code": "IOBA0002848"
    }
    
    record = PaymentTrackerRecord.model_validate(valid_data)
    assert record.s_no == 1
    assert record.assayer_name == "Guruprasad R Shet"
    assert record.assayer_code == "AS0701"
    assert record.pan_number == "DWUPS3353D"
    assert record.ifsc_code == "IOBA0002848"

def test_invalid_pan_format():
    """Tests that an invalid PAN format is rejected by the Pydantic validator."""
    invalid_data = {
        "S.no": 1,
        "Assayer Name": "Guruprasad R Shet",
        "Assayer Code": "AS0701",
        "Audit Month & Year": "Feb'26",
        "Type of Audit": "AXIS Bank POA",
        "Total pay": 1000.0,
        "PAN Number": "INVALIDPAN1"  # Invalid format
    }
    
    with pytest.raises(ValidationError) as exc_info:
        PaymentTrackerRecord.model_validate(invalid_data)
    
    assert "Invalid PAN format" in str(exc_info.value)

def test_invalid_ifsc_format():
    """Tests that an invalid bank IFSC routing code is rejected by the validator."""
    invalid_data = {
        "S.no": 1,
        "Assayer Name": "Guruprasad R Shet",
        "Assayer Code": "AS0701",
        "Audit Month & Year": "Feb'26",
        "Type of Audit": "AXIS Bank POA",
        "Total pay": 1000.0,
        "IFSC Code": "IOBA1102848"  # Invalid format (fifth char is not 0)
    }
    
    with pytest.raises(ValidationError) as exc_info:
        PaymentTrackerRecord.model_validate(invalid_data)
        
    assert "Invalid IFSC format" in str(exc_info.value)

def test_invalid_assayer_code_format():
    """Tests that an invalid assayer code triggers validation errors."""
    invalid_data = {
        "S.no": 1,
        "Assayer Name": "Guruprasad R Shet",
        "Assayer Code": "AB1234",  # Invalid prefix (must be AS or AD)
        "Audit Month & Year": "Feb'26",
        "Type of Audit": "AXIS Bank POA",
        "Total pay": 1000.0
    }
    
    with pytest.raises(ValidationError) as exc_info:
        PaymentTrackerRecord.model_validate(invalid_data)
        
    assert "Invalid Assayer Code format" in str(exc_info.value)

def test_serialization_support():
    """Tests that the domain models support seamless dictionary dumping and serialization."""
    valid_data = {
        "S.no": 1,
        "client": "Axis Bank POA",
        "Assayer Name": "Guruprasad R Shet",
        "Assayer Code": "AS0701",
        "Assayer Phone": "9731605556",
        "Location": "Koramangala",
        "State": "Karnataka",
        "Zone": "South",
        "Audit Month & Year": "Feb'26",
        "Type of Audit": "AXIS Bank POA",
        "No. of Visits": 1,
        "Base Audit Fee": 1000.0,
        "Total pay (Base)": 1000.0,
        " Travel charges(If any)": 0.0,
        "Cancelled visits": 0.0,
        "Branch Cancellation Charges": 0.0,
        " Andaman & Nicobar Branch Expenses": 0.0,
        "Error Deduction": 0.0,
        "Total pay": 1000.0,
        "Remarks (if any)": "Payment as per approval",
        "PAN Number": "DWUPS3353D",
        "Bank Name": "Indian Overseas Bank",
        "A/c Number": "284801000003273",
        "IFSC Code": "IOBA0002848"
    }
    
    model = PaymentTrackerRecord.model_validate(valid_data)
    serialized_dict = model.model_dump(by_alias=True)
    
    assert serialized_dict["S.no"] == 1
    assert serialized_dict["Assayer Name"] == "Guruprasad R Shet"
    assert serialized_dict["Assayer Code"] == "AS0701"
    assert serialized_dict["PAN Number"] == "DWUPS3353D"
    assert serialized_dict["IFSC Code"] == "IOBA0002848"

def test_missing_mandatory_fields_fail():
    """Tests that omission of strictly required fields results in validation failures."""
    invalid_data = {
        # Missing S.no, Assayer Name, and Assayer Code
        "client": "Axis Bank POA",
        "Total pay": 1000.0
    }
    
    with pytest.raises(ValidationError) as exc_info:
        PaymentTrackerRecord.model_validate(invalid_data)
        
    # Check that multiple fields are missing in error details
    err_str = str(exc_info.value)
    assert "S.no" in err_str
    assert "Assayer Name" in err_str
    assert "Assayer Code" in err_str
