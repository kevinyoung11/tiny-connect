FROM node:22-alpine

# python3 is required by pty_bridge.py for local shell mode
RUN apk add --no-cache python3

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["node", "server.js"]
