# Common Package

This package provides a shared foundation for various components within the RAG system. It contains core data models, constants, and utility functions that ensure consistency and streamline development across the application.

## Overview

The `common` package serves as a central library to reduce code duplication and establish clear data contracts for the RAG system. Its key responsibilities include:

- **Data Modeling**: Defines Pydantic models for graph entities e.g. `Entity` and `Relation`, as well as data structures for other components.

- **Shared Constants**: Centralizes constant values for database property keys, preventing inconsistencies when interacting with stored data.

- **Core Utilities**: Offers a collection of helper functions for common tasks such as logging, asynchronous operations, data hashing, and object manipulation.
