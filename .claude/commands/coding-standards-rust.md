<!-- caipe-skill: claude/coding-standards-rust -->
---
name: coding-standards-rust
description: Apply Outshift Rust coding standards to a Rust project. Use when a user asks to set up rustfmt, clippy, configure code style, add pre-commit hooks, or ensure their Rust project meets Outshift coding conventions.
---

# Rust Coding Standards

Enforce consistent Rust code style and quality in Outshift services using
the standard Rust toolchain: `rustfmt` (formatter) and `clippy` (linter).

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Rust edition**: 2021 (default) or 2024?
2. **Async runtime**: `tokio`, `async-std`, or none?
3. **Error handling library**: `anyhow`, `thiserror`, or stdlib?
4. **Pre-commit hooks**: Set them up?
5. **Build script path**: `build/lint.sh` or `scripts/lint.sh`?

### Step 2 — Create config files

### Step 3 — Wire into CI via `build/lint.sh`

---

## `rustfmt.toml`

```toml
edition = "2021"
max_width = 120
tab_spaces = 4
newline_style = "Unix"
use_small_heuristics = "Default"
reorder_imports = true
reorder_modules = true
imports_granularity = "Crate"
group_imports = "StdExternalCrate"
```

---

## `clippy.toml` (optional)

```toml
# Warn on integer arithmetic that could overflow
arithmetic_side_effects = "warn"
# Maximum allowed cognitive complexity
cognitive-complexity-threshold = 20
```

---

## `.cargo/config.toml`

```toml
[build]
# Faster linking with lld (Linux)
# rustflags = ["-C", "link-arg=-fuse-ld=lld"]

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true        # strip debug symbols for smaller binaries
```

---

## `build/lint.sh`

```bash
#!/bin/bash -e

# Format check
cargo fmt --all -- --check

# Clippy (deny warnings in CI)
cargo clippy --all-targets --all-features -- -D warnings
```

---

## `build/unit-test.sh`

```bash
#!/bin/bash -e

cargo test --all-features
```

With coverage (requires `cargo-tarpaulin`):

```bash
#!/bin/bash -e

cargo tarpaulin --out Lcov --output-dir coverage/
```

---

## `Makefile`

```makefile
.PHONY: all build test lint fmt clean

all: fmt lint test build

build:
	cargo build --release

test:
	cargo test --all-features

lint:
	cargo fmt --all -- --check
	cargo clippy --all-targets --all-features -- -D warnings

fmt:
	cargo fmt --all

clean:
	cargo clean
```

---

## Pre-commit hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/doublify/pre-commit-rust
    rev: v1.0
    hooks:
      - id: fmt
      - id: cargo-check
      - id: clippy

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-merge-conflict
      - id: check-added-large-files
```

---

## Directory layout conventions

```
<service>/
├── src/
│   ├── main.rs            # entry point (binary)
│   ├── lib.rs             # library root (if lib crate)
│   ├── config.rs
│   ├── handlers/
│   │   └── mod.rs
│   └── models/
│       └── mod.rs
├── tests/
│   └── integration_test.rs
├── build/
│   ├── Dockerfile
│   ├── lint.sh
│   └── unit-test.sh
├── Cargo.toml
├── Cargo.lock             # commit for binaries, gitignore for libraries
├── rustfmt.toml
├── clippy.toml
└── Makefile
```

---

## `Cargo.toml` conventions

```toml
[package]
name = "my-service"
version = "0.1.0"
edition = "2021"
authors = ["Outshift SRE <eti-sre@cisco.com>"]
license = "Apache-2.0"

[dependencies]
tokio = { version = "1", features = ["full"] }
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
tokio-test = "0.4"
```

---

## Naming conventions

| Element | Convention | Example |
|---------|------------|---------|
| Crates / modules | `snake_case` | `my_service`, `health_check` |
| Types / traits / enums | `PascalCase` | `HealthChecker`, `AppError` |
| Functions / variables | `snake_case` | `check_status()`, `max_retries` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_CONNECTIONS` |
| Lifetimes | short lowercase | `'a`, `'buf` |
| Enum variants | `PascalCase` | `NotFound`, `InternalError` |

---

## Code quality rules

- **Line length**: 120 characters max (matches `rustfmt.toml`).
- **Error handling**: Use `thiserror` for library errors, `anyhow` for application errors.
  Never `.unwrap()` in production code — use `?` or explicit error handling.
- **Panics**: Avoid `panic!`, `unwrap()`, `expect()` outside of tests and startup validation.
  If startup validation must fail, use `expect("descriptive message")`.
- **Logging**: Use `tracing` (not `println!`). Structured spans for async context.
- **Secrets**: Never hardcode. Use environment variables or Vault-backed ExternalSecrets.
- **`unsafe`**: Require a `// SAFETY:` comment explaining the invariant being upheld.
- **Clippy**: All `clippy::pedantic` warnings should be reviewed; fix or `#[allow]` with comment.
- **`Cargo.lock`**: Commit for binary crates; add to `.gitignore` for library crates.
- **Dependencies**: Pin major versions. Audit regularly with `cargo audit`.

---

## Dockerfile (Rust)

Multi-stage build using Cisco hardened Debian base:

```dockerfile
FROM containers.cisco.com/sto-ccc-cloud9/hardened_debian:12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential pkg-config libssl-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Pre-build deps for layer caching
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm src/main.rs

COPY src/ ./src/
RUN touch src/main.rs && cargo build --release

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM containers.cisco.com/sto-ccc-cloud9/hardened_debian:12-slim AS run

RUN useradd -u 1001 app
COPY --from=builder --chown=app:app /app/target/release/my-service /usr/bin/my-service
USER app
EXPOSE 8080
ENTRYPOINT ["/usr/bin/my-service"]
```

---

## CI integration

```yaml
# .github/workflows/ci.yaml — inside checkout-unit-tests
      - name: Lint
        run: bash build/lint.sh

      - name: Unit Tests
        run: bash build/unit-test.sh
```

The `DEFAULT_CONTAINER_RUNNER` must have Rust installed, or add a setup step:

```yaml
      - name: Install Rust
        run: |
          curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
            sh -s -- -y --default-toolchain stable
          echo "$HOME/.cargo/bin" >> $GITHUB_PATH
```

---

## Checklist

- [ ] `rustfmt.toml` at repo root
- [ ] `Makefile` with `build`, `test`, `lint`, `fmt` targets
- [ ] `build/lint.sh` running `cargo fmt --check` and `cargo clippy -D warnings`
- [ ] `build/unit-test.sh` running `cargo test`
- [ ] `Cargo.lock` committed (binary) or gitignored (library)
- [ ] Pre-commit hooks installed
- [ ] `ci.yaml` calls `bash build/lint.sh` before unit tests
- [ ] No `.unwrap()` in production paths
- [ ] No hardcoded secrets
