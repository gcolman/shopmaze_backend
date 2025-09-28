// Shared data store for WebSocket and HTTP servers
// This module manages the leaderboard data that's shared between servers


class DataStore {
    constructor() {
        this.leaderboardData = [];
    }

    // Add a new leaderboard entry
    addLeaderboardEntry(entry) {
        this.leaderboardData.push(entry);
        
        // Sort by score (highest first) and keep top 100
        this.leaderboardData.sort((a, b) => b.score - a.score);
        if (this.leaderboardData.length > 100) {
            this.leaderboardData = this.leaderboardData.slice(0, 100);
        }
        
        console.log(`🏆 New leaderboard entry: ${entry.userId} scored ${entry.score} (T-shirts: ${entry.tShirtValue}, Coins: ${entry.coinsRemaining})`);
        console.log(`📊 Current leaderboard has ${this.leaderboardData.length} entries`);
    }

    // Get all leaderboard data
    getLeaderboardData() {
        return this.leaderboardData;
    }

    // Get leaderboard count
    getLeaderboardCount() {
        return this.leaderboardData.length;
    }

    // Process game over events for leaderboard
    processGameOverEvent(gameEvent) {
        console.log("Game over event:", gameEvent);
        try {
            const player = gameEvent.player;
            const gameData = gameEvent.gameData;
            console.log("GD >> ", gameData);
            
            // Calculate score: T-shirt total value + coins remaining
            const tShirtScoreMultiplyer = 2; //To calculate the score, Tshirts are worth double the coins. 
            const levelMultiplyer = 10; //To calculate the score, each level is worth 10 points.
            const tShirtValue = gameData.tShirtsCollected.totalValue || 0;
            const coinsRemaining = gameData.coinsRemaining || 0;
            //const totalScore = tShirtValue * tShirtScoreMultiplyer + coinsRemaining + (levelMultiplyer * gameData.currentLevel || 1);
            
            const leaderboardEntry = {
                userId: player.userId,
                email: player.email,
                username: player.username,
                score: gameData.gameScore,
                tShirtValue: tShirtValue,
                coinsRemaining: coinsRemaining,
                tShirtsCount: gameData.tShirtsCollected.totalCount || 0,
                level: gameData.currentLevel || 1,
                timestamp: gameEvent.timestamp,
                gameSession: gameData.gameSession
            };
            
            this.addLeaderboardEntry(leaderboardEntry);
            this.updateInvoice(gameEvent);
            
        } catch (error) {
            console.error('❌ Error processing game over event for leaderboard:', error);
        }
    }
}

// Export singleton instance
module.exports = new DataStore();
