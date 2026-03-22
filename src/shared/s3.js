#!/usr/bin/env node

/**
 * MinIO S3 Client for Red Hat Quest Game
 * Provides connection and operations for MinIO S3 server
 */

const { Client } = require('minio');

class S3Client {
    constructor(config = {}) {
        // Default configuration - can be overridden by environment variables
     /**   this.config = {
            endPoint: config.endPoint || process.env.MINIO_ENDPOINT || 'minio-api-demo.apps.cluster-75kk9.75kk9.sandbox2022.opentlc.com',
            port: parseInt(config.port || process.env.MINIO_PORT || '443'),
            useSSL: config.useSSL !== undefined ? config.useSSL : (process.env.MINIO_USE_SSL === 'true' || true),
            accessKey: config.accessKey || process.env.MINIO_ACCESS_KEY || 'iHWCo5WCIIBAehWIOZeO',
            secretKey: config.secretKey || process.env.MINIO_SECRET_KEY || 'SyUnBgvqxWUcmlwfY92u2HwY7cqUNWtkxu3rpsAM',
            region: config.region || process.env.MINIO_REGION || 'us-east-1'
        };*/
        console.log("BEFORE CONNECTING");
        this.config = {
            endPoint: config.endPoint || process.env.MINIO_ENDPOINT || 'minio-api-demo.apps.cluster-szfjs.dynamic.redhatworkshops.io',
            //endPoint: config.endPoint || process.env.MINIO_ENDPOINT || 'http://minio-service.demo.svc.cluster.local:9000',
            port: parseInt(config.port || process.env.MINIO_PORT || '443'),
            useSSL: config.useSSL !== undefined ? config.useSSL : (process.env.MINIO_USE_SSL === 'true' || true),
            accessKey: config.accessKey || process.env.MINIO_ACCESS_KEY || 'NlJSl2F6NvxXnHW4eNy7',
            secretKey: config.secretKey || process.env.MINIO_SECRET_KEY || 'zbvCPik7Lwr6fI0gXpEeHTWNv7ZQAgpUYQzi5sqG',
            region: config.region || process.env.MINIO_REGION || 'us-east-1'
        };


        this.client = null;
        this.connected = false;
    }

    /**
     * Initialize the MinIO client connection
     * @returns {Promise<boolean>} True if connection successful
     */
    async connect() {
        try {
            console.log(`🔗  server at ${this.config.endPoint}:${this.config.port}`);
            
            this.client = new Client({
                //endPoint: this.config.endPoint,
                endPoint: 'minio-api-demo.apps.cluster-szfjs.dynamic.redhatworkshops.io',
                port: this.config.port,
                useSSL: this.config.useSSL,
                accessKey: this.config.accessKey,
                secretKey: this.config.secretKey,
                region: this.config.region
            });

            // Test connection by listing buckets
            await this.client.listBuckets();
            this.connected = true;
            console.log(`✅ Successfully connected to MinIO server`);
            return true;

        } catch (error) {
            console.error(`❌ Failed to connect to MinIO server:`, error.message);
            this.connected = false;
            throw error;
        }
    }

    /**
     * Check if client is connected
     * @returns {boolean} Connection status
     */
    isConnected() {
        return this.connected;
    }

    /**
     * List all buckets
     * @returns {Promise<Array>} Array of bucket objects
     */
    async listBuckets() {
        this.ensureConnected();
        try {
            console.log(`📂 Listing all buckets`);
            const buckets = await this.client.listBuckets();
            console.log(`📂 Found ${buckets.length} buckets`);
            return buckets;
        } catch (error) {
            console.error(`❌ Error listing buckets:`, error.message);
            throw error;
        }
    }

    /**
     * List objects in a bucket
     * @param {string} bucketName - Name of the bucket
     * @param {string} prefix - Optional prefix to filter objects
     * @param {boolean} recursive - Whether to list recursively (default: true)
     * @returns {Promise<Array>} Array of object information
     */
    async listObjects(bucketName, prefix = '', recursive = true) {
        this.ensureConnected();
        try {
            //console.log(`📋 Listing objects in bucket '${bucketName}' with prefix '${prefix}'`);
            
            const objects = [];
            const stream = this.client.listObjects(bucketName, prefix, recursive);
            
            return new Promise((resolve, reject) => {
                stream.on('data', (obj) => {
                    objects.push({
                        name: obj.name,
                        size: obj.size,
                        lastModified: obj.lastModified,
                        etag: obj.etag
                    });
                });
                
                stream.on('end', () => {
                    //console.log(`📋 Found ${objects.length} objects in bucket '${bucketName}'`);
                    resolve(objects);
                });
                
                stream.on('error', (error) => {
                    console.error(`❌ Error listing objects in bucket '${bucketName}':`, error.message);
                    reject(error);
                });
            });
        } catch (error) {
            console.error(`❌ Error accessing bucket '${bucketName}':`, error.message);
            throw error;
        }
    }

