#!/usr/bin/env node

/**
 * Test Invoice Command
 * Connects to WebSocket server and listens for invoice PDF messages
 */

const WebSocket = require('ws');

function testInvoiceCommand() {
    console.log('🧪 Testing Invoice Command via WebSocket');
    console.log('=======================================\n');

    // Connect to WebSocket server
    const ws = new WebSocket('ws://localhost:8080/game-control');

    ws.on('open', () => {
        console.log('✅ Connected to WebSocket server');
        console.log('👂 Listening for invoice PDF messages...');
        console.log('💡 Run "invoice" command in the WebSocket server console to test\n');
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'invoice_pdf') {
                console.log('📄 Received invoice PDF message:');
                console.log(`   Type: ${message.type}`);
                console.log(`   Filename: ${message.filename}`);
                console.log(`   Invoice Number: ${message.invoiceNumber}`);
                console.log(`   MIME Type: ${message.mimeType}`);
                console.log(`   File Size: ${message.fileSize} bytes`);
                console.log(`   Base64 Length: ${message.base64Data.length} characters`);
                console.log(`   Timestamp: ${message.timestamp}`);
                console.log(`   Message: ${message.message}`);
                console.log(`   Base64 Preview: ${message.base64Data.substring(0, 50)}...`);
                
                // Verify it's valid base64
                try {
                    const buffer = Buffer.from(message.base64Data, 'base64');
                    console.log(`   ✅ Valid base64 data (${buffer.length} bytes decoded)`);
                    
                    // Check if it starts with PDF header
                    if (buffer.toString('ascii', 0, 4) === '%PDF') {
                        console.log(`   ✅ Valid PDF file detected`);
                    } else {
                        console.log(`   ⚠️  Does not appear to be a valid PDF (header: ${buffer.toString('ascii', 0, 4)})`);
                    }
                } catch (error) {
                    console.log(`   ❌ Invalid base64 data: ${error.message}`);
                }
                
                console.log('');
            } else {
                console.log(`📨 Received other message: ${message.type || 'unknown type'}`);
            }
        } catch (error) {
            console.log(`📨 Received non-JSON message: ${data.toString().substring(0, 100)}...`);
        }
    });

    ws.on('error', (error) => {
        console.error(`❌ WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
        console.log('🔌 WebSocket connection closed');
    });

    // Handle interruption gracefully
    process.on('SIGINT', () => {
        console.log('\n⚠️ Test interrupted by user');
        ws.close();
        process.exit(0);
    });

    // Keep the connection alive
    console.log('🔄 Test running... Press Ctrl+C to stop');
}

// Run the test
if (require.main === module) {
    testInvoiceCommand();
}

module.exports = { testInvoiceCommand };
