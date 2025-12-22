# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Curl Tool

This tool provides capabilities to make HTTP requests using curl, useful for:
- Making API requests
- Testing endpoints
- Downloading files
- Debugging HTTP interactions
"""

from typing import Dict, Any, Optional, List
from langchain_core.tools import tool
import subprocess
import json as json_lib


@tool
def curl_request(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    data: Optional[str] = None,
    json: Optional[Dict[str, Any]] = None,
    output_file: Optional[str] = None,
    follow_redirects: bool = True,
    timeout: int = 30,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Make an HTTP request using curl.

    This tool performs HTTP requests using the curl utility.
    Useful for API testing, endpoint debugging, and HTTP interactions.

    Args:
        url: URL to request
        method: HTTP method (GET, POST, PUT, DELETE, etc.) (default: GET)
        headers: Optional dictionary of HTTP headers
        data: Optional request body data (for POST/PUT)
        json: Optional JSON data (will be serialized and sent with Content-Type: application/json)
        output_file: Optional file path to save response body
        follow_redirects: Follow HTTP redirects (default: True)
        timeout: Request timeout in seconds (default: 30)
        verbose: Include verbose output with headers (default: False)

    Returns:
        Dict containing:
        - success: Whether the request succeeded
        - status_code: HTTP status code
        - headers: Response headers (if verbose=True)
        - body: Response body (if not saved to file)
        - file_path: Path to output file (if output_file specified)
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        # GET request
        result = curl_request("https://api.example.com/users")

        # POST with JSON
        result = curl_request(
            "https://api.example.com/users",
            method="POST",
            json={"name": "John", "email": "john@example.com"}
        )

        # With custom headers
        result = curl_request(
            "https://api.example.com/data",
            headers={"Authorization": "Bearer token123"}
        )

        # Download to file
        result = curl_request(
            "https://example.com/file.pdf",
            output_file="/tmp/file.pdf"
        )

    Notes:
        - Returns response body as text by default
        - Use output_file for binary downloads
        - verbose=True includes response headers
        - Supports all standard HTTP methods
    """
    try:
        # Build curl command
        args = ['curl', '-s']  # -s for silent (no progress bar)

        # Add method
        if method.upper() != 'GET':
            args.extend(['-X', method.upper()])

        # Add follow redirects
        if follow_redirects:
            args.append('-L')

        # Add timeout
        args.extend(['--max-time', str(timeout)])

        # Add verbose output (includes headers)
        if verbose:
            args.append('-i')  # Include response headers

        # Add headers
        if headers:
            for key, value in headers.items():
                args.extend(['-H', f'{key}: {value}'])

        # Add JSON data
        if json is not None:
            args.extend(['-H', 'Content-Type: application/json'])
            args.extend(['-d', json_lib.dumps(json)])
        # Add regular data
        elif data is not None:
            args.extend(['-d', data])

        # Add output file
        if output_file:
            args.extend(['-o', output_file])

        # Add URL
        args.append(url)

        # Execute curl
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout + 10  # Add buffer to command timeout
        )

        # Check for errors
        if result.returncode != 0:
            return {
                'success': False,
                'status_code': None,
                'error': result.stderr or 'Curl command failed',
                'message': f'Request failed: {result.stderr}'
            }

        # Parse output
        if verbose:
            # Split headers and body
            output = result.stdout
            if '\r\n\r\n' in output:
                headers_text, body = output.split('\r\n\r\n', 1)
            elif '\n\n' in output:
                headers_text, body = output.split('\n\n', 1)
            else:
                headers_text = output
                body = ''

            # Extract status code from first line
            status_line = headers_text.split('\n')[0] if headers_text else ''
            status_code = None
            if ' ' in status_line:
                parts = status_line.split(' ')
                if len(parts) >= 2:
                    try:
                        status_code = int(parts[1])
                    except ValueError:
                        pass

            response = {
                'success': True,
                'status_code': status_code,
                'headers': headers_text,
                'body': body if not output_file else None,
                'file_path': output_file if output_file else None,
                'message': f'Request completed with status {status_code}'
            }
        else:
            # No headers in output
            response = {
                'success': True,
                'status_code': None,  # Not available without verbose
                'body': result.stdout if not output_file else None,
                'file_path': output_file if output_file else None,
                'message': 'Request completed successfully'
            }

        return response

    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'status_code': None,
            'error': f'Request timed out after {timeout} seconds',
            'message': f'Request timed out after {timeout} seconds'
        }
    except FileNotFoundError:
        return {
            'success': False,
            'status_code': None,
            'error': 'curl command not found',
            'message': 'curl utility is not installed or not in PATH'
        }
    except Exception as e:
        return {
            'success': False,
            'status_code': None,
            'error': str(e),
            'message': f'Unexpected error: {str(e)}'
        }


@tool
def curl_download(
    url: str,
    output_file: str,
    resume: bool = False,
    show_progress: bool = True,
    timeout: int = 300
) -> Dict[str, Any]:
    """
    Download a file using curl.

    Args:
        url: URL of the file to download
        output_file: Path to save the downloaded file
        resume: Resume partial download (default: False)
        show_progress: Show download progress (default: True)
        timeout: Download timeout in seconds (default: 300)

    Returns:
        Dict containing:
        - success: Whether the download succeeded
        - file_path: Path to the downloaded file
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = curl_download(
            "https://example.com/large-file.zip",
            "/tmp/file.zip",
            resume=True
        )
    """
    try:
        args = ['curl']

        # Don't use silent mode if showing progress
        if not show_progress:
            args.append('-s')

        args.extend(['-L', '--max-time', str(timeout)])

        if resume:
            args.append('-C-')  # Continue/resume download

        args.extend(['-o', output_file, url])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout + 10
        )

        if result.returncode == 0:
            return {
                'success': True,
                'file_path': output_file,
                'message': f'Successfully downloaded {url} to {output_file}'
            }
        else:
            return {
                'success': False,
                'file_path': None,
                'error': result.stderr or 'Download failed',
                'message': f'Download failed: {result.stderr}'
            }

    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'file_path': None,
            'error': f'Download timed out after {timeout} seconds',
            'message': f'Download timed out'
        }
    except Exception as e:
        return {
            'success': False,
            'file_path': None,
            'error': str(e),
            'message': f'Unexpected error: {str(e)}'
        }


# Export for use in agent tool lists
__all__ = ['curl_request', 'curl_download']




