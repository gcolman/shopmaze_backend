#!/usr/bin/env node

/**
 * Invoice Poller Module
 * Polls S3 bucket for invoice PDFs and stores them as base64 when found
 * Also stores invoices in local filesystem for persistence
 */

const { S3Client } = require('./s3');
const fs = require('fs').promises;
const path = require('path');

class InvoicePoller {
    constructor(options = {}) {
        this.config = {
            pollingInterval: options.pollingInterval || 10000, // 10 seconds default
            bucketName: options.bucketName || process.env.INVOICE_BUCKET || 'ingest',
            pollForInvoices: options.maxRetries !== undefined ? options.maxRetries : Infinity, // Poll indefinitely by default
            invoiceStorageDir: options.invoiceStorageDir || path.join(process.cwd(), 'invoices'), // Local storage directory
            ...options
        };

        this.s3Client = new S3Client(options.s3Config);
        this.registeredInvoices = new Map(); // Map of invoiceNumber -> { playerId, retryCount, registeredAt, lastChecked }
        this.processedInvoices = new Map(); // Map of invoiceNumber -> { playerId, base64Data, filename, processedAt, fileSize }
        this.pollingTimer = null;
        this.isPolling = false;
        this.isConnected = false;
        this.invoiceProcessedCallback = null; // Callback function when invoice is processed
        this.hasShownNoInvoicesMessage = false; // Flag to track if we've shown the "no invoices" message
    }

    /**
     * Initialize the invoice poller
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
            
            return true;
        } catch (error) {
            console.error(`❌ Failed to initialize Invoice Poller: ${error.message}`);
            this.isConnected = false;
            throw error;
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
            const filename = `${invoiceNumber}.json`;
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
    async fetchInvoiceFromFilesystem(invoiceNumber) {
        try {
            const filename = `${invoiceNumber}.json`;
            const filepath = path.join(this.config.invoiceStorageDir, filename);
            
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
            console.log(`🗑️ Deleted invoice ${invoiceNumber} from filesystem`);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📄 Invoice ${invoiceNumber} not found in filesystem for deletion`);
                return false;
            } else {
                console.error(`❌ Error deleting invoice ${invoiceNumber} from filesystem: ${error.message}`);
                throw error;
            }
        }
    }

    /**
     * Register an invoice number for polling
     * @param {string} invoiceNumber - The invoice number to watch for
     * @param {string} playerId - The player ID associated with the invoice
     */
    registerInvoice(invoiceNumber, playerId) {
        if (!invoiceNumber || !playerId) {
            throw new Error('Invoice number and player ID are required');
        }

        // Check if already processed
        if (this.processedInvoices.has(invoiceNumber)) {
            console.log(`📄 Invoice ${invoiceNumber} already processed`);
            //removed for testing, re-instate for production
            //return this.processedInvoices.get(invoiceNumber);
        }

        const registrationData = {
            playerId: playerId,
            retryCount: 0,
            registeredAt: new Date().toISOString(),
            lastChecked: null
        };

        this.registeredInvoices.set(invoiceNumber, registrationData);
        
        // Reset the flag since we now have invoices to poll for
        this.hasShownNoInvoicesMessage = false;
        
        console.log(`📄 Registered invoice ${invoiceNumber} for player ${playerId}`);
        console.log(`📄 Total registered invoices: ${this.registeredInvoices.size}`);

        // Start polling if not already running
        if (!this.isPolling && this.isConnected) {
            this.startPolling();
        }

        return null; // Not processed yet
    }

