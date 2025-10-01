#!/usr/bin/env node

// Simple WebSocket Server for Red Hat Quest Game Control
// This is a demonstration server that listens for game commands

const WebSocket = require('ws');
const { HttpClient } = require('./shared/HttpClient');
const { InvoicePoller } = require('./shared/invoicePoller');

const WS_PORT = 8080;
const HTTP_PORT = process.env.HTTP_PORT || 8099;
const HTTP_SERVER = process.env.HTTP_SERVER || 'localhost';

const server = new WebSocket.Server({ 
    port: WS_PORT,
    path: '/game-control'
    //path: '/chat/display'
});

console.log(`🎮 Red Hat Quest WebSocket Control Server running on ws://localhost:${WS_PORT}/game-control`);
console.log('📡 Waiting for game client to connect...');
console.log('');
console.log('Available commands:');
console.log('  - start  : Start/Resume the game');
console.log('  - pause  : Pause the game');
console.log('  - new    : Create a new game');
console.log('  - endgame: End the game');
console.log('  - game-status: Show current game status');
console.log('');

let connectedClients = new Set();
let userConnections = new Map(); // Map of userId -> ws object
let connectionUsers = new Map();  // Map of ws object -> userId (reverse lookup)

// Game status tracking
let gameStatus = {
    status: 'start', // Default status: 'start', 'pause', 'end'
    lastUpdated: new Date().toISOString(),
    updatedBy: 'system'
};

// Create invoice poller instance (declare before use)
let invoicePoller = null;

// Create a direct instance of the generic HttpClient for HTTP server communication
const httpClient = new HttpClient({
    baseUrl: `http://${HTTP_SERVER}:${HTTP_PORT}`,
    defaultHeaders: {
        'Content-Type': 'application/json',
        'User-Agent': 'WebSocket-Server/1.0'
    },
    timeout: 5000
});

/**
 * Send current game status to a specific client or all clients
 * @param {WebSocket} ws - Specific client to send to, or null for all clients
 */
function sendGameStatus(ws = null) {
    const gameStatusMessage = {
        type: 'game_status',
        status: gameStatus.status,
        lastUpdated: gameStatus.lastUpdated,
        updatedBy: gameStatus.updatedBy,
        timestamp: new Date().toISOString(),
        source: 'websocket-server'
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
        // Send to specific client
        ws.send(JSON.stringify(gameStatusMessage));
        console.log(`🎮 Game status (${gameStatus.status}) sent to client`);
    } else {
        // Send to all connected clients
        connectedClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(gameStatusMessage));
            }
        });
        console.log(`🎮 Game status (${gameStatus.status}) broadcast to ${connectedClients.size} clients`);
    }
}

/**
 * Update game status and broadcast to all clients
 * @param {string} newStatus - New game status ('start', 'pause', 'end')
 * @param {string} updatedBy - Who updated the status
 */
function updateGameStatus(newStatus, updatedBy = 'unknown') {
    const validStatuses = ['start', 'pause', 'end'];
    if (!validStatuses.includes(newStatus)) {
        console.error(`❌ Invalid game status: ${newStatus}. Valid statuses: ${validStatuses.join(', ')}`);
        return;
    }

    const previousStatus = gameStatus.status;
    gameStatus = {
        status: newStatus,
        lastUpdated: new Date().toISOString(),
        updatedBy: updatedBy
    };

    console.log(`🎮 Game status changed: ${previousStatus} → ${newStatus} (by ${updatedBy})`);
    
    // Broadcast new status to all clients
    sendGameStatus();
}

// Initialize invoice poller and set up websocket integration
async function initializeInvoicePoller() {
    try {
        console.log(`📄 Setting up Invoice Poller integration...`);
        
        invoicePoller = new InvoicePoller({
            pollingInterval: 5000, // Poll every 5 seconds
            bucketName: process.env.INVOICE_BUCKET || 'ingest',
            maxRetries: 'Infinity'
        });

        // Initialize the invoice poller
        await invoicePoller.initialize();

        // Set up the callback to send invoice ready notifications via websocket when processed
        invoicePoller.setInvoiceProcessedCallback(sendInvoiceReadyNotification);
        
        console.log(`✅ Invoice Poller integration setup complete`);
        
    } catch (error) {
        console.error(`❌ Failed to setup Invoice Poller integration: ${error.message}`);
        console.error(`⚠️ Invoice processing will not be available`);
    }
}

