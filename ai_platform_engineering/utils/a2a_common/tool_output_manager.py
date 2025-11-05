"""
Tool Output Manager - Handles large tool outputs using in-memory virtual files.

This prevents context window overflow by:
1. Detecting large tool outputs
2. Storing full output in memory with virtual file ID
3. Returning summary + virtual file ID to agent
4. Providing virtual file reading for agents to access chunks
"""

import json
import logging
import os
from typing import Any, Dict, Optional
from uuid import uuid4
from threading import Lock

logger = logging.getLogger(__name__)

# Configuration
MAX_TOOL_OUTPUT_CHARS = int(os.getenv("MAX_TOOL_OUTPUT_CHARS", "50000"))  # 50K chars (~12.5K tokens)
MAX_VIRTUAL_FILES = int(os.getenv("MAX_VIRTUAL_FILES", "1000"))  # Limit number of files in memory


class ToolOutputManager:
    """Manages large tool outputs using in-memory virtual files."""

    def __init__(self):
        """Initialize the tool output manager."""
        self.max_chars = MAX_TOOL_OUTPUT_CHARS
        self.max_files = MAX_VIRTUAL_FILES
        self._virtual_files: Dict[str, str] = {}  # file_id -> content
        self._lock = Lock()  # Thread-safe access
        logger.info(
            f"ToolOutputManager initialized (in-memory): max_chars={self.max_chars:,}, "
            f"max_files={self.max_files}"
        )

    def should_truncate(self, output: Any) -> bool:
        """
        Check if tool output should be truncated.

        Args:
            output: Tool output (string, dict, list, etc.)

        Returns:
            True if output should be truncated, False otherwise
        """
        output_str = self._to_string(output)
        return len(output_str) > self.max_chars

    def process_tool_output(
        self,
        output: Any,
        tool_name: str,
        context_id: str,
        agent_name: str = "unknown",
    ) -> Dict[str, Any]:
        """
        Process tool output - truncate if too large and store in virtual file.

        Args:
            output: Tool output to process
            tool_name: Name of the tool that produced the output
            context_id: Context ID for this conversation
            agent_name: Name of the agent calling the tool

        Returns:
            Dict with:
                - truncated: bool - whether output was truncated
                - summary: str - summary of the output
                - file_id: Optional[str] - virtual file ID for full output
                - char_count: int - character count
                - item_count: Optional[int] - number of items if list/dict
        """
        output_str = self._to_string(output)
        char_count = len(output_str)

        if not self.should_truncate(output):
            # Output is small enough - return as-is
            return {
                "truncated": False,
                "output": output,
                "char_count": char_count,
                "item_count": self._count_items(output),
            }

        # Output is too large - store in virtual file and return summary
        logger.warning(
            f"{agent_name}: Tool output from '{tool_name}' is large ({char_count:,} chars). "
            f"Storing in virtual file and returning summary."
        )

        # Generate unique virtual file ID
        file_id = f"{agent_name}_{tool_name}_{context_id[:8]}_{str(uuid4())[:8]}"

        # Store full output in memory
        with self._lock:
            # Check if we're at capacity - remove oldest file if needed
            if len(self._virtual_files) >= self.max_files:
                oldest_file = next(iter(self._virtual_files))
                del self._virtual_files[oldest_file]
                logger.warning(
                    f"Virtual file capacity reached ({self.max_files}). "
                    f"Removed oldest file: {oldest_file}"
                )

            # Store the output
            self._virtual_files[file_id] = output_str
            logger.info(
                f"{agent_name}: Stored tool output in virtual file: {file_id} "
                f"({len(self._virtual_files)}/{self.max_files} files in memory)"
            )

        # Create summary
        summary = self._create_summary(output, tool_name)

        return {
            "truncated": True,
            "summary": summary,
            "file_id": file_id,
            "char_count": char_count,
            "item_count": self._count_items(output),
            "note": (
                f"⚠️  Output was large ({char_count:,} chars) and has been stored in virtual memory. "
                f"Use read_virtual_file('{file_id}') to access full data if needed."
            ),
        }

    def _to_string(self, output: Any) -> str:
        """Convert output to string for size checking."""
        if isinstance(output, str):
            return output
        elif isinstance(output, (dict, list)):
            return json.dumps(output)
        else:
            return str(output)

    def _count_items(self, output: Any) -> Optional[int]:
        """Count items in output if it's a collection."""
        if isinstance(output, list):
            return len(output)
        elif isinstance(output, dict):
            return len(output.keys())
        return None

    def _create_summary(self, output: Any, tool_name: str) -> str:
        """Create a summary of the tool output."""
        item_count = self._count_items(output)

        if isinstance(output, list) and item_count:
            # List of items - show first few
            preview_count = min(3, item_count)
            preview_items = output[:preview_count]

            summary = f"📊 {tool_name} returned {item_count} items.\n\n"
            summary += f"Preview of first {preview_count} items:\n"
            summary += json.dumps(preview_items, indent=2)

            if item_count > preview_count:
                summary += f"\n\n... and {item_count - preview_count} more items."

            return summary

        elif isinstance(output, dict) and item_count:
            # Dictionary - show keys and first few values
            keys = list(output.keys())[:10]
            summary = f"📊 {tool_name} returned a dictionary with {item_count} keys.\n\n"
            summary += f"Keys: {', '.join(keys)}"

            if item_count > 10:
                summary += f" ... and {item_count - 10} more"

            return summary

        else:
            # String or other - show first 1000 chars
            output_str = self._to_string(output)
            preview = output_str[:1000]
            summary = f"📊 {tool_name} returned {len(output_str):,} characters.\n\n"
            summary += f"Preview:\n{preview}"

            if len(output_str) > 1000:
                summary += f"\n\n... ({len(output_str) - 1000:,} more characters)"

            return summary

    def _create_truncated_response(
        self, output: Any, char_count: int, file_path: Optional[str]
    ) -> Dict[str, Any]:
        """Create a response for truncated output (fallback when file write fails)."""
        output_str = self._to_string(output)
        truncated_output = output_str[:self.max_chars]

        return {
            "truncated": True,
            "output": truncated_output,
            "char_count": char_count,
            "item_count": self._count_items(output),
            "note": (
                f"⚠️  Output was truncated from {char_count:,} to {len(truncated_output):,} chars. "
                "Full output could not be saved to file."
            ),
        }

    def read_virtual_file(
        self, file_id: str, start_char: int = 0, max_chars: int = 10000
    ) -> Dict[str, Any]:
        """
        Read a virtual file with optional character-based pagination.

        Args:
            file_id: Virtual file ID
            start_char: Starting character position (0-indexed)
            max_chars: Maximum number of characters to read

        Returns:
            Dict with:
                - content: str - file content (or chunk thereof)
                - total_chars: int - total characters in file
                - start_char: int - starting position
                - end_char: int - ending position
                - has_more: bool - whether more content available
        """
        with self._lock:
            if file_id not in self._virtual_files:
                logger.error(f"Virtual file not found: {file_id}")
                return {
                    "content": f"❌ Error: Virtual file '{file_id}' not found. It may have been evicted from memory.",
                    "total_chars": 0,
                    "start_char": 0,
                    "end_char": 0,
                    "has_more": False,
                }

            full_content = self._virtual_files[file_id]

        total_chars = len(full_content)
        end_char = min(start_char + max_chars, total_chars)
        content = full_content[start_char:end_char]
        has_more = end_char < total_chars

        if has_more:
            content += f"\n\n[... {total_chars - end_char:,} more characters available. Use read_virtual_file('{file_id}', start_char={end_char}) to continue ...]"

        return {
            "content": content,
            "total_chars": total_chars,
            "start_char": start_char,
            "end_char": end_char,
            "has_more": has_more,
        }

    def list_virtual_files(self) -> Dict[str, int]:
        """
        List all virtual files currently in memory.

        Returns:
            Dict mapping file_id to character count
        """
        with self._lock:
            return {
                file_id: len(content)
                for file_id, content in self._virtual_files.items()
            }

    def clear_virtual_files(self, context_id: Optional[str] = None) -> int:
        """
        Clear virtual files from memory.

        Args:
            context_id: If provided, only clear files for this context.
                       If None, clear all files.

        Returns:
            Number of files cleared
        """
        with self._lock:
            if context_id is None:
                # Clear all files
                count = len(self._virtual_files)
                self._virtual_files.clear()
                logger.info(f"Cleared all {count} virtual files from memory")
                return count
            else:
                # Clear only files for this context
                files_to_remove = [
                    file_id
                    for file_id in self._virtual_files
                    if context_id[:8] in file_id
                ]
                for file_id in files_to_remove:
                    del self._virtual_files[file_id]
                logger.info(
                    f"Cleared {len(files_to_remove)} virtual files for context {context_id}"
                )
                return len(files_to_remove)

    def grep_virtual_file(
        self, file_id: str, pattern: str, max_results: int = 100, case_sensitive: bool = False
    ) -> Dict[str, Any]:
        """
        Search for a pattern in a virtual file (like grep).

        Args:
            file_id: Virtual file ID
            pattern: Search pattern (string or regex)
            max_results: Maximum number of matching lines to return
            case_sensitive: Whether search should be case-sensitive

        Returns:
            Dict with:
                - matches: List[Dict] - matching lines with context
                - match_count: int - total number of matches
                - file_id: str - the file that was searched
                - pattern: str - the pattern searched for
        """
        import re

        with self._lock:
            if file_id not in self._virtual_files:
                logger.error(f"Virtual file not found: {file_id}")
                return {
                    "matches": [],
                    "match_count": 0,
                    "file_id": file_id,
                    "pattern": pattern,
                    "error": f"Virtual file '{file_id}' not found. It may have been evicted from memory.",
                }

            full_content = self._virtual_files[file_id]

        # Split into lines for grepping
        lines = full_content.split('\n')

        # Compile regex pattern
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return {
                "matches": [],
                "match_count": 0,
                "file_id": file_id,
                "pattern": pattern,
                "error": f"Invalid regex pattern: {e}",
            }

        # Search for matches
        matches = []
        for line_num, line in enumerate(lines, 1):
            if regex.search(line):
                matches.append({
                    "line_number": line_num,
                    "content": line,
                })

                if len(matches) >= max_results:
                    break

        return {
            "matches": matches,
            "match_count": len(matches),
            "file_id": file_id,
            "pattern": pattern,
            "total_lines": len(lines),
            "truncated": len(matches) >= max_results,
        }


# Global instance
_tool_output_manager = None


def get_tool_output_manager() -> ToolOutputManager:
    """Get the global ToolOutputManager instance."""
    global _tool_output_manager
    if _tool_output_manager is None:
        _tool_output_manager = ToolOutputManager()
    return _tool_output_manager

