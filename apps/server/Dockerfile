FROM python:3.13.15-slim-bookworm@sha256:ed86c82274b3c69b52fb5820f358f0bd7df0b603332063cb5c6e32bd220c3e6e
WORKDIR /opt/aift/apps/server
RUN pip install --no-cache-dir uv==0.11.28
COPY apps/server/pyproject.toml apps/server/uv.lock ./
RUN uv sync --frozen --no-dev
COPY apps/server/aift ./aift
COPY apps/server/migrations ./migrations
COPY apps/server/tools ./tools
COPY apps/server/alembic.ini ./alembic.ini
COPY packages/contracts/python /opt/aift/packages/contracts/python
COPY packages/contracts/schema /opt/aift/packages/contracts/schema
COPY packages/estimator/python /opt/aift/packages/estimator/python
COPY packages/estimator/data /opt/aift/packages/estimator/data
# aift/engine_adapter.py reads all three estimation configs and the EcoLogits catalog and retained
# upstream source (packaged_definition, _native_source_data). Without them every figure view failed.
COPY config/estimation.build.json config/estimation.mappings.json config/estimation.media.json /opt/aift/config/
COPY packages/ecologits-core/data /opt/aift/packages/ecologits-core/data
COPY packages/ecologits-core/upstream /opt/aift/packages/ecologits-core/upstream
ENV PYTHONPATH=/opt/aift/packages/contracts/python:/opt/aift/packages/estimator/python
RUN useradd --system --uid 10001 aift && mkdir -p /var/log/aift && chown 10001 /var/log/aift
USER 10001
# API worker processes (uvicorn reads WEB_CONCURRENCY when --workers is not given). One process
# serves every request under one interpreter lock, so a slow summary held up sign-ins, uploads and
# health checks. Four of the box's eight cores leave room for PostgreSQL, the maintenance worker
# and the other applications on the same server. aift/db.py sizes each process's database pool
# so all processes stay under PostgreSQL's connection limit; change both together.
ENV WEB_CONCURRENCY=4
EXPOSE 8000
# The keep-alive timeout is longer than nginx keeps idle upstream connections (60 s), so nginx
# never reuses a connection uvicorn has just closed.
CMD [".venv/bin/uvicorn", "aift.main:production_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--timeout-keep-alive", "75"]
