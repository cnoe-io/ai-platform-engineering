#!/usr/bin/env sh
# install.sh — CAIPE CLI installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh
#
# Options (environment variables):
#   CAIPE_INSTALL_DIR   — override install directory (default: /usr/local/bin)
#   CAIPE_VERSION       — pin a specific version (default: latest)
#   CAIPE_NO_VERIFY     — set to 1 to skip checksum verification (not recommended)
#
# Supports: Linux and macOS on arm64 and x64.

set -e

REPO="cnoe-io/ai-platform-engineering"
INSTALL_DIR="${CAIPE_INSTALL_DIR:-/usr/local/bin}"
VERSION="${CAIPE_VERSION:-}"
NO_VERIFY="${CAIPE_NO_VERIFY:-0}"

# ── helpers ───────────────────────────────────────────────────────────────────

die() { printf '\033[31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m  >\033[0m %s\n' "$*"; }
ok() { printf '\033[32m  ✓\033[0m %s\n' "$*"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Required command not found: $1"
  fi
}

# ── detect platform ───────────────────────────────────────────────────────────

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) OS_NAME="darwin" ;;
    Linux)  OS_NAME="linux" ;;
    *)      die "Unsupported OS: $OS. Only macOS and Linux are supported." ;;
  esac

  case "$ARCH" in
    arm64|aarch64) ARCH_NAME="arm64" ;;
    x86_64|amd64)  ARCH_NAME="x64" ;;
    *)             die "Unsupported architecture: $ARCH. Only arm64 and x64 are supported." ;;
  esac

  PLATFORM="${OS_NAME}-${ARCH_NAME}"
}

# ── resolve latest version ────────────────────────────────────────────────────

resolve_version() {
  if [ -n "$VERSION" ]; then
    info "Using pinned version: $VERSION"
    return
  fi

  info "Resolving latest release…"
  need_cmd curl

  # GitHub API: get latest tag matching caipe/v*
  LATEST=$(curl -fsSL \
    "https://api.github.com/repos/${REPO}/releases" \
    | grep '"tag_name"' \
    | grep '"caipe/v' \
    | head -1 \
    | sed 's/.*"caipe\/\(v[^"]*\)".*/\1/')

  if [ -z "$LATEST" ]; then
    die "Could not determine latest caipe release. Set CAIPE_VERSION to install a specific version."
  fi

  VERSION="$LATEST"
  info "Latest version: $VERSION"
}

# ── download and verify ───────────────────────────────────────────────────────

download_binary() {
  BINARY_NAME="caipe-${PLATFORM}"
  TAG="caipe/${VERSION}"
  BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
  BINARY_URL="${BASE_URL}/${BINARY_NAME}"
  CHECKSUMS_URL="${BASE_URL}/caipe-checksums.txt"

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  info "Downloading caipe ${VERSION} for ${PLATFORM}…"
  need_cmd curl

  curl -fsSL -o "${TMP_DIR}/${BINARY_NAME}" "${BINARY_URL}" \
    || die "Download failed. Check that version ${VERSION} exists for ${PLATFORM}."

  if [ "$NO_VERIFY" != "1" ]; then
    info "Verifying checksum…"
    curl -fsSL -o "${TMP_DIR}/checksums.txt" "${CHECKSUMS_URL}" \
      || die "Could not fetch checksums. Use CAIPE_NO_VERIFY=1 to skip (not recommended)."

    # Extract the expected hash for this binary
    EXPECTED=$(grep "${BINARY_NAME}" "${TMP_DIR}/checksums.txt" | awk '{print $1}')
    if [ -z "$EXPECTED" ]; then
      die "No checksum found for ${BINARY_NAME} in checksums.txt."
    fi

    # Compute actual hash
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL=$(sha256sum "${TMP_DIR}/${BINARY_NAME}" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL=$(shasum -a 256 "${TMP_DIR}/${BINARY_NAME}" | awk '{print $1}')
    else
      die "sha256sum or shasum not found. Use CAIPE_NO_VERIFY=1 to skip verification."
    fi

    if [ "$ACTUAL" != "$EXPECTED" ]; then
      die "Checksum mismatch!\n  expected: $EXPECTED\n  actual:   $ACTUAL\nThis may indicate a network interception."
    fi
    ok "Checksum verified"
  else
    printf '\033[33m  ! Skipping checksum verification (CAIPE_NO_VERIFY=1)\033[0m\n'
  fi

  chmod +x "${TMP_DIR}/${BINARY_NAME}"
  DOWNLOADED_BINARY="${TMP_DIR}/${BINARY_NAME}"
}

# ── install ───────────────────────────────────────────────────────────────────

install_binary() {
  DEST="${INSTALL_DIR}/caipe"

  # Check if install dir is writable; offer sudo if not
  if [ ! -w "$INSTALL_DIR" ]; then
    info "Installing to ${INSTALL_DIR} requires elevated privileges…"
    if command -v sudo >/dev/null 2>&1; then
      sudo install -m 755 "${DOWNLOADED_BINARY}" "${DEST}"
    else
      die "Cannot write to ${INSTALL_DIR} and sudo is unavailable. " \
          "Set CAIPE_INSTALL_DIR to a writable directory (e.g. ~/.local/bin)."
    fi
  else
    install -m 755 "${DOWNLOADED_BINARY}" "${DEST}"
  fi

  ok "Installed caipe to ${DEST}"
}

# ── verify installation ───────────────────────────────────────────────────────

verify_install() {
  if ! command -v caipe >/dev/null 2>&1; then
    printf '\n\033[33m  ! caipe is not in your PATH.\033[0m\n'
    printf '    Add %s to your PATH:\n' "$INSTALL_DIR"
    printf '    export PATH="%s:$PATH"\n\n' "$INSTALL_DIR"
    return
  fi

  INSTALLED_VER=$(caipe --version 2>&1 | head -1)
  ok "caipe is ready: $INSTALLED_VER"
}

# ── main ──────────────────────────────────────────────────────────────────────

main() {
  printf '\n\033[36m  ██████╗ █████╗ ██╗██████╗ ███████╗\033[0m\n'
  printf '\033[36m ██╔════╝██╔══██╗██║██╔══██╗██╔════╝\033[0m\n'
  printf '\033[36m ██║     ███████║██║██████╔╝█████╗  \033[0m\n'
  printf '\033[36m ██║     ██╔══██║██║██╔═══╝ ██╔══╝  \033[0m\n'
  printf '\033[36m ╚██████╗██║  ██║██║██║     ███████╗\033[0m\n'
  printf '\033[36m  ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝\033[0m\n'
  printf '\n  AI-assisted coding, workflows, and platform engineering\n\n'

  detect_platform
  resolve_version
  download_binary
  install_binary
  verify_install

  printf '\n\033[32mInstallation complete!\033[0m\n'
  printf 'Get started:\n'
  printf '  caipe config set server.url https://your-caipe-server.example.com\n'
  printf '  caipe auth login\n'
  printf '  caipe chat\n\n'
}

main "$@"
