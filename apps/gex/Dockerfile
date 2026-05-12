FROM node:20-slim

# better-sqlite3 needs build tools (we install from source rather than rely on
# prebuilt binaries — slim image, lower chance of glibc mismatch surprises).
# Cleaned up in the same RUN to keep the layer small.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 1: package descriptors only. Lets Docker cache the install layer
# across code changes that don't touch package.json.
COPY apps/gex/package.json apps/gex/package-lock.json* /app/

# Use npm (not pnpm) here so the image build doesn't need pnpm bootstrap.
# The workspace dance is moot inside the container — we copy a single app.
# Skip dev deps for production; no scripts means no postinstall ambient state.
RUN npm install --omit=dev --no-fund --no-audit

# Layer 2: source. Excludes data/ (SQLite + JSONL archives) and node_modules.
COPY apps/gex/src /app/src
COPY apps/gex/scripts /app/scripts
COPY apps/gex/scanner /app/scanner
COPY apps/gex/config /app/config

# Persistent volume for SQLite + JSONL event archive. Set DATA_DIR=/data in
# Railway env so the poller writes to the mounted volume rather than the
# ephemeral container filesystem (which would lose all snapshot history on
# each redeploy).
ENV DATA_DIR=/data \
    NODE_ENV=production

# Default command — runs poller + scheduler + auth in one Node process.
# Override with DISABLE_SCHEDULER=1 if you ever want a poller-only deploy.
CMD ["node", "src/index.js"]
