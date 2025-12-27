# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source
COPY . .

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S gasdf && \
    adduser -S gasdf -u 1001 -G gasdf

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/sdk ./sdk

# Set ownership
RUN chown -R gasdf:gasdf /app

# Switch to non-root user
USER gasdf

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start with dumb-init for signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
