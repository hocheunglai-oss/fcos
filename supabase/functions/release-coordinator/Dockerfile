# Build context is the FCOS repository root. This image receives no application/provider secrets.
FROM node:24.18.0-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force
COPY config/fcosConnections.js ./config/fcosConnections.js
COPY supabase/functions/release-coordinator ./supabase/functions/release-coordinator
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "supabase/functions/release-coordinator/server.mjs"]
