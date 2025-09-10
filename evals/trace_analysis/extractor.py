"""
Tool call extraction from Langfuse traces.
"""
import logging
from typing import List, Optional, Any, Dict
from datetime import datetime
from langfuse import Langfuse

from models.trajectory import ToolCall, Trajectory

logger = logging.getLogger(__name__)


class TraceExtractor:
    """Extracts tool calls and agent interactions from Langfuse traces."""
    
    def __init__(self, langfuse_client: Langfuse):
        self.langfuse = langfuse_client
    
    async def extract_trajectory(self, trace_id: str) -> Optional[Trajectory]:
        """
        Extract complete trajectory from a Langfuse trace.
        
        Args:
            trace_id: ID of the trace to extract
            
        Returns:
            Trajectory object with extracted tool calls, or None if extraction fails
        """
        try:
            logger.info(f"Extracting trajectory from trace: {trace_id}")
            
            # Note: fetch_trace method doesn't exist in current Langfuse SDK
            # For now, create a placeholder trajectory - this would need to be
            # replaced with proper trace fetching when the SDK supports it
            logger.warning(f"Trace fetching not implemented - creating placeholder trajectory for {trace_id}")
            
            # Create empty trajectory as fallback
            tool_calls = []
            
            # Build trajectory
            trajectory = Trajectory(
                trace_id=trace_id,
                tool_calls=tool_calls
            )
            
            logger.info(f"Created placeholder trajectory with {len(tool_calls)} tool calls for trace {trace_id}")
            return trajectory
            
        except Exception as e:
            logger.error(f"Failed to extract trajectory from trace {trace_id}: {e}")
            return None
    
    def _extract_tool_calls(self, trace) -> List[ToolCall]:
        """Extract tool calls from trace observations and messages."""
        tool_calls = []
        
        # Method 1: Extract from observations metadata
        if hasattr(trace, 'observations') and trace.observations:
            for obs in trace.observations:
                tool_call = self._extract_from_observation(obs)
                if tool_call:
                    tool_calls.append(tool_call)
        
        # Method 2: Extract from Langchain messages in trace
        tool_calls.extend(self._extract_from_messages(trace))
        
        # Sort by timestamp if available
        tool_calls.sort(key=lambda x: x.timestamp or datetime.min)
        
        return tool_calls
    
    def _extract_from_observation(self, observation) -> Optional[ToolCall]:
        """Extract tool call from a single observation."""
        try:
            # Check if observation has agent metadata
            if not hasattr(observation, 'metadata') or not observation.metadata:
                return None
            
            metadata = observation.metadata
            agent_name = metadata.get('agent_name') or metadata.get('agent')
            
            if not agent_name:
                return None
            
            # Extract tool information
            tool_name = metadata.get('tool_name') or metadata.get('function_name')
            
            # Get input/output data
            input_data = getattr(observation, 'input', None)
            output_data = getattr(observation, 'output', None)
            
            # Extract parameters from input if it's structured
            parameters = {}
            if isinstance(input_data, dict):
                parameters = input_data.copy()
            
            # Calculate duration if available
            duration_ms = None
            if hasattr(observation, 'start_time') and hasattr(observation, 'end_time'):
                if observation.start_time and observation.end_time:
                    duration_ms = (observation.end_time - observation.start_time).total_seconds() * 1000
            
            # Check for errors
            success = True
            error_message = None
            if hasattr(observation, 'status_message') and observation.status_message:
                if 'error' in observation.status_message.lower():
                    success = False
                    error_message = observation.status_message
            
            return ToolCall(
                agent_name=agent_name,
                tool_name=tool_name,
                parameters=parameters,
                input_data=input_data,
                output_data=output_data,
                timestamp=getattr(observation, 'start_time', None),
                duration_ms=duration_ms,
                success=success,
                error_message=error_message
            )
            
        except Exception as e:
            logger.warning(f"Failed to extract tool call from observation: {e}")
            return None
    
    def _extract_from_messages(self, trace) -> List[ToolCall]:
        """Extract tool calls from Langchain messages in the trace."""
        tool_calls = []
        
        try:
            # Look for messages in trace data
            messages = []
            if hasattr(trace, 'observations'):
                for obs in trace.observations:
                    if hasattr(obs, 'input') and isinstance(obs.input, dict):
                        if 'messages' in obs.input:
                            messages.extend(obs.input['messages'])
                    if hasattr(obs, 'output') and isinstance(obs.output, dict):
                        if 'messages' in obs.output:
                            messages.extend(obs.output['messages'])
            
            # Process Langchain messages
            for message in messages:
                if self._is_ai_message_with_tools(message):
                    tool_calls.extend(self._extract_from_ai_message(message))
                elif self._is_tool_message(message):
                    # Tool messages contain results - can be used to enhance existing tool calls
                    self._enhance_with_tool_message(tool_calls, message)
            
        except Exception as e:
            logger.warning(f"Failed to extract from messages: {e}")
        
        return tool_calls
    
    def _is_ai_message_with_tools(self, message) -> bool:
        """Check if message is an AIMessage with tool calls."""
        return (
            isinstance(message, dict) 
            and message.get('type') == 'ai'
            and 'tool_calls' in message
            and message['tool_calls']
        )
    
    def _is_tool_message(self, message) -> bool:
        """Check if message is a ToolMessage."""
        return (
            isinstance(message, dict)
            and message.get('type') == 'tool'
        )
    
    def _extract_from_ai_message(self, message: Dict) -> List[ToolCall]:
        """Extract tool calls from AIMessage."""
        tool_calls = []
        
        try:
            for tool_call in message.get('tool_calls', []):
                # Extract agent name from tool name or use generic
                tool_name = tool_call.get('name', 'unknown')
                agent_name = self._infer_agent_from_tool_name(tool_name)
                
                tool_calls.append(ToolCall(
                    agent_name=agent_name,
                    tool_name=tool_name,
                    parameters=tool_call.get('args', {}),
                    input_data=tool_call.get('args'),
                    timestamp=datetime.now()  # AIMessage timestamp if available
                ))
        
        except Exception as e:
            logger.warning(f"Failed to extract from AI message: {e}")
        
        return tool_calls
    
    def _enhance_with_tool_message(self, tool_calls: List[ToolCall], message: Dict):
        """Enhance existing tool calls with ToolMessage results."""
        try:
            tool_call_id = message.get('tool_call_id')
            content = message.get('content')
            
            # Find matching tool call and add output
            for tool_call in reversed(tool_calls):  # Start from most recent
                if not tool_call.output_data and tool_call.tool_name:
                    tool_call.output_data = content
                    break
        
        except Exception as e:
            logger.warning(f"Failed to enhance with tool message: {e}")
    
    def _infer_agent_from_tool_name(self, tool_name: str) -> str:
        """Infer agent name from tool name."""
        tool_name_lower = tool_name.lower()
        
        # Common agent patterns
        agent_mappings = {
            'github': 'github',
            'jira': 'jira',
            'slack': 'slack',
            'pagerduty': 'pagerduty',
            'confluence': 'confluence',
            'backstage': 'backstage',
            'argocd': 'argocd',
            'komodor': 'komodor'
        }
        
        for pattern, agent in agent_mappings.items():
            if pattern in tool_name_lower:
                return agent
        
        # Default to tool name if no pattern matches
        return tool_name.lower().replace('_', '-')