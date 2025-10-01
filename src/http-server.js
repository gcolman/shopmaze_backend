#!/usr/bin/env node

// HTTP Server for Red Hat Quest Game APIs
// Provides REST endpoints for leaderboard and health checks

const http = require('http');
const url = require('url');
const dataStore = require('./shared/data-store');
const { OrderProcessor } = require('./shared/order');
const { WebSocketClient } = require('./shared/WebSocketClient');

const HTTP_PORT = process.env.HTTP_PORT || 8099;
const WS_PORT = process.env.WS_PORT || 8080;
const WS_SERVER = process.env.WS_SERVER || 'localhost';

// Initialize order processor and WebSocket client
const orderProcessor = new OrderProcessor();

// Initialize WebSocket client for communicating with websocket-server
const wsClient = new WebSocketClient({
    url: `ws://${WS_SERVER}:${WS_PORT}/game-control`,
    userId: 'http-server',
    autoReconnect: false, // Disable auto-reconnect, we use manual retry logic
    timeout: 5000, // Shorter timeout for faster retry
    heartbeatInterval: 30000, // Send ping every 30 seconds
    enableHeartbeat: true // Enable heartbeat monitoring
});

const httpServer = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    if (parsedUrl.pathname === '/leaderboard') {
        //console.log('>>>>>Leaderboard API called');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            count: dataStore.getLeaderboardCount(),
            data: dataStore.getLeaderboardData(),
            lastUpdated: new Date().toISOString()
        }));
        console.log(`📊 Leaderboard API called - returned ${dataStore.getLeaderboardCount()} entries`);
    } else if (parsedUrl.pathname === '/game-over' && req.method === 'POST') {
        // Handle game over events from WebSocket server
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const gameOverData = JSON.parse(body);
                console.log(`🎮 Received game over event from WebSocket server`);
                
                // Process the game over event using dataStore
                dataStore.processGameOverEvent(gameOverData);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'Game over event processed successfully',
                    timestamp: new Date().toISOString()
                }));
            } catch (error) {
                console.error('❌ Error processing game over event:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Invalid game over data',
                    message: error.message
                }));
            }
        });
    } else if (parsedUrl.pathname === '/process-order' && req.method === 'POST') {
        // Handle order processing using OrderProcessor module
        try {
            const orderResult = await orderProcessor.handleOrderRequest(req, res);
            
            // Now we can use the returned result for additional processing
            if (orderResult.success) {
                console.log(`✅ Order processed successfully: ${orderResult.orderId} for ${orderResult.customerName} (${orderResult.customerEmail})`);
                
                // Access backend response data and send invoice registration
                // Send expected invoice registration to WebSocket server
                if (orderResult.backendResponse && orderResult.backendResponse.po) {
                    console.log(`📊 Backend PO: ${orderResult.backendResponse.po}, Total: ${orderResult.backendResponse.summary?.totalAmount}`);
                    
                    // Send expected invoice registration via WebSocket
                    try {
                        const expectedInvoiceMessage = {
                            type: 'register_expected_invoice',
                            userId: 'http-server', // Required by websocket-server
                            invoiceNumber: orderResult.backendResponse.po.toString(),
                            playerId: orderResult.customerName, 
                            orderData: {
                                customerName: orderResult.customerName,
                                customerEmail: orderResult.customerEmail,
                                orderId: orderResult.orderId,
                                summary: orderResult.backendResponse.summary
                            },
                            timestamp: new Date().toISOString()
                        };
                        
                        const sent = wsClient.send(expectedInvoiceMessage);
                        if (sent) {
                            console.log(`📤 Sent expected invoice registration for PO ${orderResult.backendResponse.po} to WebSocket server`);
                        } else {
                            console.log(`📦 Queued expected invoice registration for PO ${orderResult.backendResponse.po} (WebSocket not connected)`);
                        }
                        
                    } catch (wsError) {
                        console.error(`❌ Error sending expected invoice registration: ${wsError.message}`);
                    }
                }
                
            } else {
                console.log(`❌ Order processing failed: ${orderResult.error}`);
            }
            
        } catch (error) {
            console.error('❌ Error in order processing:', error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Internal server error',
                    message: 'An error occurred while processing the order',
                    timestamp: new Date().toISOString()
                }));
            }
        }

    } else if (parsedUrl.pathname === '/health') {
        // Health check endpoint for Docker
        const wsStatus = wsClient.getStatus();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'http-server',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            leaderboardEntries: dataStore.getLeaderboardCount(),
            websocket: {
                isConnected: wsStatus.isConnected,
                isReconnecting: wsStatus.isReconnecting,
                reconnectAttempts: wsStatus.reconnectAttempts,
                queuedMessages: wsStatus.queuedMessages,
                uptime: wsStatus.uptime,
                url: wsStatus.url
            }
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

// Set up WebSocket event listeners for monitoring before starting connection attempts
wsClient.on('connected', () => {
    console.log(`🔗 WebSocket connected successfully to game control service`);
    const status = wsClient.getStatus();
    if (status.queuedMessages > 0) {
        console.log(`📦 Processing ${status.queuedMessages} queued messages...`);
    }
});

wsClient.on('disconnected', (info) => {
    console.log(`🔌 WebSocket disconnected: ${info.reason} (uptime: ${info.uptime || 0}s)`);
    const status = wsClient.getStatus();
    if (status.queuedMessages > 0) {
        console.log(`📦 ${status.queuedMessages} messages queued for retry when reconnected`);
    }
    
    // Try to reconnect (fewer attempts for reconnection)
    console.log(`🔄 Attempting to reconnect...`);
    setTimeout(async () => {
        try {
            await wsClient.connect(10); // Try 10 times for reconnection
            console.log(`✅ Reconnected to WebSocket server`);
        } catch (error) {
            console.log(`❌ Failed to reconnect after 10 attempts, will try again later`);
        }
    }, 2000); // Wait 2 seconds before starting reconnection attempts
});

wsClient.on('error', (error) => {
    console.error(`❌ WebSocket error: ${error.message}`);
});

wsClient.on('maxReconnectAttemptsReached', () => {
    console.error(`❌ WebSocket max reconnection attempts reached - manual intervention may be required`);
});

// Initialize WebSocket connection using client's built-in retry logic
async function initializeWebSocketConnection() {
    try {
        await wsClient.connect(30); // Try 30 times with 1-second delays
        console.log(`✅ Connected to WebSocket server for game events`);
    } catch (error) {
        console.error(`❌ Failed to connect to WebSocket server after 30 attempts`);
        console.log(`📦 Game events will be queued until WebSocket server becomes available`);
    }
}

httpServer.listen(HTTP_PORT, () => {
    console.log(`📊 Red Hat Quest HTTP API Server running on http://localhost:${HTTP_PORT}`);
    console.log(`🔗 Leaderboard data: http://localhost:${HTTP_PORT}/leaderboard`);
    console.log(`📄 Invoices data: http://localhost:${HTTP_PORT}/invoices`);
    console.log(`📄 Invoice stats: http://localhost:${HTTP_PORT}/invoices/stats`);
    console.log(`📦 Process order: http://localhost:${HTTP_PORT}/process-order`);
    console.log(`💚 Health check: http://localhost:${HTTP_PORT}/health`);
    console.log(`✅ HTTP Server started successfully`);
    
    // Start WebSocket connection attempt asynchronously (doesn't block server startup)
    initializeWebSocketConnection();

    // Simple periodic monitoring (every 5 minutes)
    setInterval(() => {
        const status = wsClient.getStatus();
        if (!status.isConnected) {
            console.log(`⚠️ WebSocket not connected - queued messages: ${status.queuedMessages}`);
        } else {
            console.log(`💓 WebSocket healthy - uptime: ${status.uptime}s, queued: ${status.queuedMessages}`);
        }
    }, 5 * 60 * 1000); // 5 minutes
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n🛑 HTTP Server: Received SIGINT, shutting down gracefully...');
    
    // Close WebSocket connection
    if (wsClient) {
        console.log('🔌 Disconnecting from WebSocket server...');
        wsClient.disconnect();
    }
    
    httpServer.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 HTTP Server: Received SIGTERM, shutting down gracefully...');
    
    // Close WebSocket connection
    if (wsClient) {
        console.log('🔌 Disconnecting from WebSocket server...');
        wsClient.disconnect();
    }
    
    httpServer.close();
    process.exit(0);
});

module.exports = httpServer;
