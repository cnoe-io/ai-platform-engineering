# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for workspace_ops.py - Agent Workspace Tools
"""

import pytest
import os
from pathlib import Path

# Import the actual tool instances for testing
from ai_platform_engineering.multi_agents.tools import workspace_ops

# Import helper functions and constants directly
from ai_platform_engineering.multi_agents.tools.workspace_ops import (
    _workspaces,
    _workspace_lock,
    _get_workspace,
    _delete_workspace,
    MAX_FILE_SIZE,
    MAX_FILES,
    MAX_PATH_LENGTH
)

# Helper functions to call tools properly
def write_workspace_file(file_path: str, content: str, context_id=None):
    """Helper to call write_workspace_file tool."""
    return workspace_ops.write_workspace_file.invoke({
        'file_path': file_path,
        'content': content,
        'context_id': context_id
    })

def read_workspace_file(file_path: str, context_id=None):
    """Helper to call read_workspace_file tool."""
    return workspace_ops.read_workspace_file.invoke({
        'file_path': file_path,
        'context_id': context_id
    })

def list_workspace_files(directory="/", context_id=None):
    """Helper to call list_workspace_files tool."""
    return workspace_ops.list_workspace_files.invoke({
        'directory': directory,
        'context_id': context_id
    })

def clear_workspace(context_id=None, delete_workspace=False):
    """Helper to call clear_workspace tool."""
    return workspace_ops.clear_workspace.invoke({
        'context_id': context_id,
        'delete_workspace': delete_workspace
    })


@pytest.fixture(autouse=True)
def cleanup_workspaces():
    """Cleanup all workspaces before and after each test."""
    with _workspace_lock:
        # Cleanup before test
        for context_id in list(_workspaces.keys()):
            try:
                _workspaces[context_id]['tempdir'].cleanup()
            except:
                pass
        _workspaces.clear()
    
    yield
    
    # Cleanup after test
    with _workspace_lock:
        for context_id in list(_workspaces.keys()):
            try:
                _workspaces[context_id]['tempdir'].cleanup()
            except:
                pass
        _workspaces.clear()


class TestWriteWorkspaceFile:
    """Tests for write_workspace_file function."""

    def test_write_simple_file(self):
        """Test writing a simple file to workspace."""
        result = write_workspace_file("test.txt", "Hello World")
        
        assert result['success'] is True
        assert result['path'] == "test.txt"
        assert result['size'] == 11
        assert 'Successfully wrote' in result['message']

    def test_write_file_with_directory(self):
        """Test writing file with directory path."""
        result = write_workspace_file("subdir/test.txt", "Content")
        
        assert result['success'] is True
        assert result['path'] == "subdir/test.txt"
        
        # Verify directory was created
        workspace_root = _get_workspace(None)
        assert Path(workspace_root, "subdir").exists()
        assert Path(workspace_root, "subdir").is_dir()

    def test_write_unicode_content(self):
        """Test writing Unicode content."""
        content = "Hello 世界 🌍 emoji"
        result = write_workspace_file("unicode.txt", content)
        
        assert result['success'] is True
        
        # Verify we can read it back
        read_result = read_workspace_file("unicode.txt")
        assert read_result['success'] is True
        assert read_result['content'] == content

    def test_write_multiline_content(self):
        """Test writing multiline content."""
        content = """Line 1
