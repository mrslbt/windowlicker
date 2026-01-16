const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');

class LoggerService {
    constructor() {
        this.logFile = path.resolve(CONFIG.LOGGING.SIGNALS_FILE);
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        const dir = path.dirname(this.logFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Log a signal/alert to the JSONL file
     * @param {Object} data - Signal data to log
     */
    logSignal(data) {
        if (!CONFIG.LOGGING.ENABLED) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            hour: this.getHourStart().toISOString(),
            ...data
        };

        try {
            fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
            console.log(`[Logger] Signal logged: ${data.recommendation || 'N/A'} @ ${data.ethPrice?.toFixed(2) || 'N/A'}`);
        } catch (error) {
            console.error('[Logger] Failed to write signal:', error.message);
        }
    }

    /**
     * Get the start of the current hour
     */
    getHourStart() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    }

    /**
     * Read all logged signals (for analysis)
     * @returns {Array} Array of signal objects
     */
    readSignals() {
        try {
            if (!fs.existsSync(this.logFile)) return [];

            const content = fs.readFileSync(this.logFile, 'utf8');
            return content
                .trim()
                .split('\n')
                .filter(line => line)
                .map(line => JSON.parse(line));
        } catch (error) {
            console.error('[Logger] Failed to read signals:', error.message);
            return [];
        }
    }

    /**
     * Get signals from the last N hours
     * @param {number} hours - Number of hours to look back
     * @returns {Array} Array of signal objects
     */
    getRecentSignals(hours = 24) {
        const signals = this.readSignals();
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        return signals.filter(s => new Date(s.timestamp) >= cutoff);
    }

    /**
     * Get summary statistics
     * @returns {Object} Stats object
     */
    getStats() {
        const signals = this.readSignals();
        const last24h = this.getRecentSignals(24);

        const countByRec = (arr, rec) => arr.filter(s => s.recommendation === rec).length;

        return {
            total: signals.length,
            last24h: last24h.length,
            buyCount: countByRec(signals, 'BUY'),
            smallBetCount: countByRec(signals, 'SMALL BET'),
            skipCount: countByRec(signals, 'SKIP'),
            last24hBuy: countByRec(last24h, 'BUY'),
            last24hSmallBet: countByRec(last24h, 'SMALL BET'),
            last24hSkip: countByRec(last24h, 'SKIP'),
        };
    }
}

module.exports = new LoggerService();