//console.log(' HTTP Server URL: ' + `http://${HTTP_SERVER}:${HTTP_PORT}`);

/**
 * Send game over event to HTTP server
 * @param {Object} gameOverData - The game over event data
 * @returns {Promise} Promise that resolves when event is processed
 */
async function sendGameOverEvent(gameOverData) {

    try {
        console.log(`🎮 Sending game over event to HTTP server`);
        const response = await httpClient.post('/game-over', gameOverData);
        //console.log(`✅ Game over event successfully processed by HTTP server`);
        return response;
    } catch (error) {
        console.error(`❌ Error sending game over event to HTTP server:`, error.message);
        throw error;
    }
}

/**
 * Get leaderboard data from HTTP server
 * @returns {Promise} Promise that resolves with leaderboard data
 */
async function getLeaderboard() {
    try {
        console.log(`📊 Fetching leaderboard from HTTP server`);
        const response = await httpClient.get('/leaderboard');
        //console.log(`✅ Retrieved ${response.data.count} leaderboard entries`);
        return response;
    } catch (error) {
        console.error(`❌ Error fetching leaderboard from HTTP server:`, error.message);
        throw error;
    }
}

/**
 * Get health status from HTTP server
 * @returns {Promise} Promise that resolves with health data
 */
async function getHealth() {
    try {
        const response = await httpClient.get('/health');
        return response;
    } catch (error) {
        console.error(`❌ Error fetching health from HTTP server:`, error.message);
        throw error;
    }
}

/**
 * Get invoices from HTTP server
 * @returns {Promise} Promise that resolves with invoices data
 */
async function getInvoices() {
    try {
        console.log(`📄 Fetching invoices from HTTP server`);
        const response = await httpClient.get('/invoices');
        //console.log(`✅ Retrieved ${response.data.count} invoices`);
        return response;
    } catch (error) {
        console.error(`❌ Error fetching invoices from HTTP server:`, error.message);
        throw error;
    }
}

/**
 * Process order by forwarding to HTTP server
 * @param {Object} orderData - The order data to process
 * @returns {Promise} Promise that resolves when order is processed
 */
async function processOrder(orderData) {
    try {
        JSON.stringify(orderData)
        console.log(`📦 Processing order for ${JSON.stringify(orderData.data) || 'unknown customer'}`);
        const response = await httpClient.post('/process-order', orderData.data);
        console.log(`✅ Order processed successfully by HTTP server`);
        return response;
    } catch (error) {
        console.error(`❌ Failed to process order via HTTP server:`, error.message);
        throw error;
    }
}


/**
 * Register a user connection
 * @param {string} userId - The user ID
 * @param {WebSocket} ws - The WebSocket connection
 */
function registerUser(userId, ws) {
    // Remove any existing connection for this user
    if (userConnections.has(userId)) {
        const existingWs = userConnections.get(userId);
        connectionUsers.delete(existingWs);
        console.log(`🔄 User ${userId} reconnected, removing old connection`);
    }
    
    userConnections.set(userId, ws);
    connectionUsers.set(ws, userId);
    console.log(`👤 User registered: ${userId} (Total users: ${userConnections.size})`);
}

/**
 * Unregister a user connection
 * @param {WebSocket} ws - The WebSocket connection
 */
function unregisterUser(ws) {
    const userId = connectionUsers.get(ws);
    if (userId) {
        userConnections.delete(userId);
        connectionUsers.delete(ws);
        //console.log(`👋 User disconnected: ${userId} (Total users: ${userConnections.size})`);
    }
}

/**
 * Send message to a specific user
 * @param {string} userId - The user ID
 * @param {Object} message - The message to send
 * @returns {boolean} True if message was sent, false if user not found
 */
function sendToUser(userId, message) {
    //console.log("Sending message to user: " + userId);
    const ws = userConnections.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        //console.log(`📤 Message sent to user ${userId}:`, message);
        return true;
    } else {
        console.log(`❌ User ${userId} not found or connection not open`);
        return false;
    }
}

/**
 * Send message to all connected users
 * @param {Object} message - The message to send
 * @returns {number} Number of users the message was sent to
 */
