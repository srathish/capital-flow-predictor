# Conviction Nest — resident market-clock daemon. Long-running process; no HTTP
# server, so Railway treats process-alive as liveness and restarts on hard crash.
#
# State lives in SQLite at NEST_HOME (default /data). MOUNT A PERSISTENT VOLUME at
# /data on Railway — the container filesystem is ephemeral and a redeploy would
# otherwise wipe the entire conviction memory. This is the one non-optional step.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NEST_HOME=/data

WORKDIR /app

COPY apps/nest/pyproject.toml /app/pyproject.toml
COPY apps/nest/src /app/src

RUN pip install . && mkdir -p /data

CMD ["python", "-m", "nest.cli", "run"]
