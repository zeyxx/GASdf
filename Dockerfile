# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Native deps for bigint-buffer (solana web3.js transitive dep)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source
COPY . .

# Production stage
FROM node:18-alpine

WORKDIR /app

# Native build tools + dumb-init for signal handling
RUN apk add --no-cache dumb-init python3 make g++

# Create non-root user
RUN addgroup -g 1001 -S gasdf && \
    adduser -S gasdf -u 1001 -G gasdf

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Remove build tools after install to keep image smaller
RUN apk del python3 make g++

# Copy application code from builder
COPY --from=builder /app/src ./src

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
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/v1/health || exit 1

# Start with dumb-init for signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
