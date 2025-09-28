#!/usr/bin/env node

/**
 * Order Processing Module
 * Handles order validation and forwarding to backend systems
 */

class OrderProcessor {
    constructor(config = {}) {
        this.config = {
            backendUrl: config.backendUrl || process.env.BACKEND_ORDER_URL || 'https://mobile-backend-route-demo.apps.cluster-75kk9.75kk9.sandbox2022.opentlc.com/api/edi/purchase-order',
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'ShopMaze-Backend/1.0'
        };
    }

    /**
     * Validate order data
     * @param {Object} orderData - The order data to validate
     * @returns {Object} Validation result with success flag and error details
     */
    validateOrder(orderData) {
        console.log(`📦 Validating order data`);

        const { customerName, customerEmail, items } = orderData;

        // Check required fields
        if (!customerName || !customerEmail || !items || !Array.isArray(items)) {
            return {
                success: false,
                error: 'Missing required fields',
                message: 'customerName, customerEmail, and items array are required',
                required: ['customerName', 'customerEmail', 'items'],
                statusCode: 400
            };
        }

        // Check items array is not empty
        if (items.length === 0) {
            return {
                success: false,
                error: 'Empty order',
                message: 'At least one item is required',
                statusCode: 400
            };
        }

        // Validate each item has required fields
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item.description || item.quantity === undefined || item.unitPrice === undefined) {
                return {
                    success: false,
                    error: 'Invalid item data',
                    message: `Item ${i + 1} is missing required fields (description, quantity, unitPrice)`,
                    statusCode: 400
                };
            }

            if (typeof item.quantity !== 'number' || item.quantity <= 0) {
                return {
                    success: false,
                    error: 'Invalid quantity',
                    message: `Item ${i + 1} has invalid quantity (must be a positive number)`,
                    statusCode: 400
                };
            }