Line 2
Line 3"""
        result = write_workspace_file("multiline.txt", content)
        
        assert result['success'] is True
        
        # Verify content is preserved
        read_result = read_workspace_file("multiline.txt")
        assert read_result['content'] == content

    def test_overwrite_existing_file(self):
        """Test overwriting an existing file."""
        write_workspace_file("test.txt", "Original")
        result = write_workspace_file("test.txt", "Overwritten")
        
        assert result['success'] is True
        
        # Verify new content
        read_result = read_workspace_file("test.txt")
        assert read_result['content'] == "Overwritten"

    def test_path_traversal_prevention(self):
        """Test that path traversal attempts are blocked."""
        result = write_workspace_file("../etc/passwd", "malicious")
        
        assert result['success'] is False
        assert 'Path traversal not allowed' in result['message']

    def test_path_too_long(self):
        """Test that paths exceeding MAX_PATH_LENGTH are rejected."""
        long_path = "a" * (MAX_PATH_LENGTH + 1) + ".txt"
        result = write_workspace_file(long_path, "content")
        
        assert result['success'] is False
        assert 'Path too long' in result['message']

    def test_file_too_large(self):
        """Test that files exceeding MAX_FILE_SIZE are rejected."""
        large_content = "x" * (MAX_FILE_SIZE + 1)
        result = write_workspace_file("large.txt", large_content)
        
        assert result['success'] is False
        assert 'Content too large' in result['message']

    def test_max_files_limit(self):
        """Test that MAX_FILES limit is enforced."""
        # Write MAX_FILES files
        for i in range(MAX_FILES):
            result = write_workspace_file(f"file_{i}.txt", f"content {i}")
            assert result['success'] is True
        
        # Try to write one more
        result = write_workspace_file(f"file_{MAX_FILES}.txt", "extra")
        assert result['success'] is False
        assert 'Workspace full' in result['message']

    def test_context_isolation(self):
        """Test that different contexts have isolated workspaces."""
        write_workspace_file("test.txt", "Context 1", context_id="ctx1")
        write_workspace_file("test.txt", "Context 2", context_id="ctx2")
        
        # Verify isolation
        result1 = read_workspace_file("test.txt", context_id="ctx1")
        result2 = read_workspace_file("test.txt", context_id="ctx2")
        
        assert result1['content'] == "Context 1"
        assert result2['content'] == "Context 2"

    def test_leading_slash_stripped(self):
        """Test that leading slashes are stripped from paths."""
        result = write_workspace_file("/test.txt", "content")
        
        assert result['success'] is True
        assert result['path'] == "test.txt"


class TestReadWorkspaceFile:
    """Tests for read_workspace_file function."""

    def test_read_existing_file(self):
        """Test reading an existing file."""
        write_workspace_file("test.txt", "Hello World")
        result = read_workspace_file("test.txt")
        
        assert result['success'] is True
        assert result['content'] == "Hello World"
        assert result['path'] == "test.txt"
        assert result['size'] == 11

    def test_read_nonexistent_file(self):
        """Test reading a file that doesn't exist."""
        result = read_workspace_file("nonexistent.txt")
        
        assert result['success'] is False
        assert result['content'] is None
        assert 'File not found' in result['message']

    def test_read_directory_as_file(self):
        """Test that reading a directory fails appropriately."""
        write_workspace_file("subdir/file.txt", "content")
        result = read_workspace_file("subdir")
        
        assert result['success'] is False
        assert 'Path is not a file' in result['message']

    def test_read_path_traversal_prevention(self):
        """Test that path traversal is prevented on read."""
        result = read_workspace_file("../etc/passwd")
        
        assert result['success'] is False
        assert 'Path traversal not allowed' in result['message']

    def test_read_from_different_context(self):
        """Test that reading from wrong context returns not found."""
        write_workspace_file("test.txt", "Context 1", context_id="ctx1")
        result = read_workspace_file("test.txt", context_id="ctx2")
        
        assert result['success'] is False
        assert 'File not found' in result['message']

    def test_read_large_file(self):
        """Test reading a large file (near max size)."""
        large_content = "x" * (MAX_FILE_SIZE - 1000)  # Just under limit
        write_workspace_file("large.txt", large_content)
        result = read_workspace_file("large.txt")
        
        assert result['success'] is True
        assert len(result['content']) == len(large_content)