function broadcastToUsers(message) {
    let sentCount = 0;
    userConnections.forEach((ws, userId) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            sentCount++;
        }
    });
    console.log(`📢 Broadcast message sent to ${sentCount} users:`, message);
    return sentCount;
}

/**
 * Get list of connected user IDs
 * @returns {Array} Array of connected user IDs
 */
function getConnectedUsers() {
    return Array.from(userConnections.keys());
}

/**
 * Send invoice ready notification to a specific player via websocket
 * @param {string} invoiceNumber - The invoice number
 * @param {Object} processedData - The processed invoice data
 * @returns {Promise<boolean>} True if message was sent, false if user not found
 */
async function  sendInvoiceReadyNotification(invoiceNumber, processedData) {
    try {
        // TESTING - this had been taken out so that I can test with returning an invoice 10003 eveery time 
        // remove this as we want the user related to the invocie to be returned as part of the saved processdata 
        // with the actual requesting playerID    
        const playerId = processedData.playerId;

        //const playerId = invoicePoller.getPlayerIdForInvoice(invoiceNumber);

        console.log(`📄 Sending invoice ready notification to player ${playerId} for invoice ${invoiceNumber}`);
        if (!playerId) {
            console.log(`❌ No playerId found in processed invoice data for ${invoiceNumber}`);
            return false;
        }

        //this is stopping the testing as it is fetching the playerid from the stored invoice json
        const ws = userConnections.get(playerId);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log(`❌ Player ${playerId} not connected or connection not open for invoice ${invoiceNumber}`);
            return false;
        }

        // Create invoice ready notification message for the player
        const invoiceReadyMessage = {
            type: 'invoice_ready',
            invoiceNumber: invoiceNumber,
            //invoiceNumber: '1003',
            filename: processedData.filename,
            fileSize: processedData.fileSize,
            processedAt: processedData.processedAt,
            message: `Your invoice ${invoiceNumber} has been processed and is ready for download`,
            timestamp: new Date().toISOString(),
            source: 'invoice-poller'
        };

        // Send the invoice ready notification to the specific player
        ws.send(JSON.stringify(invoiceReadyMessage));
        console.log(`✅ Invoice ready notification for ${invoiceNumber} sent to player ${playerId} via websocket`);
        console.log(`   Filename: ${processedData.filename}`);
        console.log(`   File Size: ${processedData.fileSize} bytes`);
        
        return true;

    } catch (error) {
        console.error(`❌ Error sending invoice ready notification for ${invoiceNumber}:`, error.message);
        return false;
    }
}

/**
 * Handle invoice request from client by fetching from filesystem and sending full invoice data
 * @param {string} invoiceNumber - The invoice number to fetch
 * @param {string} requestingUserId - The user ID making the request
 * @param {WebSocket} ws - The websocket connection
 * @returns {Promise<boolean>} True if invoice was found and sent, false otherwise
 */
async function handleInvoiceRequest(invoiceNumber, requestingUserId, ws) {
    try {
        if (!invoicePoller) {
            console.log(`❌ Invoice poller not initialized - cannot fetch invoice ${invoiceNumber}`);
            return false;
        }

        console.log(`📄 -------- Fetching invoice ${invoiceNumber} for user ${requestingUserId || 'unknown'}`);

        // Try to get the invoice from the invoice poller (memory cache or filesystem)
        const invoiceData = await invoicePoller.getProcessedInvoice(invoiceNumber,requestingUserId);

        if (!invoiceData) {
            console.log(`❌ Invoice ${invoiceNumber} not found in storage`);
            return false;
        }


        // Get summary data from expected invoices if available
        let expectedInvoiceData = invoicePoller.expectedInvoices?.get(invoiceNumber);
        let summary = expectedInvoiceData?.summary || null;
        
        // If no expected invoice data found, try to find by playerId
        if (!expectedInvoiceData && invoiceData.playerId) {
            console.log(`📊 No expected invoice for ${invoiceNumber}, searching by playerId: ${invoiceData.playerId}`);
            expectedInvoiceData = invoicePoller.getExpectedInvoiceDataForPlayer(invoiceData.playerId);
            summary = expectedInvoiceData?.summary || null;
        }
        
        console.log(`📊 Expected invoice data found:`, expectedInvoiceData ? 'Yes' : 'No');
        console.log(`📊 Summary data available:`, summary ? 'Yes' : 'No');
        if (summary) {
            console.log(`📊 Summary total: ${summary.totalAmount}`);
        }

        // Create full invoice message with base64 data for display
        const invoiceMessage = {
            type: 'invoice_pdf',
            status: 'success',
            invoiceNumber: invoiceNumber,
            filename: invoiceData.filename,
            mimeType: 'application/pdf',
            base64Data: invoiceData.base64Data,
            fileSize: invoiceData.fileSize,
            processedAt: invoiceData.processedAt,
            s3Metadata: invoiceData.s3Metadata,
            summary: summary,
            message: `Invoice ${invoiceNumber} retrieved successfully`,
            timestamp: new Date().toISOString(),
            source: 'invoice-request'
        };

        // Send the full invoice to the requesting client
        ws.send(JSON.stringify(invoiceMessage));
        console.log(`✅ Invoice ${invoiceNumber} sent to user ${requestingUserId || 'unknown'}`);
        console.log(`   Filename: ${invoiceData.filename}`);
        console.log(`   File Size: ${invoiceData.fileSize} bytes`);
        console.log(`   Base64 Length: ${invoiceData.base64Data.length} characters`);
        
        return true;

    } catch (error) {
        console.error(`❌ Error handling invoice request for ${invoiceNumber}: ${error.message}`);
        return false;
    }
}


