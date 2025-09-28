#!/bin/bash

# ShopMaze WebSocket Server Build Script
# Builds and optionally pushes the WebSocket server container image

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
IMAGE_NAME="redhat-quest-ws-server"
TAG="latest"
REGISTRY="quay.io/uk_redhatdemo/summitconnect"
PUSH=true

# Function to display help
show_help() {
    echo "ShopMaze WebSocket Server Build Script"
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -t, --tag TAG          Set image tag (default: latest)"
    echo "  -r, --registry REG     Set registry prefix (e.g., quay.io/myorg)"
    echo "  -p, --push             Push image after building"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Build with default tag"
    echo "  $0 -t v1.0                          # Build with custom tag"
    echo "  $0 -r quay.io/myorg -t v1.0 -p     # Build, tag and push"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -p|--push)
            PUSH=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Construct full image name
if [ -n "$REGISTRY" ]; then
    FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}:${TAG}"
else
    FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"
fi

echo -e "${BLUE}🚀 ShopMaze WebSocket Server Container Build${NC}"
echo -e "${BLUE}===========================================${NC}"
echo -e "  Image: ${FULL_IMAGE_NAME}"
echo -e "  Push: $([ "$PUSH" = true ] && echo "Yes" || echo "No")"
echo ""

# Check if required files exist
echo -e "${YELLOW}🔍 Checking required files...${NC}"
REQUIRED_FILES=(
    "Dockerfile.websocket"
    "package.json"
    "src/websocket-server.js"
    "src/health-check-websocket.js"
    "src/shared/HttpClient.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [[ ! -e "$file" ]]; then
        echo -e "${RED}❌ Required file not found: $file${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Found: $file${NC}"
done

echo ""

# Build the container image
echo -e "${YELLOW}🔨 Building container image for Intel (x86_64) architecture...${NC}"
echo -e "  Command: podman build --platform linux/amd64 -f Dockerfile.websocket -t ${FULL_IMAGE_NAME} ."
echo ""

if podman build --platform linux/amd64 -f Dockerfile.websocket -t "${FULL_IMAGE_NAME}" .; then
    echo ""
    echo -e "${GREEN}✅ Container image built successfully!${NC}"
    echo -e "  Image: ${FULL_IMAGE_NAME}"
    
    # Show image size
    IMAGE_SIZE=$(podman images "${FULL_IMAGE_NAME}" --format "table {{.Size}}" | tail -n 1)
    echo -e "  Size: ${IMAGE_SIZE}"
else
    echo -e "${RED}❌ Container build failed!${NC}"
    exit 1
fi

# Push image if requested
if [ "$PUSH" = true ]; then
    echo ""
    echo -e "${YELLOW}📤 Pushing image to registry...${NC}"
    if podman push "${FULL_IMAGE_NAME}"; then
        echo -e "${GREEN}✅ Image pushed successfully!${NC}"
    else
        echo -e "${RED}❌ Failed to push image!${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo ""
echo -e "${BLUE}🐳 Container Commands:${NC}"
echo -e "  Run WebSocket server: podman run -p 8080:8080 ${FULL_IMAGE_NAME}"
echo -e "  Run with custom port: podman run -e WS_PORT=9090 -p 9090:9090 ${FULL_IMAGE_NAME}"
echo ""
echo -e "${BLUE}🌐 Access URLs (when running):${NC}"
echo -e "  WebSocket Server:     ws://localhost:8080/game-control"
echo ""
