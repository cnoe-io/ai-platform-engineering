# CAIPE UI Makefile
# Usage: make <target>

.PHONY: help install dev build start clean lint format check run setup test

# Default target - runs the full setup
.DEFAULT_GOAL := run

help:
	@echo "CAIPE UI - Available targets:"
	@echo ""
	@echo "  make install    - Install dependencies"
	@echo "  make dev        - Run development server (localhost:3000)"
	@echo "  make build      - Build for production"
	@echo "  make start      - Start production server"
	@echo "  make test       - Run Jest unit tests"
	@echo "  make clean      - Remove node_modules and .next"
	@echo "  make lint       - Run linter"
	@echo "  make format     - Format code with prettier"
	@echo "  make check      - Run type checking"
	@echo ""
	@echo "Quick start:"
	@echo "  make install dev"
	@echo ""

# Install dependencies
install:
	@echo "📦 Installing dependencies..."
	npm install

# Run development server
dev:
	@echo "🚀 Starting development server..."
	@echo "   URL: http://localhost:3000"
	npm run dev

# Build for production
build:
	@echo "🔨 Building for production..."
	npm run build

# Start production server
start:
	@echo "▶️  Starting production server..."
	npm run start

# Clean build artifacts
clean:
	@echo "🧹 Cleaning..."
	rm -rf node_modules .next out

# Run linter
lint:
	@echo "🔍 Running linter..."
	npm run lint

# Format code
format:
	@echo "✨ Formatting code..."
	npx prettier --write "src/**/*.{ts,tsx,css}"

# Type checking
check:
	@echo "📝 Running type check..."
	npx tsc --noEmit

# Run tests
test:
	@echo "🧪 Running Jest tests..."
	npm test

# Setup environment (creates .env.local if not exists)
setup:
	@if [ ! -f .env.local ]; then \
		echo "📝 Creating .env.local from env.example..."; \
		cp env.example .env.local; \
		echo "   Edit .env.local with your configuration"; \
	else \
		echo "✅ .env.local already exists"; \
	fi

# Full setup: install + setup env + dev
run: install setup dev
