FROM postgres:17.11-bookworm
# Install released PostGIS packages from the official PGDG repository in the base image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-postgis-3 postgresql-17-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*
# The official PostgreSQL entrypoint supports the postgres OS user. Make the
# non-root runtime explicit so image-policy scanners can enforce it.
USER postgres
