const axios = require('axios');
const CONFIG = require('../config');

class PolymarketService {
    constructor() {
        this.gammaApi = CONFIG.ETH_HOURLY.GAMMA_API;

        // Odds velocity tracking
        this.oddsHistory = []; // Array of { timestamp, upOdds, downOdds }
        this.maxHistorySize = CONFIG.ETH_HOURLY.ODDS_HISTORY_WINDOW || 10;
    }

    async getMarketBySlug(slug) {
        try {
            const response = await axios.get(`${this.gammaApi}/events`, {
                params: { slug }
            });

            if (!response.data || response.data.length === 0) return null;

            const event = response.data[0];
            const market = event.markets?.[0];

            if (!market) return null;

            return {
                slug: slug,
                title: event.title || market.question,
                endTime: new Date(market.endDate || event.endDate).getTime(),
                id: market.id,
                market
            };
        } catch (error) {
            console.error(`[Polymarket] Error fetching slug ${slug}:`, error.message);
            return null;
        }
    }

    parseOutcomePrices(market) {
        if (!market) return { up: null, down: null };

        let outcomePrices = market.outcomePrices;
        let outcomes = market.outcomes;

        // Handle stringified JSON if necessary (API sometimes returns strings)
        if (typeof outcomePrices === 'string') {
            try { outcomePrices = JSON.parse(outcomePrices); } catch (e) { outcomePrices = null; }
        }
        if (typeof outcomes === 'string') {
            try { outcomes = JSON.parse(outcomes); } catch (e) { outcomes = null; }
        }

        let up = null;
        let down = null;

        if (outcomePrices && outcomes) {
            for (let i = 0; i < outcomes.length; i++) {
                const outcome = outcomes[i].toLowerCase();
                if (outcome === 'up' || outcome === 'yes') {
                    up = parseFloat(outcomePrices[i]);
                } else if (outcome === 'down' || outcome === 'no') {
                    down = parseFloat(outcomePrices[i]);
                }
            }
        }

        return { up, down };
    }

    /**
     * Record odds reading for velocity calculation
     * @param {number} upOdds - Current UP odds
     * @param {number} downOdds - Current DOWN odds
     */
    recordOdds(upOdds, downOdds) {
        const now = Date.now();

        this.oddsHistory.push({
            timestamp: now,
            upOdds,
            downOdds
        });

        // Keep only the last N readings
        if (this.oddsHistory.length > this.maxHistorySize) {
            this.oddsHistory.shift();
        }
    }

    /**
     * Calculate odds velocity (change per minute)
     * @param {string} direction - 'UP' or 'DOWN'
     * @returns {Object} Velocity data
     */
    calculateVelocity(direction = 'UP') {
        if (this.oddsHistory.length < 2) {
            return {
                velocity: 0,
                velocityStatus: 'UNKNOWN',
                minutesTracked: 0,
                oldestOdds: null,
                newestOdds: null,
            };
        }

        const oldest = this.oddsHistory[0];
        const newest = this.oddsHistory[this.oddsHistory.length - 1];

        const oddsKey = direction === 'UP' ? 'upOdds' : 'downOdds';
        const oldOdds = oldest[oddsKey];
        const newOdds = newest[oddsKey];

        if (oldOdds === null || newOdds === null) {
            return {
                velocity: 0,
                velocityStatus: 'UNKNOWN',
                minutesTracked: 0,
                oldestOdds: oldOdds,
                newestOdds: newOdds,
            };
        }

        const timeDiffMinutes = (newest.timestamp - oldest.timestamp) / (1000 * 60);

        if (timeDiffMinutes < 0.5) {
            return {
                velocity: 0,
                velocityStatus: 'INSUFFICIENT_DATA',
                minutesTracked: timeDiffMinutes,
                oldestOdds: oldOdds,
                newestOdds: newOdds,
            };
        }

        // Velocity = change per minute (as decimal, e.g., 0.02 = 2%/min)
        const velocity = (newOdds - oldOdds) / timeDiffMinutes;

        let velocityStatus = 'STABLE';
        if (velocity >= CONFIG.ETH_HOURLY.ODDS_VELOCITY_RAPID) {
            velocityStatus = 'RAPID_RISE';
        } else if (velocity >= CONFIG.ETH_HOURLY.ODDS_VELOCITY_RISING) {
            velocityStatus = 'RISING';
        } else if (velocity <= -CONFIG.ETH_HOURLY.ODDS_VELOCITY_RISING) {
            velocityStatus = 'FALLING';
        }

        return {
            velocity,                          // Change per minute (decimal)
            velocityPercent: velocity * 100,   // Change per minute (percentage)
            velocityStatus,                    // 'RAPID_RISE', 'RISING', 'FALLING', 'STABLE'
            minutesTracked: timeDiffMinutes,
            oldestOdds: oldOdds,
            newestOdds: newOdds,
            change: newOdds - oldOdds,
        };
    }

    /**
     * Clear odds history (call at start of new hour)
     */
    clearHistory() {
        this.oddsHistory = [];
        console.log('[Polymarket] Odds history cleared for new hour');
    }

    /**
     * Get current odds with velocity analysis
     * @param {string} slug - Market slug
     * @param {string} direction - 'UP' or 'DOWN'
     * @returns {Object} Odds and velocity data
     */
    async getOddsWithVelocity(slug, direction = 'UP') {
        const marketData = await this.getMarketBySlug(slug);

        if (!marketData) {
            return {
                upOdds: null,
                downOdds: null,
                currentOdds: null,
                velocity: null,
            };
        }

        const prices = this.parseOutcomePrices(marketData.market);

        // Record for velocity tracking
        if (prices.up !== null && prices.down !== null) {
            this.recordOdds(prices.up, prices.down);
        }

        const currentOdds = direction === 'UP' ? prices.up : prices.down;
        const velocityData = this.calculateVelocity(direction);

        return {
            upOdds: prices.up,
            downOdds: prices.down,
            currentOdds,
            velocity: velocityData,
            marketTitle: marketData.title,
        };
    }
}

module.exports = new PolymarketService();
