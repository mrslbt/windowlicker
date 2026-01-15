const axios = require('axios');
const CONFIG = require('../config');

class PolymarketService {
    constructor() {
        this.gammaApi = CONFIG.ETH_HOURLY.GAMMA_API; // Shared base URL
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
}

module.exports = new PolymarketService();
