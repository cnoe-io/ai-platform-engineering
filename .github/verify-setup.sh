#!/bin/bash

# Verification script for GitHub Action setup
# Checks if all required files and configurations are in place

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  GitHub Action Setup Verification                           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to print check result
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((CHECKS_PASSED++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((CHECKS_FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

# Check 1: Workflow file exists
echo -e "${BLUE}[Check 1]${NC} Checking workflow file..."
if [ -f ".github/workflows/build-agent-forge-plugin.yml" ]; then
    check_pass "Workflow file exists"
else
    check_fail "Workflow file not found at .github/workflows/build-agent-forge-plugin.yml"
fi
echo ""

# Check 2: Workflow syntax
echo -e "${BLUE}[Check 2]${NC} Validating workflow syntax..."
if command -v yamllint &> /dev/null; then
    if yamllint -d relaxed .github/workflows/build-agent-forge-plugin.yml &> /dev/null; then
        check_pass "YAML syntax is valid"
    else
        check_warn "YAML syntax check failed (may be false positive)"
    fi
else
    check_warn "yamllint not installed, skipping syntax check"
fi
echo ""

# Check 3: Documentation files
echo -e "${BLUE}[Check 3]${NC} Checking documentation..."
if [ -f ".github/workflows/README.md" ]; then
    check_pass "Workflow README exists"
else
    check_warn "Workflow README not found"
fi

if [ -f ".github/WORKFLOW_SETUP.md" ]; then
    check_pass "Setup documentation exists"
else
    check_warn "Setup documentation not found"
fi
echo ""

# Check 4: Test script
echo -e "${BLUE}[Check 4]${NC} Checking test utilities..."
if [ -f ".github/test-build-locally.sh" ]; then
    check_pass "Local build test script exists"
    if [ -x ".github/test-build-locally.sh" ]; then
        check_pass "Test script is executable"
    else
        check_warn "Test script is not executable (run: chmod +x .github/test-build-locally.sh)"
    fi
else
    check_warn "Local build test script not found"
fi
echo ""

# Check 5: Git repository status
echo -e "${BLUE}[Check 5]${NC} Checking Git repository..."
if git rev-parse --git-dir > /dev/null 2>&1; then
    check_pass "Inside a Git repository"
    
    # Check if there's a remote
    if git remote -v | grep -q "origin"; then
        check_pass "Git remote 'origin' configured"
        REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "unknown")
        echo -e "  Remote URL: ${YELLOW}$REMOTE_URL${NC}"
    else
        check_warn "No Git remote configured. Add one with: git remote add origin <url>"
    fi
else
    check_warn "Not inside a Git repository"
fi
echo ""

# Check 6: Docker availability
echo -e "${BLUE}[Check 6]${NC} Checking Docker availability..."
if command -v docker &> /dev/null; then
    check_pass "Docker is installed"
    DOCKER_VERSION=$(docker --version | awk '{print $3}' | tr -d ',')
    echo -e "  Docker version: ${YELLOW}$DOCKER_VERSION${NC}"
    
    # Check if Docker daemon is running
    if docker info &> /dev/null; then
        check_pass "Docker daemon is running"
    else
        check_warn "Docker daemon is not running"
    fi
else
    check_warn "Docker is not installed (needed for local testing)"
fi
echo ""

# Check 7: Node.js and Yarn
echo -e "${BLUE}[Check 7]${NC} Checking build dependencies..."
if command -v node &> /dev/null; then
    check_pass "Node.js is installed"
    NODE_VERSION=$(node --version)
    echo -e "  Node.js version: ${YELLOW}$NODE_VERSION${NC}"
else
    check_warn "Node.js not installed (needed for local testing)"
fi

if command -v yarn &> /dev/null; then
    check_pass "Yarn is installed"
    YARN_VERSION=$(yarn --version)
    echo -e "  Yarn version: ${YELLOW}$YARN_VERSION${NC}"
else
    check_warn "Yarn not installed (needed for local testing)"
fi
echo ""

# Check 8: Workflow configuration details
echo -e "${BLUE}[Check 8]${NC} Validating workflow configuration..."
if [ -f ".github/workflows/build-agent-forge-plugin.yml" ]; then
    # Check for repository reference
    if grep -q "repository: cnoe-io/community-plugins" .github/workflows/build-agent-forge-plugin.yml; then
        check_pass "Source repository configured correctly"
    else
        check_fail "Source repository not found in workflow"
    fi
    
    # Check for branch reference
    if grep -q "ref: agent-forge-upstream-docker" .github/workflows/build-agent-forge-plugin.yml; then
        check_pass "Source branch configured correctly"
    else
        check_fail "Source branch not found in workflow"
    fi
    
    # Check for image name
    if grep -q "cnoe-io/backstage-plugin-agent-forge" .github/workflows/build-agent-forge-plugin.yml; then
        check_pass "Docker image name configured correctly"
    else
        check_fail "Docker image name not found in workflow"
    fi
fi
echo ""

# Check 9: GitHub CLI (optional)
echo -e "${BLUE}[Check 9]${NC} Checking GitHub CLI..."
if command -v gh &> /dev/null; then
    check_pass "GitHub CLI is installed"
    
    # Check authentication
    if gh auth status &> /dev/null; then
        check_pass "GitHub CLI is authenticated"
    else
        check_warn "GitHub CLI not authenticated (run: gh auth login)"
    fi
else
    check_warn "GitHub CLI not installed (optional, useful for managing workflows)"
fi
echo ""

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Verification Summary                                        ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}  Passed:   $CHECKS_PASSED${NC}"
echo -e "${YELLOW}  Warnings: $WARNINGS${NC}"
echo -e "${RED}  Failed:   $CHECKS_FAILED${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Recommendations
if [ $CHECKS_FAILED -gt 0 ]; then
    echo -e "${RED}Action Required:${NC}"
    echo -e "  Some critical checks failed. Please fix the issues above."
    echo ""
fi

if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Recommendations:${NC}"
    if ! command -v docker &> /dev/null; then
        echo -e "  • Install Docker to test builds locally"
    fi
    if ! command -v gh &> /dev/null; then
        echo -e "  • Install GitHub CLI for easier workflow management: https://cli.github.com"
    fi
    echo ""
fi

echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo -e "1. ${GREEN}Commit the workflow files:${NC}"
echo -e "   git add .github/"
echo -e "   git commit -m \"Add GitHub Action for building Agent Forge plugin\""
echo ""
echo -e "2. ${GREEN}Push to GitHub:${NC}"
echo -e "   git push origin main"
echo ""
echo -e "3. ${GREEN}Enable GitHub Actions:${NC}"
echo -e "   Visit: https://github.com/<owner>/<repo>/settings/actions"
echo -e "   Enable workflow permissions (read and write)"
echo ""
echo -e "4. ${GREEN}Test locally (optional):${NC}"
echo -e "   ./.github/test-build-locally.sh"
echo ""
echo -e "5. ${GREEN}Monitor workflow execution:${NC}"
echo -e "   https://github.com/<owner>/<repo>/actions"
echo ""

# Exit with appropriate code
if [ $CHECKS_FAILED -gt 0 ]; then
    exit 1
else
    exit 0
fi


