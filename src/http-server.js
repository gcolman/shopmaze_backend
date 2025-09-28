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
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectDelay: 2000
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
                if (orderResult.backendResponse && orderResult.backendResponse.po) {
                    console.log(`📊 Backend PO: ${orderResult.backendResponse.po}, Total: ${orderResult.backendResponse.summary?.totalAmount}`);
                    
                    // Send invoice_register event via WebSocket
                    try {
                        const invoiceRegisterMessage = {
                            type: 'invoice_register',
                            userId: 'http-server', // Required by websocket-server
                            //po: orderResult.backendResponse.po,
                            po: 1030,
                            playerId: orderResult.customerName, // Use email as playerId
                            customerName: orderResult.customerName,
                            customerEmail: orderResult.customerEmail,
                            orderId: orderResult.orderId,
                            totalAmount: orderResult.backendResponse.summary?.totalAmount,
                            timestamp: new Date().toISOString()
                        };
                        
                        const sent = wsClient.send(invoiceRegisterMessage);
                        if (sent) {
                            console.log(`📤 Sent invoice_register event for PO ${orderResult.backendResponse.po} to WebSocket server`);
                        } else {
                            console.log(`📦 Queued invoice_register event for PO ${orderResult.backendResponse.po} (WebSocket not connected)`);
                        }
                        
                    } catch (wsError) {
                        console.error(`❌ Error sending invoice_register event: ${wsError.message}`);
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'http-server',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            leaderboardEntries: dataStore.getLeaderboardCount(),
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

httpServer.listen(HTTP_PORT, async () => {
    console.log(`📊 Red Hat Quest HTTP API Server running on http://localhost:${HTTP_PORT}`);
    console.log(`🔗 Leaderboard data: http://localhost:${HTTP_PORT}/leaderboard`);
    console.log(`📄 Invoices data: http://localhost:${HTTP_PORT}/invoices`);
    console.log(`📄 Invoice stats: http://localhost:${HTTP_PORT}/invoices/stats`);
    console.log(`📦 Process order: http://localhost:${HTTP_PORT}/process-order`);
    console.log(`💚 Health check: http://localhost:${HTTP_PORT}/health`);
    
    // Initialize WebSocket connection to websocket-server
    try {
        console.log(`🔌 Connecting to WebSocket server for invoice registration...`);
        await wsClient.connect();
        console.log(`✅ Connected to WebSocket server for invoice events`);
    } catch (error) {
        console.error(`❌ Failed to connect to WebSocket server: ${error.message}`);
        console.log(`📦 Invoice events will be queued until connection is established`);
    }
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
