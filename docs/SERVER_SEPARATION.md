# Server Separation Documentation

## Overview

The WebSocket server and HTTP server have been successfully separated into distinct services for better maintainability, scalability, and deployment flexibility.

## File Structure

```
src/
├── websocket-server.js     # WebSocket server for game control
├── http-server.js          # HTTP REST API server
├── start-servers.js        # Process manager for both servers
└── shared/
    └── data-store.js       # Shared data management module
```

## Services

### WebSocket Server (`websocket-server.js`)
- **Port**: 8080
- **Purpose**: Handles real-time game communication
- **Features**:
  - Game command processing (start, pause, new)
  - Game event handling
  - Client connection management
  - Command line interface for testing

### HTTP Server (`http-server.js`)
- **Port**: 8099
- **Purpose**: Provides REST API endpoints
- **Endpoints**:
  - `GET /leaderboard` - Returns leaderboard data
  - `GET /health` - Health check endpoint for monitoring

### Shared Data Store (`shared/data-store.js`)
- **Purpose**: Manages leaderboard data shared between servers
- **Features**:
  - Singleton pattern for data consistency
  - Game over event processing
  - Leaderboard sorting and management
  - Top 100 entry limitation

## Running the Servers

### Individual Servers
```bash
# WebSocket server only
npm run start:ws

# HTTP server only
npm run start:http
```

### Both Servers
```bash
# Recommended: Use process manager
npm run start:both

# Development mode (same as start:both)
npm run dev

# Default start (WebSocket only for backward compatibility)
npm start
```

## Process Management

The `start-servers.js` process manager provides:
- Coordinated startup of both services
- Graceful shutdown handling
- Crash detection and recovery
- Proper signal handling (SIGINT, SIGTERM)

## Environment Variables

- `HTTP_PORT`: Override HTTP server port (default: 8099)
- `WS_PORT`: Override WebSocket server port (default: 8080)

## Benefits of Separation

1. **Scalability**: Each server can be scaled independently
2. **Maintainability**: Cleaner, focused codebases
3. **Deployment**: Flexible deployment options (same container, separate containers, etc.)
4. **Development**: Easier to debug and test individual components
5. **Resource Management**: Better resource allocation per service type

## Docker Considerations

The existing Dockerfile can be updated to either:
1. Run both servers in the same container using the process manager
2. Use multi-stage builds for separate containers
3. Create separate Dockerfiles for each service

## Migration Notes

- Existing clients should continue to work without changes
- The WebSocket server maintains the same interface
- The HTTP API endpoints remain unchanged
- All environment variables and configuration are preserved
