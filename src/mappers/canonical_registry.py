"""
Canonical Field Registry for Sprint 2 Mapping Engine.
Acts as the single source of truth for target schema fields, datatypes, and constraints.
"""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from src.models.domain_models import SchemaDefinition, ColumnDefinition
from src.models.exceptions import MappingException
from src.schema_loader import load_schema_config

class CanonicalField(BaseModel):
    """
    Registry representation of a target canonical field.
    """
    name: str = Field(description="Canonical target field name.")
    datatype: str = Field(description="Expected data type (integer, decimal, string, date, time).")
    mandatory: bool = Field(default=False, description="Flag indicating if the field is mandatory.")
    default_value: Any = Field(default=None, description="Fallback default value if column is missing.")
    validation_regex: Optional[str] = Field(default=None, description="Optional regex constraint.")
    copy_from_column: Optional[str] = Field(default=None, description="Source column to copy values from.")

class CanonicalRegistry:
    """
    Dynamic registry holding canonical target columns and formats grouped by sheet scope.
    """
    def __init__(self):
        # Maps scope_name -> field_name -> CanonicalField
        self._registry: Dict[str, Dict[str, CanonicalField]] = {}

    def register_field(self, scope: str, field: CanonicalField):
        """
        Registers a single canonical field under a specific scope/sheet.
        """
        if scope not in self._registry:
            self._registry[scope] = {}
            
        clean_name = field.name.strip()
        if clean_name in self._registry[scope]:
            raise MappingException(f"Duplicate registration of canonical field '{clean_name}' in scope '{scope}'.")
            
        self._registry[scope][clean_name] = field

    def load_from_schema(self, schema: SchemaDefinition):
        """
        Loads and registers all column definitions from a validated SchemaDefinition.
        """
        for sheet_name, sheet_def in schema.sheets.items():
            for col in sheet_def.columns:
                c_field = CanonicalField(
                    name=col.canonical_name,
                    datatype=col.datatype,
                    mandatory=col.mandatory,
                    default_value=col.default_value,
                    validation_regex=col.validation_regex,
                    copy_from_column=col.copy_from_column
                )
                self.register_field(sheet_name, c_field)

    def load_from_yaml(self, filepath: str):
        """
        Helper to load and register configurations directly from a schema file path.
        """
        schema = load_schema_config(filepath)
        self.load_from_schema(schema)

    def get_field(self, scope: str, name: str) -> Optional[CanonicalField]:
        """
        Retrieves a registered CanonicalField by name under a given scope.
        """
        if scope in self._registry:
            return self._registry[scope].get(name)
        return None

    def is_mandatory(self, scope: str, name: str) -> bool:
        """
        Checks if a field is registered as mandatory in a scope.
        """
        field = self.get_field(scope, name)
        return field.mandatory if field else False

    def get_all_fields(self, scope: str) -> List[str]:
        """
        Returns a list of all canonical field names registered for a scope.
        """
        if scope in self._registry:
            return list(self._registry[scope].keys())
        return []

    def get_all_mandatory_fields(self, scope: str) -> List[str]:
        """
        Returns a list of all mandatory canonical field names for a scope.
        """
        if scope in self._registry:
            return [name for name, field in self._registry[scope].items() if field.mandatory]
        return []
