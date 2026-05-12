FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# uv from the official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Copy the workspace structure needed to install cfp-api + its workspace deps
# (cfp-jobs transitively pulls in cfp-shared, cfp-features, cfp-models, cfp-agents).
COPY pyproject.toml uv.lock /app/
COPY packages /app/packages
COPY apps/api /app/apps/api
COPY apps/jobs /app/apps/jobs
# Schema migrations applied at startup by cfp_api.migrations.
COPY infra/migrations /app/infra/migrations

# Install the workspace; --no-dev skips test + lint extras.
RUN uv sync --frozen --no-dev --package cfp-api

# Make the workspace's venv the default Python env for runtime.
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
CMD ["uvicorn", "cfp_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
