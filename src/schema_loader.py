"""
Configuration parser and loader for YAML schemas.
Verifies structure and parses safe dictionaries into Pydantic SchemaDefinition domain models.
"""

import os
import yaml
from typing import Dict, Any
from src.models.domain_models import SchemaDefinition
from src.models.exceptions import SchemaConfigException

def load_yaml_raw(filepath: str) -> Dict[str, Any]:
    """
    Reads raw YAML content from the filesystem.
    
    Args:
        filepath: Absolute filesystem path to the YAML configuration file.
        
    Returns:
        A dictionary representation of the loaded configuration structure.
        
    Raises:
        SchemaConfigException: If the file is missing or contains invalid YAML syntax.
    """
    if not os.path.exists(filepath):
        raise SchemaConfigException(f"YAML schema configuration file not found at: {filepath}")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            content = yaml.safe_load(f)
            if not isinstance(content, dict):
                raise SchemaConfigException(f"Schema configuration must be a dictionary map in: {filepath}")
            return content
        except yaml.YAMLError as e:
            raise SchemaConfigException(f"Invalid YAML syntax in schema file {filepath}: {e}")

def parse_schema(raw_dict: Dict[str, Any]) -> SchemaDefinition:
    """
    Parses and casts a raw configuration dictionary into a validated Pydantic SchemaDefinition.
    
    Args:
        raw_dict: Dictionary containing raw schema properties.
        
    Returns:
        A fully validated and typed SchemaDefinition object.
        
    Raises:
        SchemaConfigException: If the dictionary violates the strict schema structure rules.
    """
    try:
        return SchemaDefinition.model_validate(raw_dict)
    except Exception as e:
        raise SchemaConfigException(f"Schema structural schema validation failed: {e}")

def load_schema_config(filepath: str) -> SchemaDefinition:
    """
    Orchestrates the loading, parsing, and type validation of a YAML configuration file.
    
    Args:
        filepath: Filesystem path to the target YAML file.
        
    Returns:
        A validated SchemaDefinition object.
    """
    raw_content = load_yaml_raw(filepath)
    return parse_schema(raw_content)
