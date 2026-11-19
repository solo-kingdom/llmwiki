FROM node:24-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web-build /app/web/dist ./web/dist
COPY skills ./skills
EXPOSE 8868
# MCP over RPC requires a bearer token when binding to a non-loopback address.
# Enable it explicitly: docker run ... <image> serve --bind 0.0.0.0 --token <secret>
CMD ["node", "dist/cli/index.js", "serve", "--bind", "0.0.0.0", "--port", "8868", "--no-mcp"]
