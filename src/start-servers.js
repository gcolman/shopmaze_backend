#!/usr/bin/env node

// Process manager to start both WebSocket and HTTP servers
// Handles graceful shutdown and process coordination

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Red Hat Quest Backend Services...\n');

// Start WebSocket server
const wsServer = spawn('node', [path.join(__dirname, 'websocket-server.js')], {
    stdio: 'inherit',
    env: { ...process.env, SERVER_TYPE: 'websocket' }
});

// Start HTTP server
const httpServer = spawn('node', [path.join(__dirname, 'http-server.js')], {
    stdio: 'inherit',
    env: { ...process.env, SERVER_TYPE: 'http' }
});

// Handle WebSocket server events
wsServer.on('close', (code) => {
    console.log(`\n🔌 WebSocket server exited with code ${code}`);
    if (code !== 0) {
        console.log('❌ WebSocket server crashed, shutting down all services...');
        httpServer.kill('SIGTERM');
        process.exit(1);
    }
});

wsServer.on('error', (err) => {
    console.error('❌ WebSocket server error:', err);
    httpServer.kill('SIGTERM');
    process.exit(1);
});

// Handle HTTP server events
httpServer.on('close', (code) => {
    console.log(`\n📊 HTTP server exited with code ${code}`);
    if (code !== 0) {
        console.log('❌ HTTP server crashed, shutting down all services...');
        wsServer.kill('SIGTERM');
        process.exit(1);
    }
});

httpServer.on('error', (err) => {
    console.error('❌ HTTP server error:', err);
    wsServer.kill('SIGTERM');
    process.exit(1);
});

// Handle graceful shutdown
function shutdown() {
    console.log('\n🛑 Shutting down all servers gracefully...');
    
    wsServer.kill('SIGTERM');
    httpServer.kill('SIGTERM');
    
    // Force kill if they don't shut down within 5 seconds
    setTimeout(() => {
        wsServer.kill('SIGKILL');
        httpServer.kill('SIGKILL');
        process.exit(0);
    }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('✅ Both servers started successfully');
console.log('📝 Use Ctrl+C to stop all services\n');
