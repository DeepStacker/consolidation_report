"""
Synonym Resolution Engine for Sprint 2 Mapping Engine.
Provides tiered matching logic with strict confidence scoring to prevent silent column misalignment.
"""

import re
import difflib
from typing import List, Dict, Optional
from pydantic import BaseModel, Field
from src.models.domain_models import ColumnDefinition

class ResolutionMatch(BaseModel):
    """
    Data model representing a column mapping decision.
    """
    raw_header: str = Field(description="Raw column header from source Excel.")
    canonical_name: Optional[str] = Field(default=None, description="Matched canonical target column name.")
    confidence: float = Field(default=0.0, description="Confidence score from 0.0 to 1.0.")
    strategy: str = Field(default="unresolved", description="Strategy used: 'exact_canonical' | 'exact_synonym' | 'normalized_match' | 'fuzzy_match' | 'unresolved'.")
    explanation: str = Field(description="Explanation trace behind the matching decision.")

def normalize_string(s: str) -> str:
    """
    Strips punctuation, dashes, underscores, slashes, dots, and spaces, converting to lowercase.
    """
    return re.sub(r"[^a-zA-Z0-9]", "", s).lower().strip()

class SynonymResolutionEngine:
    """
    Tiered synonym matching engine ensuring explainable and safe column resolution.
    """
    def __init__(self, columns: List[ColumnDefinition], fuzzy_threshold: float = 0.85):
        self.columns = columns
        self.fuzzy_threshold = fuzzy_threshold
        
        # Pre-compile registries
        self.canonicals: List[str] = [col.canonical_name for col in columns]
        self.canonical_lower_map: Dict[str, str] = {c.lower().strip(): c for c in self.canonicals}
        
        self.synonym_map: Dict[str, str] = {}
        for col in columns:
            for syn in col.synonyms:
                self.synonym_map[syn.lower().strip()] = col.canonical_name
                
        # Compilation of normalized registry
        self.normalized_canonical_map: Dict[str, str] = {
            normalize_string(c): c for c in self.canonicals
        }
        self.normalized_synonym_map: Dict[str, str] = {
            normalize_string(syn): canonical for syn, canonical in self.synonym_map.items()
        }

    def resolve(self, raw_header: str) -> ResolutionMatch:
        """
        Resolves a single raw header column into a canonical candidate using tiered rules.
        """
        clean_header = raw_header.strip()
        header_lower = clean_header.lower()
        
        # Tier 1: Exact Case-Insensitive Canonical Match
        if header_lower in self.canonical_lower_map:
            canonical = self.canonical_lower_map[header_lower]
            return ResolutionMatch(
                raw_header=raw_header,
                canonical_name=canonical,
                confidence=1.0,
                strategy="exact_canonical",
                explanation=f"Exact case-insensitive match with canonical field '{canonical}'."
            )
            
        # Tier 2: Exact Case-Insensitive Synonym Match
        if header_lower in self.synonym_map:
            canonical = self.synonym_map[header_lower]
            return ResolutionMatch(
                raw_header=raw_header,
                canonical_name=canonical,
                confidence=1.0,
                strategy="exact_synonym",
                explanation=f"Exact case-insensitive match with configured synonym in schema, resolving to canonical '{canonical}'."
            )
            
        # Tier 3: Normalized Match (Stripping non-alphanumerics)
        norm_header = normalize_string(clean_header)
        if norm_header:
            # Check normalized canonicals first
            if norm_header in self.normalized_canonical_map:
                canonical = self.normalized_canonical_map[norm_header]
                return ResolutionMatch(
                    raw_header=raw_header,
                    canonical_name=canonical,
                    confidence=0.90,
                    strategy="normalized_match",
                    explanation=f"Normalized character-only match (stripped punctuation/spaces) resolving to canonical '{canonical}'."
                )
            # Check normalized synonyms
            if norm_header in self.normalized_synonym_map:
                canonical = self.normalized_synonym_map[norm_header]
                return ResolutionMatch(
                    raw_header=raw_header,
                    canonical_name=canonical,
                    confidence=0.90,
                    strategy="normalized_match",
                    explanation=f"Normalized character-only synonym match (stripped punctuation/spaces) resolving to canonical '{canonical}'."
                )
                
        # Tier 4: Fuzzy String Similarity (Last Resort)
        best_match = None
        highest_ratio = 0.0
        
        # Test against all registered synonyms and canonical names to find the closest candidate
        candidates = list(self.canonicals) + list(self.synonym_map.keys())
        for cand in candidates:
            # SequenceMatcher ratio check
            ratio = difflib.SequenceMatcher(None, header_lower, cand.lower().strip()).ratio()
            if ratio > highest_ratio:
                highest_ratio = ratio
                best_match = cand
                
        if highest_ratio >= self.fuzzy_threshold and best_match is not None:
            # Retrieve canonical name for candidate
            canonical = self.synonym_map.get(best_match.lower().strip(), best_match)
            # Make sure it maps to target canonical case
            canonical = self.canonical_lower_map.get(canonical.lower().strip(), canonical)
            return ResolutionMatch(
                raw_header=raw_header,
                canonical_name=canonical,
                confidence=round(highest_ratio, 2),
                strategy="fuzzy_match",
                explanation=f"Soft fuzzy string similarity match ({round(highest_ratio * 100)}% ratio) with configured name/synonym '{best_match}', resolving to '{canonical}'."
            )
            
        # Tier 5: Unresolved
        return ResolutionMatch(
            raw_header=raw_header,
            canonical_name=None,
            confidence=0.0,
            strategy="unresolved",
            explanation=f"No matching synonyms or canonical keys could be resolved above the similarity threshold ({self.fuzzy_threshold * 100}%)."
        )
