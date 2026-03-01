FROM node:22-alpine
RUN apk add --no-cache expect
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY public ./public
COPY tsconfig.json ./
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ARG GIT_SHA=unknown
ARG APP_VERSION=0.0.0
ARG BUILD_TIME=unknown
ENV APP_GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_TIME=$BUILD_TIME

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
