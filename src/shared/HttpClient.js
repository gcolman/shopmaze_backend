const http = require('http');
const https = require('https');
const url = require('url');

/**
 * Generic HTTP Client for making HTTP/HTTPS requests
 * Supports all common HTTP methods and provides a clean Promise-based API
 */
class HttpClient {
    /**
     * Create a new HttpClient instance
     * @param {Object} options - Configuration options
     * @param {string} options.baseUrl - Base URL for all requests (e.g., 'http://localhost:8099')
     * @param {Object} options.defaultHeaders - Default headers to include with all requests
     * @param {number} options.timeout - Request timeout in milliseconds (default: 5000)
     * @param {boolean} options.followRedirects - Whether to follow redirects (default: false)
     */
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || '';
        this.defaultHeaders = {
            'Content-Type': 'application/json',
            'User-Agent': 'HttpClient/1.0',
            ...options.defaultHeaders
        };
        this.timeout = options.timeout || 5000;
        this.followRedirects = options.followRedirects || false;
    }

    /**
     * Parse URL and determine if it's HTTP or HTTPS
     * @param {string} requestUrl - The URL to parse
     * @returns {Object} Parsed URL object with protocol info
     */
    parseUrl(requestUrl) {
        const fullUrl = requestUrl.startsWith('http') ? requestUrl : this.baseUrl + requestUrl;
        const parsedUrl = url.parse(fullUrl);
        
        return {
            ...parsedUrl,
            isHttps: parsedUrl.protocol === 'https:',
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80)
        };
    }

    /**
     * Make a generic HTTP request
     * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
     * @param {string} requestUrl - Request URL (absolute or relative to baseUrl)
     * @param {Object|string|null} data - Request body data
     * @param {Object} options - Request options
     * @param {Object} options.headers - Additional headers for this request
     * @param {number} options.timeout - Override default timeout for this request
     * @param {boolean} options.json - Whether to JSON stringify the data (default: true)
     * @returns {Promise<Object>} Promise that resolves with response data
     */
    request(method, requestUrl, data = null, options = {}) {
        return new Promise((resolve, reject) => {
            const parsedUrl = this.parseUrl(requestUrl);
            const httpModule = parsedUrl.isHttps ? https : http;
            
            // Prepare request data
            let postData = null;
            if (data !== null) {
                if (options.json !== false && typeof data === 'object') {
                    postData = JSON.stringify(data);
                } else {
                    postData = data.toString();
                }
            }

            // Prepare headers
            const headers = {
                ...this.defaultHeaders,
                ...options.headers
            };

            if (postData) {
                headers['Content-Length'] = Buffer.byteLength(postData);
            }

            // Request options
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.path,
                method: method.toUpperCase(),
                headers: headers,
                timeout: options.timeout || this.timeout
            };

            const req = httpModule.request(requestOptions, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        // Try to parse as JSON, fall back to raw string
                        let parsedData;
                        try {
                            parsedData = responseData ? JSON.parse(responseData) : {};
                        } catch (parseError) {
                            parsedData = responseData;
                        }

                        const response = {
                            statusCode: res.statusCode,
                            statusMessage: res.statusMessage,
                            headers: res.headers,
                            data: parsedData,
                            rawResponse: responseData
                        };

                        // Handle redirects if enabled
                        if (this.followRedirects && 
                            res.statusCode >= 300 && res.statusCode < 400 && 
                            res.headers.location) {
                            
                            return this.request(method, res.headers.location, data, options)
                                .then(resolve)
                                .catch(reject);
                        }

                        // Check if response is successful
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(response);
                        } else {
                            const errorMessage = parsedData.message || 
                                              parsedData.error || 
                                              responseData || 
                                              res.statusMessage;
                            reject(new HttpError(
                                `HTTP ${res.statusCode}: ${errorMessage}`,
                                res.statusCode,
                                response
                            ));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to process response: ${error.message}`));
                    }
                });
            });

            // Handle request timeout
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${requestOptions.timeout}ms`));
            });

            // Handle request errors
            req.on('error', (err) => {
                if (err.code === 'ECONNREFUSED') {
                    reject(new Error(`Connection refused to ${parsedUrl.hostname}:${parsedUrl.port}. Make sure the server is running.`));
                } else {
                    reject(new Error(`Network error: ${err.message}`));
                }
            });

            // Send request data
            if (postData) {
                req.write(postData);
            }
            
            req.end();
        });
    }

    /**
     * Make a GET request
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Promise<Object>} Promise that resolves with response data
     */
    get(url, options = {}) {
        return this.request('GET', url, null, options);
    }

    /**
     * Make a POST request
     * @param {string} url - Request URL
     * @param {Object|string} data - Request body data
     * @param {Object} options - Request options
     * @returns {Promise<Object>} Promise that resolves with response data
     */
    post(url, data, options = {}) {
        return this.request('POST', url, data, options);
    }

    /**
     * Make a PUT request
     * @param {string} url - Request URL
     * @param {Object|string} data - Request body data
     * @param {Object} options - Request options
     * @returns {Promise<Object>} Promise that resolves with response data
     */
    put(url, data, options = {}) {
        return this.request('PUT', url, data, options);
    }

    /**
     * Make a PATCH request
     * @param {string} url - Request URL
     * @param {Object|string} data - Request body data
     * @param {Object} options - Request options
     * @returns {Promise<Object>} Promise that resolves with response data
     */
    patch(url, data, options = {}) {
        return this.request('PATCH', url, data, options);
    }

    /**
     * Make a DELETE request
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Promise<Object>} Promise that resolves with response data
     */
    delete(url, options = {}) {
        return this.request('DELETE', url, null, options);
    }

    /**
     * Make a HEAD request
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Promise<Object>} Promise that resolves with response data
     */
    head(url, options = {}) {
        return this.request('HEAD', url, null, options);
    }

    /**
     * Set default headers for all future requests
     * @param {Object} headers - Headers to set as defaults
     */
    setDefaultHeaders(headers) {
        this.defaultHeaders = { ...this.defaultHeaders, ...headers };
    }

    /**
     * Set a single default header
     * @param {string} name - Header name
     * @param {string} value - Header value
     */
    setDefaultHeader(name, value) {
        this.defaultHeaders[name] = value;
    }

    /**
     * Get current default headers
     * @returns {Object} Current default headers
     */
    getDefaultHeaders() {
        return { ...this.defaultHeaders };
    }

    /**
     * Set base URL for relative requests
     * @param {string} baseUrl - Base URL to set
     */
    setBaseUrl(baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * Get current base URL
     * @returns {string} Current base URL
     */
    getBaseUrl() {
        return this.baseUrl;
    }

    /**
     * Set request timeout
     * @param {number} timeout - Timeout in milliseconds
     */
    setTimeout(timeout) {
        this.timeout = timeout;
    }

    /**
     * Get current timeout
     * @returns {number} Current timeout in milliseconds
     */
    getTimeout() {
        return this.timeout;
    }
}

/**
 * Custom error class for HTTP errors
 */
class HttpError extends Error {
    constructor(message, statusCode, response) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.response = response;
    }
}

// Export both the class and error class
module.exports = {
    HttpClient,
    HttpError
};
