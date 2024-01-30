FROM node:20-buster-slim
# network and process debugging tools
RUN apt-get update && apt install -y iproute2 iputils-ping procps dnsutils curl
WORKDIR /app
COPY . /app
# this is common node template.
# source (src) will be set dynamically in docker compose
RUN rm -rf src
RUN npm install -g pnpm@8.14.0 nodemon
ENV NODE_ENV=development