/**
 * 
 * HAANDLE MESSAGES FROM CLIENTS
 *
 */
server.on('connection', (ws, request) => {
    const clientInfo = {
        ip: request.socket.remoteAddress,
        userAgent: request.headers['user-agent']
    };
    
    connectedClients.add(ws);
    console.log(`🔗 Game client connected from ${clientInfo.ip}`);
    console.log(`👥 Total connected clients: ${connectedClients.size}`);

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to Red Hat Quest Control Server',
        availableCommands: ['start', 'pause', 'new']
    }));

    // Send current game status to new client
    sendGameStatus(ws);

    ws.on('message', (data) => {
        try {
            let messageData;
            try {
                messageData = JSON.parse(data);
            } catch (e) {
                messageData = { type: 'raw', data: data.toString() };
            }
            
            //console.log(`📨 Received from client:`, messageData);
            
            // Handle user connection registration
            if (messageData.type === 'register' && messageData.userId) {
                registerUser(messageData.userId, ws);
                ws.send(JSON.stringify({
                    type: 'register_response',
                    status: 'success',
                    userId: messageData.userId,
                    message: `User ${messageData.userId} registered successfully`,
                    timestamp: new Date().toISOString()
                }));
                return;
            }

            // Handle expected invoice registration from HTTP server
            if (messageData.type === 'register_expected_invoice' && messageData.userId) {
                console.log(`📄 Registering expected invoice ${messageData.invoiceNumber} for player ${messageData.playerId}`);
                console.log(`📄 Summary in message:`, messageData.orderData?.summary ? 'Yes' : 'No');
                if (messageData.orderData?.summary) {
                    console.log(`📄 Summary total: ${messageData.orderData.summary.totalAmount}`);
                }
                if (!invoicePoller) {
                    console.log(`❌ Invoice poller not initialized - cannot register expected invoice ${messageData.invoiceNumber}`);
                    ws.send(JSON.stringify({
                        type: 'register_expected_invoice_response',
                        status: 'error',
                        invoiceNumber: messageData.invoiceNumber,
                        message: 'Invoice poller not initialized',
                        timestamp: new Date().toISOString()
                    }));
                    return;
                }

                try {
                    // Pass the summary from orderData to registerExpectedInvoice
                    const orderDataWithSummary = {
                        ...messageData.orderData,
                        summary: messageData.orderData?.summary
                    };
                    
                    invoicePoller.registerExpectedInvoice(
                        messageData.invoiceNumber,
                        //HARDCODED FOR TESTING
                        //'1003',
                        messageData.playerId,
                        orderDataWithSummary
                    );

                    ws.send(JSON.stringify({
                        type: 'register_expected_invoice_response',
                        status: 'success',
                        invoiceNumber: messageData.invoiceNumber,
                        playerId: messageData.playerId,
                        message: `Expected invoice ${messageData.invoiceNumber} registered successfully`,
                        timestamp: new Date().toISOString()
                    }));
                } catch (error) {
                    console.error(`❌ Error registering expected invoice: ${error.message}`);
                    ws.send(JSON.stringify({
                        type: 'register_expected_invoice_response',
                        status: 'error',
                        invoiceNumber: messageData.invoiceNumber,
                        error: error.message,
                        message: 'Failed to register expected invoice',
                        timestamp: new Date().toISOString()
                    }));
                }
                return;
            }
     

            // Process game over events by forwarding to HTTP server
            if (messageData.type === 'game_event' && messageData.event === 'game_over') {
                console.log(`🎮 Forwarding game over event to HTTP server`);
                sendGameOverEvent(messageData).catch(error => {
                    console.error('Failed to process game over event:', error.message);
                });
            }

            // Handle game status events (start, pause, end)
            if (messageData.type === 'game_event' && ['start', 'pause', 'end'].includes(messageData.event)) {
                const userId = connectionUsers.get(ws) || 'unknown-client';
                console.log(`🎮 Game ${messageData.event} event received from ${userId}`);
                updateGameStatus(messageData.event, userId);
                
                // Send acknowledgment back to sender
                ws.send(JSON.stringify({
                    type: 'game_event_response',
                    event: messageData.event,
                    status: 'success',
                    message: `Game ${messageData.event} event processed`,
                    timestamp: new Date().toISOString()
                }));
                return;
            }
            
            // Process order events by forwarding to HTTP server
            if (messageData.type === 'order') {
                console.log(`📦 Received order event from client`,messageData);
                processOrder(messageData)
                    .then(response => {
                        // Send success response back to the client
                        ws.send(JSON.stringify({
                            type: 'order_response',
                            status: 'success',
                            orderId: response.data.orderId,
                            message: 'Order processed successfully',
                            customerName: messageData.customerName,
                            customerEmail: messageData.customerEmail,
                            itemCount: messageData.items ? messageData.items.length : 0,
                            timestamp: new Date().toISOString()
                        }));
                    })
                    .catch(error => {
                        console.error('Failed to process order:', error.message);
                        // Send error response back to the client
                        ws.send(JSON.stringify({
                            type: 'order_response',
                            status: 'error',
                            error: error.message,
                            message: 'Failed to process order',
                            timestamp: new Date().toISOString()
                        }));
                    });
                return;
            }
            
            // Handle send-to command from clients
            if (messageData.type === 'send-to' && messageData.targetUserId && messageData.message) {
                console.log(`📤 Send-to command received: ${messageData.targetUserId} -> ${messageData.message}`);
                const success = sendToUser(messageData.targetUserId, {
                    type: 'direct_message',
                    message: messageData.message,
                    fromUserId: connectionUsers.get(ws) || 'unknown',
                    timestamp: new Date().toISOString(),
                    source: 'user'
                });
                
                // Send confirmation back to sender
                ws.send(JSON.stringify({
                    type: 'send_response',
                    success: success,
                    targetUserId: messageData.targetUserId,
                    message: success ? 'Message sent successfully' : 'User not found or disconnected',
                    timestamp: new Date().toISOString()
                }));
                return;
            }

            // Handle request_invoice command from clients
            if (messageData.type === 'request_invoice' && messageData.invoiceNumber) {
                console.log(`📄 Invoice request received for: ${messageData.invoiceNumber}`);
                
                // Get the requesting user's ID
                const requestingUserId = connectionUsers.get(ws);
                
                handleInvoiceRequest(messageData.invoiceNumber, requestingUserId, ws)
                    .then(success => {
                        if (!success) {
                            // Send error response if invoice wasn't found or couldn't be sent
                            ws.send(JSON.stringify({
                                type: 'invoice_response',
                                status: 'error',
                                invoiceNumber: messageData.invoiceNumber,
                                message: `Invoice ${messageData.invoiceNumber} not found or could not be retrieved`,
                                timestamp: new Date().toISOString()
                            }));
                        }
                    })
                    .catch(error => {
                        console.error(`❌ Error handling invoice request: ${error.message}`);
                        ws.send(JSON.stringify({
                            type: 'invoice_response',
                            status: 'error',
                            invoiceNumber: messageData.invoiceNumber,
                            error: error.message,
                            message: 'Failed to retrieve invoice',
                            timestamp: new Date().toISOString()
                        }));
                    });
                return;
            }
            
            //if receiving a command from admin-panel then process the command
            if (typeof messageData === 'object' && messageData !== null) {
                const messageType = messageData.type;
                
                // If it's not a command message, but has a command field, extract it
                if (messageData.command && messageData.source === 'admin-panel') {
                    command = messageData.command;
                    source = messageData.source;
                    console.log("Received command: " +command + " from " + source);
                    handleCommand(command);
                } else {
                    return;
                }
            }

            // Don't echo back confirmations to avoid loops
            // Just log the received message
            
        } catch (error) {
            console.error('❌ Error processing message:', error);
        }
    });

    ws.on('close', (code, reason) => {
        connectedClients.delete(ws);
        unregisterUser(ws);
        console.log(`🔌 Client disconnected (${code}): ${reason}`);
        console.log(`👥 Total connected clients: ${connectedClients.size}`);
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        connectedClients.delete(ws);
        unregisterUser(ws);
    });
});

