FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000 APPROVALS_FILE=/data/approvals.json

COPY package.json ./
COPY src ./src

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/server.js"]
