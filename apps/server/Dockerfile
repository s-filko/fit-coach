FROM node:22-slim AS webapp-build
WORKDIR /webapp
COPY apps/webapp/package.json apps/webapp/package-lock.json apps/webapp/.npmrc ./
RUN npm ci
COPY apps/webapp/ ./
RUN npx tsc --noEmit && npx vite build --outDir dist

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends expect postgresql-client wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/server/src ./src
COPY apps/server/public ./public
COPY --from=webapp-build /webapp/dist ./public/webapp
COPY apps/server/tsconfig.json ./
COPY apps/server/drizzle ./drizzle
COPY apps/server/drizzle.config.ts ./
COPY apps/server/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ARG GIT_SHA=unknown
ARG APP_VERSION=0.0.0
ARG BUILD_TIME=unknown
ENV APP_GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_TIME=$BUILD_TIME

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
