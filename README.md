# ShopMaze Backend

Backend API and WebSocket server for the ShopMaze game. This service provides real-time communication and game state management for the frontend game client.

## 🏗️ Architecture

The backend consists of:
- **WebSocket Server**: Real-time communication for game control
- **Health API**: Service health monitoring
- **Game State Management**: Centralized game state and leaderboard

## 📁 Project Structure

```
shopmaze_backend/
├── src/
│   └── websocket-server.js    # Main WebSocket server
├── config/                    # Configuration files
├── docs/                      # Documentation
│   └── WEBSOCKET_README.md    # WebSocket API documentation
├── containerconfig/           # Container build configs
│   ├── Dockerfile            # Container build definition
│   ├── .dockerignore         # Docker ignore patterns
│   └── build-backend.sh      # Build script
├── package.json              # Dependencies and scripts
└── README.md                 # This file
```

## 🚀 Quick Start

### Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   # or for development
   npm run dev
   ```

3. **Server will be available at:**
   - WebSocket: `ws://localhost:8080`
   - Health API: `http://localhost:8080/health`

### Container Build

1. **Build the container:**
   ```bash
   ./containerconfig/build-backend.sh
   ```

2. **Build with custom tag:**
   ```bash
   ./containerconfig/build-backend.sh -t v1.0
   ```

3. **Build and push to registry:**
   ```bash
   ./containerconfig/build-backend.sh -r quay.io/myorg -t v1.0 -p
   ```

### Container Run

```bash
# Run the backend container
docker run -p 8080:8080 shopmaze-backend:latest

# Run with environment variables
docker run -p 8080:8080 \
  -e NODE_ENV=production \
  -e PORT=8080 \
  shopmaze-backend:latest
```

## 🔌 API Reference

### WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('Connected to ShopMaze backend');
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message);
});
```

### Health Endpoint

```bash
# Check service health
curl http://localhost:8080/health

# Response
{
  "status": "healthy",
  "timestamp": "2024-08-22T12:00:00Z",
  "uptime": 3600
}
```

## 🎮 Game Commands

The WebSocket server accepts these command types:

### Admin Commands
```json
{
  "type": "command",
  "command": "start|pause|new",
  "source": "admin-panel"
}
```

### Game Events
```json
{
  "type": "game-event",
  "event": "player-move|score-update|game-over",
  "data": { ... }
}
```

See [docs/WEBSOCKET_README.md](docs/WEBSOCKET_README.md) for complete API documentation.

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | WebSocket server port |
| `NODE_ENV` | `development` | Runtime environment |
| `CORS_ORIGIN` | `*` | CORS allowed origins |

### Package Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the WebSocket server |
| `npm run dev` | Start in development mode |
| `npm test` | Run tests (placeholder) |

## 🐳 Container Details

- **Base Image**: Red Hat UBI Node.js 18
- **Port**: 8080 (WebSocket + HTTP)
- **User**: Non-root (1001)
- **Health Check**: HTTP endpoint at `/health`

## 📊 Monitoring

The backend provides:
- **Health endpoint**: `/health` - Service status
- **WebSocket events**: Real-time connection monitoring
- **Console logging**: Structured logging for debugging

## 🔒 Security

- Runs as non-root user (1001)
- CORS configuration for cross-origin requests
- Input validation on WebSocket messages
- Health check endpoint for monitoring

## 🚀 Deployment

### Local Development
```bash
npm install
npm start
```

### Container Deployment
```bash
./containerconfig/build-backend.sh -t latest
docker run -p 8080:8080 shopmaze-backend:latest
```

### Kubernetes/OpenShift
```bash
# Build and push
./containerconfig/build-backend.sh -r quay.io/myorg -t v1.0 -p

# Deploy (using frontend project's deployment configs)
kubectl apply -f ../shopmaze/containerconfig/k8s-deployment.yaml
```

## 📝 Development Notes

- The backend is designed to work with the ShopMaze frontend
- WebSocket connections are stateless for scalability
- Game state is managed in memory (consider Redis for production)
- Health endpoint enables container orchestration

## 🤝 Integration

This backend integrates with:
- **ShopMaze Frontend**: Main game client
- **Admin Panel**: Administrative controls
- **Monitoring Systems**: Via health endpoint
- **Load Balancers**: WebSocket-aware routing

## 📄 License

MIT License - see the main ShopMaze project for details.

