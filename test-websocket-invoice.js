#!/usr/bin/env node

const WebSocket = require('ws');
const crypto = require('crypto');

// Configuration
const CONFIG = {
    serverUrl: 'wss://redhat-quest-websocket-route-demo-frontend.apps.cluster-h7sqb.h7sqb.sandbox182.opentlc.com/game-control',
    numUsers: 2, // Reduced for invoice testing
    delayBetweenRegistrations: 10, // ms between user registrations
    delayBeforeOrders: 100, // ms after all registrations before starting orders
    delayBetweenOrders: 100, // ms between order submissions
    maxRetries: 3,
    timeout: 60000, // 60 seconds timeout (increased for invoice processing)
    invoiceTimeout: 30000 // 30 seconds timeout for invoice processing
};

// Generate sample order data
function generateRandomOrder(userId) {
    const items = [
        { description: 'Ansible T-Shirt', quantity: Math.floor(Math.random() * 5) + 1, unitPrice: 25 },
        { description: 'Red Hat Hoodie', quantity: Math.floor(Math.random() * 3) + 1, unitPrice: 75 },
        { description: 'Kubernetes Mug', quantity: Math.floor(Math.random() * 4) + 1, unitPrice: 15 },
        { description: 'DevOps Sticker Pack', quantity: Math.floor(Math.random() * 10) + 1, unitPrice: 8 }
    ];

    // Select 1-3 random items
    const selectedItems = [];
    const numItems = Math.floor(Math.random() * 3) + 1;
    
    for (let i = 0; i < numItems; i++) {
        const randomItem = items[Math.floor(Math.random() * items.length)];
        selectedItems.push(randomItem);
    }

    return {
        customerName: userId,
        customerEmail: `${userId}@example.com`,
        items: selectedItems
    };
}

