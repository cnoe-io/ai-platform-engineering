"""
Trace extractor for fetching and analyzing Langfuse traces.
"""

import json
import logging
from typing import Any, Optional
from langfuse import Langfuse

logger = logging.getLogger(__name__)


class TraceExtractor:
    """Extracts and analyzes traces from Langfuse using trace IDs."""
    
    def __init__(self, langfuse_client: Langfuse):
        """
        Initialize the TraceExtractor with a Langfuse client.
        
        Args:
            langfuse_client: Initialized Langfuse client instance
        """
        self.langfuse = langfuse_client
        logger.info("TraceExtractor initialized with Langfuse client")
    
    def get_trace(self, trace_id: str) -> Optional[Any]:
        """
        Fetch a single trace using its trace ID and print the full trace structure.
        
        Uses the langfuse.api.trace.get() method for Langfuse 3.x, which returns
        a TraceWithFullDetails Pydantic model (not raw JSON).
        
        Args:
            trace_id: The unique identifier for the trace
            
        Returns:
            TraceWithFullDetails object if found, None if not found or on error.
            The object has methods like .dict() and .json() for conversion.
            
        Raises:
            Exception: If there's an error fetching the trace
        """
        logger.info(f"Fetching trace with ID: {trace_id}")
        
        try:
            # Use the correct API method for Langfuse 3.3.4
            trace = self.langfuse.api.trace.get(trace_id)
            
            if trace is None:
                logger.warning(f"Trace not found: {trace_id}")
                print(f"⚠️  Trace not found: {trace_id}")
                return None
            
            print(f"✓ Successfully fetched trace: {trace_id}")
            print("\n" + "="*80)
            print("FULL TRACE STRUCTURE:")
            print("="*80)
            
            try:
                # The API returns a TraceWithFullDetails Pydantic model
                # Convert to dict for pretty printing
                if hasattr(trace, 'dict'):
                    # Pydantic v1 style
                    trace_dict = trace.dict()
                elif hasattr(trace, 'model_dump'):
                    # Pydantic v2 style
                    trace_dict = trace.model_dump()
                else:
                    # Fallback for other object types
                    trace_dict = trace.__dict__ if hasattr(trace, '__dict__') else str(trace)
                
                # Pretty print the trace structure
                print(json.dumps(trace_dict, indent=2, default=str, ensure_ascii=False))
                
            except Exception as print_error:
                logger.warning(f"Could not pretty print trace structure: {print_error}")
                print(f"Raw trace object: {trace}")
                print(f"Trace type: {type(trace)}")
                print(f"Available attributes: {[attr for attr in dir(trace) if not attr.startswith('_')]}")
            
            print("="*80 + "\n")
            logger.info(f"Successfully fetched and displayed trace: {trace_id}")
            return trace
            
        except Exception as e:
            error_msg = f"Failed to fetch trace {trace_id}: {e}"
            logger.error(error_msg)
            print(f"✗ {error_msg}")
            raise
    
    def extract_tool_calls(self, trace_id: str) -> list:
        """
        Extract unique tool calls from a trace.
        
        Args:
            trace_id: The unique identifier for the trace
            
        Returns:
            List of unique tool calls with agent and tool information:
            [
                {
                    "agent": "platform_engineer_supervisor",
                    "tool": "github_tools_agent", 
                    "tool_id": "call_OVkukFAEJUxNTef...",
                    "arguments": {...}
                }
            ]
        """
        logger.info(f"Extracting tool calls from trace: {trace_id}")
        
        try:
            # Fetch the trace
            trace = self.langfuse.api.trace.get(trace_id)
            
            if not trace:
                logger.warning(f"Trace not found: {trace_id}")
                return []
            
            # Track unique tool calls by ID to avoid duplicates
            unique_tool_calls = {}
            
            # Convert trace to dict format for easier processing
            if hasattr(trace, 'dict'):
                trace_dict = trace.dict()
            elif hasattr(trace, 'model_dump'):
                trace_dict = trace.model_dump()
            else:
                trace_dict = trace.__dict__
            
            # Build observation ID to observation mapping for hierarchy traversal
            observations = trace_dict.get('observations', [])
            obs_by_id = {}
            for obs in observations:
                obs_by_id[obs.get('id', '')] = obs
            
            # Iterate through all observations to find tool calls
            for obs in observations:
                # Look for tool calls in input messages
                if 'input' in obs and obs['input']:
                    input_data = obs['input']
                    
                    if isinstance(input_data, dict) and 'messages' in input_data:
                        messages = input_data['messages']
                        
                        for msg in messages:
                            if isinstance(msg, dict) and 'tool_calls' in msg and msg['tool_calls']:
                                tool_calls = msg['tool_calls']
                                
                                for tc in tool_calls:
                                    if isinstance(tc, dict):
                                        tool_id = tc.get('id', '')
                                        if tool_id and tool_id not in unique_tool_calls:
                                            
                                            # Get tool name (handle both formats)
                                            tool_name = tc.get('name')
                                            if not tool_name and 'function' in tc:
                                                function_data = tc['function']
                                                if isinstance(function_data, dict):
                                                    tool_name = function_data.get('name', 'unknown')
                                                else:
                                                    tool_name = str(function_data)
                                            
                                            # Get arguments (handle both formats)
                                            arguments = tc.get('args', {})
                                            if not arguments and 'function' in tc:
                                                function_data = tc['function']
                                                if isinstance(function_data, dict):
                                                    arguments = function_data.get('arguments', {})
                                                    # Parse arguments if they're a JSON string
                                                    if isinstance(arguments, str):
                                                        try:
                                                            import json
                                                            arguments = json.loads(arguments)
                                                        except:
                                                            pass
                                            
                                            # Extract agent name from hierarchy
                                            agent_name = self._extract_agent_from_hierarchy(
                                                obs.get('id', ''), 
                                                obs_by_id
                                            )
                                            
                                            unique_tool_calls[tool_id] = {
                                                'agent': agent_name,
                                                'tool': tool_name or 'unknown',
                                                'tool_id': tool_id,
                                                'arguments': arguments or {}
                                            }
            
            # Convert to list and sort by tool_id for consistent ordering
            tool_calls_list = list(unique_tool_calls.values())
            tool_calls_list.sort(key=lambda x: x['tool_id'])
            
            logger.info(f"Extracted {len(tool_calls_list)} unique tool calls")
            
            # Print summary
            print(f"🔧 EXTRACTED TOOL CALLS FROM TRACE: {trace_id}")
            print("="*60)
            
            if not tool_calls_list:
                print("⚠️  No tool calls found in this trace")
            else:
                for i, tc in enumerate(tool_calls_list, 1):
                    print(f"{i}. Agent: {tc['agent']}")
                    print(f"   Tool: {tc['tool']}")
                    print(f"   ID: {tc['tool_id']}")
                    if tc['arguments']:
                        if isinstance(tc['arguments'], dict):
                            args_preview = str(tc['arguments'])[:100]
                            print(f"   Args: {args_preview}{'...' if len(str(tc['arguments'])) > 100 else ''}")
                        else:
                            print(f"   Args: {tc['arguments']}")
                    print()
            
            print(f"✅ Total unique tool calls: {len(tool_calls_list)}")
            print("="*60 + "\n")
            
            return tool_calls_list
            
        except Exception as e:
            error_msg = f"Failed to extract tool calls from trace {trace_id}: {e}"
            logger.error(error_msg)
            print(f"✗ {error_msg}")
            raise
    
    def _extract_agent_from_hierarchy(self, observation_id: str, obs_by_id: dict) -> str:
        """
        Extract agent name by traversing up the observation hierarchy.
        
        Args:
            observation_id: Starting observation ID
            obs_by_id: Dictionary mapping observation IDs to observation data
            
        Returns:
            Agent name extracted from the hierarchy
        """
        current_id = observation_id
        visited = set()  # Prevent infinite loops
        
        while current_id and current_id not in visited:
            visited.add(current_id)
            obs = obs_by_id.get(current_id, {})
            
            # Check observation name for agent indicators
            name = obs.get('name', '')
            
            # Look for emoji agent markers (🤖-{agent}-agent)
            if '🤖' in name:
                try:
                    # Extract agent name from pattern: 🤖-{agent_name}-agent
                    parts = name.split('🤖-')[1].split('-')
                    if parts:
                        agent_name = parts[0]
                        logger.debug(f"Found agent from emoji marker: {agent_name}")
                        return agent_name
                except (IndexError, AttributeError):
                    pass
            
            # Check metadata for agent information
            metadata = obs.get('metadata', {})
            
            # Check checkpoint namespace
            if 'checkpoint_ns' in metadata:
                checkpoint_ns = metadata['checkpoint_ns']
                if 'platform_engineer_supervisor' in checkpoint_ns:
                    logger.debug("Found platform_engineer_supervisor from checkpoint_ns")
                    return 'platform_engineer_supervisor'
                elif 'github' in checkpoint_ns:
                    logger.debug("Found github_agent from checkpoint_ns")
                    return 'github_agent'
                elif 'slack' in checkpoint_ns:
                    return 'slack_agent'
                elif 'argocd' in checkpoint_ns:
                    return 'argocd_agent'
                elif 'pagerduty' in checkpoint_ns:
                    return 'pagerduty_agent'
            
            # Check agent_type in metadata
            if 'agent_type' in metadata:
                agent_type = metadata['agent_type']
                logger.debug(f"Found agent_type in metadata: {agent_type}")
                return f"{agent_type}_agent"
            
            # Check observation name patterns
            if 'platform_engineer' in name.lower():
                return 'platform_engineer_supervisor'
            elif 'github' in name.lower():
                return 'github_agent'
            elif 'slack' in name.lower():
                return 'slack_agent'
            elif 'argocd' in name.lower():
                return 'argocd_agent'
            elif 'pagerduty' in name.lower():
                return 'pagerduty_agent'
            
            # Move to parent observation
            current_id = obs.get('parentObservationId')
        
        # If no agent found in hierarchy, return unknown
        logger.warning(f"Could not determine agent from hierarchy starting at {observation_id}")
        return 'unknown_agent'