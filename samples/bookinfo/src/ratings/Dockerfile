FROM node:21.6-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

ARG service_version
ENV SERVICE_VERSION=${service_version:-v1}

ENV REDIS_HOST=redis
ENV REDIS_PORT=6379

COPY package.json /opt/microservices/
COPY ratings.js /opt/microservices/
WORKDIR /opt/microservices
RUN npm install
RUN npm install redis

EXPOSE 9080
CMD ["node", "/opt/microservices/ratings.js", "9080"]

USER 1000