# Onboard server image. Build from the repository root so the shared types are included:
#   docker compose up -d --build
FROM node:24.19.0-slim

WORKDIR /app

# Workspace manifests first, so dependency installs are cached between code changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false --include=dev --ignore-scripts

COPY shared/ shared/
COPY server/ server/

WORKDIR /app/server
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

EXPOSE 4000
USER node
CMD ["npx", "tsx", "src/index.ts"]
