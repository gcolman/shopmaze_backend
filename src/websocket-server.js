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
console.log('');

let connectedClients = new Set();
let userConnections = new Map(); // Map of userId -> ws object
let connectionUsers = new Map();  // Map of ws object -> userId (reverse lookup)

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

/*
* Register an invoice for polling
* @param {string} invoiceNumber - The invoice number to register
* @param {string} playerId - The player ID associated with the invoice
* @returns {void}
*/
function registerInvoice(invoiceNumber, playerId) {
    if (invoicePoller) {
        try {
            const result = invoicePoller.registerInvoice(invoiceNumber, playerId);
            if (result) {
                console.log(`✅ Invoice ${invoiceNumber} was already processed for player ${playerId}`);
            } else {
                console.log(`📄 Registered invoice ${invoiceNumber} for player ${playerId} for polling`);
            }
        } catch (error) {
            console.log(`❌ Failed to register invoice: ${error.message}`);
        }
    } else {
        console.log(`❌ Invoice Poller not initialized`);
    }
    return;
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
async function sendInvoiceReadyNotification(invoiceNumber, processedData) {
    try {
        const playerId = processedData.playerId;
        
        if (!playerId) {
            console.log(`❌ No playerId found in processed invoice data for ${invoiceNumber}`);
            return false;
        }

        const ws = userConnections.get(playerId);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log(`❌ Player ${playerId} not connected or connection not open for invoice ${invoiceNumber}`);
            return false;
        }

        // Create invoice ready notification message for the player
        const invoiceReadyMessage = {
            type: 'invoice_ready',
            invoiceNumber: invoiceNumber,
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
 * Send processed invoice to a specific player via websocket
 * @param {string} invoiceNumber - The invoice number
 * @param {Object} processedData - The processed invoice data with base64 content
 * @returns {Promise<boolean>} True if message was sent, false if user not found
 */
async function sendInvoiceToPlayer(invoiceNumber, processedData) {
    try {
        const playerId = processedData.playerId;
        
        if (!playerId) {
            console.log(`❌ No playerId found in processed invoice data for ${invoiceNumber}`);
            return false;
        }

        const ws = userConnections.get(playerId);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log(`❌ Player ${playerId} not connected or connection not open for invoice ${invoiceNumber}`);
            return false;
        }

        // Create invoice message for the player
        const invoiceMessage = {
            type: 'invoice_pdf',
            invoiceNumber: invoiceNumber,
            filename: processedData.filename,
            mimeType: 'application/pdf',
            base64Data: processedData.base64Data,
            fileSize: processedData.fileSize,
            processedAt: processedData.processedAt,
            s3Metadata: processedData.s3Metadata,
            message: `Your invoice ${invoiceNumber} has been processed and is ready`,
            timestamp: new Date().toISOString(),
            source: 'invoice-poller'
        };

        // Send the invoice to the specific player
        ws.send(JSON.stringify(invoiceMessage));
        console.log(`✅ Invoice ${invoiceNumber} sent to player ${playerId} via websocket`);
        console.log(`   Filename: ${processedData.filename}`);
        console.log(`   File Size: ${processedData.fileSize} bytes`);
        console.log(`   Base64 Length: ${processedData.base64Data.length} characters`);
        
        return true;

    } catch (error) {
        console.error(`❌ Error sending invoice ${invoiceNumber} via websocket: ${error.message}`);
        return false;
    }
}


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
     
            // Handle an invoice message that is sent by the http server when an invoice number has ben generated. We use this to register the invoice number for polling.
            if (messageData.type === 'invoice_register' && messageData.userId) {
                registerInvoice(messageData.po, messageData.playerId);
                ws.send(JSON.stringify({
                    type: 'invoice_register_response',
                    status: 'success',
                    invoiceNumber: messageData.po,
                    message: `Invoice ${messageData.po} for ${messageData.playerId} player  registered successfully`,
                    timestamp: new Date().toISOString()
                }));
                return;
            }            

            // Process game over events by forwarding to HTTP server
            if (messageData.type === 'game_event' && messageData.event === 'game_over') {
                console.log(`🎮 Forwarding game over event to HTTP server`);
                sendGameOverEvent(messageData).catch(error => {
                    console.error('Failed to process game over event:', error.message);
                });
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
                        //register on websocket event when the invoice number is available registerInvoice(response.data.orderId, messageData.customerId);
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
console.log('  Game commands: start, pause, new, endgame');
console.log('  HTTP commands: leaderboard, health, raw-get <path>');
console.log('  User commands: users, send-to <userId> <message>, broadcast <message>');
console.log('  Invoice commands: send-invoices, invoice, register-invoice <invoiceNumber> <playerId>, invoice-status');
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
    
    if (command === 'invoice') {
        console.log('📄 Sending test invoice PDF to all connected clients...');
        
        // Hardcoded base64 test PDF (small PDF with "Test Invoice" text)
        const testBase64PDF = "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R+o3gPFYQdRhM472B+fnD6b/ubzHJf83CWo3sw55fJTOcbn8aUQicP8PvmtEmwplbmRzdHJlYW0KZW5kb2JqCjE1IDAgb2JqCjw8L0ZpbHRlci9GbGF0ZURlY29kZS9MZW5ndGggMTM+PnN0cmVhbQp4nPv/f1CAPwBCPYd2CmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDIwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMjMzMiAwMDAwMCBuIAowMDAwMDAyNjIxIDAwMDAwIG4gCjAwMDAwMDIzNzcgMDAwMDAgbiAKMDAwMDAwMjE3NSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDI2NzIgMDAwMDAgbiAKMDAwMDAwMjgwNyAwMDAwMCBuIAowMDAwMDA1MDIzIDAwMDAwIG4gCjAwMDAwMDUyNzEgMDAwMDAgbiAKMDAwMDAxNDgzNSAwMDAwMCBuIAowMDAwMDAyOTQ1IDAwMDAwIG4gCjAwMDAwMDM0MzMgMDAwMDAgbiAKMDAwMDAxNDkxNSAwMDAwMCBuIAowMDAwMDE1MTY0IDAwMDAwIG4gCjAwMDAwMjYxNjQgMDAwMDAgbiAKMDAwMDAwMzk1NiAwMDAwMCBuIAowMDAwMDA0NDQwIDAwMDAwIG4gCjAwMDAwMDIwNDAgMDAwMDAgbiAKMDAwMDAwMDAxNSAwMDAwMCBuIAp0cmFpbGVyCjw8L0lEIFs8Y2NiZTMxNjA0YmIzNDJiMjFkMmYyY2Y2OWRiNjBhODc1MTQ2NjM3NDI3M2I4OTk4NzYzNzM4YmEwMGNiMmQ4YzdiYTc3NmRiY2FiNzZhM2FjNzRmNmQ4YTUzZWFmNjBhNzllNTExZWQyMWQxZjUwZGRiMjY0OWNlYmEyZDE0ZDc+PDRiZjA3Yzc1NjExN2I0ZjdmZGNkYzIzNDk3ZTdmMzRlYmQ4MjYwNGQ3NTc4Njk2MWIzNjA4NjcyNzAzM2QyOWEzZjNhZmI5MGExOTVmZjRmZjM0NmQxMDhmZTk1YTA1ZjE0NWUyMmM5NWU5YjYwMmNjMjY4YWM2ZjNmZTYwNDEzPl0vSW5mbyAzIDAgUi9Sb290IDEgMCBSL1NpemUgMjA+PgolaVRleHQtQ29yZS05LjEuMApzdGFydHhyZWYKMjYyNDQKJSVFT0YK";

        // Create invoice message
        const invoiceMessage = {
            type: 'invoice_pdf',
            filename: 'test-invoice.pdf',
            mimeType: 'application/pdf',
            base64Data: testBase64PDF,
            fileSize: Math.ceil(testBase64PDF.length * 3 / 4), // Approximate original file size
            timestamp: new Date().toISOString(),
            invoiceNumber: 'TEST-INV-' + Date.now(),
            message: 'Test invoice PDF from WebSocket server'
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
        console.log(`   Base64 Length: ${testBase64PDF.length} characters`);
        return;
    }
    
    if (command === 'invoice-status') {
        if (invoicePoller) {
            const status = invoicePoller.getStatus();
            console.log(`📄 Invoice Poller Status:`);
            console.log(`   Connected: ${status.isConnected}`);
            console.log(`   Polling: ${status.isPolling}`);
            console.log(`   Bucket: ${status.bucketName}`);
            console.log(`   Polling Interval: ${status.pollingInterval}ms`);
            console.log(`   Registered Invoices: ${status.registeredCount}`);
            console.log(`   Processed Invoices: ${status.processedCount}`);
            
            if (status.registrations.length > 0) {
                console.log(`   Current Registrations:`);
                status.registrations.forEach(reg => {
                    console.log(`     - ${reg.invoiceNumber} (${reg.playerId}) - Retries: ${reg.retryCount}`);
                });
            }
            
            if (status.processedInvoices.length > 0) {
                console.log(`   Processed Invoices:`);
                status.processedInvoices.forEach(inv => {
                    console.log(`     - ${inv.invoiceNumber} (${inv.playerId}) - ${inv.filename} - ${(inv.fileSize / 1024).toFixed(2)} KB`);
                });
            }
        } else {
            console.log(`❌ Invoice Poller not initialized`);
        }
        return;
    }
    
    
    else if (command !== '') {
        console.log(`❓ Unknown command: "${command}"`);
        console.log(`   Game commands: start, pause, new, endgame`);
        console.log(`   HTTP commands: leaderboard, health, raw-get <path>`);
        console.log(`   User commands: users, send-to <userId> <message>, broadcast <message>`);
        console.log(`   Invoice commands: send-invoices, invoice, register-invoice <invoiceNumber> <playerId>, invoice-status`);
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
