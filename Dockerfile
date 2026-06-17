FROM node:22-alpine

# python3 is required by pty_bridge.py for local shell mode
RUN apk add --no-cache python3

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY . .

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["node", "server.js"]
