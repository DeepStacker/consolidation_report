"""Tests for domain models and schema-driven validation."""

import pytest
from src.models.domain_models import SchemaDefinition, SheetDefinition, ColumnDefinition
from src.schema_loader import load_schema_config
from src.validators.format_validator import validate_sheet


class TestSchemaConfig:
    """Verify YAML schema configs load correctly."""

    def test_axis_schema_loads(self):
        schema = load_schema_config("config/schemas/axis_poa.yaml")
        assert schema.client_id == "axis_poa"
        assert "Payment Tracker" in schema.sheets
        assert "Master Data" in schema.sheets
        assert schema.active is True

    def test_rbl_schema_loads(self):
        schema = load_schema_config("config/schemas/rbl_poa.yaml")
        assert schema.client_id == "rbl_poa"
        assert "Payment Tracker" in schema.sheets
        assert "Master Data" in schema.sheets
        assert schema.active is True

    def test_column_definition_validation_exceptions(self):
        """Verify validation_exceptions field works in schema loading."""
        schema = load_schema_config("config/schemas/axis_poa.yaml")
        pt = schema.sheets["Payment Tracker"]
        ifsc = [c for c in pt.columns if c.canonical_name == "IFSC Code"]
        assert len(ifsc) == 1
        assert "0" in ifsc[0].validation_exceptions
        assert "N.A" in ifsc[0].validation_exceptions

    def test_sum_columns_in_schema(self):
        schema = load_schema_config("config/schemas/axis_poa.yaml")
        pt = schema.sheets["Payment Tracker"]
        assert "Total pay (Base)" in pt.sum_columns
        assert "Total pay" in pt.sum_columns

    def test_hidden_columns_in_schema(self):
        schema = load_schema_config("config/schemas/axis_poa.yaml")
        md = schema.sheets["Master Data"]
        assert 10 in md.hidden_columns
        assert 15 in md.hidden_columns


class TestSchemaDrivenValidation:
    """Test that schema-driven validation works correctly."""

    def test_mandatory_field_check(self):
        sheet_def = SheetDefinition(
            columns=[
                ColumnDefinition(canonical_name="S.no", synonyms=[], datatype="integer", mandatory=True),
                ColumnDefinition(canonical_name="Name", synonyms=[], datatype="string", mandatory=True),
            ]
        )
        valid_records = [{"S.no": 1, "Name": "Test"}]
        clean, warns = validate_sheet(valid_records, sheet_def)
        assert len(clean) == 1
        assert len(warns) == 0

    def test_mandatory_field_missing(self):
        sheet_def = SheetDefinition(
            columns=[
                ColumnDefinition(canonical_name="S.no", synonyms=[], datatype="integer", mandatory=True),
                ColumnDefinition(canonical_name="Name", synonyms=[], datatype="string", mandatory=True),
            ]
        )
        from src.models.exceptions import ValidationException
        with pytest.raises(ValidationException):
            validate_sheet([{"S.no": 1}], sheet_def)

    def test_regex_validation(self):
        sheet_def = SheetDefinition(
            columns=[
                ColumnDefinition(
                    canonical_name="Code", synonyms=[], datatype="string",
                    mandatory=True, validation_regex=r"^AS[0-9]{4}$"
                ),
            ]
        )
        clean, warns = validate_sheet([{"Code": "AS0001"}], sheet_def)
        assert len(warns) == 0

        clean, warns = validate_sheet([{"Code": "INVALID"}], sheet_def)
        assert len(warns) == 1
        assert "Code" in warns[0]["message"]

    def test_regex_exceptions(self):
        sheet_def = SheetDefinition(
            columns=[
                ColumnDefinition(
                    canonical_name="IFSC", synonyms=[], datatype="string",
                    validation_regex=r"^[A-Z]{4}0[A-Z0-9]{6}$",
                    validation_exceptions=["0", "N.A"]
                ),
            ]
        )
        clean, warns = validate_sheet([{"IFSC": "0"}, {"IFSC": "N.A"}, {"IFSC": "SBIN0001234"}], sheet_def)
        assert len(warns) == 0

    def test_duplicate_detection(self):
        sheet_def = SheetDefinition(
            columns=[
                ColumnDefinition(canonical_name="ID", synonyms=[], datatype="integer", mandatory=True),
            ]
        )
        records = [{"ID": 1}, {"ID": 2}, {"ID": 1}]
        clean, warns = validate_sheet(records, sheet_def, duplicate_keys=["ID"])
        dupes = [w for w in warns if w["field"] == "DUPLICATE"]
        assert len(dupes) == 1

    def test_default_values_preserved(self):
        sheet_def = SheetDefinition(
            columns=[
                ColumnDefinition(canonical_name="Name", synonyms=[], datatype="string", mandatory=True),
                ColumnDefinition(canonical_name="Optional", synonyms=[], datatype="string", default_value="N/A"),
            ]
        )
        records = [{"Name": "Test"}]
        clean, warns = validate_sheet(records, sheet_def)
        assert len(clean) == 1
