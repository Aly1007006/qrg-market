FROM postgis/postgis:17-3.7
# The upstream PostGIS image builds the PostgreSQL server and extension as one
# compatible release. Installing a rolling PGDG extension into a separate
# PostgreSQL base image can produce a runtime symbol mismatch.
# The official PostgreSQL entrypoint supports the postgres OS user. Make the
# non-root runtime explicit so image-policy scanners can enforce it.
USER postgres