class TestListWorkspaceFiles:
    """Tests for list_workspace_files function."""

    def test_list_empty_workspace(self):
        """Test listing an empty workspace."""
        result = list_workspace_files()
        
        assert result['success'] is True
        assert result['files'] == []
        assert result['count'] == 0

    def test_list_files_in_root(self):
        """Test listing files in root directory."""
        write_workspace_file("file1.txt", "content1")
        write_workspace_file("file2.txt", "content2")
        write_workspace_file("file3.txt", "content3")
        
        result = list_workspace_files()
        
        assert result['success'] is True
        assert result['count'] == 3
        paths = [f['path'] for f in result['files']]
        assert "file1.txt" in paths
        assert "file2.txt" in paths
        assert "file3.txt" in paths

    def test_list_files_with_subdirectories(self):
        """Test listing files including subdirectories."""
        write_workspace_file("root.txt", "root content")
        write_workspace_file("subdir/file1.txt", "content1")
        write_workspace_file("subdir/file2.txt", "content2")
        write_workspace_file("deep/nested/file.txt", "deep content")
        
        result = list_workspace_files()
        
        assert result['success'] is True
        assert result['count'] == 4
        paths = [f['path'] for f in result['files']]
        assert "root.txt" in paths
        assert any("subdir/file1.txt" in p or "subdir\\file1.txt" in p for p in paths)

    def test_list_files_in_specific_directory(self):
        """Test listing files in a specific subdirectory."""
        write_workspace_file("root.txt", "root")
        write_workspace_file("subdir/file1.txt", "content1")
        write_workspace_file("subdir/file2.txt", "content2")
        write_workspace_file("other/file.txt", "other")
        
        result = list_workspace_files("subdir")
        
        assert result['success'] is True
        assert result['count'] == 2

    def test_list_nonexistent_directory(self):
        """Test listing a directory that doesn't exist."""
        result = list_workspace_files("nonexistent")
        
        assert result['success'] is False
        assert 'Directory not found' in result['message']

    def test_list_path_traversal_prevention(self):
        """Test that path traversal is prevented."""
        result = list_workspace_files("../etc")
        
        assert result['success'] is False
        assert 'Path traversal not allowed' in result['message']

    def test_list_files_shows_sizes(self):
        """Test that file sizes are included in listing."""
        write_workspace_file("small.txt", "Hi")
        write_workspace_file("large.txt", "x" * 1000)
        
        result = list_workspace_files()
        
        assert result['success'] is True
        for file_info in result['files']:
            assert 'size' in file_info
            assert file_info['size'] > 0

    def test_list_context_isolation(self):
        """Test that listing respects context isolation."""
        write_workspace_file("file1.txt", "ctx1", context_id="ctx1")
        write_workspace_file("file2.txt", "ctx2", context_id="ctx2")
        
        result1 = list_workspace_files(context_id="ctx1")
        result2 = list_workspace_files(context_id="ctx2")
        
        assert result1['count'] == 1
        assert result2['count'] == 1
        assert result1['files'][0]['path'] == "file1.txt"
        assert result2['files'][0]['path'] == "file2.txt"


class TestClearWorkspace:
    """Tests for clear_workspace function."""

    def test_clear_empty_workspace(self):
        """Test clearing an already empty workspace."""
        result = clear_workspace()
        
        assert result['success'] is True
        assert result['files_removed'] == 0

    def test_clear_workspace_with_files(self):
        """Test clearing workspace with files."""
        write_workspace_file("file1.txt", "content1")
        write_workspace_file("file2.txt", "content2")
        write_workspace_file("subdir/file3.txt", "content3")
        
        result = clear_workspace()
        
        assert result['success'] is True
        assert result['files_removed'] == 3
        
        # Verify workspace is empty
        list_result = list_workspace_files()
        assert list_result['count'] == 0

    def test_clear_workspace_preserves_workspace(self):
        """Test that clearing doesn't delete the workspace instance."""
        write_workspace_file("test.txt", "content")
        
        # Get workspace path before clear
        workspace_path_before = _get_workspace(None)
        
        clear_workspace()
        
        # Get workspace path after clear
        workspace_path_after = _get_workspace(None)
        
        # Should be same workspace instance
        assert workspace_path_before == workspace_path_after

    def test_delete_workspace_completely(self):
        """Test deleting entire workspace."""
        write_workspace_file("test.txt", "content", context_id="temp_ctx")
        
        result = clear_workspace(context_id="temp_ctx", delete_workspace=True)
        
        assert result['success'] is True
        assert result['workspace_deleted'] is True

    def test_delete_nonexistent_workspace(self):
        """Test deleting workspace that doesn't exist."""
        result = clear_workspace(context_id="nonexistent", delete_workspace=True)
        
        assert result['success'] is False
        assert 'Workspace not found' in result['message']

    def test_clear_specific_context(self):
        """Test clearing a specific context."""
        write_workspace_file("file1.txt", "ctx1", context_id="ctx1")
        write_workspace_file("file2.txt", "ctx2", context_id="ctx2")
        
        clear_workspace(context_id="ctx1")
        
        # ctx1 should be empty
        list1 = list_workspace_files(context_id="ctx1")
        assert list1['count'] == 0
        
        # ctx2 should still have files
        list2 = list_workspace_files(context_id="ctx2")
        assert list2['count'] == 1