// User connection class for invoice testing
class InvoiceTestUser {
    constructor(userId, onConnected, onDisconnected) {
        this.userId = userId;
        this.ws = null;
        this.connected = false;
        this.registered = false;
        this.onConnected = onConnected;
        this.onDisconnected = onDisconnected;
        this.messageBuffer = [];
        this.orderSent = false;
        this.orderProcessed = false;
        this.invoiceReady = false;
        this.invoiceRequested = false;
        this.invoiceReceived = false;
        this.invoiceNumber = null;
        this.errors = [];
        this.startTime = Date.now();
        this.invoiceStartTime = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(CONFIG.serverUrl);
                
                const timeout = setTimeout(() => {
                    this.errors.push('Connection timeout');
                    reject(new Error(`Connection timeout for user ${this.userId}`));
                }, CONFIG.timeout);

                this.ws.on('open', () => {
                    clearTimeout(timeout);
                    this.connected = true;
                    this.send({
                        type: 'register',
                        playerId: this.userId // Use playerId for registration
                    });
                    resolve();
                });

                this.ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        this.messageBuffer.push(message);
                        this.handleMessage(message);
                    } catch (error) {
                        this.errors.push(`Message parse error: ${error.message}`);
                    }
                });

                this.ws.on('close', () => {
                    this.onDisconnected(this);
                });

                this.ws.on('error', (error) => {
                    clearTimeout(timeout);
                    this.errors.push(`WebSocket error: ${error.message}`);
                    reject(error);
                });

            } catch (error) {
                this.errors.push(`Connection error: ${error.message}`);
                reject(error);
            }
        });
    }

    handleMessage(message) {
        switch (message.type) {
            case 'register_response':
                if (message.status === 'success') {
                    this.registered = true;
                    console.log(`✅ User ${this.userId} registered successfully`);
                    this.onConnected(this);
                } else {
                    this.errors.push(`Registration failed: ${message.message}`);
                }
                break;
                
            case 'order_response':
                if (message.status === 'success') {
                    console.log(`📦 User ${this.userId} order processed: ${message.orderId || 'N/A'}`);
                    this.orderProcessed = true;
                    
                    // Extract invoice number from order response if available
                    if (message.orderId) {
                        this.invoiceNumber = message.orderId;
                    }
                } else {
                    this.errors.push(`Order failed: ${message.error || message.message}`);
                }
                this.orderSent = true;
                break;
                
            case 'invoice_ready':
                console.log(`📄 User ${this.userId} received invoice ready notification for invoice ${message.invoiceNumber}`);
                this.invoiceReady = true;
                this.invoiceNumber = message.invoiceNumber;
                this.invoiceStartTime = Date.now();
                
                // Automatically request the invoice
                this.requestInvoice();
                break;
                
            case 'invoice_pdf':
                if (message.status === 'success') {
                    console.log(`📄 User ${this.userId} received invoice PDF for ${message.invoiceNumber}`);
                    this.invoiceReceived = true;
                } else {
                    this.errors.push(`Invoice request failed: ${message.message}`);
                }
                break;
                
            case 'invoice_response':
                if (message.status === 'error') {
                    this.errors.push(`Invoice response error: ${message.message}`);
                }
                break;
                
            case 'game_status':
                // Ignore game status messages
                break;
                
            default:
                // console.log(`📨 User ${this.userId} received: ${message.type}`);
                break;
        }
    }

    async sendOrder() {
        if (!this.connected || !this.registered) {
            this.errors.push('Cannot send order: not connected or registered');
            return false;
        }

        const orderData = generateRandomOrder(this.userId);
        
        try {
            this.send({
                type: 'order',
                data: orderData,
                timestamp: new Date().toISOString()
            });
            
            console.log(`📤 User ${this.userId} sent order with ${orderData.items.length} items`);
            return true;
        } catch (error) {
            this.errors.push(`Failed to send order: ${error.message}`);
            return false;
        }
    }

    async requestInvoice() {
        if (!this.invoiceNumber) {
            this.errors.push('Cannot request invoice: no invoice number available');
            return false;
        }

        if (!this.connected || !this.registered) {
            this.errors.push('Cannot request invoice: not connected or registered');
            return false;
        }

        try {
            this.send({
                type: 'request_invoice',
                invoiceNumber: this.invoiceNumber,
                timestamp: new Date().toISOString()
            });
            
            this.invoiceRequested = true;
            console.log(`📄 User ${this.userId} requested invoice ${this.invoiceNumber}`);
            return true;
        } catch (error) {
            this.errors.push(`Failed to request invoice: ${error.message}`);
            return false;
        }
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.errors.push('WebSocket not open for sending');
        }
    }

    async disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    getStats() {
        return {
            userId: this.userId,
            connected: this.connected,
            registered: this.registered,
            orderSent: this.orderSent,
            orderProcessed: this.orderProcessed,
            invoiceReady: this.invoiceReady,
            invoiceRequested: this.invoiceRequested,
            invoiceReceived: this.invoiceReceived,
            invoiceNumber: this.invoiceNumber,
            errors: this.errors,
            duration: Date.now() - this.startTime,
            invoiceDuration: this.invoiceStartTime ? Date.now() - this.invoiceStartTime : null,
            messagesReceived: this.messageBuffer.length
        };
    }
}

// Load test runner for invoice testing
class InvoiceLoadTester {
    constructor() {
        this.users = [];
        this.completedUsers = 0;
        this.startTime = Date.now();
        this.results = {
            totalUsers: CONFIG.numUsers,
            successfulRegistrations: 0,
            failedRegistrations: 0,
            successfulOrders: 0,
            failedOrders: 0,
            successfulInvoices: 0,
            failedInvoices: 0,
            totalErrors: 0,
            duration: 0,
            errorDetails: []
        };
    }

    async runTest() {
        console.log('🚀 Starting WebSocket Invoice Load Test');
        console.log(`📊 Configuration:`);
        console.log(`   Server: ${CONFIG.serverUrl}`);
        console.log(`   Users: ${CONFIG.numUsers}`);
        console.log(`   Registration delay: ${CONFIG.delayBetweenRegistrations}ms`);
        console.log(`   Order delay: ${CONFIG.delayBetweenOrders}ms`);
        console.log(`   Invoice timeout: ${CONFIG.invoiceTimeout}ms`);
        console.log('');

        try {
            // Phase 1: Register all users
            await this.registerUsers();
            
            // Phase 2: Wait for all registrations to complete
            await this.waitForRegistrations();
            
            // Phase 3: Send orders
            await this.sendOrders();
            
            // Phase 4: Wait for all orders to complete
            await this.waitForOrders();
            
            // Phase 5: Wait for invoice ready notifications
            await this.waitForInvoiceReady();
            
            // Phase 6: Wait for invoice requests to complete
            await this.waitForInvoiceRequests();
            
        } catch (error) {
            console.error('❌ Load test failed:', error.message);
        } finally {
            await this.cleanup();
            this.generateReport();
        }
    }

