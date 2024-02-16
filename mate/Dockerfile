#### develop stage
FROM node:20-buster-slim as develop-stage
WORKDIR /app
RUN npm install -g pnpm@8.14.0 nodemon
ENV NODE_ENV=development
# network and process debugging tools
RUN apt-get update && apt install -y iproute2 iputils-ping procps dnsutils curl

#### production stage
FROM node:20-alpine as production-stage
ARG SENTRY_RELEASE
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV DD_SERVICE=my-service
ENV DD_VERSION=$SENTRY_RELEASE
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
RUN pnpm run build
CMD ["node", "dist/index.js"]