class TestWorkspaceHelpers:
    """Tests for internal helper functions."""

    def test_get_workspace_creates_new(self):
        """Test that _get_workspace creates new workspace."""
        workspace_path = _get_workspace("new_context")
        
        assert workspace_path is not None
        assert Path(workspace_path).exists()
        assert Path(workspace_path).is_dir()

    def test_get_workspace_returns_existing(self):
        """Test that _get_workspace returns existing workspace."""
        path1 = _get_workspace("ctx1")
        path2 = _get_workspace("ctx1")
        
        assert path1 == path2

    def test_delete_workspace_cleanup(self):
        """Test that _delete_workspace properly cleans up."""
        workspace_path = _get_workspace("temp")
        write_workspace_file("test.txt", "content", context_id="temp")
        
        # Workspace should exist
        assert Path(workspace_path).exists()
        
        # Delete it
        deleted = _delete_workspace("temp")
        assert deleted is True
        
        # Should not exist anymore (cleaned up by TemporaryDirectory)
        # Note: The directory might still exist briefly due to OS cleanup timing

    def test_workspace_default_context(self):
        """Test that default context is used when none specified."""
        write_workspace_file("test.txt", "content")
        result = read_workspace_file("test.txt")
        
        assert result['success'] is True
        assert result['context_id'] == "default"


class TestWorkspaceIntegration:
    """Integration tests for complete workflows."""

    def test_parallel_agent_workflow(self):
        """Test simulated parallel agent workflow."""
        # Simulate agents writing in parallel
        write_workspace_file("argocd_results.md", "# ArgoCD\n- app1: healthy\n- app2: degraded")
        write_workspace_file("jira_results.md", "# Jira\n- PROJ-123: Open\n- PROJ-456: Closed")
        write_workspace_file("aws_results.md", "# AWS\n- i-123: running\n- i-456: stopped")
        
        # List all results
        files = list_workspace_files()
        assert files['count'] == 3
        
        # Combine results
        combined = ""
        for file_info in files['files']:
            content = read_workspace_file(file_info['path'])
            combined += content['content'] + "\n\n"
        
        assert "ArgoCD" in combined
        assert "Jira" in combined
        assert "AWS" in combined

    def test_progressive_analysis_workflow(self):
        """Test progressive analysis with intermediate results."""
        # Step 1: Initial data
        write_workspace_file("step1_raw.txt", "raw data from agent")
        
        # Step 2: Filtered data
        raw = read_workspace_file("step1_raw.txt")
        write_workspace_file("step2_filtered.txt", raw['content'].upper())
        
        # Step 3: Analysis
        filtered = read_workspace_file("step2_filtered.txt")
        write_workspace_file("step3_analysis.txt", f"Analyzed: {filtered['content']}")
        
        # Verify all steps preserved
        files = list_workspace_files()
        assert files['count'] == 3
        
        final = read_workspace_file("step3_analysis.txt")
        assert "RAW DATA FROM AGENT" in final['content']

    def test_cleanup_and_reuse(self):
        """Test clearing and reusing workspace."""
        # First task
        write_workspace_file("task1_file1.txt", "task 1 content")
        write_workspace_file("task1_file2.txt", "more task 1")
        
        # Clear for new task
        clear_workspace()
        
        # Second task
        write_workspace_file("task2_file1.txt", "task 2 content")
        
        # Should only have task 2 files
        files = list_workspace_files()
        assert files['count'] == 1
        paths = [f['path'] for f in files['files']]
        assert "task2_file1.txt" in paths
        assert "task1_file1.txt" not in paths

    def test_multi_context_concurrent_use(self):
        """Test multiple contexts being used concurrently."""
        # Simulate different user sessions
        write_workspace_file("report.md", "User 1 report", context_id="user1")
        write_workspace_file("report.md", "User 2 report", context_id="user2")
        write_workspace_file("report.md", "User 3 report", context_id="user3")
        
        # Verify isolation
        report1 = read_workspace_file("report.md", context_id="user1")
        report2 = read_workspace_file("report.md", context_id="user2")
        report3 = read_workspace_file("report.md", context_id="user3")
        
        assert report1['content'] == "User 1 report"
        assert report2['content'] == "User 2 report"
        assert report3['content'] == "User 3 report"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

