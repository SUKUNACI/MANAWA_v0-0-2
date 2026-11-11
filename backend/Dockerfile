# Multi-stage build for Node.js backend
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Generate Prisma client
RUN npx prisma generate

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.prisma ./.prisma

# Copy application code
COPY . .

# Create directories for logs and uploads
RUN mkdir -p logs uploads && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD curl -f http://localhost:${PORT:-4000}/api/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["/sbin/dumb-init", "--"]

# Start application
CMD ["node", "index.js"]

# Expose port
EXPOSE 4000
