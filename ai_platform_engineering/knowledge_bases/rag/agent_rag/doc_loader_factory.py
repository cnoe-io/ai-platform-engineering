from typing import Any
from langchain_community.document_loaders import (
    PyPDFLoader,
    TextLoader,
    UnstructuredHTMLLoader,
    S3DirectoryLoader,
    CSVLoader,
    WebBaseLoader,
    DirectoryLoader,
)

class DocumentLoaderFactory:
    """Factory for creating LangChain-compatible document loaders based on type."""

    @staticmethod
    def create_loader(loader_type: str, **kwargs) -> Any:
        """
        Create a document loader instance.

        Args:
            loader_type (str): Type of the loader (e.g., 'pdf', 'html', 's3').
            **kwargs: Additional arguments for the loader.

        Returns:
            An instance of a document loader.
        """
        loader_type = loader_type.lower()

        if loader_type == "pdf":
            file_path = kwargs.get("file_path")
            return PyPDFLoader(file_path)

        elif loader_type == "text":
            file_path = kwargs.get("file_path")
            return TextLoader(file_path)

        elif loader_type == "html":
            file_path = kwargs.get("file_path")
            return UnstructuredHTMLLoader(file_path)

        elif loader_type == "csv":
            file_path = kwargs.get("file_path")
            return CSVLoader(file_path)

        elif loader_type == "s3":
            bucket = kwargs.get("bucket")
            prefix = kwargs.get("prefix", "")
            return S3DirectoryLoader(bucket, prefix=prefix)

        elif loader_type == "url":
            web_path = kwargs.get("web_path")
            return WebBaseLoader(web_path)

        elif loader_type == "dir":
            directory_path = kwargs.get("directory_path")
            return DirectoryLoader(directory_path)

        else:
            raise ValueError(f"Unsupported loader type: {loader_type}")
