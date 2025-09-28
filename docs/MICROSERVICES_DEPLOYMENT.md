# Microservices Deployment Guide

This document explains how to deploy the ShopMaze backend as separate microservices using Docker and OpenShift.

## Architecture Overview

The ShopMaze backend has been architected to support both monolithic and microservices deployment patterns:

```
┌─────────────────────────────────────────────────────────────┐
│                    ShopMaze Backend                         │
├─────────────────────────────────────────────────────────────┤
│  Monolithic Deployment (Original)                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Single Container                                   │   │
│  │  ┌─────────────────┐  ┌─────────────────────────┐  │   │
│  │  │ WebSocket Server│  │    HTTP Server          │  │   │
│  │  │ Port: 8080      │  │    Port: 8099           │  │   │
│  │  │ Game Control    │  │    Leaderboard API      │  │   │
│  │  └─────────────────┘  └─────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Microservices Deployment (New)                            │
│  ┌──────────────────────┐  ┌──────────────────────────┐   │
│  │  WebSocket Service   │  │     HTTP Service         │   │
│  │  ┌─────────────────┐ │  │  ┌─────────────────────┐ │   │
│  │  │ WebSocket Server│ │  │  │    HTTP Server      │ │   │
│  │  │ Port: 8080      │ │  │  │    Port: 8099       │ │   │
│  │  │ Game Control    │ │  │  │    Leaderboard API  │ │   │
│  │  └─────────────────┘ │  │  └─────────────────────┘ │   │
│  └──────────────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Options

### 1. Monolithic Deployment (Default)

Use the original `Dockerfile` and deployment configuration:

```bash
# Build single container
podman build -t shopmaze-backend .

# Run with both services
podman run -p 8080:8080 -p 8099:8099 shopmaze-backend

# Docker Compose
docker-compose up
```

### 2. Microservices Deployment

Use the new separate Dockerfiles and configurations:

```bash
# Build separate containers
./containerconfig/build-all.sh -t v1.0

# Run separately
podman run -p 8080:8080 shopmaze-websocket:v1.0
podman run -p 8099:8099 shopmaze-http:v1.0

# Docker Compose (separate services)
docker-compose -f docker-compose.separate.yml up
```

## Container Images

### Base Images
All containers use Red Hat Universal Base Image (UBI) 9 with Node.js 18:
- `registry.redhat.io/ubi9/nodejs-18:latest`

### Built Images

| Service | Dockerfile | Image Name | Ports | Purpose |
|---------|------------|------------|-------|---------|
| HTTP | `Dockerfile.http` | `shopmaze-http` | 8099 | REST API, Leaderboard |
| WebSocket | `Dockerfile.websocket` | `shopmaze-websocket` | 8080 | Game Control, Real-time |
| Combined | `Dockerfile` | `shopmaze-backend` | 8080, 8099 | Both services |

## Build Scripts

### Individual Service Builds

```bash
# HTTP service only
./containerconfig/build-http.sh -t v1.0 -r quay.io/myorg -p

# WebSocket service only  
./containerconfig/build-websocket.sh -t v1.0 -r quay.io/myorg -p
```

### Combined Build

```bash
# Build both services
./containerconfig/build-all.sh -t v1.0 -r quay.io/myorg -p

# Build only HTTP service
./containerconfig/build-all.sh --http-only -t v1.0

# Build only WebSocket service
./containerconfig/build-all.sh --websocket-only -t v1.0
```

## Docker Compose Configurations

### Standard Deployment
File: `docker-compose.yml`
- Supports both monolithic and microservices
- Use profiles to switch between modes

```bash
# Monolithic (default)
docker-compose up

# Microservices
docker-compose --profile separate up
```

### Separate Services
File: `docker-compose.separate.yml`
- Dedicated configuration for microservices
- Shows service dependencies and networking

```bash
docker-compose -f docker-compose.separate.yml up
```

## OpenShift Deployment

### Quick Deployment

```bash
# All services with default settings
./openshift/deploy.sh

# Custom namespace and registry
./openshift/deploy.sh -n my-project -r quay.io/myorg -t v1.0

# Individual services
./openshift/deploy.sh --http-only
./openshift/deploy.sh --websocket-only
```

### Manual Deployment

```bash
# Create namespace
oc create namespace shopmaze
oc project shopmaze

# Deploy all resources
oc apply -f openshift/all-in-one.yaml