    /**
     * Get processed invoice data
     * @param {string} invoiceNumber - The invoice number to retrieve
     * @returns {Promise<Object|null>} Processed invoice data or null if not found
     */
    async getProcessedInvoice(invoiceNumber) {
        // First check in-memory cache
        let invoiceData = this.processedInvoices.get(invoiceNumber);
        
        if (invoiceData) {
            return invoiceData;
        }
        
        // If not in memory, try to fetch from filesystem
        try {
            invoiceData = await this.fetchInvoiceFromFilesystem(invoiceNumber);
            
            // If found in filesystem, load it into memory cache
            if (invoiceData) {
                this.processedInvoices.set(invoiceNumber, invoiceData);
                console.log(`📄 Loaded invoice ${invoiceNumber} from filesystem into memory cache`);
            }
            
            return invoiceData;
        } catch (error) {
            console.error(`❌ Error fetching invoice ${invoiceNumber} from filesystem: ${error.message}`);
            return null;
        }
    }

    /**
     * Get all processed invoices for a player
     * @param {string} playerId - The player ID
     * @returns {Array} Array of processed invoices for the player
     */
    getProcessedInvoicesForPlayer(playerId) {
        const playerInvoices = [];
        
        for (const [invoiceNumber, data] of this.processedInvoices.entries()) {
            if (data.playerId === playerId) {
                playerInvoices.push({
                    invoiceNumber,
                    ...data
                });
            }
        }
        
        return playerInvoices;
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
     * Poll S3 bucket for registered invoices
     * @private
     */
    async pollForInvoices() {
        if (this.registeredInvoices.size === 0) {
            if (!this.hasShownNoInvoicesMessage) {
                console.log(`📄 No registered invoices to poll for - pausing polling until next registered invoice`);
                this.hasShownNoInvoicesMessage = true;
            }
            return;
        }

        // Reset the flag since we have invoices to poll for
        this.hasShownNoInvoicesMessage = false;
        
        console.log(`🔍 Polling for ${this.registeredInvoices.size} registered invoices...`);

        try {
            // Get all objects in the bucket
            const objects = await this.s3Client.listObjects(this.config.bucketName);
            
            // Check each registered invoice
            for (const [invoiceNumber, registrationData] of this.registeredInvoices.entries()) {
                await this.checkInvoiceInObjects(invoiceNumber, registrationData, objects);
            }

            // Clean up old registrations
            this.cleanupExpiredRegistrations();

        } catch (error) {
            console.error(`❌ Error during polling: ${error.message}`);
        }
    }

    /**
     * Check if a specific invoice exists in the S3 objects
     * @param {string} invoiceNumber - Invoice number to check for
     * @param {Object} registrationData - Registration data for the invoice
     * @param {Array} objects - List of S3 objects
     * @private
     */
    async checkInvoiceInObjects(invoiceNumber, registrationData, objects) {
        try {
            registrationData.lastChecked = new Date().toISOString();

            // Look for files containing the invoice number
            const matchingObjects = objects.filter(obj => 
                obj.name.includes(invoiceNumber) && 
                (obj.name.toLowerCase().endsWith('.pdf') || obj.name.toLowerCase().includes('invoice'))
            );

            if (matchingObjects.length > 0) {
                console.log(`📄 Found ${matchingObjects.length} matching files for invoice ${invoiceNumber}`);
                
                // Process the first matching file
                const invoiceFile = matchingObjects[0];
                await this.processAndStoreInvoice(invoiceNumber, invoiceFile, registrationData);
                
                // Remove from registered list once processed
                this.registeredInvoices.delete(invoiceNumber);
                
            } else {
                // Increment retry count
                registrationData.retryCount++;
                
                if (this.config.maxRetries === Infinity) {
                    console.log(`🔍 Invoice ${invoiceNumber} not found, retry ${registrationData.retryCount} (polling indefinitely)`);
                } else if (registrationData.retryCount >= this.config.maxRetries) {
                    console.log(`⚠️ Invoice ${invoiceNumber} exceeded max retries (${this.config.maxRetries}), removing from polling`);
                    this.registeredInvoices.delete(invoiceNumber);
                } else {
                    console.log(`🔍 Invoice ${invoiceNumber} not found, retry ${registrationData.retryCount}/${this.config.maxRetries}`);
                }
            }

        } catch (error) {
            console.error(`❌ Error checking invoice ${invoiceNumber}: ${error.message}`);
            registrationData.retryCount++;
        }
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

            console.log(`📄 Base64 PDF: ${base64Pdf}`); 
            
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

            this.processedInvoices.set(invoiceNumber, processedData);

            // Save to filesystem
            try {
                await this.saveInvoiceToFilesystem(invoiceNumber, processedData);
            } catch (filesystemError) {
                console.error(`⚠️ Failed to save invoice ${invoiceNumber} to filesystem: ${filesystemError.message}`);
                // Continue processing even if filesystem save fails
            }

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
     * Clean up expired registrations
     * @private
     */
    cleanupExpiredRegistrations() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [invoiceNumber, registrationData] of this.registeredInvoices.entries()) {
            const registeredAt = new Date(registrationData.registeredAt).getTime();
            
            if (now - registeredAt > maxAge) {
                console.log(`🧹 Removing expired registration for invoice ${invoiceNumber}`);
                this.registeredInvoices.delete(invoiceNumber);
            }
        }
    }

