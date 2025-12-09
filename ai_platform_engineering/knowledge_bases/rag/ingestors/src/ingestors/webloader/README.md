# Webloader Ingestor

The Webloader ingestor is a specialized ingestor that crawls and ingests web pages and documentation sites into the RAG system. It supports sitemap parsing, automatic reloading, and concurrent URL processing.

## Overview

The Webloader operates differently from other ingestors:
- **Event-Driven**: Listens to Redis queue for ingestion requests from the RAG server
- **Concurrent Processing**: Handles multiple URL ingestion tasks simultaneously
- **Automatic Reloading**: Periodically re-ingests datasources to keep content fresh
- **Sitemap Support**: Can automatically discover and crawl URLs from sitemaps
- **Smart Scrapers**: Includes specialized scrapers for Docusaurus and MkDocs sites

## Architecture

The Webloader must run **alongside the RAG server** with access to the **same Redis instance**. The flow is:

1. User sends URL ingestion request to RAG server
2. Server creates datasource and job, then pushes request to Redis queue
3. Webloader picks up request from Redis queue
4. Webloader processes URL and ingests content
5. Webloader updates job status via Redis

## Required Environment Variables

- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)
- `REDIS_URL` - Redis connection URL (default: `redis://localhost:6379`)

## Optional Environment Variables

- `WEBLOADER_MAX_CONCURRENCY` - Max concurrent HTTP requests per ingestion (default: `10`)
- `WEBLOADER_MAX_INGESTION_TASKS` - Max concurrent ingestion tasks (default: `5`)
- `WEBLOADER_RELOAD_INTERVAL` - Auto-reload interval in seconds (default: `86400` = 24 hours)
- `LOG_LEVEL` - Logging level (default: `INFO`)

## Features

### 1. URL Ingestion
- Crawls web pages and extracts text content
- Chunks content for optimal retrieval
- Extracts metadata (title, description, etc.)
- Stores documents with source URL tracking

### 2. Sitemap Support
- Automatically checks for and parses sitemaps
- Supports both XML sitemaps and sitemap indexes
- Can limit maximum URLs to crawl from sitemap

### 3. Specialized Scrapers
- **Docusaurus**: Optimized for Docusaurus documentation sites
- **MkDocs**: Optimized for MkDocs documentation sites
- **Generic**: Falls back to generic HTML parsing for other sites

### 4. Automatic Reloading
- Periodically re-ingests all datasources
- Keeps content up-to-date automatically
- Can be triggered on-demand via Redis

### 5. Concurrent Processing
- Processes multiple URLs simultaneously
- Rate limiting to prevent overwhelming servers
- Task queue management with configurable limits

## Running with Docker Compose

The Webloader should be part of your main deployment and have access to the same Redis instance as the RAG server.

```bash
# The Webloader typically runs automatically with the main stack
docker compose up --build webloader
```

## Deployment Requirements

### Critical: Redis Access
The Webloader **MUST** have access to the same Redis instance as the RAG server. It uses Redis for:
- Receiving URL ingestion requests from the server
- Job status updates and progress tracking
- Coordinating with the RAG server

### Network Configuration
- Must be on the same network as the RAG server
- Must be able to reach Redis
- Needs outbound internet access to crawl URLs

## Commands

The Webloader responds to three types of commands via Redis:

1. **INGEST_URL**: Ingest a specific URL
2. **RELOAD_DATASOURCE**: Reload a specific datasource
3. **RELOAD_ALL**: Reload all datasources for this ingestor

These commands are sent by the RAG server API, not directly by users.

## Monitoring

Check logs for:
- URL ingestion progress
- Error messages for failed crawls
- Redis connection status
- Active task count

Example log output:
```
INFO: Starting Webloader Ingestor...
INFO: Starting Redis listener on redis://localhost:6379 queue: webloader_queue
INFO: Max concurrent ingestion tasks: 5
INFO: Received message from Redis: {...}
INFO: Processing URL ingestion request: https://example.com (active tasks: 1)
INFO: Completed URL ingestion for https://example.com
```

## Notes

- The Webloader is designed to be a singleton - run only one instance per RAG deployment
- URLs are processed asynchronously; use job APIs to track progress
- Failed URLs are logged and can be retried via reload commands
- The ingestor automatically manages task concurrency to prevent resource exhaustion
- Periodic reloads ensure documentation stays current without manual intervention

