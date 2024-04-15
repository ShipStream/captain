#### develop stage
FROM node:20-buster-slim as develop-stage
WORKDIR /app
RUN npm install -g pnpm@8.14.0 nodemon
ENV NODE_ENV=development
# network and process debugging tools
RUN apt-get update && apt install -y iproute2 iputils-ping procps dnsutils curl

# # Begin hashicorp consul installation
# # setup consul alongside captain server
# RUN apt-get update && apt install -y wget gpg
# RUN wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
# RUN echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com buster main" | tee /etc/apt/sources.list.d/hashicorp.list
# RUN apt update && apt install consul
# RUN mkdir -p /consul/data
# # RUN chown -R consul /consul
# # End hashicorp consul installation

# consul helper bins. Can be copied irrespective of whether the above 'consul' setup or not
COPY __simulation__/real-consul-app/bin/run-consul.sh /usr/local/bin
COPY __simulation__/real-consul-app/bin/stop-consul.sh /usr/local/bin
COPY __simulation__/real-consul-app/bin/consul-details.sh /usr/local/bin
RUN chmod +x /usr/local/bin/run-consul.sh /usr/local/bin/stop-consul.sh /usr/local/bin/consul-details.sh


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
