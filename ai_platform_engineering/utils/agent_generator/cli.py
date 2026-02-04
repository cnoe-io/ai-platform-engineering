# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
CLI for Agent Generator

Command-line interface for generating agents from manifests.
"""

import sys
import argparse
from pathlib import Path
from typing import Optional
from .manifest_parser import AgentManifestParser
from .manifest_validator import AgentManifestValidator
from .agent_generator import AgentGenerator


def validate_manifest_cmd(args):
    """Validate a manifest file"""
    try:
        print(f"Validating manifest: {args.manifest}")
        manifest = AgentManifestParser.parse_file(args.manifest)
        
        is_valid, errors = AgentManifestValidator.validate(manifest)
        
        if errors:
            print("\n⚠️  Validation Issues:")
            for error in errors:
                print(f"  {error}")
        
        if is_valid:
            print("\n✅ Manifest is valid!")
            print(f"   Agent: {manifest.metadata.display_name} (v{manifest.metadata.version})")
            print(f"   Protocols: {', '.join([p.value for p in manifest.protocols])}")
            print(f"   Skills: {len(manifest.skills)}")
            return 0
        else:
            print("\n❌ Manifest has errors and cannot be used for generation.")
            return 1
            
    except FileNotFoundError as e:
        print(f"❌ Error: {e}")
        return 1
    except Exception as e:
        print(f"❌ Error parsing manifest: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1


def generate_agent_cmd(args):
    """Generate an agent from manifest"""
    try:
        print(f"Parsing manifest: {args.manifest}")
        manifest = AgentManifestParser.parse_file(args.manifest)
        
        # Validate first
        if not args.skip_validation:
            print("Validating manifest...")
            is_valid, errors = AgentManifestValidator.validate(manifest)
            
            if errors:
                print("\n⚠️  Validation Issues:")
                for error in errors:
                    print(f"  {error}")
            
            if not is_valid and not args.force:
                print("\n❌ Manifest has errors. Use --force to generate anyway, or fix the errors.")
                return 1
        
        # Generate agent
        print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Generating agent: {manifest.metadata.display_name}")
        
        generator = AgentGenerator()
        results = generator.generate(
            manifest=manifest,
            output_dir=Path(args.output_dir),
            overwrite=args.overwrite,
            dry_run=args.dry_run
        )
        
        # Display results
        print(f"\n✅ Agent generation {'simulation ' if args.dry_run else ''}complete!")
        print(f"   Agent: {results['agent_name']}")
        print(f"   Location: {results['agent_dir']}")
        print(f"   Files created: {len(results['files_created'])}")
        
        if args.verbose:
            print("\n📁 Generated files:")
            for file_path in results['files_created']:
                print(f"   - {file_path}")
        
        if not args.dry_run:
            print(f"\n🎉 Next steps:")
            print(f"   1. cd {results['agent_dir']}")
            print(f"   2. cp .env.example .env")
            print(f"   3. Edit .env with your configuration")
            print(f"   4. make uv-sync")
            print(f"   5. make run-a2a")
        
        return 0
        
    except FileExistsError as e:
        print(f"❌ Error: {e}")
        print("   Use --overwrite to replace existing agent.")
        return 1
    except Exception as e:
        print(f"❌ Error generating agent: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1


def list_examples_cmd(args):
    """List example manifests"""
    examples_dir = Path(__file__).parent.parent.parent.parent / "examples" / "agent_manifests"
    
    if not examples_dir.exists():
        print("No example manifests found.")
        return 0
    
    print("📋 Example Agent Manifests:\n")
    
    for manifest_file in sorted(examples_dir.glob("*.yaml")):
        try:
            manifest = AgentManifestParser.parse_file(manifest_file)
            print(f"  • {manifest_file.name}")
            print(f"    {manifest.metadata.display_name} - {manifest.metadata.description[:60]}...")
            print(f"    Protocols: {', '.join([p.value for p in manifest.protocols])}")
            print()
        except Exception as e:
            print(f"  • {manifest_file.name} (error: {e})")
            print()
    
    return 0


def create_example_manifest_cmd(args):
    """Create an example manifest"""
    from .models import (
        AgentManifest,
        AgentMetadata,
        AgentSkillSpec,
        AgentProtocol,
        DependencySpec,
        DependencySource,
        EnvironmentVariable
    )
    import yaml
    
    # Create example manifest
    manifest = AgentManifest(
        manifest_version="1.0",
        metadata=AgentMetadata(
            name=args.name,
            display_name=args.name.replace('_', ' ').title(),
            version="0.1.0",
            description=f"An AI agent for {args.name} operations",
            author="Your Name",
            author_email="your.email@example.com",
            license="Apache-2.0",
            tags=["example", args.name]
        ),
        protocols=[AgentProtocol.A2A],
        skills=[
            AgentSkillSpec(
                id=f"{args.name}_skill",
                name=f"{args.name.title()} Operations",
                description=f"Perform {args.name} related tasks",
                tags=[args.name, "operations"],
                examples=[
                    "What can you do?",
                    f"Help me with {args.name}",
                    f"Show {args.name} status"
                ]
            )
        ],
        dependencies=[],
        environment=[
            EnvironmentVariable(
                name=f"{args.name.upper()}_API_KEY",
                description=f"API key for {args.name} service",
                required=True
            )
        ]
    )
    
    # Write to file
    output_file = Path(args.output)
    manifest_dict = manifest.to_dict()
    
    # Convert enums to strings for clean YAML output
    def convert_enums(obj):
        if isinstance(obj, dict):
            return {k: convert_enums(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_enums(item) for item in obj]
        elif hasattr(obj, 'value'):  # Enum
            return obj.value
        return obj
    
    clean_dict = convert_enums(manifest_dict)
    
    with open(output_file, 'w') as f:
        yaml.dump(clean_dict, f, default_flow_style=False, sort_keys=False)
    
    print(f"✅ Created example manifest: {output_file}")
    print(f"\nNext steps:")
    print(f"  1. Edit {output_file} to customize your agent")
    print(f"  2. Validate: python -m ai_platform_engineering.utils.agent_generator.cli validate {output_file}")
    print(f"  3. Generate: python -m ai_platform_engineering.utils.agent_generator.cli generate {output_file}")
    
    return 0


def main():
    """Main CLI entry point"""
    parser = argparse.ArgumentParser(
        description="CNOE Agent Generator - Generate agents from manifests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Validate a manifest
  %(prog)s validate my-agent.yaml
  
  # Generate an agent
  %(prog)s generate my-agent.yaml -o ./agents
  
  # Generate with dry-run to see what would be created
  %(prog)s generate my-agent.yaml --dry-run
  
  # Create an example manifest
  %(prog)s create-example myagent -o myagent.yaml
  
  # List example manifests
  %(prog)s list-examples
"""
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Verbose output'
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Command to run')
    
    # Validate command
    validate_parser = subparsers.add_parser(
        'validate',
        help='Validate an agent manifest'
    )
    validate_parser.add_argument(
        'manifest',
        type=str,
        help='Path to agent manifest file (YAML or JSON)'
    )
    validate_parser.set_defaults(func=validate_manifest_cmd)
    
    # Generate command
    generate_parser = subparsers.add_parser(
        'generate',
        help='Generate agent from manifest'
    )
    generate_parser.add_argument(
        'manifest',
        type=str,
        help='Path to agent manifest file (YAML or JSON)'
    )
    generate_parser.add_argument(
        '-o', '--output-dir',
        type=str,
        default='./agents',
        help='Output directory for generated agent (default: ./agents)'
    )
    generate_parser.add_argument(
        '--overwrite',
        action='store_true',
        help='Overwrite existing agent directory'
    )
    generate_parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be generated without creating files'
    )
    generate_parser.add_argument(
        '--skip-validation',
        action='store_true',
        help='Skip manifest validation'
    )
    generate_parser.add_argument(
        '--force',
        action='store_true',
        help='Generate even if validation fails'
    )
    generate_parser.set_defaults(func=generate_agent_cmd)
    
    # List examples command
    list_parser = subparsers.add_parser(
        'list-examples',
        help='List example manifests'
    )
    list_parser.set_defaults(func=list_examples_cmd)
    
    # Create example command
    create_parser = subparsers.add_parser(
        'create-example',
        help='Create an example manifest'
    )
    create_parser.add_argument(
        'name',
        type=str,
        help='Agent name (lowercase, no spaces)'
    )
    create_parser.add_argument(
        '-o', '--output',
        type=str,
        default='agent-manifest.yaml',
        help='Output file path (default: agent-manifest.yaml)'
    )
    create_parser.set_defaults(func=create_example_manifest_cmd)
    
    # Parse arguments
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return 1
    
    # Execute command
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

