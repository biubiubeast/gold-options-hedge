FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# The bundled server still imports Vite's production static-serving helpers.
# Keep the installed build-time packages in the runtime image so that import
# remains available after the build.

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "dist/index.js"]
