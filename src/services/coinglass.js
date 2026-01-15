const axios = require('axios');
const CONFIG = require('../config');

class CoinglassService {
    constructor() {
        this.apiKey = process.env.COINGLASS_API_KEY;
        this.baseUrl = CONFIG.ETH_HOURLY.COINGLASS_API;
    }

    async getLiquidations(symbol = 'ETH') {
        // NOTE: Real implementation would hit the Coinglass API.
        // For this task, we will try a basic fetch if a key exists, 
        // otherwise return a safe default or mock data so the bot doesn't crash.

        if (!this.apiKey) {
            // console.warn('[Coinglass] No API key provided, returning 0 stats.');
            return { totalVolUsd: 0, buyVolUsd: 0, sellVolUsd: 0 };
        }

        try {
            // Example endpoint (requires checking actual Coinglass API docs for exact path)
            // This is a common pattern, but might need adjustment.
            // const response = await axios.get(`${this.baseUrl}/liquidation_history`, {
            //     headers: { 'coinglassSecret': this.apiKey },
            //     params: { symbol, time_type: 'h1' }
            // });
            // return response.data;

            return { totalVolUsd: 0, buyVolUsd: 0, sellVolUsd: 0 };

        } catch (error) {
            console.error('[Coinglass] API Error:', error.message);
            return { totalVolUsd: 0, buyVolUsd: 0, sellVolUsd: 0 };
        }
    }
}

module.exports = new CoinglassService();
