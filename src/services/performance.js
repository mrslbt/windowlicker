const fs = require('fs');
const path = require('path');
const discordService = require('./discord'); // Optional: to notify discord on resolution

class PerformanceService {
    constructor() {
        this.filePath = path.join(__dirname, '../../data/performance_log.json');
        this.ensureFileExists();
    }

    ensureFileExists() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
        }
    }

    readLog() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('[Performance] Error reading log:', error.message);
            return [];
        }
    }

    writeLog(data) {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[Performance] Error writing log:', error.message);
        }
    }

    /**
     * Record a signal to be checked in 8 hours
     */
    async recordSignal(data) {
        // data: { price, score, recommendation, strength, ethMove, timestamp }
        const log = this.readLog();

        // Avoid duplicate recording for the same hour if called multiple times in minute 40
        // Check if we have an entry within the last 50 minutes
        const now = Date.now();
        const existing = log.find(entry => Math.abs(entry.timestamp - now) < 50 * 60 * 1000);

        if (existing) {
            console.log('[Performance] Signal already recorded for this hour.');
            return;
        }

        const entry = {
            id: now.toString(),
            timestamp: now,
            resolveTime: now + (8 * 60 * 60 * 1000), // 8 hours later
            status: 'PENDING',
            ...data
        };

        log.push(entry);
        this.writeLog(log);
        console.log(`[Performance] 📝 Recorded Signal: ${data.recommendation} @ $${data.price} (Resolution: ${new Date(entry.resolveTime).toLocaleTimeString()})`);
    }

    /**
     * Check if any pending signals need to be resolved
     */
    async checkSettlements(currentPrice) {
        const log = this.readLog();
        let changed = false;

        for (const entry of log) {
            if (entry.status === 'PENDING' && Date.now() >= entry.resolveTime) {
                // Settle
                const pnlValues = this.calculatePnL(entry, currentPrice);

                entry.status = 'RESOLVED';
                entry.exitPrice = currentPrice;
                entry.pnlPercent = pnlValues.pnlPercent;
                entry.pnlAbs = pnlValues.pnlAbs;
                entry.result = pnlValues.result; // WIN / LOSS / FLAT

                changed = true;

                // Log outcome
                const message = `[Performance] 🏁 Settlement: ${entry.recommendation} (8h ago)\n` +
                    `Entry: $${entry.entryPrice} | Exit: $${currentPrice}\n` +
                    `Result: ${entry.result} (${entry.pnlPercent}%)`;
                console.log(message);

                // Optional: Send to Discord debugging channel? 
                // We'll keep it to console/log for now as requested "lets match later".
            }
        }

        if (changed) {
            this.writeLog(log);
        }
    }

    calculatePnL(entry, currentPrice) {
        const direction = entry.recommendation === 'BUY' ? 1 : -1; // Assuming BUY is Long. What about "WAIT"?

        // If recommendation was WAIT/SKIP, result is flat (0)
        if (entry.recommendation !== 'BUY' && entry.recommendation !== 'SMALL BET') {
            return { pnlPercent: 0, pnlAbs: 0, result: 'FLAT' };
        }

        // Assuming Long Only for now based on context? 
        // Or does the bot have Short signals? 
        // Based on `eth-hourly.js`, recommendation is based on Score. 
        // And Checks use `direction`. But `recommendation` string doesn't say SHORT.
        // Let's assume the user buys if score is high.
        // Wait, the bot produces "UP" or "DOWN" signals in the embed, but the recommendation is "BUY" or "SMALL BET".
        // Does "BUY" mean Long? Or "Enter Position"?
        // Looking at `eth-hourly.js`: `const direction = ethMove >= 0 ? 'UP' : 'DOWN';`
        // So the signal direction is implied by the trend.
        // We need to capture the direction in `recordSignal`.

        const isLong = entry.direction === 'UP';
        const mult = isLong ? 1 : -1;

        const pnlAbs = (currentPrice - entry.entryPrice) * mult;
        const pnlPercent = ((currentPrice - entry.entryPrice) / entry.entryPrice) * 100 * mult;

        const result = pnlPercent > 0 ? 'WIN' : pnlPercent < 0 ? 'LOSS' : 'FLAT';

        return { pnlPercent: pnlPercent.toFixed(2), pnlAbs: pnlAbs.toFixed(2), result };
    }
}

module.exports = new PerformanceService();
