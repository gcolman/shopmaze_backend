#!/usr/bin/env node

/**
 * Test Invoice Poller
 * Demonstrates invoice registration and polling functionality
 */

const { InvoicePoller } = require('./src/shared/invoicePoller');

async function testInvoicePoller() {
    console.log('🧪 Testing Invoice Poller');
    console.log('========================\n');

    // Create invoice poller instance
    const poller = new InvoicePoller({
        pollingInterval: 5000, // 5 seconds for testing
        bucketName: 'invoice',
        maxRetries: 5
    });

    try {
        // Initialize the poller
        console.log('1️⃣ Initializing Invoice Poller...');
        await poller.initialize();
        
        // Register some test invoices
        console.log('\n2️⃣ Registering test invoices...');
        poller.registerInvoice('invoice_1003', 'player-3');
        poller.registerInvoice('invoice_1004', 'player-4');
        poller.registerInvoice('invoice_1005', 'player-5'); // This should exist in your S3
        
        // Show initial status
        console.log('\n3️⃣ Initial status:');
        const status = poller.getStatus();
        console.log(`   Connected: ${status.isConnected}`);
        console.log(`   Polling: ${status.isPolling}`);
        console.log(`   Registered: ${status.registeredCount}`);
        console.log(`   Processed: ${status.processedCount}`);
        
        // Wait for some polling cycles
        console.log('\n4️⃣ Waiting for polling cycles...');
        await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds
        
        // Check status again
        console.log('\n5️⃣ Status after polling:');
        const finalStatus = poller.getStatus();
        console.log(`   Registered: ${finalStatus.registeredCount}`);
        console.log(`   Processed: ${finalStatus.processedCount}`);
        
        if (finalStatus.processedInvoices.length > 0) {
            console.log('\n6️⃣ Processed invoices:');
            finalStatus.processedInvoices.forEach(invoice => {
                console.log(`   - ${invoice.invoiceNumber} (${invoice.playerId}): ${invoice.filename} (${(invoice.fileSize / 1024).toFixed(2)} KB)`);
            });
            
            // Show first processed invoice details (without full base64)
            const firstProcessed = poller.getProcessedInvoice(finalStatus.processedInvoices[0].invoiceNumber);
            if (firstProcessed) {
                console.log('\n7️⃣ Sample processed invoice data:');
                console.log(`   Player ID: ${firstProcessed.playerId}`);
                console.log(`   Filename: ${firstProcessed.filename}`);
                console.log(`   File Size: ${firstProcessed.fileSize} bytes`);
                console.log(`   Base64 Length: ${firstProcessed.base64Data.length} characters`);
                console.log(`   Base64 Preview: ${firstProcessed.base64Data.substring(0, 100)}...`);
                console.log(`   Processed At: ${firstProcessed.processedAt}`);
            }
        } else {
            console.log('\n⚠️ No invoices were processed. Make sure there are PDF files in your S3 bucket that match the registered invoice numbers.');
        }
        
        // Test force check
        console.log('\n8️⃣ Testing force check...');
        try {
            const result = await poller.forceCheck('invoice_1003');
            console.log(`   Force check result: ${result}`);
        } catch (error) {
            console.log(`   Force check error: ${error.message}`);
        }
        
        // Test retrieval functions
        console.log('\n9️⃣ Testing retrieval functions...');
        const playerInvoices = poller.getProcessedInvoicesForPlayer('player-3');
        console.log(`   Invoices for player-3: ${playerInvoices.length}`);
        
    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
    } finally {
        // Cleanup
        console.log('\n🧹 Cleaning up...');
        await poller.shutdown();
        console.log('✅ Test completed');
    }
}

// Handle interruption gracefully
process.on('SIGINT', () => {
    console.log('\n⚠️ Test interrupted by user');
    process.exit(1);
});

// Run the test
if (require.main === module) {
    testInvoicePoller().catch(error => {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { testInvoicePoller };
