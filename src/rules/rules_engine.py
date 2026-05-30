from typing import List, Dict, Any, Callable
from src.models.domain_models import RuleDefinition
from src.models.exceptions import ValidationException

class RulesEngine:
    def __init__(self):
        self._rules: List[Dict[str, Any]] = []

    def register_rule(self, rule_def: RuleDefinition, rule_callable: Callable[[Dict[str, Any]], Dict[str, Any]]):
        """Registers a transformation rule with its priority metadata."""
        self._rules.append({
            "definition": rule_def,
            "callable": rule_callable,
            "priority": rule_def.priority
        })
        # Keep rules sorted by priority (lowest priority value executes first)
        self._rules.sort(key=lambda x: x["priority"])

    def execute_rules_on_records(self, records: List[Dict[str, Any]], client_id: str, scope: str) -> List[Dict[str, Any]]:
        """Executes all registered rules matching client_id and scope on the records list."""
        transformed_records = []
        
        for idx, row in enumerate(records, 2):
            modified_row = row.copy()
            
            for rule in self._rules:
                rule_def = rule["definition"]
                
                # Check scope matches
                if rule_def.client_id == client_id and rule_def.scope == scope:
                    try:
                        modified_row = rule["callable"](modified_row)
                    except Exception as e:
                        raise ValidationException(f"Failed executing rule '{rule_def.rule_id}' on Row {idx}: {e}")
                        
            transformed_records.append(modified_row)
            
        return transformed_records
