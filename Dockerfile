# ---- Stage 1: Build Next.js app ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

ARG CACHE_BUST=1
COPY . .
RUN npm run build

# ---- Stage 2: Production runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
# Copy static files (public/) — .next/static AND full public/ dir
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3055
CMD ["node", "server.js"]
