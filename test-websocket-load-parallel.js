#!/usr/bin/env node

const WebSocket = require('ws');
const crypto = require('crypto');

// Configuration
const CONFIG = {
    serverUrl: 'wss://redhat-quest-websocket-route-demo-frontend.apps.cluster-h7sqb.h7sqb.sandbox182.opentlc.com/game-control',
    numUsers: 500,
    maxConcurrentConnections: 50, // Maximum parallel connections
    delayBetweenBatches: 100, // ms between batches
    delayBetweenOrders: 10, // ms between order submissions
    maxRetries: 3,
    timeout: 30000, // 30 seconds timeout
    batchSize: 25 // Users per batch
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

// User connection class
class ParallelTestUser {
    constructor(userId, onConnected, onDisconnected) {
        this.userId = userId;
        this.ws = null;
        this.connected = false;
        this.registered = false;
        this.onConnected = onConnected;
        this.onDisconnected = onDisconnected;
        this.messageBuffer = [];
        this.orderSent = false;
        this.errors = [];
        this.startTime = Date.now();
        this.connectionStartTime = null;
        this.registrationTime = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.connectionStartTime = Date.now();
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
                        playerId: this.userId
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
                    this.registrationTime = Date.now();
                    console.log(`✅ User ${this.userId} registered successfully`);
                    this.onConnected(this);
                } else {
                    this.errors.push(`Registration failed: ${message.message}`);
                }
                break;
                
            case 'order_response':
                if (message.status === 'success') {
                    console.log(`📦 User ${this.userId} order processed: ${message.order?.trackingId || 'N/A'}`);
                } else {
                    this.errors.push(`Order failed: ${message.error || message.message}`);
                }
                this.orderSent = true;
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
            errors: this.errors,
            duration: Date.now() - this.startTime,
            connectionTime: this.connectionStartTime ? Date.now() - this.connectionStartTime : null,
            registrationTime: this.registrationTime ? this.registrationTime - this.connectionStartTime : null,
            messagesReceived: this.messageBuffer.length
        };
    }
}

// Parallel load test runner
class ParallelLoadTester {
    constructor() {
        this.users = [];
        this.completedUsers = 0;
        this.startTime = Date.now();
        this.activeConnections = 0;
        this.results = {
            totalUsers: CONFIG.numUsers,
            successfulRegistrations: 0,
            failedRegistrations: 0,
            successfulOrders: 0,
            failedOrders: 0,
            totalErrors: 0,
            duration: 0,
            errorDetails: [],
            connectionStats: {
                totalConnectionTime: 0,
                totalRegistrationTime: 0,
                averageConnectionTime: 0,
                averageRegistrationTime: 0
            }
        };
    }

    async runTest() {
        console.log('🚀 Starting Parallel WebSocket Load Test');
        console.log(`📊 Configuration:`);
        console.log(`   Server: ${CONFIG.serverUrl}`);
        console.log(`   Users: ${CONFIG.numUsers}`);
        console.log(`   Max Concurrent Connections: ${CONFIG.maxConcurrentConnections}`);
        console.log(`   Batch Size: ${CONFIG.batchSize}`);
        console.log(`   Order delay: ${CONFIG.delayBetweenOrders}ms`);
        console.log('');

        try {
            // Phase 1: Register all users in parallel batches
            await this.registerUsersInBatches();
            
            // Phase 2: Wait for all registrations to complete
            await this.waitForRegistrations();
            
            // Phase 3: Send orders in parallel
            await this.sendOrdersInParallel();
            
            // Phase 4: Wait for all orders to complete
            await this.waitForOrders();
            
        } catch (error) {
            console.error('❌ Load test failed:', error.message);
        } finally {
            await this.cleanup();
            this.generateReport();
        }
    }

    async registerUsersInBatches() {
        console.log('📝 Phase 1: Registering users in parallel batches...');
        
        const batches = this.createBatches(CONFIG.numUsers, CONFIG.batchSize);
        let totalProcessed = 0;
        
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`📝 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} users)`);
            
            // Process batch in parallel
            const batchPromises = batch.map(userId => this.createUser(userId));
            
