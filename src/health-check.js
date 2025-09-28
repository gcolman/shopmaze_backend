#!/usr/bin/env node

// Health check script for Docker containers
// Uses Node.js http module instead of external dependencies like curl

const http = require('http');

const HTTP_PORT = process.env.HTTP_PORT || 8099;
const timeout = 5000; // 5 second timeout

const options = {
    hostname: 'localhost',
    port: HTTP_PORT,
    path: '/health',
    method: 'GET',
    timeout: timeout
};

const req = http.request(options, (res) => {
    if (res.statusCode === 200) {
        console.log('Health check passed');
        process.exit(0);
    } else {
        console.error(`Health check failed with status: ${res.statusCode}`);
        process.exit(1);
    }
});

req.on('error', (err) => {
    console.error(`Health check failed: ${err.message}`);
    process.exit(1);
});

req.on('timeout', () => {
    console.error('Health check timed out');
    req.destroy();
    process.exit(1);
});

req.setTimeout(timeout);
req.end();