    /**
     * Get an object from MinIO
     * @param {string} bucketName - Name of the bucket
     * @param {string} objectName - Name of the object
     * @returns {Promise<Buffer>} Object data as Buffer
     */
    async getObject(bucketName, objectName) {
        this.ensureConnected();
        try {
            console.log(`📥 Fetching object '${objectName}' from bucket '${bucketName}'`);
            
            const stream = await this.client.getObject(bucketName, objectName);
            const chunks = [];
            
            return new Promise((resolve, reject) => {
                stream.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                
                stream.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    console.log(`✅ Successfully fetched object '${objectName}' (${buffer.length} bytes)`);
                    resolve(buffer);
                });
                
                stream.on('error', (error) => {
                    console.error(`❌ Error fetching object '${objectName}':`, error.message);
                    reject(error);
                });
            });
        } catch (error) {
            console.error(`❌ Error accessing object '${objectName}' in bucket '${bucketName}':`, error.message);
            throw error;
        }
    }

    /**
     * Get object as string (for text files)
     * @param {string} bucketName - Name of the bucket
     * @param {string} objectName - Name of the object
     * @param {string} encoding - Text encoding (default: 'utf8')
     * @returns {Promise<string>} Object content as string
     */
    async getObjectAsString(bucketName, objectName, encoding = 'utf8') {
        const buffer = await this.getObject(bucketName, objectName);
        return buffer.toString(encoding);
    }

    /**
     * Get object as JSON
     * @param {string} bucketName - Name of the bucket
     * @param {string} objectName - Name of the object
     * @returns {Promise<Object>} Parsed JSON object
     */
    async getObjectAsJSON(bucketName, objectName) {
        const content = await this.getObjectAsString(bucketName, objectName);
        try {
            return JSON.parse(content);
        } catch (error) {
            console.error(`❌ Error parsing JSON from object '${objectName}':`, error.message);
            throw new Error(`Invalid JSON in object '${objectName}': ${error.message}`);
        }
    }

    /**
     * Get object metadata
     * @param {string} bucketName - Name of the bucket
     * @param {string} objectName - Name of the object
     * @returns {Promise<Object>} Object statistics and metadata
     */
    async getObjectStat(bucketName, objectName) {
        this.ensureConnected();
        try {
            console.log(`📊 Getting stats for object '${objectName}' in bucket '${bucketName}'`);
            const stat = await this.client.statObject(bucketName, objectName);
            console.log(`📊 Object '${objectName}' size: ${stat.size} bytes, modified: ${stat.lastModified}`);
            return stat;
        } catch (error) {
            console.error(`❌ Error getting stats for object '${objectName}':`, error.message);
            throw error;
        }
    }

    /**
     * Check if an object exists
     * @param {string} bucketName - Name of the bucket
     * @param {string} objectName - Name of the object
     * @returns {Promise<boolean>} True if object exists
     */
    async objectExists(bucketName, objectName) {
        try {
            await this.getObjectStat(bucketName, objectName);
            return true;
        } catch (error) {
            if (error.code === 'NotFound') {
                return false;
            }
            throw error;
        }
    }

    /**
     * Generate a presigned URL for downloading an object
     * @param {string} bucketName - Name of the bucket
     * @param {string} objectName - Name of the object
     * @param {number} expiry - URL expiration in seconds (default: 24 hours)
     * @returns {Promise<string>} Presigned URL
     */
    async getPresignedUrl(bucketName, objectName, expiry = 24 * 60 * 60) {
        this.ensureConnected();
        try {
            console.log(`🔗 Generating presigned URL for '${objectName}' (expires in ${expiry}s)`);
            const url = await this.client.presignedGetObject(bucketName, objectName, expiry);
            console.log(`✅ Generated presigned URL for '${objectName}'`);
            return url;
        } catch (error) {
            console.error(`❌ Error generating presigned URL for '${objectName}':`, error.message);
            throw error;
        }
    }

    /**
     * Search for objects by name pattern
     * @param {string} bucketName - Name of the bucket
     * @param {string} pattern - Search pattern (supports wildcards)
     * @param {string} prefix - Optional prefix to limit search scope
     * @returns {Promise<Array>} Array of matching objects
     */
    async searchObjects(bucketName, pattern, prefix = '') {
        const allObjects = await this.listObjects(bucketName, prefix, true);
        
        // Convert pattern to regex (simple wildcard support)
        const regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(regexPattern, 'i');
        
        const matchingObjects = allObjects.filter(obj => regex.test(obj.name));
        console.log(`🔍 Found ${matchingObjects.length} objects matching pattern '${pattern}'`);
        
        return matchingObjects;
    }

    /**
     * Get multiple objects by pattern
     * @param {string} bucketName - Name of the bucket
     * @param {string} pattern - Search pattern
     * @param {string} prefix - Optional prefix
     * @returns {Promise<Array>} Array of objects with name and data
     */
    async getObjectsByPattern(bucketName, pattern, prefix = '') {
        const matchingObjects = await this.searchObjects(bucketName, pattern, prefix);
        
        const results = await Promise.allSettled(
            matchingObjects.map(async (obj) => {
                try {
                    const data = await this.getObject(bucketName, obj.name);
                    return {
                        name: obj.name,
                        size: obj.size,
                        lastModified: obj.lastModified,
                        data: data
                    };
                } catch (error) {
                    console.error(`❌ Failed to fetch object '${obj.name}':`, error.message);
                    return {
                        name: obj.name,
                        error: error.message
                    };
                }
            })
        );

        const successful = results
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value);

        console.log(`📥 Successfully fetched ${successful.length} out of ${matchingObjects.length} objects`);
        return successful;
    }

    /**
     * Ensure client is connected before operations
     * @private
     */
    ensureConnected() {
        if (!this.connected || !this.client) {
            throw new Error('S3 client is not connected. Call connect() first.');
        }
    }

    /**
     * Get connection info
     * @returns {Object} Connection configuration (without sensitive data)
     */
    getConnectionInfo() {
        return {
            endPoint: this.config.endPoint,
            port: this.config.port,
            useSSL: this.config.useSSL,
            region: this.config.region,
            connected: this.connected
        };
    }
}

module.exports = { S3Client };
