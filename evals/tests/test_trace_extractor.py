#!/usr/bin/env python3
"""
Test suite for TraceExtractor functionality.
"""

import os
import sys
from pathlib import Path
import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from langfuse import Langfuse
from trace_analysis.extractor import TraceExtractor


class TestTraceExtractor:
    """Test suite for TraceExtractor class."""
    
    @classmethod
    def setup_class(cls):
        """Set up test environment."""
        # Load configuration from parent directory
        # Load from project root .env file
        from pathlib import Path
        project_root = Path(__file__).parent.parent.parent
        load_dotenv(project_root / '.env')
        
        cls.config = {
            'public_key': os.getenv('LANGFUSE_PUBLIC_KEY'),
            'secret_key': os.getenv('LANGFUSE_SECRET_KEY'),
            'host': os.getenv('LANGFUSE_HOST', 'http://localhost:3000')
        }
        
        # Initialize Langfuse client
        cls.langfuse = Langfuse(
            public_key=cls.config['public_key'],
            secret_key=cls.config['secret_key'],
            host=cls.config['host']
        )
        
        # Initialize TraceExtractor
        cls.extractor = TraceExtractor(cls.langfuse)
        
        # Test trace IDs (from our previous successful tests)
        cls.test_traces = {
            'github_agent': 'a611481ab405d927a23626f3ffbd2bbc',
            'confluence_agent': '2b622b7dffffbc7aab85d2e8a2560092', 
            'argocd_agent': 'ad266835b287238e52cb077f9a87fc05'
        }
    
    @pytest.mark.skip(reason="Cannot run remotely - needs Langfuse dependency configuration")
    def test_extract_tool_calls_github(self):
        """Test tool call extraction for GitHub agent."""
        trace_id = self.test_traces['github_agent']
        
        print(f"\n🧪 Testing GitHub agent trace: {trace_id}")
        
        tool_calls = self.extractor.extract_tool_calls(trace_id)
        
        # Verify results
        assert len(tool_calls) == 2, f"Expected 2 tool calls, got {len(tool_calls)}"
        
        # Check for expected tool calls
        agents = [tc['agent'] for tc in tool_calls]
        tools = [tc['tool'] for tc in tool_calls]
        
        assert 'platform_engineer_supervisor' in agents, "Missing platform_engineer_supervisor"
        assert 'github' in agents, "Missing github agent"
        assert 'github_tools_agent' in tools, "Missing github_tools_agent tool"
        assert 'search_repositories' in tools, "Missing search_repositories tool"
        
        print("✅ GitHub agent test passed")
        return tool_calls
    
    @pytest.mark.skip(reason="Cannot run remotely - needs Langfuse dependency configuration")
    def test_extract_tool_calls_confluence(self):
        """Test tool call extraction for Confluence agent."""
        trace_id = self.test_traces['confluence_agent']
        
        print(f"\n🧪 Testing Confluence agent trace: {trace_id}")
        
        tool_calls = self.extractor.extract_tool_calls(trace_id)
        
        # Verify results
        assert len(tool_calls) == 2, f"Expected 2 tool calls, got {len(tool_calls)}"
        
        # Check for expected tool calls
        agents = [tc['agent'] for tc in tool_calls]
        tools = [tc['tool'] for tc in tool_calls]
        
        assert 'platform_engineer_supervisor' in agents, "Missing platform_engineer_supervisor"
        assert 'confluence' in agents, "Missing confluence agent"
        assert 'confluence_tools_agent' in tools, "Missing confluence_tools_agent tool"
        assert 'get_spaces' in tools, "Missing get_spaces tool"
        
        print("✅ Confluence agent test passed")
        return tool_calls
    
    @pytest.mark.skip(reason="Cannot run remotely - needs Langfuse dependency configuration")
    def test_extract_tool_calls_argocd(self):
        """Test tool call extraction for ArgoCD agent."""
        trace_id = self.test_traces['argocd_agent']
        
        print(f"\n🧪 Testing ArgoCD agent trace: {trace_id}")
        
        tool_calls = self.extractor.extract_tool_calls(trace_id)
        
        # Verify results
        assert len(tool_calls) == 2, f"Expected 2 tool calls, got {len(tool_calls)}"
        
        # Check for expected tool calls
        agents = [tc['agent'] for tc in tool_calls]
        tools = [tc['tool'] for tc in tool_calls]
        
        assert 'platform_engineer_supervisor' in agents, "Missing platform_engineer_supervisor"
        assert 'argocd' in agents, "Missing argocd agent"
        assert 'argocd_tools_agent' in tools, "Missing argocd_tools_agent tool"
        assert 'version_service__version' in tools, "Missing version_service__version tool"
        
        print("✅ ArgoCD agent test passed")
        return tool_calls
    
    @pytest.mark.skip(reason="Cannot run remotely - needs Langfuse dependency configuration")
    def test_get_trace_basic(self):
        """Test basic trace fetching functionality."""
        trace_id = self.test_traces['github_agent']
        
        print(f"\n🧪 Testing basic trace fetch: {trace_id}")
        
        trace = self.extractor.get_trace(trace_id)
        
        # Verify trace was fetched
        assert trace is not None, "Trace should not be None"
        
        # Check basic trace attributes
        if hasattr(trace, 'dict'):
            trace_dict = trace.dict()
        elif hasattr(trace, 'model_dump'):
            trace_dict = trace.model_dump()
        else:
            trace_dict = trace.__dict__
        
        assert 'id' in trace_dict, "Trace should have ID"
        assert trace_dict['id'] == trace_id, f"Trace ID mismatch: {trace_dict['id']} != {trace_id}"
        assert 'observations' in trace_dict, "Trace should have observations"
        
        print("✅ Basic trace fetch test passed")
        return trace
    
    @pytest.mark.skip(reason="Cannot run remotely - needs Langfuse dependency configuration")
    def test_hierarchy_agent_detection(self):
        """Test the hierarchy-based agent detection method."""
        print("\n🧪 Testing hierarchy-based agent detection")
        
        # Test with GitHub trace
        trace_id = self.test_traces['github_agent']
        trace = self.langfuse.api.trace.get(trace_id)
        
        if hasattr(trace, 'dict'):
            trace_dict = trace.dict()
        elif hasattr(trace, 'model_dump'):
            trace_dict = trace.model_dump()
        else:
            trace_dict = trace.__dict__
        
        observations = trace_dict.get('observations', [])
        obs_by_id = {}
        for obs in observations:
            obs_by_id[obs.get('id', '')] = obs
        
        # Test the hierarchy traversal method
        # Find an observation with tool calls and test agent detection
        for obs in observations:
            if obs.get('input') and isinstance(obs['input'], dict):
                messages = obs['input'].get('messages', [])
                for msg in messages:
                    if isinstance(msg, dict) and 'tool_calls' in msg and msg['tool_calls']:
                        # Test the private method
                        agent_name = self.extractor._extract_agent_from_hierarchy(
                            obs.get('id', ''), 
                            obs_by_id
                        )
                        
                        assert agent_name != 'unknown_agent', f"Should detect agent, got: {agent_name}"
                        print(f"✅ Detected agent: {agent_name}")
                        break
        
        print("✅ Hierarchy detection test passed")
    
    def run_all_tests(self):
        """Run all tests."""
        print("🧪 RUNNING TRACE EXTRACTOR TEST SUITE")
        print("="*60)
        
        try:
            # Test basic functionality
            self.test_get_trace_basic()
            
            # Test tool call extraction for different agents
            self.test_extract_tool_calls_github()
            self.test_extract_tool_calls_confluence() 
            self.test_extract_tool_calls_argocd()
            
            # Test hierarchy detection
            self.test_hierarchy_agent_detection()
            
            print("\n🎉 ALL TESTS PASSED!")
            print("="*60)
            
        except Exception as e:
            print(f"\n❌ TEST FAILED: {e}")
            raise


def main():
    """Run the test suite."""
    if not os.getenv('LANGFUSE_PUBLIC_KEY'):
        print("❌ Error: LANGFUSE_PUBLIC_KEY not set in environment")
        print("Please ensure .env file is configured with Langfuse credentials")
        return 1
    
    # Create test instance and run tests
    test_suite = TestTraceExtractor()
    test_suite.setup_class()
    test_suite.run_all_tests()
    
    return 0


if __name__ == "__main__":
    exit(main())