    async registerUsers() {
        console.log('📝 Phase 1: Registering users...');
        
        for (let i = 0; i < CONFIG.numUsers; i++) {
            const userId = this.generateLetterUsername(i);
            const user = new InvoiceTestUser(userId, this.onUserConnected.bind(this), this.onUserDisconnected.bind(this));
            
            try {
                await user.connect();
                this.users.push(user);
                
                // Small delay between connections
                if (i < CONFIG.numUsers - 1) {
                    await this.sleep(CONFIG.delayBetweenRegistrations);
                }
                
                if ((i + 1) % 10 === 0) {
                    console.log(`📝 Registered ${i + 1}/${CONFIG.numUsers} users`);
                }
                
            } catch (error) {
                console.error(`❌ Failed to register user ${userId}:`, error.message);
                this.results.failedRegistrations++;
                this.results.errorDetails.push({ userId, error: error.message });
            }
        }
        
        console.log(`📝 Registration phase complete: ${this.users.length} users connected`);
    }

    async waitForRegistrations() {
        console.log('⏳ Phase 2: Waiting for registrations to complete...');
        
        const timeout = Date.now() + CONFIG.timeout;
        
        while (Date.now() < timeout && this.completedUsers < this.users.length) {
            await this.sleep(100);
            
            if ((this.completedUsers) % 10 === 0 && this.completedUsers > 0) {
                console.log(`⏳ ${this.completedUsers}/${this.users.length} users registered`);
            }
        }
        
        const successfulRegistrations = this.users.filter(u => u.registered).length;
        console.log(`⏳ Registration checks complete: ${successfulRegistrations}/${this.users.length} successfully registered`);
    }

    async sendOrders() {
        console.log('📤 Phase 3: Sending orders...');
        
        const registeredUsers = this.users.filter(u => u.registered);
        
        for (let i = 0; i < registeredUsers.length; i++) {
            const user = registeredUsers[i];
            
            try {
                await user.sendOrder();
                
                if ((i + 1) % 10 === 0) {
                    console.log(`📤 Sent ${i + 1}/${registeredUsers.length} orders`);
                }
                
                // Small delay between orders
                if (i < registeredUsers.length - 1) {
                    await this.sleep(CONFIG.delayBetweenOrders);
                }
                
            } catch (error) {
                console.error(`❌ Failed to send order for user ${user.userId}:`, error.message);
                this.results.errorDetails.push({ userId: user.userId, error: `Order send failed: ${error.message}` });
            }
        }
        
        console.log(`📤 Order phase complete: ${registeredUsers.length} orders submitted`);
    }

    async waitForOrders() {
        console.log('⏳ Phase 4: Waiting for orders to complete...');
        
        const timeout = Date.now() + CONFIG.timeout;
        
        while (Date.now() < timeout && this.users.some(u => u.registered && !u.orderSent)) {
            await this.sleep(500);
            
            const completedOrders = this.users.filter(u => u.registered && u.orderSent).length;
            const totalExpected = this.users.filter(u => u.registered).length;
            
            if (completedOrders % 20 === 0 && completedOrders > 0) {
                console.log(`⏳ ${completedOrders}/${totalExpected} orders completed`);
            }
        }
        
        const successfulOrders = this.users.filter(u => u.registered && u.orderSent).length;
        console.log(`⏳ Order checks complete: ${successfulOrders}/${this.users.filter(u => u.registered).length} orders completed`);
    }

