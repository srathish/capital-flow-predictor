# Read-only Discord listener — runs as its own Railway service.
# Kept deliberately tiny: pip-installs discord.py-self + asyncpg, copies the
# package, runs the module. No multi-stage build needed (no compiled deps).

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install deps via the pyproject so the version constraints stay in one place.
COPY apps/discord_listener/pyproject.toml /app/pyproject.toml
COPY apps/discord_listener/src /app/src

# Editable install so the package is importable as ``discord_listener``.
RUN pip install .

CMD ["python", "-m", "discord_listener.main"]
