import pytest
from src.models.domain_models import SchemaDefinition, ColumnDefinition, SheetDefinition
from src.models.exceptions import MappingException, MissingColumnException, SchemaDriftException
from src.mappers.canonical_registry import CanonicalRegistry, CanonicalField
from src.mappers.synonym_engine import SynonymResolutionEngine, normalize_string
from src.mappers.validation_frame import clean_and_normalize_type, validate_regex_pattern
from src.mappers.mapping_engine import map_sheet_records

@pytest.fixture
def sample_columns():
    return [
        ColumnDefinition(canonical_name="S.no", synonyms=["s.no", "S.No", "S.No."], datatype="integer", mandatory=True),
        ColumnDefinition(canonical_name="Assayer Name", synonyms=["Assayer Name", "Auditor Name"], datatype="string"),
        ColumnDefinition(canonical_name="Assayer Code", synonyms=["Assayer Code"], datatype="string", validation_regex="^AS[0-9]{4}$|^AD[0-9]{4}$", mandatory=True),
        ColumnDefinition(canonical_name="Total pay", synonyms=["Total pay", "Total"], datatype="decimal", mandatory=True),
        ColumnDefinition(canonical_name="A/c Number", synonyms=["A/c Number", "Account Number"], datatype="string")
    ]

@pytest.fixture
def mock_schema(sample_columns):
    sheet_def = SheetDefinition(header_row=1, data_start_row=2, columns=sample_columns)
    return SchemaDefinition(
        client_id="test_client",
        client_display_name="Test Client Bank",
        filename_pattern="*test*",
        active=True,
        sheets={"Payment Tracker": sheet_def}
    )

def test_exact_and_synonym_matching(sample_columns):
    """Verify exact canonical and synonym resolving return confidence = 1.0."""
    engine = SynonymResolutionEngine(sample_columns)
    
    # Tier 1 exact canonical match
    match1 = engine.resolve("S.no")
    assert match1.canonical_name == "S.no"
    assert match1.confidence == 1.0
    assert match1.strategy == "exact_canonical"
    
    # Tier 2 exact synonym match
    match2 = engine.resolve("Auditor Name")
    assert match2.canonical_name == "Assayer Name"
    assert match2.confidence == 1.0
    assert match2.strategy == "exact_synonym"

def test_normalized_punctuation_matching(sample_columns):
    """Verify exact match resolves after stripping spaces and punctuation, return confidence = 0.9."""
    engine = SynonymResolutionEngine(sample_columns)
    
    # "S-No" with dashes and different casing (not configured explicitly)
    match1 = engine.resolve(" S-No ")
    assert match1.canonical_name == "S.no"
    assert match1.confidence == 0.90
    assert match1.strategy == "normalized_match"
    
    # "A/c Number" stripped down to "acnumber"
    match2 = engine.resolve("Account_Number")
    assert match2.canonical_name == "A/c Number"
    assert match2.confidence == 0.90
    assert match2.strategy == "normalized_match"

def test_soft_fuzzy_resolution(sample_columns):
    """Verify last-resort fuzzy matching captures close misspelling with likeness confidence >= 0.85."""
    engine = SynonymResolutionEngine(sample_columns, fuzzy_threshold=0.80)
    
    match = engine.resolve("Assayr Code") # missing "e"
    assert match.canonical_name == "Assayer Code"
    assert match.confidence >= 0.80
    assert match.strategy == "fuzzy_match"

def test_low_confidence_rejected(sample_columns):
    """Verify that matches falling below threshold return confidence = 0.0 unresolved."""
    engine = SynonymResolutionEngine(sample_columns, fuzzy_threshold=0.98)
    
    # "Assayr Code" likeness is high (~0.96) but below the strict 0.98 gate
    match = engine.resolve("Assayr Code")
    assert match.canonical_name is None
    assert match.confidence == 0.0
    assert match.strategy == "unresolved"

def test_missing_mandatory_columns_raise_exception(mock_schema):
    """Verify that missing a mandatory canonical column throws a MissingColumnException."""
    raw_records = [
        {"S.no": 1, "Assayer Name": "Ram Prasad", "Assayer Code": "AS0123"}
        # missing "Total pay" which is mandatory
    ]
    with pytest.raises(MissingColumnException):
        map_sheet_records(raw_records, "Payment Tracker", mock_schema)

def test_strict_schema_drift_fails(mock_schema):
    """Verify that strict schema drift throws a SchemaDriftException on unknown column names."""
    raw_records = [
        {"S.no": 1, "Assayer Name": "Ram Prasad", "Assayer Code": "AS0123", "Total pay": 1000.0, "Unexpected Bonus": 500.0}
    ]
    # In standard mode, it logs a warning and proceeds
    res = map_sheet_records(raw_records, "Payment Tracker", mock_schema, strict_drift_detection=False)
    assert "Unexpected Bonus" in res.unmapped_columns
    assert len(res.mapped_records) == 1
    
    # In strict mode, it must raise a loud SchemaDriftException
    with pytest.raises(SchemaDriftException):
        map_sheet_records(raw_records, "Payment Tracker", mock_schema, strict_drift_detection=True)

def test_datatype_normalization_checks():
    """Verify sanitizations for integers, currencies, date formats, and scientific floating notations."""
    # Rupee stripping and thousands commas
    assert clean_and_normalize_type(" ₹ 1,50,000.00 ", "decimal") == 150000.0
    assert clean_and_normalize_type("-5,000", "decimal") == -5000.0
    
    # Precision scientific float notation preservation
    assert clean_and_normalize_type(284801000003273.0, "string") == "284801000003273"
    assert clean_and_normalize_type("284801000003273.0", "integer") == 284801000003273
    
    # Date formatting
    assert clean_and_normalize_type("28-02-2026", "date") == "2026-02-28"
    assert clean_and_normalize_type("2026/02/28", "date") == "2026-02-28"

def test_regex_layout_validators():
    """Verify character validation regex matching."""
    # Assayer Code layout: ^AS[0-9]{4}$|^AD[0-9]{4}$
    pattern = "^AS[0-9]{4}$|^AD[0-9]{4}$"
    assert validate_regex_pattern("AS0123", pattern) is True
    assert validate_regex_pattern("AD9999", pattern) is True
    assert validate_regex_pattern("AD123", pattern) is False # digit count
    assert validate_regex_pattern("XX0123", pattern) is False # alpha prefix
    
    # Null values pass formatting checks cleanly
    assert validate_regex_pattern("N.A", pattern) is True
    assert validate_regex_pattern("0", pattern) is True