            if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
                return {
                    success: false,
                    error: 'Invalid price',
                    message: `Item ${i + 1} has invalid unit price (must be a non-negative number)`,
                    statusCode: 400
                };
            }
        }

        console.log(`✅ Order validation passed for ${customerName} with ${items.length} items`);
        return { success: true };
    }

    /**
     * Process order by forwarding to backend API
     * @param {Object} orderData - The order data to process
     * @returns {Promise<Object>} Processing result
     */
    async processOrder(orderData) {
        console.log(`📦 Processing order for ${orderData.customerName || 'unknown customer'}`);

        // Validate order first
        const validation = this.validateOrder(orderData);
        if (!validation.success) {
            return validation;
        }

        // Check backend URL configuration
        if (!this.config.backendUrl) {
            console.error('❌ Backend order URL not configured');
            return {
                success: false,
                error: 'Configuration error',
                message: 'Backend order URL not configured',
                statusCode: 500
            };
        }

        console.log(`📦 Forwarding order to: ${this.config.backendUrl}`);

        try {
            const result = await this.forwardToBackend(orderData);
            console.log(`✅ Order processed successfully`);
            return result;
        } catch (error) {
            console.error(`❌ Error processing order:`, error.message);
            return {
                success: false,
                error: error.code || 'Processing error',
                message: error.message,
                statusCode: error.statusCode || 500
            };
        }
    }

    /**
     * Forward order to backend API
     * @param {Object} orderData - The order data to forward
     * @returns {Promise<Object>} Backend response
     * @private
     */
    async forwardToBackend(orderData) {
        return new Promise((resolve, reject) => {
            try {
                const https = require('https');
                const httpModule = this.config.backendUrl.startsWith('https') ? https : require('http');
                const urlParts = new URL(this.config.backendUrl);

                const orderPayload = JSON.stringify(orderData);

                const options = {
                    hostname: urlParts.hostname,
                    port: urlParts.port || (urlParts.protocol === 'https:' ? 443 : 80),
                    path: urlParts.pathname + urlParts.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(orderPayload),
                        'User-Agent': this.config.userAgent
                    }
                };

                const backendReq = httpModule.request(options, (backendRes) => {
                    let backendBody = '';

                    backendRes.on('data', (chunk) => {
                        backendBody += chunk;
                    });

                    backendRes.on('end', () => {
                        try {
                            // Try to parse as JSON
                            const backendResponse = JSON.parse(backendBody);
                            console.log(`✅ Order forwarded successfully. Backend response: ${JSON.stringify(backendResponse)}`);

                            resolve({
                                success: true,
                                message: 'Order processed successfully',
                                orderId: backendResponse.orderId || `ORDER-${Date.now()}`,
                                customerName: orderData.customerName,
                                customerEmail: orderData.customerEmail,
                                itemCount: orderData.items.length,
                                backendResponse: backendResponse,
                                timestamp: new Date().toISOString(),
                                statusCode: 200
                            });

                        } catch (parseError) {
                            // Backend returned non-JSON response
                            console.log(`✅ Order forwarded, but backend response was not JSON: ${backendBody}`);

                            resolve({
                                success: true,
                                message: 'Order processed successfully',
                                orderId: `ORDER-${Date.now()}`,
                                customerName: orderData.customerName,
                                customerEmail: orderData.customerEmail,
                                itemCount: orderData.items.length,
                                backendResponse: backendBody,
                                timestamp: new Date().toISOString(),
                                statusCode: 200
                            });
                        }
                    });
                });

                backendReq.on('error', (error) => {
                    console.error(`❌ Error forwarding order to backend:`, error.message);
                    reject({
                        code: 'Backend communication error',
                        message: error.message,
                        statusCode: 500
                    });
                });

                backendReq.setTimeout(this.config.timeout, () => {
                    console.error(`❌ Timeout forwarding order to backend`);
                    backendReq.destroy();
                    reject({
                        code: 'Backend timeout',
                        message: `Backend API did not respond within ${this.config.timeout / 1000} seconds`,
                        statusCode: 500
                    });
                });

                // Send the order data
                backendReq.write(orderPayload);
                backendReq.end();

            } catch (urlError) {
                console.error('❌ Invalid backend URL:', urlError.message);
                reject({
                    code: 'Invalid backend URL',
                    message: 'Backend URL is not a valid URL',
                    statusCode: 500
                });
            }
        });
    }

    /**
     * Handle HTTP request for order processing and return the result
     * @param {Object} req - HTTP request object
     * @param {Object} res - HTTP response object
     * @returns {Promise<Object>} Promise that resolves with the order processing result
     */
    async handleOrderRequest(req, res) {
        return new Promise((resolve, reject) => {
            let body = '';
            
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const orderData = JSON.parse(body);
                    console.log(`📦 Received order processing request`);
                    
                    // Process the order
                    const result = await this.processOrder(orderData);
                    
                    // Send HTTP response
                    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                    
                    // Return the result to the caller
                    resolve(result);
                    
                } catch (error) {
                    console.error('❌ Error parsing order request:', error);
                    
                    const errorResult = {
                        success: false,
                        error: 'Invalid order data',
                        message: error.message,
                        timestamp: new Date().toISOString(),
                        statusCode: 400
                    };
                    
                    // Send HTTP error response
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResult));
                    
                    // Return the error result to the caller
                    resolve(errorResult);
                }
            });

            req.on('error', (error) => {
                console.error('❌ Request error:', error);
                
                const errorResult = {
                    success: false,
                    error: 'Request error',
                    message: error.message,
                    timestamp: new Date().toISOString(),
                    statusCode: 500
                };
                
                // Send HTTP error response if possible
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResult));
                }
                
                // Return the error result to the caller
                resolve(errorResult);
            });
        });
    }

    /**
     * Get configuration info
     * @returns {Object} Configuration details (without sensitive data)
     */
    getConfig() {
        return {
            backendUrl: this.config.backendUrl ? '***configured***' : 'not configured',
            timeout: this.config.timeout,
            userAgent: this.config.userAgent
        };
    }
}

module.exports = { OrderProcessor };
