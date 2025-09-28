# Docker Deployment Guide

## Overview

The ShopMaze backend can be deployed using Docker in several configurations to accommodate different deployment needs and scaling requirements.

## Container Architecture

The updated Docker configuration supports both WebSocket and HTTP servers with flexible deployment options:

- **Single Container**: Both servers running in one container (default)
- **Separate Containers**: WebSocket and HTTP servers in separate containers
- **Scalable Deployment**: Multiple instances of each service type

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Start both servers in a single container
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Using Docker CLI

```bash
# Build the image
docker build -t shopmaze-backend .

# Run both servers (default)
docker run -p 8080:8080 -p 8099:8099 shopmaze-backend

# Run only WebSocket server
docker run -p 8080:8080 shopmaze-backend npm run start:ws

# Run only HTTP server
docker run -p 8099:8099 shopmaze-backend npm run start:http
```

## Build Script

Use the provided build script for consistent builds:

```bash
# Basic build
./containerconfig/build-backend.sh

# Build with custom tag
./containerconfig/build-backend.sh -t v2.0

# Build and push to registry
./containerconfig/build-backend.sh -r quay.io/myorg -t v2.0 -p
```

### Build Script Options

- `-t, --tag TAG`: Set image tag (default: latest)
- `-r, --registry REG`: Set registry prefix
- `-p, --push`: Push image after building
- `-h, --help`: Show help message

## Port Configuration

| Service | Default Port | Environment Variable | Description |
|---------|--------------|---------------------|-------------|
| WebSocket | 8080 | `WS_PORT` | Game control WebSocket server |
| HTTP API | 8099 | `HTTP_PORT` | REST API for leaderboard and health |

## Environment Variables

- `NODE_ENV`: Node.js environment (default: production)
- `WS_PORT`: WebSocket server port (default: 8080)
- `HTTP_PORT`: HTTP server port (default: 8099)

## Health Checks

The container includes built-in health checks:

```bash
# Docker health check (built-in)
docker run -p 8080:8080 -p 8099:8099 shopmaze-backend

# Custom health check command
docker run --health-cmd="node src/health-check.js || exit 1" \
           --health-interval=30s \
           --health-timeout=10s \
           --health-retries=3 \
           -p 8080:8080 -p 8099:8099 \
           shopmaze-backend
```

### Health Check Endpoints

- `GET /health`: Returns service status, uptime, and metrics

## Deployment Scenarios

### 1. Development Environment

Single container with both services:

```yaml
# docker-compose.yml
version: '3.8'
services:
  shopmaze-backend:
    build: .
    ports:
      - "8080:8080"
      - "8099:8099"
    environment:
      - NODE_ENV=development
```

### 2. Production Environment

Separate containers for scalability:

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  websocket:
    build: .
    command: ["npm", "run", "start:ws"]
    ports:
      - "8080:8080"
    deploy:
      replicas: 2
    
  http-api:
    build: .
    command: ["npm", "run", "start:http"]
    ports:
      - "8099:8099"
    deploy:
      replicas: 3
```

### 3. Kubernetes Deployment

Example Kubernetes manifests:

```yaml
# websocket-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shopmaze-websocket
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shopmaze-websocket
  template:
    spec:
      containers:
      - name: websocket
        image: shopmaze-backend:latest
        command: ["npm", "run", "start:ws"]
        ports:
        - containerPort: 8080
        env:
        - name: WS_PORT
          value: "8080"
```

## Monitoring and Logging

### Container Logs

```bash
# View live logs
docker logs -f <container_id>

# Docker Compose logs
docker-compose logs -f shopmaze-backend
```

### Health Monitoring

```bash
# Check health status
curl http://localhost:8099/health

# Monitor with watch
watch -n 5 curl -s http://localhost:8099/health | jq
```

## Troubleshooting

### Common Issues

1. **Port Conflicts**
   ```bash
   # Check for port usage
   netstat -tlnp | grep :8080
   lsof -i :8099
   ```

2. **Container Won't Start**
   ```bash
   # Check container logs
   docker logs <container_id>
   
   # Inspect container
   docker inspect <container_id>
   ```

3. **Health Check Failures**
   ```bash
   # Test health endpoint directly
   docker exec <container_id> node src/health-check.js
   
   # Or test the endpoint manually
   docker exec <container_id> node -e "
   const http = require('http');
   http.get('http://localhost:8099/health', (res) => {
     console.log('Status:', res.statusCode);
     res.on('data', d => process.stdout.write(d));
   }).on('error', console.error);
   "
   ```

### Debug Mode

Run container with interactive shell:

```bash
docker run -it --entrypoint /bin/bash shopmaze-backend
```

## Security Considerations

- Container runs as non-root user (UID 1001)
- Based on Red Hat UBI (Universal Base Image)
- Minimal attack surface with production dependencies only
- Health checks use internal endpoints only

## Performance Tuning

### Resource Limits

```yaml
services:
  shopmaze-backend:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### Node.js Optimization

```bash
# Set Node.js memory limit
docker run -e NODE_OPTIONS="--max-old-space-size=512" shopmaze-backend
```
