# Build once from the admitted controller, qualify it, then configure its GHCR
# digest. Release workflows refuse mutable tags. This image contains no secrets.
FROM node:24.18.0-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 git postgresql postgresql-client libpq-dev \
    && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm exec --yes --package=playwright@1.62.1 -- playwright install --with-deps chromium chrome \
    && chmod -R a+rX /ms-playwright
RUN npm install --global vercel@54.20.1
RUN groupadd --gid 1001 fcos-checks && useradd --uid 1001 --gid 1001 --no-create-home fcos-checks
USER 1001:1001
WORKDIR /candidate
