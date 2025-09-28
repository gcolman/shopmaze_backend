#!/usr/bin/env node

/**
 * WebSocket Client Module
 * Provides a reusable WebSocket client for communicating with WebSocket servers
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

class WebSocketClient extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            url: options.url || 'ws://localhost:8080/game-control',
            userId: options.userId || 'websocket-client',
            autoReconnect: options.autoReconnect !== false, // Default true
            maxReconnectAttempts: options.maxReconnectAttempts || 5,
            reconnectDelay: options.reconnectDelay || 1000, // Base delay in ms
            timeout: options.timeout || 30000,
            ...options
        };

        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.messageQueue = [];
        this.isReconnecting = false;
    }

    /**
     * Connect to the WebSocket server
     * @returns {Promise<boolean>} True if connection successful
     */
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                console.log(`🔗 Connecting to WebSocket server: ${this.config.url}`);
                
                this.ws = new WebSocket(this.config.url);
                
                // Connection timeout
                const timeout = setTimeout(() => {
                    if (this.ws.readyState === WebSocket.CONNECTING) {
                        this.ws.terminate();
                        reject(new Error('Connection timeout'));
                    }
                }, this.config.timeout);

                this.ws.on('open', () => {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.isReconnecting = false;
                    
                    console.log(`✅ Connected to WebSocket server: ${this.config.url}`);
                    
                    // Register with the server
                    this.register();
                    
                    // Process queued messages
                    this.processMessageQueue();
                    
                    this.emit('connected');
                    resolve(true);
                });

                this.ws.on('close', (code, reason) => {
                    clearTimeout(timeout);
                    this.isConnected = false;
                    
                    console.log(`🔌 WebSocket connection closed (${code}): ${reason}`);
                    this.emit('disconnected', { code, reason });
                    
                    // Auto-reconnect if enabled
                    if (this.config.autoReconnect && !this.isReconnecting) {
                        this.handleReconnection();
                    }
                    
                    if (this.ws.readyState === WebSocket.CONNECTING) {
                        reject(new Error(`Connection failed: ${code} - ${reason}`));
                    }
                });

                this.ws.on('error', (error) => {
                    clearTimeout(timeout);
                    console.error(`❌ WebSocket error: ${error.message}`);
                    this.emit('error', error);
                    
                    if (this.ws.readyState === WebSocket.CONNECTING) {
                        reject(error);
                    }
                });

                this.ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.handleMessage(message);
                    } catch (error) {
                        console.error(`❌ Error parsing WebSocket message: ${error.message}`);
                        this.emit('parseError', error, data.toString());
                    }
                });

            } catch (error) {
                console.error(`❌ Error creating WebSocket connection: ${error.message}`);
                reject(error);
            }
        });
    }

    /**
     * Handle incoming messages
     * @param {Object} message - Parsed message object
     * @private
     */
    handleMessage(message) {
        // Handle registration response
        if (message.type === 'register_response') {
            console.log(`📝 Registration response: ${message.message}`);
            this.emit('registered', message);
            return;
        }

        // Handle invoice registration response
        if (message.type === 'invoice_register_response') {
            console.log(`📄 Invoice registration response: ${message.message}`);
            this.emit('invoiceRegistered', message);
            return;
        }

        // Emit generic message event
        this.emit('message', message);
    }

    /**
     * Register with the WebSocket server
     * @private
     */
    register() {
        const registrationMessage = {
            type: 'register',
            userId: this.config.userId,
            timestamp: new Date().toISOString(),
            source: 'websocket-client'
        };

        this.send(registrationMessage);
    }

    /**
     * Send a message to the WebSocket server
     * @param {Object} message - Message object to send
     * @returns {boolean} True if message was sent, false if queued
     */
    send(message) {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            // Queue message for later sending
            this.messageQueue.push(message);
            console.log(`📦 Message queued (connection not ready): ${message.type}`);
            return false;
        }

        try {
            const messageString = JSON.stringify(message);
            this.ws.send(messageString);
            console.log(`📤 Message sent: ${message.type}`);
            return true;
        } catch (error) {
            console.error(`❌ Error sending message: ${error.message}`);
            this.emit('sendError', error, message);
            return false;
        }
    }

    /**
     * Send invoice registration message
     * @param {string} invoiceNumber - Invoice number to register
     * @param {string} userId - User/player ID
     * @returns {boolean} True if message was sent
     */
    registerInvoice(invoiceNumber, userId) {
        const message = {
            type: 'invoice_register',
            invoiceNumber: invoiceNumber,
            userId: userId,
            timestamp: new Date().toISOString(),
            source: 'websocket-client'
        };

        return this.send(message);
    }

    /**
     * Send invoice PDF data
     * @param {string} invoiceNumber - Invoice number
     * @param {Object} invoiceData - Invoice data with base64 content
     * @returns {boolean} True if message was sent
     */
    sendInvoicePDF(invoiceNumber, invoiceData) {
        const message = {
            type: 'invoice-pdf',
            invoiceNumber: invoiceNumber,
            filename: invoiceData.filename,
            mimeType: invoiceData.mimeType || 'application/pdf',
            base64Data: invoiceData.base64Data,
            fileSize: invoiceData.fileSize,
            processedAt: invoiceData.processedAt,
            s3Metadata: invoiceData.s3Metadata,
            playerId: invoiceData.playerId,
            timestamp: new Date().toISOString(),
            source: 'websocket-client'
        };

        return this.send(message);
    }

    /**
     * Process queued messages
     * @private
     */
    processMessageQueue() {
        if (this.messageQueue.length === 0) return;

        console.log(`📦 Processing ${this.messageQueue.length} queued messages`);
        
        const messages = [...this.messageQueue];
        this.messageQueue = [];

        messages.forEach(message => {
            this.send(message);
        });
    }

    /**
     * Handle reconnection logic
     * @private
     */
    handleReconnection() {
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            console.error(`❌ Max reconnection attempts (${this.config.maxReconnectAttempts}) reached`);
            this.emit('maxReconnectAttemptsReached');
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        // Exponential backoff
        const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`🔄 Attempting to reconnect in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
        
        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect();
            } catch (error) {
                console.error(`❌ Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`);
                this.handleReconnection(); // Try again
            }
        }, delay);
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect() {
        console.log('🔌 Disconnecting from WebSocket server...');
        
        this.config.autoReconnect = false; // Disable auto-reconnect
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.messageQueue = [];
        
        this.emit('disconnected', { code: 1000, reason: 'Manual disconnect' });
    }

    /**
     * Get connection status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            isReconnecting: this.isReconnecting,
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.config.maxReconnectAttempts,
            queuedMessages: this.messageQueue.length,
            url: this.config.url,
            userId: this.config.userId,
            readyState: this.ws ? this.ws.readyState : null,
            readyStateText: this.ws ? this.getReadyStateText() : 'Not connected'
        };
    }

    /**
     * Get human-readable ready state
     * @returns {string} Ready state text
     * @private
     */
    getReadyStateText() {
        if (!this.ws) return 'Not connected';
        
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'Connecting';
            case WebSocket.OPEN: return 'Open';
            case WebSocket.CLOSING: return 'Closing';
            case WebSocket.CLOSED: return 'Closed';
            default: return 'Unknown';
        }
    }

    /**
     * Wait for connection to be established
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<boolean>} True if connected within timeout
     */
    waitForConnection(timeout = 10000) {
        return new Promise((resolve) => {
            if (this.isConnected) {
                resolve(true);
                return;
            }

            const timer = setTimeout(() => {
                this.removeListener('connected', onConnected);
                resolve(false);
            }, timeout);

            const onConnected = () => {
                clearTimeout(timer);
                resolve(true);
            };

            this.once('connected', onConnected);
        });
    }
}

module.exports = { WebSocketClient };
