FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
