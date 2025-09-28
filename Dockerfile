# ShopMaze Backend - WebSocket and HTTP Servers
# Base: Red Hat UBI Node.js image
FROM registry.redhat.io/ubi9/nodejs-18:latest

# Set working directory
WORKDIR /opt/app-root/src

# Copy package files and install dependencies
COPY --chown=1001:0 package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source code and documentation
COPY --chown=1001:0 src/ ./src/
COPY --chown=1001:0 config/ ./config/
COPY --chown=1001:0 docs/ ./docs/

# Expose both WebSocket and HTTP ports
EXPOSE 8080 8099

# Environment variables for configuration
ENV WS_PORT=8080
ENV HTTP_PORT=8099
ENV NODE_ENV=production

# Add health check for HTTP server using Node.js
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node src/health-check.js || exit 1

# Add labels for better container management
LABEL maintainer="ShopMaze Backend v2.0" \
      description="Backend WebSocket and HTTP servers for ShopMaze game" \
      version="2.0" \
      port.websocket="8080" \
      port.http="8099" \
      services="websocket,http"

# Switch to non-root user
USER 1001

# Default: Start both servers using process manager
# Can be overridden with docker run --entrypoint or CMD
CMD ["npm", "run", "start:both"]

