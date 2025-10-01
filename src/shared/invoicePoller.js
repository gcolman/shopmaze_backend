#!/usr/bin/env node

/**
 * Invoice Poller Module
 * Polls S3 bucket for invoice PDFs and stores them in local filesystem
 * Sends invoice ready notifications when invoices are processed
 */

const { S3Client } = require('./s3');
const fs = require('fs').promises;
const path = require('path');

class InvoicePoller {
    constructor(options = {}) {
        this.config = {
            pollingInterval: options.pollingInterval || 10000, // 10 seconds default
            bucketName: options.bucketName || process.env.INVOICE_BUCKET || 'invoices',
            pollForInvoices: options.maxRetries !== undefined ? options.maxRetries : Infinity, // Poll indefinitely by default
            invoiceStorageDir: options.invoiceStorageDir || path.join(process.cwd(), 'invoices'), // Local storage directory
            ...options
        };

        this.s3Client = new S3Client(options.s3Config);
        this.pollingTimer = null;
        this.isPolling = false;
        this.isConnected = false;
        this.invoiceProcessedCallback = null; // Callback function when invoice is processed
        this.hasShownNoInvoicesMessage = false; // Flag to track if we've shown the "no invoices" message
        this.processedInvoicesCache = new Set(); // Track invoice numbers that have been processed to avoid re-fetching
        this.expectedInvoices = new Map(); // Track expected invoices: invoiceNumber -> { playerId, customerName, customerEmail, orderId, registeredAt }
    }

    /**
     * Initialize the invoice poller and start continuous polling
     */
    async initialize() {
        try {
            console.log(`📄 Initializing Invoice Poller...`);
            
            // Connect to S3
            await this.s3Client.connect();
            this.isConnected = true;
            
            // Ensure invoice storage directory exists
            await this.ensureStorageDirectory();
            
            console.log(`📄 Invoice Poller initialized successfully`);
            console.log(`📄 Polling bucket: ${this.config.bucketName}`);
            console.log(`📄 Invoice storage directory: ${this.config.invoiceStorageDir}`);
            console.log(`📄 Polling interval: ${this.config.pollingInterval}ms`);
            console.log(`📄 Max retries: ${this.config.maxRetries === Infinity ? 'unlimited (polling indefinitely)' : this.config.maxRetries}`);
            
            // Populate cache with existing invoices to avoid reprocessing
            await this.populateProcessedCache();
            
            // Start continuous polling immediately
            this.startPolling();
            
            return true;
        } catch (error) {
            console.error(`❌ Failed to initialize Invoice Poller: ${error.message}`);
            this.isConnected = false;
            throw error;
        }
    }

    /**
     * Populate the processed invoices cache with existing invoices from filesystem
     * @private
     */
    async populateProcessedCache() {
        try {
            const files = await fs.readdir(this.config.invoiceStorageDir);
            let cacheCount = 0;
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    // Extract invoice number from filename (remove .json extension)
                    const invoiceNumber = file.replace('.json', '');
                    this.processedInvoicesCache.add(invoiceNumber);
                    cacheCount++;
                }
            }
            
