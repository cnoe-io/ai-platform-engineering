<!-- caipe-skill: claude/create-python-dockerfile -->
---
name: create-python-dockerfile
description: >
  Creates a production-ready Dockerfile for Python services using the Cisco
  hardened base image. Use when a user asks to create a Dockerfile for a Python
  app, containerize a Python service, or set up a Docker build for Python.
  Reference implementation: cisco-eti/platform-demo.
---

# Create Python Dockerfile

Generate a `build/Dockerfile` for Python services using the Cisco Outshift hardened
base image. Follows the `cisco-eti/platform-demo` reference pattern.

Reference: https://github.com/cisco-eti/platform-demo/blob/main/Dockerfile

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Python version**: 3.11 (default), 3.10, 3.12?
2. **App entry point**: e.g. `server.py`, `main.py`, `app.py`
3. **App source directory**: e.g. `app/src/`, `src/`, `.`
4. **Requirements file path**: e.g. `app/requirements.txt`, `requirements.txt`
5. **App port**: e.g. `5000`, `8080`
6. **Non-root user name**: default `app` (UID 1001)

### Step 2 — Generate the Dockerfile

Place at `build/Dockerfile` (or `Dockerfile` if the project uses root-level placement).

---

## Dockerfile Template

```dockerfile
FROM ghcr.io/cisco-eti/sre-python-docker:v3.11.9-hardened-debian-12

# Create non-root user
RUN useradd -u 1001 app

# Create app home directory
RUN mkdir /home/app/ && chown -R app:app /home/app

WORKDIR /home/app

USER app

# Copy and install dependencies first (layer cache optimization)
COPY --chown=app:app app/requirements.txt .
RUN pip3 install --user -r requirements.txt --break-system-packages

# Copy application source
COPY --chown=app:app app/src/ .

EXPOSE 5000

CMD ["python3", "server.py"]
```

---

## Base Image

| Python Version | Image Tag |
|----------------|-----------|
| 3.11 (default) | `ghcr.io/cisco-eti/sre-python-docker:v3.11.9-hardened-debian-12` |
| Other versions | Check `ghcr.io/cisco-eti/sre-python-docker` for available tags |

The hardened image is based on Debian 12 Slim with Cisco security hardening applied.
It is maintained by the Outshift SRE team.

**Do not use** `FROM python:*` or `FROM ubuntu:*` — those are not Cisco-approved for production.
**Do not use** `FROM containers.cisco.com/sto-ccc-cloud9/hardened_debian:12-slim` directly
for Python apps — use the pre-built `sre-python-docker` image instead, which already
has Python installed and configured.

---

## Security Conventions

- Always run as a **non-root user** (UID 1001). Create the user explicitly with `useradd`.
- Use `--chown=app:app` on all `COPY` instructions.
- Install dependencies as the app user to avoid root-owned files.
- `--break-system-packages` is required with Debian 12's pip isolation.

---

## Example: Flask API service

```dockerfile
FROM ghcr.io/cisco-eti/sre-python-docker:v3.11.9-hardened-debian-12

RUN useradd -u 1001 app
RUN mkdir /home/app/ && chown -R app:app /home/app
WORKDIR /home/app
USER app

COPY --chown=app:app requirements.txt .
RUN pip3 install --user -r requirements.txt --break-system-packages

COPY --chown=app:app src/ .

EXPOSE 8080

CMD ["python3", "main.py"]
```

---

## Wiring into CI

After generating the Dockerfile, ensure the CI pipeline references it:

```yaml
  call-docker-build-push:
    with:
      dockerfile: build/Dockerfile   # or Dockerfile if at root
```

If using `build/Dockerfile`, also ensure the build context is correct (default `.`).

---

## Guidelines

- Keep the Dockerfile minimal — don't install dev tools in the production image.
- Copy `requirements.txt` before copying source code to maximize layer caching.
- If the app needs system packages, install them before switching to the non-root user:
  ```dockerfile
  # As root (before USER app)
  RUN apt-get update && apt-get install -y --no-install-recommends <pkg> \
      && apt-get clean && rm -rf /var/lib/apt/lists/*
  USER app
  ```
