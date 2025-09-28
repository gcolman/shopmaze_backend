#!/bin/bash

# OpenShift Cleanup Script for ShopMaze Backend
# Deletes all resources created by the deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
NAMESPACE="demo-frontend"
FORCE=false

# Function to display help
show_help() {
    echo "OpenShift Cleanup Script for ShopMaze Backend"
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS         Set OpenShift namespace (default: gcolman1-dev)"
    echo "  -f, --force                Force deletion without confirmation"
    echo "  -h, --help                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                         # Interactive cleanup in gcolman1-dev namespace"
    echo "  $0 -n my-project -f       # Force cleanup in custom namespace"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -f|--force)
            FORCE=true
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

echo -e "${BLUE}🧹 Cleanup for ShopMaze Backend${NC}"
echo -e "${BLUE}===============================${NC}"
echo -e "  Namespace: ${NAMESPACE}"
echo -e "  Force: $([ "$FORCE" = true ] && echo "Yes" || echo "No")"
echo ""

# Check if oc command is available
if ! command -v oc &> /dev/null; then
    echo -e "${RED}❌ OpenShift CLI (oc) not found. Please install it first.${NC}"
    exit 1
fi

# Check if logged into OpenShift
if ! oc whoami &> /dev/null; then
    echo -e "${RED}❌ Not logged into OpenShift. Please login first with 'oc login'.${NC}"
    exit 1
fi

# Check if namespace exists
if ! oc get namespace "$NAMESPACE" &> /dev/null; then
    echo -e "${YELLOW}⚠️  Namespace '$NAMESPACE' does not exist. Nothing to cleanup.${NC}"
    exit 0
fi

# Switch to namespace
oc project "$NAMESPACE" > /dev/null 2>&1

# Confirmation prompt
if [ "$FORCE" = false ]; then
    echo -e "${YELLOW}⚠️  This will delete ALL ShopMaze backend resources in namespace '${NAMESPACE}'${NC}"
    echo -e "${YELLOW}   This includes deployments, services, and routes.${NC}"
    echo ""
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}✅ Cleanup cancelled.${NC}"
        exit 0
    fi
fi

echo ""
echo -e "${BLUE}🗑️  Starting cleanup process...${NC}"
echo ""

# Delete using the deployment file if it exists
if [ -f "deployment.yaml" ]; then
    echo -e "${YELLOW}🗑️  Deleting resources using deployment.yaml...${NC}"
    oc delete -f deployment.yaml --ignore-not-found=true
else
    echo -e "${YELLOW}🗑️  Deleting individual resources...${NC}"
    
    # Delete Routes
    oc delete route shopmaze-http-route --ignore-not-found=true
    oc delete route shopmaze-websocket-route --ignore-not-found=true
    
    # Delete Services
    oc delete service shopmaze-http-service --ignore-not-found=true
    oc delete service shopmaze-websocket-service --ignore-not-found=true
    
    # Delete Deployments
    oc delete deployment shopmaze-http --ignore-not-found=true
    oc delete deployment shopmaze-websocket --ignore-not-found=true
fi

# Clean up any remaining pods
echo -e "${YELLOW}🧹 Cleaning up any remaining pods...${NC}"
oc delete pods -l service=shopmaze-backend --ignore-not-found=true

# Wait a moment for deletion to propagate
echo -e "${YELLOW}⏳ Waiting for resources to be fully removed...${NC}"
sleep 5

echo ""
echo -e "${BLUE}📊 Checking for any remaining resources...${NC}"

# Check for remaining resources
remaining_deployments=$(oc get deployments -l service=shopmaze-backend -o name 2>/dev/null | wc -l)
remaining_services=$(oc get services -l service=shopmaze-backend -o name 2>/dev/null | wc -l)
remaining_routes=$(oc get routes -l service=shopmaze-backend -o name 2>/dev/null | wc -l)
remaining_pods=$(oc get pods -l service=shopmaze-backend -o name 2>/dev/null | wc -l)

if [ "$remaining_deployments" -eq 0 ] && [ "$remaining_services" -eq 0 ] && [ "$remaining_routes" -eq 0 ] && [ "$remaining_pods" -eq 0 ]; then
    echo -e "${GREEN}🎉 All ShopMaze backend resources have been successfully removed!${NC}"
else
    echo -e "${YELLOW}⚠️  Some resources are still being removed:${NC}"
    echo -e "   Deployments: $remaining_deployments"
    echo -e "   Services: $remaining_services"
    echo -e "   Routes: $remaining_routes"
    echo -e "   Pods: $remaining_pods"
    echo ""
    echo -e "${BLUE}💡 This is normal - OpenShift may take a few moments to fully clean up.${NC}"
    echo -e "${BLUE}📋 Run 'oc get all -l service=shopmaze-backend' to monitor progress${NC}"
fi

echo ""
echo -e "${BLUE}📝 The namespace '${NAMESPACE}' has been preserved.${NC}"
echo ""
