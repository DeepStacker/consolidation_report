class ConsolidationException(Exception):
    """Base exception class for all errors in the Excel Consolidation Platform."""
    pass

class ConsolidationPlatformException(ConsolidationException):
    """Alias for backwards compatibility with legacy modules."""
    pass

class SchemaConfigException(ConsolidationException):
    """Raised when loading or validating structural configuration schemas fails."""
    pass

class ValidationException(ConsolidationException):
    """Raised when data validations (required fields, datatypes, regex) fail."""
    pass

class MappingException(ConsolidationException):
    """Raised when columns synonym resolving or canonical alignments fail."""
    pass

class IngestionException(ConsolidationException):
    """Raised when opening, reading, or parsing raw workbooks fails."""
    pass

class MissingSheetException(IngestionException):
    """Raised when a configured sheet cannot be found in the Excel file."""
    pass

class MissingColumnException(MappingException):
    """Raised when a mandatory column cannot be found after synonym matching."""
    pass

class ReconciliationException(ConsolidationException):
    """Raised when final mathematical count or payment sums checks fail."""
    pass

class SchemaDriftException(ConsolidationException):
    """Raised when the schema drifts or structural changes are detected."""
    pass
