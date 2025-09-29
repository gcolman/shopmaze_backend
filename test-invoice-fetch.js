#!/usr/bin/env node

/**
 * Test Script for Fetching Invoice from WebSocket Server
 * Tests the request_invoice functionality by connecting to the websocket server
 * and requesting a specific invoice by number
 */

const WebSocket = require('ws');

// Configuration
const WS_URL = 'ws://localhost:8080/game-control';
const TEST_INVOICE_NUMBER = '1003';
const TEST_USER_ID = 'test-user-invoice-fetch';
const CONNECTION_TIMEOUT = 10000; // 10 seconds
const RESPONSE_TIMEOUT = 15000; // 15 seconds

class InvoiceTestClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.testResults = {
            connectionSuccess: false,
            registrationSuccess: false,
            invoiceRequestSent: false,
            invoiceReceived: false,
            invoiceData: null,
            errors: []
        };
    }

    /**
     * Run the complete test suite
     */
    async runTest() {
        console.log('🧪 Starting Invoice Fetch Test');
        console.log(`📄 Testing invoice number: ${TEST_INVOICE_NUMBER}`);
        console.log(`🔗 WebSocket URL: ${WS_URL}`);
        console.log(`👤 Test User ID: ${TEST_USER_ID}`);
        console.log('');

        try {
            // Step 1: Connect to WebSocket server
            await this.connect();
            
            // Step 2: Register with the server
            await this.register();
            
            // Step 3: Request the invoice
            await this.requestInvoice();
            
            // Step 4: Wait for response
            await this.waitForInvoiceResponse();
            
            // Step 5: Display results
            this.displayResults();
            
        } catch (error) {
            console.error(`❌ Test failed: ${error.message}`);
            this.testResults.errors.push(error.message);
            this.displayResults();
        } finally {
            this.cleanup();
        }
    }

    /**
     * Connect to the WebSocket server
     */
    connect() {
        return new Promise((resolve, reject) => {
            console.log('🔌 Connecting to WebSocket server...');
            
            this.ws = new WebSocket(WS_URL);
            
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, CONNECTION_TIMEOUT);

            this.ws.on('open', () => {
                clearTimeout(timeout);
                this.isConnected = true;
                this.testResults.connectionSuccess = true;
                console.log('✅ Connected to WebSocket server');
                resolve();
            });

            this.ws.on('error', (error) => {
                clearTimeout(timeout);
                console.error(`❌ WebSocket error: ${error.message}`);
                reject(error);
            });

            this.ws.on('close', (code, reason) => {
                this.isConnected = false;
                console.log(`🔌 Connection closed (${code}): ${reason}`);
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });
        });
    }

    /**
     * Register with the WebSocket server
     */
    register() {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Not connected to WebSocket server'));
                return;
            }

            console.log('📝 Registering with WebSocket server...');

            const registrationMessage = {
                type: 'register',
                userId: TEST_USER_ID,
                timestamp: new Date().toISOString()
            };

            // Set up one-time listener for registration response
            this.registrationResolver = resolve;
            this.registrationRejecter = reject;

            // Send registration message
            this.ws.send(JSON.stringify(registrationMessage));
            console.log('📤 Registration message sent');

            // Timeout for registration
            setTimeout(() => {
                if (this.registrationResolver) {
                    this.registrationRejecter(new Error('Registration timeout'));
                    this.registrationResolver = null;
                    this.registrationRejecter = null;
                }
            }, 5000);
        });
    }

    /**
     * Request the invoice
     */
    requestInvoice() {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Not connected to WebSocket server'));
                return;
            }

            console.log(`📄 Requesting invoice ${TEST_INVOICE_NUMBER}...`);

            const invoiceRequestMessage = {
                type: 'request_invoice',
                invoiceNumber: TEST_INVOICE_NUMBER,
                timestamp: new Date().toISOString()
            };

            // Send the invoice request
            this.ws.send(JSON.stringify(invoiceRequestMessage));
            this.testResults.invoiceRequestSent = true;
            console.log('📤 Invoice request message sent');
            resolve();
        });
    }

    /**
     * Wait for invoice response
     */
    waitForInvoiceResponse() {
        return new Promise((resolve, reject) => {
            console.log('⏳ Waiting for invoice response...');

            this.invoiceResponseResolver = resolve;
            this.invoiceResponseRejecter = reject;

            // Timeout for invoice response
            setTimeout(() => {
                if (this.invoiceResponseResolver) {
                    this.invoiceResponseRejecter(new Error('Invoice response timeout'));
                    this.invoiceResponseResolver = null;
                    this.invoiceResponseRejecter = null;
                }
            }, RESPONSE_TIMEOUT);
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            console.log(`📨 Received message type: ${message.type}`);

            switch (message.type) {
                case 'welcome':
                    console.log(`🎉 Welcome message: ${message.message}`);
                    break;

                case 'register_response':
                    this.handleRegistrationResponse(message);
                    break;

                case 'invoice_pdf':
                    this.handleInvoiceResponse(message);
                    break;

                case 'invoice_response':
                    this.handleInvoiceErrorResponse(message);
                    break;

                default:
                    console.log(`📄 Other message: ${JSON.stringify(message, null, 2)}`);
            }
        } catch (error) {
            console.error(`❌ Error parsing message: ${error.message}`);
            console.log(`Raw data: ${data.toString()}`);
        }
    }

    /**
     * Handle registration response
     */
    handleRegistrationResponse(message) {
        if (message.status === 'success') {
            console.log(`✅ Registration successful: ${message.message}`);
            this.testResults.registrationSuccess = true;
            
            if (this.registrationResolver) {
                this.registrationResolver();
                this.registrationResolver = null;
                this.registrationRejecter = null;
            }
        } else {
            console.error(`❌ Registration failed: ${message.message}`);
            if (this.registrationRejecter) {
                this.registrationRejecter(new Error(`Registration failed: ${message.message}`));
                this.registrationResolver = null;
                this.registrationRejecter = null;
            }
        }
    }

    /**
     * Handle successful invoice response
     */
    handleInvoiceResponse(message) {
        console.log(`✅ Invoice received successfully!`);
        console.log(`📄 Invoice Number: ${message.invoiceNumber}`);
        console.log(`📁 Filename: ${message.filename}`);
        console.log(`📏 File Size: ${message.fileSize} bytes`);
        console.log(`📅 Processed At: ${message.processedAt}`);
        console.log(`🔗 Source: ${message.source}`);
        
        if (message.base64Data) {
            console.log(`📊 Base64 Data Length: ${message.base64Data.length} characters`);
            console.log(`📄 Base64 Preview: ${message.base64Data.substring(0, 100)}...`);
        }

        this.testResults.invoiceReceived = true;
        this.testResults.invoiceData = {
            invoiceNumber: message.invoiceNumber,
            filename: message.filename,
            fileSize: message.fileSize,
            processedAt: message.processedAt,
            base64Length: message.base64Data ? message.base64Data.length : 0,
            hasBase64Data: !!message.base64Data
        };

        if (this.invoiceResponseResolver) {
            this.invoiceResponseResolver();
            this.invoiceResponseResolver = null;
            this.invoiceResponseRejecter = null;
        }
    }

    /**
     * Handle invoice error response
     */
    handleInvoiceErrorResponse(message) {
        console.error(`❌ Invoice request failed: ${message.message}`);
        console.error(`📄 Invoice Number: ${message.invoiceNumber}`);
        console.error(`❌ Error: ${message.error || 'Unknown error'}`);

        const errorMsg = `Invoice request failed: ${message.message}`;
        this.testResults.errors.push(errorMsg);

        if (this.invoiceResponseRejecter) {
            this.invoiceResponseRejecter(new Error(errorMsg));
            this.invoiceResponseResolver = null;
            this.invoiceResponseRejecter = null;
        }
    }

    /**
     * Display test results
     */
    displayResults() {
        console.log('\n' + '='.repeat(60));
        console.log('🧪 TEST RESULTS');
        console.log('='.repeat(60));
        
        console.log(`🔗 Connection Success: ${this.testResults.connectionSuccess ? '✅' : '❌'}`);
        console.log(`📝 Registration Success: ${this.testResults.registrationSuccess ? '✅' : '❌'}`);
        console.log(`📤 Invoice Request Sent: ${this.testResults.invoiceRequestSent ? '✅' : '❌'}`);
        console.log(`📄 Invoice Received: ${this.testResults.invoiceReceived ? '✅' : '❌'}`);
        
        if (this.testResults.invoiceData) {
            console.log('\n📄 Invoice Data:');
            console.log(`   Invoice Number: ${this.testResults.invoiceData.invoiceNumber}`);
            console.log(`   Filename: ${this.testResults.invoiceData.filename}`);
            console.log(`   File Size: ${this.testResults.invoiceData.fileSize} bytes`);
            console.log(`   Processed At: ${this.testResults.invoiceData.processedAt}`);
            console.log(`   Has Base64 Data: ${this.testResults.invoiceData.hasBase64Data ? '✅' : '❌'}`);
            console.log(`   Base64 Length: ${this.testResults.invoiceData.base64Length} characters`);
        }

        if (this.testResults.errors.length > 0) {
            console.log('\n❌ Errors:');
            this.testResults.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }

        // Overall test result
        const allTestsPassed = this.testResults.connectionSuccess && 
                              this.testResults.registrationSuccess && 
                              this.testResults.invoiceRequestSent && 
                              this.testResults.invoiceReceived &&
                              this.testResults.errors.length === 0;

        console.log('\n' + '='.repeat(60));
        console.log(`🧪 OVERALL RESULT: ${allTestsPassed ? '✅ PASSED' : '❌ FAILED'}`);
        console.log('='.repeat(60));
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        console.log('\n🧹 Cleaning up...');
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        console.log('✅ Cleanup complete');
    }
}

// Main execution
async function main() {
    const testClient = new InvoiceTestClient();
    await testClient.runTest();
    
    // Exit with appropriate code
    const success = testClient.testResults.invoiceReceived && 
                   testClient.testResults.errors.length === 0;
    process.exit(success ? 0 : 1);
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted by user');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run the test
if (require.main === module) {
    main().catch(error => {
        console.error(`❌ Test execution failed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { InvoiceTestClient };
