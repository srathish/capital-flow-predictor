# Phase C — UW WebSocket subscriber. Long-running async process that
# holds 5 outbound WebSocket connections + a periodic news poller.
# No HTTP server; Railway treats process-alive as liveness.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY apps/uw_socket/pyproject.toml /app/pyproject.toml
COPY apps/uw_socket/src /app/src

RUN pip install .

CMD ["python", "-m", "cfp_uw_socket.main"]