            console.log(`📋 Populated processed cache with ${cacheCount} existing invoices`);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📋 No existing invoices found - starting with empty cache`);
            } else {
                console.error(`❌ Error populating processed cache: ${error.message}`);
            }
        }
    }

    /**
     * Set callback function to be called when an invoice is processed
     * @param {Function} callback - Function to call with (invoiceNumber, processedData)
     */
    setInvoiceProcessedCallback(callback) {
        this.invoiceProcessedCallback = callback;
        console.log(`📄 Invoice processed callback registered`);
    }

    /**
     * Register an expected invoice from order processing
     * @param {string} invoiceNumber - The invoice number to expect
     * @param {string} playerId - The player ID (customer email/name)
     * @param {Object} orderData - Additional order data
     */
    registerExpectedInvoice(invoiceNumber, playerId, orderData = {}) {
        if (!invoiceNumber || !playerId) {
            console.error(`❌ Cannot register expected invoice: missing invoiceNumber (${invoiceNumber}) or playerId (${playerId})`);
            return;
        }

        const expectedInvoiceData = {
            playerId: playerId,
            customerName: orderData.customerName || playerId,
            customerEmail: orderData.customerEmail || playerId,
            orderId: orderData.orderId,
            totalAmount: orderData.totalAmount,
            summary: orderData.summary,
            registeredAt: new Date().toISOString()
        };

        this.expectedInvoices.set(invoiceNumber, expectedInvoiceData);
        console.log(`📋 Registered expected invoice ${invoiceNumber} for player ${playerId}`);
        console.log(`📋 Summary data stored:`, expectedInvoiceData.summary ? 'Yes' : 'No');
        if (expectedInvoiceData.summary) {
            console.log(`📋 Summary total: ${expectedInvoiceData.summary.totalAmount}`);
        }
        console.log(`📋 Total expected invoices: ${this.expectedInvoices.size}`);
    }

    /**
     * Get the player ID for a given invoice number from expected invoices
     * @param {string} invoiceNumber - The invoice number to look up
     * @returns {string|null} Player ID if found, null if not found
     */
    getPlayerIdForInvoice(invoiceNumber) {
        if (!invoiceNumber) {
            console.error(`❌ Cannot get player ID: missing invoiceNumber`);
            return null;
        }

        const expectedInvoiceData = this.expectedInvoices.get(invoiceNumber);
        if (expectedInvoiceData) {
            return expectedInvoiceData.playerId;
        }

        console.log(`📄 No expected invoice found for invoice number: ${invoiceNumber}`);
        return null;
    }

    /**
     * Get expected invoice data for a player (finds any expected invoice for the player)
     * @param {string} playerId - The player ID to look up
     * @returns {Object|null} Expected invoice data if found, null if not found
     */
    getExpectedInvoiceDataForPlayer(playerId) {
        if (!playerId) {
            console.error(`❌ Cannot get expected invoice data: missing playerId`);
            return null;
        }

        // Look for any expected invoice for this player
        for (const [invoiceNumber, expectedData] of this.expectedInvoices.entries()) {
            if (expectedData.playerId === playerId) {
                console.log(`📄 Found expected invoice ${invoiceNumber} for player ${playerId}`);
                return expectedData;
            }
        }

        console.log(`📄 No expected invoice found for player: ${playerId}`);
        return null;
    }

    /**
     * Ensure the invoice storage directory exists
     * @private
     */
    async ensureStorageDirectory() {
        try {
            await fs.access(this.config.invoiceStorageDir);
            console.log(`📁 Invoice storage directory exists: ${this.config.invoiceStorageDir}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📁 Creating invoice storage directory: ${this.config.invoiceStorageDir}`);
                await fs.mkdir(this.config.invoiceStorageDir, { recursive: true });
                console.log(`✅ Invoice storage directory created successfully`);
            } else {
                throw error;
            }
        }
    }

    /**
     * Save invoice to filesystem
     * @param {string} invoiceNumber - Invoice number
     * @param {Object} invoiceData - Invoice data to save
     * @private
     */
    async saveInvoiceToFilesystem(invoiceNumber, invoiceData) {
        try {
            const filename = `invoice_${invoiceNumber}.json`;
            const filepath = path.join(this.config.invoiceStorageDir, filename);
            
            // Create a copy of the data with filesystem metadata
            const fileData = {
                ...invoiceData,
                savedAt: new Date().toISOString(),
                filePath: filepath
            };
            
            await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf8');
            console.log(`💾 Invoice ${invoiceNumber} saved to filesystem: ${filepath}`);
            
            return filepath;
        } catch (error) {
            console.error(`❌ Error saving invoice ${invoiceNumber} to filesystem: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch invoice by invoice number from filesystem
     * @param {string} invoiceNumber - Invoice number to fetch
     * @returns {Object|null} Invoice data or null if not found
     */
    async fetchInvoiceFromFilesystem(invoiceNumber,requestingUserId) {
        try {
            const filename = `invoice_${invoiceNumber}.json`;
            const filepath = path.join(this.config.invoiceStorageDir, filename);
            console.log(`📄 ${requestingUserId} Fetching invoice ${invoiceNumber} from filesystem: ${filepath}`);
            
            const data = await fs.readFile(filepath, 'utf8');
            const invoiceData = JSON.parse(data);

            console.log(`📄 Fetched invoice ${invoiceNumber} from filesystem`);
            return invoiceData;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📄 Invoice ${invoiceNumber} not found in filesystem`);
                return null;
            } else {
                console.error(`❌ Error reading invoice ${invoiceNumber} from filesystem: ${error.message}`);
                throw error;
            }
        }
    }

    /**
     * List all invoices stored in filesystem
     * @returns {Array} Array of invoice numbers stored in filesystem
     */
    async listInvoicesInFilesystem() {
        try {
            const files = await fs.readdir(this.config.invoiceStorageDir);
            const invoiceNumbers = files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''));
            
            console.log(`📄 Found ${invoiceNumbers.length} invoices in filesystem`);
            return invoiceNumbers;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📄 Invoice storage directory does not exist`);
                return [];
            } else {
                console.error(`❌ Error listing invoices from filesystem: ${error.message}`);
                throw error;
            }
        }
    }

    /**
     * Delete invoice from filesystem
     * @param {string} invoiceNumber - Invoice number to delete
     * @returns {boolean} True if deleted, false if not found
     */
    async deleteInvoiceFromFilesystem(invoiceNumber) {
        try {
            const filename = `${invoiceNumber}.json`;
            const filepath = path.join(this.config.invoiceStorageDir, filename);
            
            await fs.unlink(filepath);
            
            // Remove from cache as well
            this.processedInvoicesCache.delete(invoiceNumber);
            
            console.log(`🗑️ Deleted invoice ${invoiceNumber} from filesystem and cache`);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📄 Invoice ${invoiceNumber} not found in filesystem for deletion`);
                // Still remove from cache in case it was there
                this.processedInvoicesCache.delete(invoiceNumber);
                return false;
            } else {
                console.error(`❌ Error deleting invoice ${invoiceNumber} from filesystem: ${error.message}`);
                throw error;
            }
        }
    }


    /**
     * Get processed invoice data from filesystem
     * @param {string} invoiceNumber - The invoice number to retrieve
     * @returns {Promise<Object|null>} Processed invoice data or null if not found
     */
    async getProcessedInvoice(invoiceNumber,requestingUserId) {
        try {
            const data = await this.fetchInvoiceFromFilesystem(invoiceNumber,requestingUserId);
            console.log("HERE!!!!",data);
            return data;
        } catch (error) {
            console.error(`❌ Error fetching invoice ${invoiceNumber} from filesystem: ${error.message}`);
            return null;
        }
    }

    /**
     * Get all processed invoices for a player from filesystem
     * @param {string} playerId - The player ID
     * @returns {Promise<Array>} Array of processed invoices for the player
     */
    async getProcessedInvoicesForPlayer(playerId) {
        try {
            const allInvoices = await this.listInvoicesInFilesystem();
            const playerInvoices = [];
            
            for (const invoiceNumber of allInvoices) {
                const invoiceData = await this.fetchInvoiceFromFilesystem(invoiceNumber);
                if (invoiceData && invoiceData.playerId === playerId) {
                    playerInvoices.push({
                        invoiceNumber,
                        ...invoiceData
                    });
                }
            }
            
            return playerInvoices;
        } catch (error) {
            console.error(`❌ Error fetching invoices for player ${playerId}: ${error.message}`);
            return [];
        }
    }

    /**
     * Start the polling process
     */
    startPolling() {
        if (this.isPolling) {
            console.log(`⚠️ Polling is already running`);
            return;
        }

        if (!this.isConnected) {
            console.error(`❌ Cannot start polling - S3 client not connected`);
            return;
        }

        console.log(`🔄 Starting invoice polling...`);
        this.isPolling = true;
        this.scheduleNextPoll();
    }

    /**
     * Stop the polling process
     */
    stopPolling() {
        if (!this.isPolling) {
            console.log(`⚠️ Polling is not running`);
            return;
        }

        console.log(`⏹️ Stopping invoice polling...`);
        this.isPolling = false;

        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = null;
        }
    }

    /**
     * Schedule the next polling cycle
     * @private
     */
    
    scheduleNextPoll() {
        if (!this.isPolling) return;
        this.pollingTimer = setTimeout(async () => {
            if (this.isPolling) {
                await this.pollForInvoices();
                this.scheduleNextPoll();
            }
        }, this.config.pollingInterval);
    }

    /**
     * Poll S3 bucket for all new invoices
     * @private
     */
    async pollForInvoices() {
        //console.log(`🔍 Polling S3 bucket for new invoices...`);

        try {
            // Get all objects in the bucket
            const objects = await this.s3Client.listObjects(this.config.bucketName);
            
            if (objects.length === 0) {
                if (!this.hasShownNoInvoicesMessage) {
                    console.log(`📄 No invoices found in S3 bucket ${this.config.bucketName}`);
                    this.hasShownNoInvoicesMessage = true;
                }
                return;
            }

            // Reset the flag since we found invoices
            this.hasShownNoInvoicesMessage = false;
            
            // Check each invoice file in the bucket
            for (const invoiceFile of objects) {
                // Only process PDF files or files with "invoice" in the name
                if (invoiceFile.name.toLowerCase().endsWith('.pdf') || 
                    invoiceFile.name.toLowerCase().includes('invoice')) {
                    await this.checkAndProcessInvoiceFile(invoiceFile);
                }
            }

        } catch (error) {
            console.error(`❌ Error during polling: ${error.message}`);
        }
    }

    /**
     * Check and process a single invoice file from S3
     * @param {Object} invoiceFile - S3 object representing the invoice file
     * @private
     */
    async checkAndProcessInvoiceFile(invoiceFile) {
        try {
            // Extract invoice number from filename (assume it's part of the filename)
            const invoiceNumber = this.extractInvoiceNumber(invoiceFile.name);
            
            if (!invoiceNumber) {
                console.log(`⚠️ Could not extract invoice number from filename: ${invoiceFile.name}`);
                return;
            }

            // Check if this invoice is expected - if not, skip it
            const expectedInvoiceData = this.expectedInvoices.get(invoiceNumber);
            if (!expectedInvoiceData) {
                // Not an expected invoice, skip silently
                return;
            }

            // Check cache first - if already processed, still notify client but don't reprocess
            if (this.processedInvoicesCache.has(invoiceNumber)) {
                console.log(`📄 Invoice ${invoiceNumber} already in cache - sending notification to player ${expectedInvoiceData.playerId}`);
                
                // Get existing invoice data from filesystem to send notification
                const existingInvoice = await this.fetchInvoiceFromFilesystem(invoiceNumber);
                console.log("EXISTING INVOICE", existingInvoice);
                if (existingInvoice && this.invoiceProcessedCallback) {
                    try {
                        await this.invoiceProcessedCallback(invoiceNumber, existingInvoice);
                        console.log(`✅ Sent notification for existing cached invoice ${invoiceNumber} to player ${expectedInvoiceData.playerId}`);
                    } catch (callbackError) {
                        console.error(`❌ Error sending notification for cached invoice: ${callbackError.message}`);
                    }
                }
                
                // Remove from expected invoices since notification has been sent
                this.expectedInvoices.delete(invoiceNumber);
                return;
            }

            // Check if already processed by looking in filesystem
            const existingInvoice = await this.fetchInvoiceFromFilesystem(invoiceNumber);
            if (existingInvoice) {
                console.log(`📄 Invoice ${invoiceNumber} already exists in filesystem - sending notification to player ${expectedInvoiceData.playerId}`);
                
                // Add to cache for future checks
                this.processedInvoicesCache.add(invoiceNumber);
                
                // Send notification to client even though invoice already exists
                if (this.invoiceProcessedCallback) {
                    try {
                        await this.invoiceProcessedCallback(invoiceNumber, existingInvoice);
                        console.log(`✅ Sent notification for existing filesystem invoice ${invoiceNumber} to player ${expectedInvoiceData.playerId}`);
                    } catch (callbackError) {
                        console.error(`❌ Error sending notification for existing invoice: ${callbackError.message}`);
                    }
                }
                
                // Remove from expected invoices since notification has been sent
                this.expectedInvoices.delete(invoiceNumber);
                return;
            }

            console.log(`📄 Found expected invoice file: ${invoiceFile.name} (Invoice: ${invoiceNumber}) for player ${expectedInvoiceData.playerId}`);
            
            // Use the expected invoice data for processing
            const registrationData = {
                playerId: expectedInvoiceData.playerId,
                customerName: expectedInvoiceData.customerName,
                customerEmail: expectedInvoiceData.customerEmail,
                orderId: expectedInvoiceData.orderId,
                retryCount: 0,
                registeredAt: expectedInvoiceData.registeredAt,
                lastChecked: new Date().toISOString()
            };

            // Process and store the invoice
            await this.processAndStoreInvoice(invoiceNumber, invoiceFile, registrationData);
            
            // Add to processed cache after successful processing
            this.processedInvoicesCache.add(invoiceNumber);
            
            // Remove from expected invoices since it's been processed
            this.expectedInvoices.delete(invoiceNumber);

        } catch (error) {
            console.error(`❌ Error processing invoice file ${invoiceFile.name}: ${error.message}`);
        }
    }

    /**
     * Extract invoice number from filename
     * @param {string} filename - The S3 object filename
     * @returns {string|null} Invoice number or null if not found
     * @private
     */
    extractInvoiceNumber(filename) {
        // Look for patterns like invoice_1234, invoice-1234, 1234.pdf, etc.
        const patterns = [
            /invoice[_-](\d+)/i,      // invoice_1234 or invoice-1234
            /(\d+)\.pdf$/i,           // 1234.pdf
            /invoice(\d+)/i,          // invoice1234
            /(\d+)[_-]invoice/i       // 1234_invoice or 1234-invoice
        ];

        for (const pattern of patterns) {
            const match = filename.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Extract player ID from filename (if embedded in filename)
     * @param {string} filename - The S3 object filename
     * @returns {string|null} Player ID or null if not found
     * @private
     */
    extractPlayerIdFromFilename(filename) {
        // Look for patterns like player123_invoice_1234.pdf or email@domain.com_invoice_1234.pdf
        const patterns = [
            /^([^_]+)_invoice/i,       // player123_invoice_1234.pdf
            /^([^_]+)_\d+/i,           // player123_1234.pdf
            /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i // email pattern
        ];

        for (const pattern of patterns) {
            const match = filename.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Process and store invoice file as base64
     * @param {string} invoiceNumber - Invoice number
     * @param {Object} invoiceFile - S3 object info
     * @param {Object} registrationData - Registration data
     * @private
     */
    async processAndStoreInvoice(invoiceNumber, invoiceFile, registrationData) {
        try {
            console.log(`📥 Processing invoice file: ${invoiceFile.name} (${(invoiceFile.size / 1024).toFixed(2)} KB)`);

            // Download the PDF from S3
            const pdfBuffer = await this.s3Client.getObject(this.config.bucketName, invoiceFile.name);
            
            // Convert to base64
            const base64Pdf = pdfBuffer.toString('base64');
            
            console.log(`📄 Converted PDF to base64 (${base64Pdf.length} characters)`);

            //console.log(`📄 Base64 PDF: ${base64Pdf}`); 
            
            // Store the processed invoice
            const processedData = {
                playerId: registrationData.playerId,
                base64Data: base64Pdf,
                filename: invoiceFile.name,
                fileSize: invoiceFile.size,
                processedAt: new Date().toISOString(),
                s3Metadata: {
                    s3Key: invoiceFile.name,
                    s3Size: invoiceFile.size,
                    s3LastModified: invoiceFile.lastModified
                }
            };
            console.log(">>>>>", processedData);
            // Save to filesystem only (no memory storage)
            await this.saveInvoiceToFilesystem(invoiceNumber, processedData);

            console.log(`✅ Invoice ${invoiceNumber} processed and stored successfully for player ${registrationData.playerId}`);

            // Call the callback function if registered to send invoice via websocket
            if (this.invoiceProcessedCallback) {
                try {
                    console.log(`📤 Sending processed invoice ${invoiceNumber} to player ${registrationData.playerId} via websocket`);
                    await this.invoiceProcessedCallback(invoiceNumber, processedData);
                } catch (callbackError) {
                    console.error(`❌ Error in invoice processed callback: ${callbackError.message}`);
                }
            }

        } catch (error) {
            console.error(`❌ Error processing invoice file ${invoiceFile.name}: ${error.message}`);
            throw error;
        }
    }



    /**
     * Get status information
     */
    getStatus() {
        const expectedInvoices = Array.from(this.expectedInvoices.entries()).map(([invoiceNumber, data]) => ({
            invoiceNumber,
            playerId: data.playerId,
            customerName: data.customerName,
            orderId: data.orderId,
            summary: data.summary,
            registeredAt: data.registeredAt
        }));

        return {
            isConnected: this.isConnected,
            isPolling: this.isPolling,
            bucketName: this.config.bucketName,
            pollingInterval: this.config.pollingInterval,
            maxRetries: this.config.maxRetries === Infinity ? 'unlimited' : this.config.maxRetries,
            storageDir: this.config.invoiceStorageDir,
            processedCacheSize: this.processedInvoicesCache.size,
            expectedInvoicesCount: this.expectedInvoices.size,
            expectedInvoices: expectedInvoices
        };
    }

    /**
     * Clear processed invoices from filesystem (for cleanup)
     * @param {string} playerId - Optional player ID to clear only their invoices
     */
    async clearProcessedInvoices(playerId = null) {
        try {
            const allInvoices = await this.listInvoicesInFilesystem();
            let clearedCount = 0;
            
            for (const invoiceNumber of allInvoices) {
                if (playerId) {
                    // Clear only invoices for specific player
                    const invoiceData = await this.fetchInvoiceFromFilesystem(invoiceNumber);
                    if (invoiceData && invoiceData.playerId === playerId) {
                        await this.deleteInvoiceFromFilesystem(invoiceNumber);
                        clearedCount++;
                    }
                } else {
                    // Clear all invoices
                    await this.deleteInvoiceFromFilesystem(invoiceNumber);
                    clearedCount++;
                }
            }
            
            if (playerId) {
                console.log(`🧹 Cleared ${clearedCount} processed invoices for player ${playerId}`);
            } else {
                // Clear entire cache if clearing all invoices
                this.processedInvoicesCache.clear();
                console.log(`🧹 Cleared ${clearedCount} processed invoices from filesystem and cache`);
            }
        } catch (error) {
            console.error(`❌ Error clearing processed invoices: ${error.message}`);
        }
    }

    /**
     * Cleanup and shutdown
     */
    async shutdown() {
        console.log(`🛑 Shutting down Invoice Poller...`);
        
        this.stopPolling(); 
        // Processed invoices remain in filesystem storage
        
        console.log(`✅ Invoice Poller shutdown complete`);
    }
}

module.exports = { InvoicePoller };