    async waitForInvoiceReady() {
        console.log('📄 Phase 5: Waiting for invoice ready notifications...');
        
        const timeout = Date.now() + CONFIG.invoiceTimeout;
        
        while (Date.now() < timeout && this.users.some(u => u.registered && u.orderSent && !u.invoiceReady)) {
            await this.sleep(1000);
            
            const invoiceReady = this.users.filter(u => u.registered && u.orderSent && u.invoiceReady).length;
            const totalExpected = this.users.filter(u => u.registered && u.orderSent).length;
            
            if (invoiceReady % 10 === 0 && invoiceReady > 0) {
                console.log(`📄 ${invoiceReady}/${totalExpected} invoices ready`);
            }
        }
        
        const invoiceReadyCount = this.users.filter(u => u.registered && u.orderSent && u.invoiceReady).length;
        console.log(`📄 Invoice ready checks complete: ${invoiceReadyCount}/${this.users.filter(u => u.registered && u.orderSent).length} invoices ready`);
    }

    async waitForInvoiceRequests() {
        console.log('📄 Phase 6: Waiting for invoice requests to complete...');
        
        const timeout = Date.now() + CONFIG.invoiceTimeout;
        
        while (Date.now() < timeout && this.users.some(u => u.registered && u.invoiceReady && !u.invoiceReceived)) {
            await this.sleep(1000);
            
            const invoiceReceived = this.users.filter(u => u.registered && u.invoiceReady && u.invoiceReceived).length;
            const totalExpected = this.users.filter(u => u.registered && u.invoiceReady).length;
            
            if (invoiceReceived % 10 === 0 && invoiceReceived > 0) {
                console.log(`📄 ${invoiceReceived}/${totalExpected} invoices received`);
            }
        }
        
        const invoiceReceivedCount = this.users.filter(u => u.registered && u.invoiceReady && u.invoiceReceived).length;
        console.log(`📄 Invoice request checks complete: ${invoiceReceivedCount}/${this.users.filter(u => u.registered && u.invoiceReady).length} invoices received`);
    }

