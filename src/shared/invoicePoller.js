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
            invoiceStorageDir: options.invoiceStorageDir || path.join(process.cwd(), 'invoices'), // Local storage directory
            ...options
        };

        this.s3Client = new S3Client(options.s3Config);
        this.pollingTimer = null;
        this.isPolling = false;
        this.isConnected = false;
        this.invoiceProcessedCallback = null; // Callback function when invoice is processed
        this.processedFiles = new Map(); // Track processed files: filename -> { timestamp, invoiceNumber, playerId, notificationSent }
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
            console.log(`📄 >>> connected`);
            // Ensure invoice storage directory exists
            await this.ensureStorageDirectory();
            
            console.log(`📄 Invoice Poller initialized successfully`);
            console.log(`📄 Polling bucket: ${this.config.bucketName}`);
            console.log(`📄 Invoice storage directory: ${this.config.invoiceStorageDir}`);
            console.log(`📄 Polling interval: ${this.config.pollingInterval}ms`);
            
            // Load processed files from filesystem
            await this.loadProcessedFiles();
            
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
     * Load processed files from filesystem to track what has been processed
     * @private
     */
    async loadProcessedFiles() {
        try {
            const files = await fs.readdir(this.config.invoiceStorageDir);
            let loadedCount = 0;
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const filepath = path.join(this.config.invoiceStorageDir, file);
                        const data = await fs.readFile(filepath, 'utf8');
                        const invoiceData = JSON.parse(data);
                        
                        // Extract filename from s3Metadata or use a default
                        const filename = invoiceData.s3Metadata?.s3Key || file.replace('.json', '');
                        const timestamp = invoiceData.s3Metadata?.s3LastModified || invoiceData.processedAt;
                        
                        this.processedFiles.set(filename, {
                            timestamp: timestamp,
                            invoiceNumber: invoiceData.invoiceNumber || filename,
                            playerId: invoiceData.playerId,
                            processedAt: invoiceData.processedAt,
                            notificationSent: true // Assume existing files have already had notifications sent
                        });
                        loadedCount++;
                    } catch (error) {
                        console.log(`⚠️ Could not load processed file ${file}: ${error.message}`);
                    }
                }
            }
            
            console.log(`📋 Loaded ${loadedCount} processed files from filesystem`);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📋 No existing invoices found - starting with empty processed files list`);
            } else {
                console.error(`❌ Error loading processed files: ${error.message}`);
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
     * Poll S3 bucket for new invoices
     * @private
     */
    async pollForInvoices() {
        try {
            // Get all objects in the bucket with timestamps
            const objects = await this.s3Client.listObjects(this.config.bucketName);
            
            if (objects.length === 0) {
                return;
            }
            
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
            const filename = invoiceFile.name;
            const timestamp = invoiceFile.lastModified;
            
            // Check if this file and timestamp have already been processed
            const existingEntry = this.processedFiles.get(filename);
            if (existingEntry && existingEntry.timestamp.toString() === timestamp.toString() && existingEntry.notificationSent) {
                // File and timestamp already processed and notification sent, do nothing
               //console.log(filename, existingEntry.timestamp.toString(), existingEntry.notificationSent);
                return;
            }
            
            console.log(`📄 >>>>>>Found new invoice file: ${filename} (${timestamp})`);
            
            // Extract invoice number from filename
            const invoiceNumber = this.extractInvoiceNumber(filename);
            if (!invoiceNumber) {
                console.log(`⚠️ Could not extract invoice number from filename: ${filename}`);
                return;
            }
            
            // Download and process the file
            const pdfBuffer = await this.s3Client.getObject(this.config.bucketName, filename);
            const base64Pdf = pdfBuffer.toString('base64');
            
            // Store the processed invoice
            const processedData = {
                invoiceNumber: invoiceNumber,
                filename: filename,
                fileSize: invoiceFile.size,
                base64Data: base64Pdf,
                processedAt: new Date().toISOString(),
                s3Metadata: {
                    s3Key: filename,
                    s3Size: invoiceFile.size,
                    s3LastModified: timestamp
                }
            };
            
            // Save to filesystem
            await this.saveInvoiceToFilesystem(invoiceNumber, processedData);
            
            // Check if this is a truly new file (not just a reprocess)
            const isNewFile = !existingEntry || existingEntry.timestamp.toString() !== timestamp.toString();
            console.log("isNewFile", isNewFile);
            console.log("existingEntry", existingEntry ? "exists" : "null");
            console.log("timestamp this/existing", timestamp, existingEntry?.timestamp);
            console.log("timestamp types", typeof timestamp, typeof existingEntry?.timestamp);
            console.log("filename this/existing", filename, existingEntry?.filename);



            // Add to processed files list
            this.processedFiles.set(filename, {
                filename: filename,
                timestamp: timestamp,
                invoiceNumber: invoiceNumber,
                playerId: null, // Will be updated when invoice is requested
                processedAt: processedData.processedAt,
                notificationSent: false // Will be set to true after notification is sent
            });
            
            console.log(`✅ Invoice ${invoiceNumber} processed and stored successfully`);
            console.log(">>>>isNewFile<<<<<", isNewFile);
            // Only send invoice ready event for truly new files
            if (isNewFile && this.invoiceProcessedCallback) {
                try {
                    await this.invoiceProcessedCallback(invoiceNumber, processedData);
                    
                    // Mark notification as sent
                    const updatedEntry = this.processedFiles.get(filename);
                    if (updatedEntry) {
                        updatedEntry.notificationSent = true;
                        this.processedFiles.set(filename, updatedEntry);
                    }
                    
                    console.log(`📤 Invoice ready notification sent for ${invoiceNumber}`);
                } catch (callbackError) {
                    console.error(`❌ Error sending invoice ready notification: ${callbackError.message}`);
                }
            } else if (!isNewFile) {
                console.log(`📄 Invoice ${invoiceNumber} reprocessed but notification already sent`);
            }

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
        const processedFilesList = Array.from(this.processedFiles.entries()).map(([filename, data]) => ({
            filename,
            timestamp: data.timestamp,
            invoiceNumber: data.invoiceNumber,
            playerId: data.playerId,
            processedAt: data.processedAt,
            notificationSent: data.notificationSent
        }));

        return {
            isConnected: this.isConnected,
            isPolling: this.isPolling,
            bucketName: this.config.bucketName,
            pollingInterval: this.config.pollingInterval,
            storageDir: this.config.invoiceStorageDir,
            processedFilesCount: this.processedFiles.size,
            processedFiles: processedFilesList
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