# Or deploy individually
oc apply -f openshift/http-deployment.yaml
oc apply -f openshift/http-service.yaml
oc apply -f openshift/http-route.yaml
oc apply -f openshift/websocket-deployment.yaml
oc apply -f openshift/websocket-service.yaml
oc apply -f openshift/websocket-route.yaml
```

## Service Configuration

### Environment Variables

**HTTP Service:**
- `NODE_ENV`: Environment mode (default: `production`)
- `HTTP_PORT`: HTTP server port (default: `8099`)

**WebSocket Service:**
- `NODE_ENV`: Environment mode (default: `production`)
- `WS_PORT`: WebSocket server port (default: `8080`)
- `HTTP_PORT`: HTTP service endpoint for communication (default: `8099`)

### Health Checks

**HTTP Service:**
- Endpoint: `GET /health`
- Health check script: `src/health-check.js`

**WebSocket Service:**
- TCP port check on WebSocket port
- Health check script: `src/health-check-websocket.js`

## Scaling and Resource Management

### Resource Allocation

Default settings per service:
```yaml
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

### Scaling Strategy

**HTTP Service:**
- Stateless - can scale horizontally
- Default: 3 replicas in OpenShift
- Load balancing: Round-robin

**WebSocket Service:**
- Session-aware - limited horizontal scaling
- Default: 2 replicas in OpenShift
- Load balancing: Client IP affinity (1 hour timeout)

### Scaling Commands

```bash
# OpenShift
oc scale deployment shopmaze-http --replicas=5
oc scale deployment shopmaze-websocket --replicas=3

# Docker Compose
docker-compose up --scale shopmaze-http=3 --scale shopmaze-websocket=2
```

## Security Configuration

### Container Security
- Non-root user (UID 1001)
- No privilege escalation
- All capabilities dropped
- Read-only root filesystem where possible

### Network Security
- TLS termination at OpenShift route level
- Internal service communication over cluster network
- CORS headers configured for cross-origin requests

### Image Security
- Based on Red Hat UBI (regularly updated)
- Minimal attack surface
- Security scanning compatible

## Monitoring and Observability

### Health Monitoring

```bash
# Check service health
curl https://shopmaze-http-route.apps.cluster.com/health

# Monitor deployments
oc get deployments -w
oc rollout status deployment/shopmaze-http
oc rollout status deployment/shopmaze-websocket
```

### Logging

```bash
# Service logs
oc logs -f deployment/shopmaze-http
oc logs -f deployment/shopmaze-websocket

# Aggregated logs
oc logs -f -l service=game-backend
```

### Metrics

```bash
# Resource usage
oc top pods
oc describe pod <pod-name>

# Service status
oc get services
oc get routes
```

## Troubleshooting

### Common Issues

1. **Image Pull Failures**
   - Verify image registry access
   - Check image tag existence
   - Ensure authentication if using private registry

2. **Service Communication**
   - Verify network policies
   - Check service discovery
   - Validate environment variables

3. **Health Check Failures**
   - Review probe configuration
   - Check application startup time
   - Verify health check scripts

### Debug Commands

```bash
# Get pod details
oc describe pod <pod-name>

# Execute commands in pod
oc exec -it <pod-name> -- /bin/bash

# Port forward for local testing
oc port-forward service/shopmaze-http-service 8099:8099
oc port-forward service/shopmaze-websocket-service 8080:8080

# Check events
oc get events --sort-by=.metadata.creationTimestamp
```

## Migration Guide

### From Monolithic to Microservices

1. **Build separate images**
   ```bash
   ./containerconfig/build-all.sh -t v1.0
   ```

2. **Test locally**
   ```bash
   docker-compose -f docker-compose.separate.yml up
   ```

3. **Deploy to OpenShift**
   ```bash
   ./openshift/deploy.sh -t v1.0
   ```

4. **Validate services**
   ```bash
   curl https://shopmaze-http-route.../health
   # Test WebSocket connection
   ```

5. **Update client configurations**
   - Update WebSocket connection URLs
   - Update HTTP API endpoints

### Rollback Strategy

```bash
# Quick rollback to monolithic
oc delete -f openshift/all-in-one.yaml
oc apply -f original-deployment.yaml

# Or rollback individual services
oc rollout undo deployment/shopmaze-http
oc rollout undo deployment/shopmaze-websocket
```

## Best Practices

1. **Image Management**
   - Use specific tags, not `latest`
   - Implement image scanning
   - Regular base image updates

2. **Resource Management**
   - Monitor resource usage
   - Set appropriate limits
   - Use horizontal pod autoscaling

3. **Configuration**
   - Use ConfigMaps for configuration
   - Secrets for sensitive data
   - Environment-specific values

4. **Deployment**
   - Blue-green deployments
   - Rolling updates
   - Health checks before traffic routing

5. **Monitoring**
   - Application metrics
   - Infrastructure monitoring
   - Log aggregation and analysis

## Performance Considerations

### HTTP Service
- Stateless design enables easy scaling
- Consider caching for leaderboard data
- Connection pooling for database access

### WebSocket Service
- Session affinity required for persistent connections
- Memory usage scales with connected clients
- Consider connection limits and cleanup

### Network
- Internal service communication is optimized
- External TLS termination at route level
- Consider CDN for static assets

---

For detailed implementation information, see the individual configuration files in the `openshift/` directory and the deployment scripts in `containerconfig/`.
