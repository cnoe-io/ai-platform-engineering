# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Wget Tool

This tool provides capabilities to download files using wget, useful for:
- Downloading files from URLs
- Fetching remote resources
- Mirroring websites
- Batch downloading
"""

from typing import Dict, Any, Optional
from langchain_core.tools import tool
import subprocess
import os


@tool
def wget_download(
    url: str,
    output_path: Optional[str] = None,
    output_dir: Optional[str] = None,
    timeout: int = 300,
    quiet: bool = False,
    continue_download: bool = False
) -> Dict[str, Any]:
    """
    Download a file from a URL using wget.

    This tool downloads files from web URLs using the wget utility.
    Useful for fetching remote resources, documentation, or data files.

    Args:
        url: URL of the file to download
        output_path: Optional full path for the output file (including filename)
        output_dir: Optional directory to save the file (uses URL filename)
        timeout: Download timeout in seconds (default: 300)
        quiet: Suppress wget output (default: False)
        continue_download: Continue partial downloads (default: False)

    Returns:
        Dict containing:
        - success: Whether the download succeeded
        - file_path: Path to the downloaded file
        - file_size: Size of the downloaded file in bytes
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        # Download file with custom name
        result = wget_download(
            "https://example.com/data.json",
            output_path="/tmp/mydata.json"
        )

        # Download to directory (keeps original filename)
        result = wget_download(
            "https://example.com/report.pdf",
            output_dir="/tmp/downloads"
        )

        # Continue interrupted download
        result = wget_download(
            "https://example.com/large-file.zip",
            output_dir="/tmp",
            continue_download=True
        )

    Notes:
        - Requires wget to be installed
        - If neither output_path nor output_dir specified, downloads to current directory
        - Use continue_download=True to resume interrupted downloads
        - Timeout prevents hanging on slow connections
    """
    try:
        # Build wget command
        args = ['wget']

        # Add timeout
        args.extend(['--timeout', str(timeout)])

        # Add quiet flag
        if quiet:
            args.append('-q')

        # Add continue flag
        if continue_download:
            args.append('-c')

        # Determine output
        if output_path:
            args.extend(['-O', output_path])
            expected_path = output_path
        elif output_dir:
            args.extend(['-P', output_dir])
            # Extract filename from URL
            filename = url.split('/')[-1].split('?')[0] or 'download'
            expected_path = os.path.join(output_dir, filename)
        else:
            # Default to current directory
            filename = url.split('/')[-1].split('?')[0] or 'download'
            expected_path = filename

        # Add URL
        args.append(url)

        # Execute wget
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout + 30  # Add buffer to command timeout
        )

        if result.returncode == 0:
            # Check if file was created
            if os.path.exists(expected_path):
                file_size = os.path.getsize(expected_path)
                return {
                    'success': True,
                    'file_path': expected_path,
                    'file_size': file_size,
                    'message': f'Successfully downloaded {url} to {expected_path} ({file_size} bytes)'
                }
            else:
                return {
                    'success': False,
                    'file_path': None,
                    'error': 'File was not created',
                    'message': 'Download completed but file not found'
                }
        else:
            stderr = result.stderr or result.stdout
            return {
                'success': False,
                'file_path': None,
                'error': stderr,
                'message': f'Download failed: {stderr}'
            }

    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'file_path': None,
            'error': f'Download timed out after {timeout} seconds',
            'message': f'Download operation timed out after {timeout} seconds'
        }
    except FileNotFoundError:
        return {
            'success': False,
            'file_path': None,
            'error': 'wget command not found',
            'message': 'wget utility is not installed or not in PATH'
        }
    except Exception as e:
        return {
            'success': False,
            'file_path': None,
            'error': str(e),
            'message': f'Unexpected error: {str(e)}'
        }


@tool
def wget_mirror(
    url: str,
    output_dir: str,
    max_depth: int = 1,
    no_parent: bool = True,
    wait_seconds: int = 1
) -> Dict[str, Any]:
    """
    Mirror a website or directory using wget.

    Args:
        url: Base URL to mirror
        output_dir: Directory to save mirrored content
        max_depth: Maximum recursion depth (default: 1)
        no_parent: Don't ascend to parent directory (default: True)
        wait_seconds: Wait time between requests to avoid overwhelming server (default: 1)

    Returns:
        Dict containing:
        - success: Whether the mirror succeeded
        - output_dir: Directory containing mirrored content
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = wget_mirror(
            "https://docs.example.com/guide/",
            "/tmp/docs-mirror",
            max_depth=2
        )

    Notes:
        - Use with caution - can download many files
        - Respects robots.txt by default
        - wait_seconds helps avoid overwhelming the server
    """
    try:
        args = [
            'wget',
            '--mirror',
            '--convert-links',
            '--adjust-extension',
            '--page-requisites',
            f'--level={max_depth}',
            f'--wait={wait_seconds}',
            '-P', output_dir
        ]

        if no_parent:
            args.append('--no-parent')

        args.append(url)

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout for mirroring
        )

        if result.returncode == 0:
            return {
                'success': True,
                'output_dir': output_dir,
                'message': f'Successfully mirrored {url} to {output_dir}'
            }
        else:
            return {
                'success': False,
                'output_dir': output_dir,
                'error': result.stderr or result.stdout,
                'message': f'Mirror failed: {result.stderr}'
            }

    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'output_dir': output_dir,
            'error': 'Mirror operation timed out',
            'message': 'Mirror operation timed out after 10 minutes'
        }
    except Exception as e:
        return {
            'success': False,
            'output_dir': output_dir,
            'error': str(e),
            'message': f'Unexpected error: {str(e)}'
        }


# Export for use in agent tool lists
__all__ = ['wget_download', 'wget_mirror']




