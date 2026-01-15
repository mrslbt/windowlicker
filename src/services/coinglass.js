const axios = require('axios');
const CONFIG = require('../config');

class CoinglassService {
    constructor() {
        this.apiKey = process.env.COINGLASS_API_KEY;
        this.baseUrl = CONFIG.ETH_HOURLY.COINGLASS_API;
    }

    async getLiquidations(symbol = 'ETH') {
        // Check for API key - Coinglass requires authentication
        if (!this.apiKey) {
            if (!this._warnedOnce) {
                console.warn('[Coinglass] ⚠️  No API key provided. Liquidation data will be disabled.');
                console.warn('[Coinglass] Get a free API key at: https://www.coinglass.com/pricing');
                console.warn('[Coinglass] Add it to .env as: COINGLASS_API_KEY=your_key_here');
                this._warnedOnce = true;
            }
            return { totalVolUsd: 0, buyVolUsd: 0, sellVolUsd: 0 };
        }

        try {
            // Try primary endpoint - Coinglass API v2 with authentication
            const response = await axios.get(`${this.baseUrl}/liquidation_history`, {
                params: {
                    symbol: symbol,
                    time_type: 'h1' // Last 1 hour
                },
                timeout: 8000,
                headers: {
                    'coinglassSecret': this.apiKey,
                    'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
                    'Accept': 'application/json'
                }
            });

            if (response.data?.code === '0' && response.data?.data) {
                const data = response.data.data;
                const longLiq = parseFloat(data.longLiquidationUsd || 0);
                const shortLiq = parseFloat(data.shortLiquidationUsd || 0);
                const totalVolUsd = longLiq + shortLiq;

                console.log(`[Coinglass] ✅ ${symbol} Liquidations: $${(totalVolUsd / 1e6).toFixed(2)}M (Long: $${(longLiq / 1e6).toFixed(2)}M, Short: $${(shortLiq / 1e6).toFixed(2)}M)`);

                return {
                    totalVolUsd,
                    buyVolUsd: shortLiq, // Short liquidations = buy pressure
                    sellVolUsd: longLiq, // Long liquidations = sell pressure
                    direction: longLiq > shortLiq ? 'short' : 'long'
                };
            }

            // Handle API errors in response
            if (response.data?.msg) {
                console.warn(`[Coinglass] API Error: ${response.data.msg}`);
            }

        } catch (error) {
            const status = error.response?.status;
            const message = error.response?.data?.msg || error.message;

            // Handle specific error codes
            if (status === 403) {
                console.error('[Coinglass] ❌ Authentication failed (403). Check your API key.');
                console.error('[Coinglass] Get a valid key at: https://www.coinglass.com/pricing');
            } else if (status === 429) {
                console.warn('[Coinglass] ⚠️  Rate limit exceeded. Returning 0 liquidations.');
            } else {
                console.warn(`[Coinglass] API Error (${status || 'network'}): ${message}`);
            }

            // Try fallback endpoint as last resort
            try {
                const fallbackUrl = `https://www.coinglass.com/api/futures/liquidation/info`;
                const response = await axios.get(fallbackUrl, {
                    params: { symbol: symbol },
                    timeout: 8000,
                    headers: {
                        'coinglassSecret': this.apiKey,
                        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
                        'Accept': 'application/json'
                    }
                });

                if (response.data?.data?.totalVolUsd) {
                    const totalVolUsd = parseFloat(response.data.data.totalVolUsd || 0);
                    console.log(`[Coinglass] ✅ ${symbol} Liquidations (fallback): $${(totalVolUsd / 1e6).toFixed(2)}M`);

                    return {
                        totalVolUsd,
                        buyVolUsd: 0,
                        sellVolUsd: 0
                    };
                }
            } catch (fallbackError) {
                // Silent fail on fallback
            }
        }

        // Return safe defaults if all attempts fail
        return { totalVolUsd: 0, buyVolUsd: 0, sellVolUsd: 0 };
    }
}

module.exports = new CoinglassService();