    /**
     * Force check for a specific invoice (bypass normal polling)
     * @param {string} invoiceNumber - Invoice number to check immediately
     */
    async forceCheck(invoiceNumber) {
        if (!this.registeredInvoices.has(invoiceNumber)) {
            throw new Error(`Invoice ${invoiceNumber} is not registered`);
        }

        console.log(`🔍 Force checking invoice ${invoiceNumber}...`);

        try {
            const objects = await this.s3Client.listObjects(this.config.bucketName);
            const registrationData = this.registeredInvoices.get(invoiceNumber);
            
            await this.checkInvoiceInObjects(invoiceNumber, registrationData, objects);
            
            return this.processedInvoices.has(invoiceNumber) ? 'found_and_stored' : 'not_found';
            
        } catch (error) {
            console.error(`❌ Error during force check: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get status information
     */
    getStatus() {
        const registrations = Array.from(this.registeredInvoices.entries()).map(([invoiceNumber, data]) => ({
            invoiceNumber,
            playerId: data.playerId,
            retryCount: data.retryCount,
            registeredAt: data.registeredAt,
            lastChecked: data.lastChecked
        }));

        const processed = Array.from(this.processedInvoices.entries()).map(([invoiceNumber, data]) => ({
            invoiceNumber,
            playerId: data.playerId,
            filename: data.filename,
            fileSize: data.fileSize,
            processedAt: data.processedAt
        }));

        return {
            isConnected: this.isConnected,
            isPolling: this.isPolling,
            bucketName: this.config.bucketName,
            pollingInterval: this.config.pollingInterval,
            maxRetries: this.config.maxRetries === Infinity ? 'unlimited' : this.config.maxRetries,
            registeredCount: this.registeredInvoices.size,
            processedCount: this.processedInvoices.size,
            registrations: registrations,
            processedInvoices: processed
        };
    }

    /**
     * Clear processed invoices (for cleanup)
     * @param {string} playerId - Optional player ID to clear only their invoices
     */
    clearProcessedInvoices(playerId = null) {
        if (playerId) {
            // Clear only invoices for specific player
            for (const [invoiceNumber, data] of this.processedInvoices.entries()) {
                if (data.playerId === playerId) {
                    this.processedInvoices.delete(invoiceNumber);
                }
            }
            console.log(`🧹 Cleared processed invoices for player ${playerId}`);
        } else {
            // Clear all processed invoices
            const count = this.processedInvoices.size;
            this.processedInvoices.clear();
            console.log(`🧹 Cleared ${count} processed invoices`);
        }
    }

    /**
     * Cleanup and shutdown
     */
    async shutdown() {
        console.log(`🛑 Shutting down Invoice Poller...`);
        
        this.stopPolling(); 
        this.registeredInvoices.clear();
        // Keep processed invoices as they contain valuable data
        
        console.log(`✅ Invoice Poller shutdown complete`);
    }
}

module.exports = { InvoicePoller };
