#!/usr/bin/env bash
# setup-caipe-cli.sh — clone, compile, and install the caipe CLI from source
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/cnoe-io/agent-chat-cli/main/setup-caipe-cli.sh)
#
# Run a command after install (e.g. chat):
#   bash <(curl -fsSL .../setup-caipe-cli.sh) -- chat
#
# Environment:
#   CAIPE_CLI_REPO       GitHub repo (default: cnoe-io/agent-chat-cli)
#   CAIPE_CLI_BRANCH     Branch to build (default: main)
#   CAIPE_CLI_DIR        Persistent clone directory (default: ~/.cache/caipe-cli-build/src)
#   CAIPE_INSTALL_DIR    Install binary here (default: ~/.local/bin)
#   CAIPE_SERVER_URL     If set, runs: caipe config set server.url <url>
#   CAIPE_SKIP_PULL      Set to 1 to skip git fetch on existing clone
#   BUN_INSTALL          Passed to Bun installer (default: $HOME/.bun)

set -euo pipefail

REPO="${CAIPE_CLI_REPO:-cnoe-io/agent-chat-cli}"
BRANCH="${CAIPE_CLI_BRANCH:-main}"
SRC_DIR="${CAIPE_CLI_DIR:-${HOME}/.cache/caipe-cli-build/src}"
INSTALL_DIR="${CAIPE_INSTALL_DIR:-${HOME}/.local/bin}"
BUN_INSTALL="${BUN_INSTALL:-${HOME}/.bun}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { printf "${CYAN}  >${NC} %s\n" "$*"; }
ok() { printf "${GREEN}  ✓${NC} %s\n" "$*"; }
die() { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x "${BUN_INSTALL}/bin/bun" ]]; then
    export PATH="${BUN_INSTALL}/bin:${PATH}"
    return 0
  fi
  need_cmd curl
  info "Installing Bun…"
  curl -fsSL https://bun.sh/install | bash
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  command -v bun >/dev/null 2>&1 || die "Bun install failed"
  ok "Bun installed"
}

detect_bun_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}:${arch}" in
    Darwin:arm64|Darwin:aarch64) echo "bun-darwin-arm64" ;;
    Darwin:x86_64)              echo "bun-darwin-x64" ;;
    Linux:arm64|Linux:aarch64)  echo "bun-linux-arm64" ;;
    Linux:x86_64|Linux:amd64)   echo "bun-linux-x64" ;;
    *) die "Unsupported platform: ${os} ${arch}" ;;
  esac
}

clone_or_update() {
  need_cmd git
  local url="https://github.com/${REPO}.git"
  if [[ -d "${SRC_DIR}/.git" ]]; then
    info "Updating existing clone in ${SRC_DIR}…"
    git -C "${SRC_DIR}" fetch origin "${BRANCH}" --depth 1
    git -C "${SRC_DIR}" checkout "${BRANCH}"
    if [[ "${CAIPE_SKIP_PULL:-0}" != "1" ]]; then
      git -C "${SRC_DIR}" reset --hard "origin/${BRANCH}"
    fi
  else
    info "Cloning ${REPO}@${BRANCH}…"
    mkdir -p "$(dirname "${SRC_DIR}")"
    git clone --depth 1 --branch "${BRANCH}" "${url}" "${SRC_DIR}"
  fi
  ok "Source ready at ${SRC_DIR}"
}

compile_cli() {
  local target outfile
  target="$(detect_bun_target)"
  outfile="dist/caipe"
  info "Installing npm dependencies…"
  (cd "${SRC_DIR}" && bun install --frozen-lockfile)
  info "Building native keytar (optional OS keychain)…"
  (cd "${SRC_DIR}" && npm rebuild keytar 2>/dev/null) || true
  info "Compiling caipe (${target})…"
  (cd "${SRC_DIR}" && bun build src/index.ts --compile --target="${target}" --outfile="${outfile}")
  if [[ "$(uname -s)" == "Darwin" ]]; then
    (cd "${SRC_DIR}" && codesign --remove-signature "${outfile}" 2>/dev/null || true)
    (cd "${SRC_DIR}" && codesign --sign - --force --entitlements entitlements.plist "${outfile}")
  fi
  ok "Binary: ${SRC_DIR}/${outfile}"
}

install_binary() {
  mkdir -p "${INSTALL_DIR}"
  install -m 755 "${SRC_DIR}/dist/caipe" "${INSTALL_DIR}/caipe"
  ok "Installed ${INSTALL_DIR}/caipe"
  if ! command -v caipe >/dev/null 2>&1; then
    case ":${PATH}:" in
      *":${INSTALL_DIR}:"*) ;;
      *)
        printf "\n  Add to PATH:  export PATH=\"%s:\$PATH\"\n\n" "${INSTALL_DIR}"
        ;;
    esac
  fi
}

maybe_configure_server() {
  if [[ -z "${CAIPE_SERVER_URL:-}" ]]; then
    return 0
  fi
  info "Setting server.url to ${CAIPE_SERVER_URL}…"
  "${INSTALL_DIR}/caipe" config set server.url "${CAIPE_SERVER_URL}"
}

run_caipe() {
  export PATH="${INSTALL_DIR}:${PATH}"
  if [[ $# -gt 0 ]]; then
    if [[ "$1" == "--" ]]; then
      shift
    fi
    exec caipe "$@"
  fi
}

main() {
  printf '\n%s  caipe CLI — build from source%s\n\n' "${CYAN}" "${NC}"
  ensure_bun
  clone_or_update
  compile_cli
  install_binary
  maybe_configure_server
  ok "Done"
  printf '\nNext steps:\n'
  printf '  caipe config set server.url https://your-grid-host.example.com\n'
  printf '  caipe auth login\n'
  printf '  caipe chat\n\n'
  run_caipe "$@"
}

main "$@"