// Command line interface for manual testing
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Initialize invoice poller now that all functions are defined
console.log("CALL TO INITIALIZE INVOICE POLLER");
initializeInvoicePoller();

console.log('💬 Available commands:');
console.log('  Game commands: start, pause, end, game-status');
console.log('  HTTP commands: leaderboard, health, raw-get <path>');
console.log('  User commands: users, send-to <userId> <message>, broadcast <message>');
console.log('  System commands: status, quit');
console.log('');

rl.on('line', (input) => {
    const command = input.trim().toLowerCase();
    handleCommand(command);
});



function handleCommand(command) {
    console.log("Handling command: " + command);
    if (command === 'quit' || command === 'exit') {
        console.log('🛑 Shutting down server...');
        server.close();
        rl.close();
        process.exit(0);
    }
    
    if (command === 'status') {
        console.log(`📊 Server Status:`);
        console.log(`   WebSocket Port: ${WS_PORT}`);
        console.log(`   HTTP Server Port: ${HTTP_PORT}`);
        console.log(`   Connected clients: ${connectedClients.size}`);
        console.log(`   Registered users: ${userConnections.size}`);
        console.log(`   Uptime: ${process.uptime().toFixed(2)}s`);
        return;
    }
    
    if (command === 'users') {
        const users = getConnectedUsers();
        console.log(`👥 Connected Users (${users.length}):`);
        if (users.length === 0) {
            console.log('   No users connected');
        } else {
            users.forEach(userId => {
                console.log(`   - ${userId}`);
            });
        }
        return;
    }

    // Game status commands
    if (command === 'start') {
        updateGameStatus('start', 'admin-console');
        return;
    }

    if (command === 'pause') {
        updateGameStatus('pause', 'admin-console');
        return;
    }

    if (command === 'end' || command === 'endgame') {
        updateGameStatus('end', 'admin-console');
        return;
    }

    if (command === 'game-status') {
        console.log(`🎮 Current Game Status:`);
        console.log(`   Status: ${gameStatus.status}`);
        console.log(`   Last Updated: ${gameStatus.lastUpdated}`);
        console.log(`   Updated By: ${gameStatus.updatedBy}`);
        return;
    }
    
    if (command.startsWith('send-to ')) {
        console.log("Send-to received: " + command);
        const parts = command.split(' ');
        if (parts.length < 3) {
            console.log('Usage: send-to <userId> <message>');
            console.log('Example: send-to user123 Hello there!');
            return;
        }
        
        const userId = parts[1];
        const message = parts.slice(2).join(' ');
        
        const success = sendToUser(userId, {
            type: 'direct_message',
            message: message,
            timestamp: new Date().toISOString(),
            source: 'server'
        });
        
        if (success) {
            console.log(`✅ Message sent to user ${userId}`);
        } else {
            console.log(`❌ Failed to send message to user ${userId} (user not found or disconnected)`);
        }
        return;
    }
    
    if (command === 'invoice') {
        console.log('📄 Sending test invoice PDF to all connected clients...');
        
        const invoiceMessage = {
            type: 'invoice_ready',
            invoiceNumber: '1001',
            message: `Your invoice 1001 has been processed and is ready for download`,
            timestamp: new Date().toISOString(),
        };
        
        // Send to all connected clients
        let sentCount = 0;
        connectedClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(invoiceMessage));
                    sentCount++;
                } catch (error) {
                    console.error(`❌ Failed to send invoice to client: ${error.message}`);
                }
            }
        });
        
        console.log(`✅ Test invoice sent to ${sentCount} connected clients`);
        console.log(`   Invoice Number: ${invoiceMessage.invoiceNumber}`);
        console.log(`   File Size: ${invoiceMessage.fileSize} bytes`);

        return;
    }

    if (command.startsWith('broadcast ')) {
        const message = command.substring(10).trim();
        if (!message) {
            console.log('Usage: broadcast <message>');
            console.log('Example: broadcast Game will start in 5 minutes!');
            return;
        }
        
        const sentCount = broadcastToUsers({
            type: 'broadcast_message',
            message: message,
            timestamp: new Date().toISOString(),
            source: 'server'
        });
        
        console.log(`📢 Broadcast sent to ${sentCount} users`);
        return;
    }
    
    
    if (['start', 'pause', 'new', 'endgame'].includes(command)) {
        const message = JSON.stringify({
            command: command,
            timestamp: new Date().toISOString(),
            source: 'server'
        });
        
        let sentCount = 0;
        connectedClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
                sentCount++;
            }
        });
        
        console.log(`📤 Sent "${command}" command to ${sentCount} client(s)`);
    } else if (command === 'leaderboard') {
        // Fetch and display leaderboard data
        getLeaderboard()
            .then(response => {
                console.log(`📊 Leaderboard Data (${response.data.count} entries):`);
                response.data.data.slice(0, 5).forEach((entry, index) => {
                    console.log(`   ${index + 1}. ${entry.username} - Score: ${entry.score} (T-shirts: ${entry.tShirtsCount}, Level: ${entry.level})`);
                });
                if (response.data.count > 5) {
                    console.log(`   ... and ${response.data.count - 5} more entries`);
                }
            })
            .catch(error => {
                console.error(`Failed to fetch leaderboard: ${error.message}`);
            });
    } else if (command === 'health') {
        // Check HTTP server health
        getHealth()
            .then(response => {
                console.log(`💚 HTTP Server Health:`);
                console.log(`   Status: ${response.data.status}`);
                console.log(`   Service: ${response.data.service}`);
                console.log(`   Uptime: ${response.data.uptime.toFixed(2)}s`);
                console.log(`   Leaderboard Entries: ${response.data.leaderboardEntries}`);
            })
            .catch(error => {
                console.error(`Failed to check HTTP server health: ${error.message}`);
            });
    } else if (command.startsWith('raw-get ')) {
        // Demonstrate direct usage of the generic HttpClient
        const path = command.substring(8).trim();
        if (!path) {
            console.log('Usage: raw-get <path>');
            console.log('Example: raw-get /leaderboard');
            return;
        }
        
        console.log(`🔧 Making raw GET request to: ${path}`);
        httpClient.get(path)
            .then(response => {
                console.log(`✅ Raw response (${response.statusCode}):`);
                console.log(`   Headers:`, Object.keys(response.headers).join(', '));
                console.log(`   Data:`, JSON.stringify(response.data, null, 2));
            })
            .catch(error => {
                console.error(`❌ Raw request failed: ${error.message}`);
            });
    } 
    
    
    
    
    else if (command !== '') {
        console.log(`❓ Unknown command: "${command}"`);
        console.log(`   Game commands: start, pause, new, endgame`);
        console.log(`   HTTP commands: leaderboard, health, raw-get <path>`);
        console.log(`   User commands: users, send-to <userId> <message>, broadcast <message>`);
        console.log(`   System commands: status, quit`);
    }
}


// Handle server shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\n🛑 WebSocket Server: Received SIGINT, shutting down gracefully...');
    
    // Shutdown invoice poller if it exists
    if (invoicePoller) {
        try {
            await invoicePoller.shutdown();
            console.log('✅ Invoice Poller shutdown complete');
        } catch (error) {
            console.error(`❌ Error shutting down Invoice Poller: ${error.message}`);
        }
    }
    
    server.close();
    rl.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 WebSocket Server: Received SIGTERM, shutting down gracefully...');
    
    // Shutdown invoice poller if it exists
    if (invoicePoller) {
        try {
            await invoicePoller.shutdown();
            console.log('✅ Invoice Poller shutdown complete');
        } catch (error) {
            console.error(`❌ Error shutting down Invoice Poller: ${error.message}`);
        }
    }
    
    server.close();
    rl.close();
    process.exit(0);
});
