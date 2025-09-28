#!/usr/bin/env node

// Health check script for WebSocket server
// Checks if the WebSocket server is listening on the specified port

const net = require('net');

const WS_PORT = process.env.WS_PORT || 8080;
const timeout = 5000; // 5 second timeout

const socket = new net.Socket();

socket.setTimeout(timeout);

socket.on('connect', () => {
    console.log('WebSocket health check passed - port is listening');
    socket.destroy();
    process.exit(0);
});

socket.on('error', (err) => {
    console.error(`WebSocket health check failed: ${err.message}`);
    socket.destroy();
    process.exit(1);
});

socket.on('timeout', () => {
    console.error('WebSocket health check timed out');
    socket.destroy();
    process.exit(1);
});

// Attempt to connect to the WebSocket port
socket.connect(WS_PORT, 'localhost');