            try {
                const batchUsers = await Promise.allSettled(batchPromises);
                
                // Add successful users to our collection
                batchUsers.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        this.users.push(result.value);
                    } else {
                        console.error(`❌ Failed to create user ${batch[index]}:`, result.reason.message);
                        this.results.failedRegistrations++;
                        this.results.errorDetails.push({ userId: batch[index], error: result.reason.message });
                    }
                });
                
                totalProcessed += batch.length;
                console.log(`📝 Batch ${batchIndex + 1} complete: ${totalProcessed}/${CONFIG.numUsers} users processed`);
                
                // Small delay between batches to avoid overwhelming the server
                if (batchIndex < batches.length - 1) {
                    await this.sleep(CONFIG.delayBetweenBatches);
                }
                
            } catch (error) {
                console.error(`❌ Batch ${batchIndex + 1} failed:`, error.message);
            }
        }
        
        console.log(`📝 Registration phase complete: ${this.users.length} users connected`);
    }

    async createUser(userId) {
        return new Promise(async (resolve, reject) => {
            try {
                const user = new ParallelTestUser(userId, this.onUserConnected.bind(this), this.onUserDisconnected.bind(this));
                await user.connect();
                resolve(user);
            } catch (error) {
                reject(error);
            }
        });
    }

    createBatches(totalUsers, batchSize) {
        const batches = [];
        for (let i = 0; i < totalUsers; i += batchSize) {
            const batch = [];
            for (let j = i; j < Math.min(i + batchSize, totalUsers); j++) {
                batch.push(this.generateLetterUsername(j));
            }
            batches.push(batch);
        }
        return batches;
    }

    async waitForRegistrations() {
        console.log('⏳ Phase 2: Waiting for registrations to complete...');
        
        const timeout = Date.now() + CONFIG.timeout;
        let lastReportedCount = 0;
        
        while (Date.now() < timeout && this.completedUsers < this.users.length) {
            await this.sleep(100);
            
            // Report progress every 10 users
            if (this.completedUsers - lastReportedCount >= 10) {
                console.log(`⏳ ${this.completedUsers}/${this.users.length} users registered`);
                lastReportedCount = this.completedUsers;
            }
        }
        
        const successfulRegistrations = this.users.filter(u => u.registered).length;
        console.log(`⏳ Registration checks complete: ${successfulRegistrations}/${this.users.length} successfully registered`);
    }

    async sendOrdersInParallel() {
        console.log('📤 Phase 3: Sending orders in parallel...');
        
        const registeredUsers = this.users.filter(u => u.registered);
        const orderBatches = this.createBatches(registeredUsers.length, CONFIG.maxConcurrentConnections);
        
        for (let batchIndex = 0; batchIndex < orderBatches.length; batchIndex++) {
            const batch = orderBatches[batchIndex];
            console.log(`📤 Processing order batch ${batchIndex + 1}/${orderBatches.length} (${batch.length} orders)`);
            
            // Send orders in parallel
            const orderPromises = batch.map(user => user.sendOrder());
            
            try {
                const results = await Promise.allSettled(orderPromises);
                
                let successCount = 0;
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value) {
                        successCount++;
                    } else {
                        const user = batch[index];
                        console.error(`❌ Failed to send order for user ${user.userId}`);
                        this.results.errorDetails.push({ userId: user.userId, error: 'Order send failed' });
                    }
                });
                
                console.log(`📤 Order batch ${batchIndex + 1} complete: ${successCount}/${batch.length} orders sent successfully`);
                
                // Small delay between order batches
                if (batchIndex < orderBatches.length - 1) {
                    await this.sleep(CONFIG.delayBetweenOrders);
                }
                
            } catch (error) {
                console.error(`❌ Order batch ${batchIndex + 1} failed:`, error.message);
            }
        }
        
        console.log(`📤 Order phase complete: ${registeredUsers.length} orders submitted`);
    }

    async waitForOrders() {
        console.log('⏳ Phase 4: Waiting for orders to complete...');
        
        const timeout = Date.now() + CONFIG.timeout;
        let lastReportedCount = 0;
        
        while (Date.now() < timeout && this.users.some(u => u.registered && !u.orderSent)) {
            await this.sleep(500);
            
            const completedOrders = this.users.filter(u => u.registered && u.orderSent).length;
            const totalExpected = this.users.filter(u => u.registered).length;
            
            // Report progress every 20 orders
            if (completedOrders - lastReportedCount >= 20) {
                console.log(`⏳ ${completedOrders}/${totalExpected} orders completed`);
                lastReportedCount = completedOrders;
            }
        }
        
        const successfulOrders = this.users.filter(u => u.registered && u.orderSent).length;
        console.log(`⏳ Order checks complete: ${successfulOrders}/${this.users.filter(u => u.registered).length} orders completed`);
    }

    async cleanup() {
        console.log('🧹 Cleaning up connections...');
        
        // Disconnect all users in parallel batches
        const cleanupBatches = this.createBatches(this.users.length, CONFIG.maxConcurrentConnections);
        
        for (const batch of cleanupBatches) {
            const cleanupPromises = batch.map(user => user.disconnect());
            await Promise.allSettled(cleanupPromises);
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
        
        this.results.totalErrors = this.users.reduce((sum, user) => sum + user.errors.length, 0);
        
        // Calculate connection statistics
        const userStats = this.users.map(u => u.getStats());
        const connectionTimes = userStats.filter(s => s.connectionTime).map(s => s.connectionTime);
        const registrationTimes = userStats.filter(s => s.registrationTime).map(s => s.registrationTime);
        
        if (connectionTimes.length > 0) {
            this.results.connectionStats.totalConnectionTime = connectionTimes.reduce((sum, time) => sum + time, 0);
            this.results.connectionStats.averageConnectionTime = this.results.connectionStats.totalConnectionTime / connectionTimes.length;
        }
        
        if (registrationTimes.length > 0) {
            this.results.connectionStats.totalRegistrationTime = registrationTimes.reduce((sum, time) => sum + time, 0);
            this.results.connectionStats.averageRegistrationTime = this.results.connectionStats.totalRegistrationTime / registrationTimes.length;
        }
        
        console.log('\n📊 PARALLEL LOAD TEST REPORT');
        console.log('============================');
        console.log(`Total Users: ${this.results.totalUsers}`);
        console.log(`Successful Registrations: ${this.results.successfulRegistrations}`);
        console.log(`Failed Registrations: ${this.results.failedRegistrations}`);
        console.log(`Successful Orders: ${this.results.successfulOrders}`);
        console.log(`Failed Orders: ${this.results.failedOrders}`);
        console.log(`Total Errors: ${this.results.totalErrors}`);
        console.log(`Total Duration: ${(this.results.duration / 1000).toFixed(2)}s`);
        console.log(`Average Response Time: ${(this.results.duration / this.results.totalUsers).toFixed(2)}ms per user`);
        console.log(`Average Connection Time: ${this.results.connectionStats.averageConnectionTime.toFixed(2)}ms`);
        console.log(`Average Registration Time: ${this.results.connectionStats.averageRegistrationTime.toFixed(2)}ms`);
        console.log(`Throughput: ${(this.results.totalUsers / (this.results.duration / 1000)).toFixed(2)} users/second`);
        
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
        const failedUsers = this.users.filter(u => u.errors.length > 0 || !u.registered || !u.orderSent);
        if (failedUsers.length > 0) {
            console.log('\n🔍 FAILED USER DETAILS:');
            failedUsers.slice(0, 5).forEach(user => {
                console.log(`   ${user.userId}:`);
                console.log(`     Registered: ${user.registered}`);
                console.log(`     Order Sent: ${user.orderSent}`);
                console.log(`     Errors: ${user.errors.length}`);
                if (user.errors.length > 0) {
                    console.log(`     First Error: ${user.errors[0]}`);
                }
            });
        }
        
        console.log('\n✅ Parallel load test complete!');
        
        // Exit with appropriate code
        if (this.results.failedRegistrations > 0 || this.results.failedOrders > 0) {
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
        
        return `parallelUser${username}`;
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
        console.log('Parallel WebSocket Load Test');
        console.log('');
        console.log('Usage: node test-websocket-load-parallel.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  --help, -h          Show this help message');
        console.log('  --users <number>    Number of users to test (default: 500)');
        console.log('  --server <url>      WebSocket server URL');
        console.log('  --batch-size <num>   Users per batch (default: 25)');
        console.log('  --max-concurrent <num> Maximum concurrent connections (default: 50)');
        console.log('  --order-delay <ms>  Delay between order batches in ms (default: 10)');
        console.log('  --batch-delay <ms>  Delay between registration batches in ms (default: 100)');
        console.log('');
        console.log('Example:');
        console.log('  node test-websocket-load-parallel.js --users 1000 --batch-size 50 --max-concurrent 100');
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
    
    let batchSizeIndex = args.indexOf('--batch-size');
    if (batchSizeIndex !== -1 && batchSizeIndex + 1 < args.length) {
        CONFIG.batchSize = parseInt(args[batchSizeIndex + 1]) || CONFIG.batchSize;
    }
    
    let maxConcurrentIndex = args.indexOf('--max-concurrent');
    if (maxConcurrentIndex !== -1 && maxConcurrentIndex + 1 < args.length) {
        CONFIG.maxConcurrentConnections = parseInt(args[maxConcurrentIndex + 1]) || CONFIG.maxConcurrentConnections;
    }
    
    let orderDelayIndex = args.indexOf('--order-delay');
    if (orderDelayIndex !== -1 && orderDelayIndex + 1 < args.length) {
        CONFIG.delayBetweenOrders = parseInt(args[orderDelayIndex + 1]) || CONFIG.delayBetweenOrders;
    }
    
    let batchDelayIndex = args.indexOf('--batch-delay');
    if (batchDelayIndex !== -1 && batchDelayIndex + 1 < args.length) {
        CONFIG.delayBetweenBatches = parseInt(args[batchDelayIndex + 1]) || CONFIG.delayBetweenBatches;
    }
    
    // Run the test
    const tester = new ParallelLoadTester();
    await tester.runTest();
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Parallel load test interrupted by user');
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
        console.error('❌ Parallel load test failed:', error.message);
        process.exit(1);
    });
}

module.exports = { ParallelLoadTester, ParallelTestUser };
