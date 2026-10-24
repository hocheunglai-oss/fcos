# Build once from the admitted controller, qualify it, then configure its GHCR
# digest. Release workflows refuse mutable tags. This image contains no secrets.
FROM node:24.18.0-bookworm@sha256:4e9cb555d708e0829c9d93e5eeae9dfab0617b832ca436a690680e0fca735ef5
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 git zip unzip \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error --location https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && printf '%s\n' 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-17 postgresql-client-17 postgresql-server-dev-17 \
    && rm -rf /var/lib/apt/lists/*
# Select the versioned server-development pg_config, rather than a newer libpq
# client's pg_config. Native migration fixtures follow pg_config --bindir.
ENV PATH=/usr/lib/postgresql/17/bin:$PATH
RUN test "$(pg_config --bindir)" = /usr/lib/postgresql/17/bin \
    && pg_config --version | grep -E '^PostgreSQL 17\.' \
    && test "$(node --version)" = v24.18.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm exec --yes --package=playwright@1.62.1 -- playwright install --with-deps chromium chrome \
    && chmod -R a+rX /ms-playwright
RUN npm install --global vercel@54.20.1
RUN groupadd --gid 1001 fcos-checks && useradd --uid 1001 --gid 1001 --no-create-home fcos-checks
USER 1001:1001
WORKDIR /candidate
