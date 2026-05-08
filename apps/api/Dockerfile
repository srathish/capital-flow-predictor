FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

COPY apps/api/pyproject.toml /app/pyproject.toml
RUN uv pip install --system --no-cache -r pyproject.toml

COPY apps/api/src /app/src
ENV PYTHONPATH=/app/src

EXPOSE 8000
CMD ["uvicorn", "cfp_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
