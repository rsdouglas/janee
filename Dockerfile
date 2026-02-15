# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./
COPY packages/openclaw-plugin/package.json ./packages/openclaw-plugin/

# Install all dependencies (including devDependencies for build)
RUN rm -f package-lock.json && npm install

# Copy source code and workspace packages
COPY tsconfig.json ./
COPY src/ ./src/
COPY packages/ ./packages/
COPY SKILL.md ./

# Build TypeScript (main + workspaces)
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY packages/openclaw-plugin/package.json ./packages/openclaw-plugin/

# Install only production dependencies
RUN rm -f package-lock.json && npm install --omit=dev && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages/openclaw-plugin/dist ./packages/openclaw-plugin/dist
COPY SKILL.md ./
COPY scripts/ ./scripts/

# Create config and data directories
RUN mkdir -p /root/.janee /data

# Default config directory
ENV JANEE_CONFIG_DIR=/root/.janee
ENV NODE_ENV=production

# Expose HTTP transport port
EXPOSE 3000

# Health check for HTTP mode
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health 2>/dev/null || exit 0

# Default: start MCP server in stdio mode
# Override with --transport http --port 3000 for HTTP mode
ENTRYPOINT ["node", "dist/cli/index.js", "serve"]
CMD ["--transport", "stdio"]
