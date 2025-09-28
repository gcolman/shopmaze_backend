# Red Hat Quest WebSocket Control

This feature allows remote control of the Red Hat Quest game via WebSocket commands.

## Setup

### 1. Install Node.js Dependencies
```bash
npm install ws
```

### 2. Start the WebSocket Server
```bash
node websocket-server.js
```

The server will start on `ws://localhost:8080/game-control`

### 3. Start the Game
```bash
python3 -m http.server 8000
```

Open the game at `http://localhost:8000` - the game will automatically connect to the WebSocket server.

## Available Commands

The WebSocket server accepts the following commands:

### `start`
- **Function**: Starts or resumes the game
- **When paused**: Resumes gameplay
- **When game over**: Restarts the game
- **When already running**: No effect (returns info message)

### `pause`
- **Function**: Pauses the game
- **When running**: Pauses all game activity and shows "Game is paused by Administrators" overlay
- **When already paused**: No effect (returns info message)
- **When game over**: No effect (returns info message)
- **Visual**: Displays an animated pause overlay with administrative message

### `new`
- **Function**: Creates a new game
- **Always**: Restarts the game from the beginning
- **Aliases**: `newgame`, `new_game`

## Command Formats

Commands can be sent in multiple formats:

### Plain Text
```
start
pause
new
```

### JSON Format
```json
{"command": "start"}
{"command": "pause"}
{"command": "new"}
```

### Alternative JSON
```json
{"type": "start"}
```

## Testing Commands

### Using the Server Console
When running the WebSocket server, you can type commands directly:
```bash
start
pause
new
status
quit
```

### Using WebSocket Client Tools
You can use tools like `wscat` to send commands:
```bash
npm install -g wscat
wscat -c ws://localhost:8080/game-control
> start
> pause
> new
```

### Using Browser Console
Open the game in browser, then in DevTools console:
```javascript
// Check WebSocket status
console.log(window.RedHatQuest.GameController.websocketController.getStatus());

// Send manual command (if needed)
window.RedHatQuest.GameController.websocketController.sendMessage({command: "pause"});
```

## Response Format

The game sends back JSON responses for successful commands:
```json
{
  "type": "response",
  "command": "start",
  "status": "success",
  "message": "Game resumed"
}
```

Status values:
- `success`: Command executed successfully
- `info`: Command received but no action needed
- `error`: Command failed

**Note**: Server status messages (`welcome`, `received`, `error`, `status`) are automatically filtered and do not trigger command processing to prevent message loops.

## Game Status Information

The WebSocket controller automatically sends status updates and can provide game state information including:
- Connection status
- Game over state
- Pause state
- Current level
- Player lives (red hats)
- Coin count
- Shopping basket items

## Integration Example

```javascript
// Example external control script
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8080/game-control');

ws.on('open', () => {
    console.log('Connected to game');
    
    // Start a new game
    ws.send('new');
    
    // Pause after 5 seconds
    setTimeout(() => ws.send('pause'), 5000);
    
    // Resume after 10 seconds
    setTimeout(() => ws.send('start'), 10000);
});

ws.on('message', (data) => {
    const response = JSON.parse(data);
    console.log('Game response:', response);
});
```

## Error Handling

The WebSocket controller includes:
- Automatic reconnection (up to 5 attempts)
- Error logging and reporting
- Graceful connection failure handling
- Command validation

## Security Notes

This is a demonstration implementation. For production use, consider:
- Authentication/authorization
- Rate limiting
- Input validation
- Encrypted connections (WSS)
- CORS restrictions
