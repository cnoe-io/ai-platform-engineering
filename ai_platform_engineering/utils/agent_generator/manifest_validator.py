# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Agent Manifest Validator

Validates agent manifests for correctness and completeness.
"""

from typing import List, Tuple
from .models import AgentManifest, DependencySource
import re


class ValidationError:
    """Represents a validation error"""
    
    def __init__(self, field: str, message: str, severity: str = "error"):
        self.field = field
        self.message = message
        self.severity = severity  # "error" or "warning"
    
    def __str__(self) -> str:
        return f"[{self.severity.upper()}] {self.field}: {self.message}"
    
    def __repr__(self) -> str:
        return f"ValidationError(field='{self.field}', message='{self.message}', severity='{self.severity}')"


class AgentManifestValidator:
    """Validator for agent manifests"""
    
    @staticmethod
    def validate(manifest: AgentManifest) -> Tuple[bool, List[ValidationError]]:
        """
        Validate an agent manifest
        
        Args:
            manifest: The manifest to validate
            
        Returns:
            Tuple of (is_valid, errors) where is_valid is True if no errors exist,
            and errors is a list of ValidationError objects
        """
        errors: List[ValidationError] = []
        
        # Validate metadata
        errors.extend(AgentManifestValidator._validate_metadata(manifest))
        
        # Validate skills
        errors.extend(AgentManifestValidator._validate_skills(manifest))
        
        # Validate dependencies
        errors.extend(AgentManifestValidator._validate_dependencies(manifest))
        
        # Validate environment variables
        errors.extend(AgentManifestValidator._validate_environment(manifest))
        
        # Validate protocol/transport compatibility
        errors.extend(AgentManifestValidator._validate_protocols(manifest))
        
        # Determine if valid (no errors, warnings are ok)
        has_errors = any(e.severity == "error" for e in errors)
        is_valid = not has_errors
        
        return is_valid, errors
    
    @staticmethod
    def _validate_metadata(manifest: AgentManifest) -> List[ValidationError]:
        """Validate metadata section"""
        errors = []
        metadata = manifest.metadata
        
        # Check name format
        if not re.match(r'^[a-z][a-z0-9_-]*$', metadata.name):
            errors.append(ValidationError(
                "metadata.name",
                "Name must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores"
            ))
        
        # Check version format (semver)
        if not re.match(r'^\d+\.\d+\.\d+', metadata.version):
            errors.append(ValidationError(
                "metadata.version",
                "Version should follow semantic versioning (e.g., 1.0.0)",
                severity="warning"
            ))
        
        # Check description length
        if len(metadata.description) < 20:
            errors.append(ValidationError(
                "metadata.description",
                "Description should be at least 20 characters for clarity",
                severity="warning"
            ))
        
        # Check author info
        if not metadata.author:
            errors.append(ValidationError(
                "metadata.author",
                "Author information is recommended",
                severity="warning"
            ))
        
        return errors
    
    @staticmethod
    def _validate_skills(manifest: AgentManifest) -> List[ValidationError]:
        """Validate skills section"""
        errors = []
        
        if not manifest.skills:
            errors.append(ValidationError(
                "skills",
                "At least one skill must be defined"
            ))
            return errors
        
        # Check for duplicate skill IDs
        skill_ids = [skill.id for skill in manifest.skills]
        if len(skill_ids) != len(set(skill_ids)):
            errors.append(ValidationError(
                "skills",
                "Duplicate skill IDs found"
            ))
        
        # Validate individual skills
        for i, skill in enumerate(manifest.skills):
            prefix = f"skills[{i}]"
            
            # Check skill ID format
            if not re.match(r'^[a-z][a-z0-9_]*$', skill.id):
                errors.append(ValidationError(
                    f"{prefix}.id",
                    "Skill ID must start with lowercase letter and contain only lowercase letters, numbers, and underscores"
                ))
            
            # Check examples
            if not skill.examples:
                errors.append(ValidationError(
                    f"{prefix}.examples",
                    "At least one example is recommended for each skill",
                    severity="warning"
                ))
            elif len(skill.examples) < 3:
                errors.append(ValidationError(
                    f"{prefix}.examples",
                    "At least 3 examples are recommended for better usability",
                    severity="warning"
                ))
        
        return errors
    
    @staticmethod
    def _validate_dependencies(manifest: AgentManifest) -> List[ValidationError]:
        """Validate dependencies section"""
        errors = []
        
        for i, dep in enumerate(manifest.dependencies):
            prefix = f"dependencies[{i}]"
            
            # Validate based on source type
            if dep.source == DependencySource.OPENAPI:
                if not dep.url:
                    errors.append(ValidationError(
                        f"{prefix}.url",
                        "OpenAPI dependencies must specify a URL"
                    ))
                elif not dep.url.startswith(('http://', 'https://', 'file://')):
                    errors.append(ValidationError(
                        f"{prefix}.url",
                        "OpenAPI URL must be a valid HTTP(S) or file URL"
                    ))
            
            elif dep.source == DependencySource.PYPI:
                if not dep.name:
                    errors.append(ValidationError(
                        f"{prefix}.name",
                        "PyPI dependencies must specify a package name"
                    ))
            
            # Check for API key requirements
            if dep.api_key_env_var:
                # Suggest adding to environment variables
                env_var_names = [env.name for env in manifest.environment]
                if dep.api_key_env_var not in env_var_names:
                    errors.append(ValidationError(
                        f"{prefix}.api_key_env_var",
                        f"API key environment variable '{dep.api_key_env_var}' should be defined in environment section",
                        severity="warning"
                    ))
        
        return errors
    
    @staticmethod
    def _validate_environment(manifest: AgentManifest) -> List[ValidationError]:
        """Validate environment variables section"""
        errors = []
        
        # Check for duplicate environment variable names
        env_names = [env.name for env in manifest.environment]
        if len(env_names) != len(set(env_names)):
            errors.append(ValidationError(
                "environment",
                "Duplicate environment variable names found"
            ))
        
        # Validate individual environment variables
        for i, env in enumerate(manifest.environment):
            prefix = f"environment[{i}]"
            
            # Check name format (uppercase with underscores)
            if not re.match(r'^[A-Z][A-Z0-9_]*$', env.name):
                errors.append(ValidationError(
                    f"{prefix}.name",
                    "Environment variable names should be UPPERCASE_WITH_UNDERSCORES",
                    severity="warning"
                ))
            
            # Check for required variables without defaults
            if env.required and not env.default:
                # This is actually good practice, just informational
                pass
        
        return errors
    
    @staticmethod
    def _validate_protocols(manifest: AgentManifest) -> List[ValidationError]:
        """Validate protocol and transport compatibility"""
        errors = []
        
        if not manifest.protocols:
            errors.append(ValidationError(
                "protocols",
                "At least one protocol must be specified"
            ))
        
        if not manifest.transports:
            errors.append(ValidationError(
                "transports",
                "At least one transport mode must be specified"
            ))
        
        return errors