    async cleanup() {
        console.log('🧹 Cleaning up connections...');
        
        for (const user of this.users) {
            try {
                await user.disconnect();
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        
        console.log('🧹 Cleanup complete');
    }

    generateReport() {
        this.results.duration = Date.now() - this.startTime;
        
        // Count successes and failures
        this.results.successfulRegistrations = this.users.filter(u => u.registered).length;
        this.results.failedRegistrations = this.users.length - this.results.successfulRegistrations;
        
        this.results.successfulOrders = this.users.filter(u => u.registered && u.orderSent).length;
        this.results.failedOrders = this.users.filter(u => u.registered).length - this.results.successfulOrders;
        
        this.results.successfulInvoices = this.users.filter(u => u.registered && u.invoiceReady && u.invoiceReceived).length;
        this.results.failedInvoices = this.users.filter(u => u.registered && u.invoiceReady).length - this.results.successfulInvoices;
        
        this.results.totalErrors = this.users.reduce((sum, user) => sum + user.errors.length, 0);
        
        console.log('\n📊 INVOICE LOAD TEST REPORT');
        console.log('============================');
        console.log(`Total Users: ${this.results.totalUsers}`);
        console.log(`Successful Registrations: ${this.results.successfulRegistrations}`);
        console.log(`Failed Registrations: ${this.results.failedRegistrations}`);
        console.log(`Successful Orders: ${this.results.successfulOrders}`);
        console.log(`Failed Orders: ${this.results.failedOrders}`);
        console.log(`Successful Invoices: ${this.results.successfulInvoices}`);
        console.log(`Failed Invoices: ${this.results.failedInvoices}`);
        console.log(`Total Errors: ${this.results.totalErrors}`);
        console.log(`Total Duration: ${(this.results.duration / 1000).toFixed(2)}s`);
        console.log(`Average Response Time: ${(this.results.duration / this.results.totalUsers).toFixed(2)}ms per user`);
        
        if (this.results.errorDetails.length > 0) {
            console.log('\n❌ ERROR DETAILS:');
            this.results.errorDetails.slice(0, 10).forEach(error => {
                console.log(`   ${error.userId}: ${error.error}`);
            });
            
            if (this.results.errorDetails.length > 10) {
                console.log(`   ... and ${this.results.errorDetails.length - 10} more errors`);
            }
        }
        
        // Show individual user stats for failed cases
        const failedUsers = this.users.filter(u => u.errors.length > 0 || !u.registered || !u.orderSent || (u.invoiceReady && !u.invoiceReceived));
        if (failedUsers.length > 0) {
            console.log('\n🔍 FAILED USER DETAILS:');
            failedUsers.slice(0, 5).forEach(user => {
                console.log(`   ${user.userId}:`);
                console.log(`     Registered: ${user.registered}`);
                console.log(`     Order Sent: ${user.orderSent}`);
                console.log(`     Invoice Ready: ${user.invoiceReady}`);
                console.log(`     Invoice Received: ${user.invoiceReceived}`);
                console.log(`     Errors: ${user.errors.length}`);
                if (user.errors.length > 0) {
                    console.log(`     First Error: ${user.errors[0]}`);
                }
            });
        }
        
        console.log('\n✅ Invoice load test complete!');
        
        // Exit with appropriate code
        if (this.results.failedRegistrations > 0 || this.results.failedOrders > 0 || this.results.failedInvoices > 0) {
            process.exit(1);
        }
    }

    // Utility methods
    generateLetterUsername(index) {
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        let username = '';
        let num = index;
        
        // Convert number to base-26 using letters
        do {
            username = letters[num % 26] + username;
            num = Math.floor(num / 26);
        } while (num > 0);
        
        return `invoiceUser${username}`;
    }

    onUserConnected(user) {
        this.completedUsers++;
    }

    onUserDisconnected(user) {
        // Handle disconnect
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    // Parse command line arguments
    if (args.includes('--help') || args.includes('-h')) {
        console.log('WebSocket Invoice Load Test');
        console.log('');
        console.log('Usage: node test-websocket-invoice.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  --help, -h          Show this help message');
        console.log('  --users <number>    Number of users to test (default: 100)');
        console.log('  --server <url>      WebSocket server URL');
        console.log('  --delay <ms>        Delay between registrations in ms (default: 10)');
        console.log('  --order-delay <ms>  Delay between orders in ms (default: 100)');
        console.log('  --invoice-timeout <ms> Timeout for invoice processing in ms (default: 30000)');
        console.log('');
        console.log('Example:');
        console.log('  node test-websocket-invoice.js --users 50 --server ws://localhost:8080');
        return;
    }
    
    // Parse arguments
    let userIndex = args.indexOf('--users');
    if (userIndex !== -1 && userIndex + 1 < args.length) {
        CONFIG.numUsers = parseInt(args[userIndex + 1]) || CONFIG.numUsers;
    }
    
    let serverIndex = args.indexOf('--server');
    if (serverIndex !== -1 && serverIndex + 1 < args.length) {
        CONFIG.serverUrl = args[serverIndex + 1];
    }
    
    let delayIndex = args.indexOf('--delay');
    if (delayIndex !== -1 && delayIndex + 1 < args.length) {
        CONFIG.delayBetweenRegistrations = parseInt(args[delayIndex + 1]) || CONFIG.delayBetweenRegistrations;
    }
    
    let orderDelayIndex = args.indexOf('--order-delay');
    if (orderDelayIndex !== -1 && orderDelayIndex + 1 < args.length) {
        CONFIG.delayBetweenOrders = parseInt(args[orderDelayIndex + 1]) || CONFIG.delayBetweenOrders;
    }
    
    let invoiceTimeoutIndex = args.indexOf('--invoice-timeout');
    if (invoiceTimeoutIndex !== -1 && invoiceTimeoutIndex + 1 < args.length) {
        CONFIG.invoiceTimeout = parseInt(args[invoiceTimeoutIndex + 1]) || CONFIG.invoiceTimeout;
    }
    
    // Run the test
    const tester = new InvoiceLoadTester();
    await tester.runTest();
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Invoice load test interrupted by user');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    process.exit(1);
});

// Start the test
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Invoice load test failed:', error.message);
        process.exit(1);
    });
}

module.exports = { InvoiceLoadTester, InvoiceTestUser };
