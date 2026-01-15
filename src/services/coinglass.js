const axios = require('axios');

/**
 * Liquidation Tracking Service (FREE - No API Keys Required)
 *
 * Methods used (in order of preference):
 * 1. Binance Open Interest drops (detects liquidations via OI changes)
 * 2. CoinGecko volatility proxy (estimates liquidations from price volatility)
 * 3. Disabled mode (set DISABLE_LIQUIDATION_TRACKING=true in .env)
 */
class LiquidationService {
    constructor() {
        this.binanceFuturesUrl = 'https://fapi.binance.com';
        this.cache = new Map();
        this.cacheExpiry = 60000; // Cache for 60 seconds
        this.previousOI = new Map(); // Track previous open interest
        this.disabled = process.env.DISABLE_LIQUIDATION_TRACKING === 'true';

        if (this.disabled) {
            console.log('[Liquidations] ⚠️  Liquidation tracking is DISABLED via environment variable');
        }
    }

    /**
     * Get liquidation estimates (100% FREE)
     * @param {string} symbol - Symbol like 'ETH' or 'BTC'
     * @returns {Promise<{totalVolUsd: number, buyVolUsd: number, sellVolUsd: number, direction: string}>}
     */
    async getLiquidations(symbol = 'ETH') {
        // If disabled, return immediately
        if (this.disabled) {
            return this._returnDefault();
        }

        const cacheKey = symbol;

        // Check cache first
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheExpiry) {
                return cached.data;
            }
        }

        // Try Method 1: Open Interest tracking
        try {
            const result = await this._trackOpenInterest(symbol);

            if (result.totalVolUsd > 0) {
                // Cache successful result
                this.cache.set(cacheKey, {
                    timestamp: Date.now(),
                    data: result
                });
                return result;
            }

            // If no liquidations detected, still cache to avoid hammering API
            this.cache.set(cacheKey, {
                timestamp: Date.now(),
                data: result
            });

            return result;

        } catch (error) {
            // Try Method 2: Volatility proxy
            try {
                return await this._volatilityProxy(symbol);
            } catch (fallbackError) {
                // All methods failed, return default
                return this._returnDefault();
            }
        }
    }

    /**
     * Method 1: Track Open Interest drops as liquidation proxy
     */
    async _trackOpenInterest(symbol) {
        const binanceSymbol = `${symbol}USDT`;

        // Fetch Open Interest and Price in parallel
        const [oiResponse, priceResponse] = await Promise.all([
            axios.get(`${this.binanceFuturesUrl}/fapi/v1/openInterest`, {
                params: { symbol: binanceSymbol },
                timeout: 5000
            }),
            axios.get(`${this.binanceFuturesUrl}/fapi/v1/ticker/price`, {
                params: { symbol: binanceSymbol },
                timeout: 5000
            })
        ]);

        const currentOI = parseFloat(oiResponse.data.openInterest || 0);
        const currentPrice = parseFloat(priceResponse.data.price || 0);
        const currentOIUsd = currentOI * currentPrice;

        // Get previous OI
        const previousData = this.previousOI.get(symbol);

        let liquidationEstimateUsd = 0;
        let direction = 'none';

        if (previousData) {
            const oiDropUsd = previousData.oiUsd - currentOIUsd;
            const oiDropPercent = ((oiDropUsd / previousData.oiUsd) * 100);
            const timeDiff = Date.now() - previousData.timestamp;

            // Detect liquidation cascade:
            // - OI dropped by 1%+
            // - Within last 5 minutes
            if (oiDropUsd > 0 && oiDropPercent > 1 && timeDiff < 300000) {
                liquidationEstimateUsd = oiDropUsd;

                // Determine direction from price movement
                if (currentPrice > previousData.price) {
                    direction = 'short'; // Shorts liquidated (price up)
                } else if (currentPrice < previousData.price) {
                    direction = 'long'; // Longs liquidated (price down)
                }

                console.log(
                    `[Liquidations] 💥 ${symbol} OI Drop Detected: $${(liquidationEstimateUsd / 1e6).toFixed(2)}M ` +
                    `(-${oiDropPercent.toFixed(1)}% | ${direction}s liquidated)`
                );
            }
        }

        // Update previous OI tracker
        this.previousOI.set(symbol, {
            oiUsd: currentOIUsd,
            price: currentPrice,
            timestamp: Date.now()
        });

        return {
            totalVolUsd: liquidationEstimateUsd,
            buyVolUsd: direction === 'short' ? liquidationEstimateUsd : 0,
            sellVolUsd: direction === 'long' ? liquidationEstimateUsd : 0,
            direction,
            openInterest: currentOIUsd,
            method: 'open-interest'
        };
    }

    /**
     * Method 2: Volatility-based liquidation estimate
     */
    async _volatilityProxy(symbol) {
        // Map common symbols to CoinGecko IDs
        const coinGeckoIds = {
            'ETH': 'ethereum',
            'BTC': 'bitcoin',
            'SOL': 'solana',
            'AVAX': 'avalanche-2'
        };

        const coinId = coinGeckoIds[symbol] || symbol.toLowerCase();

        const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`, {
            params: {
                vs_currency: 'usd',
                days: 1,
                interval: 'hourly'
            },
            timeout: 8000
        });

        if (response.data?.prices && response.data.prices.length >= 2) {
            const prices = response.data.prices.map(p => p[1]);
            const lastTwoPrices = prices.slice(-2);

            const priceChange = Math.abs(lastTwoPrices[1] - lastTwoPrices[0]);
            const percentChange = (priceChange / lastTwoPrices[0]) * 100;

            // Estimate liquidations based on volatility
            // 5%+ hourly move = likely liquidation cascade
            // Rough formula: $10M per 1% move above 5% threshold
            const estimatedLiqUsd = percentChange > 5 ? (percentChange - 5) * 10000000 : 0;

            if (estimatedLiqUsd > 0) {
                console.log(
                    `[Liquidations] 📊 ${symbol} Volatility estimate: $${(estimatedLiqUsd / 1e6).toFixed(1)}M ` +
                    `(${percentChange.toFixed(1)}% hourly move)`
                );
            }

            return {
                totalVolUsd: estimatedLiqUsd,
                buyVolUsd: 0,
                sellVolUsd: 0,
                direction: estimatedLiqUsd > 0 ? 'estimated' : 'none',
                method: 'volatility-proxy'
            };
        }

        return this._returnDefault();
    }

    /**
     * Clear all cached data
     */
    clearCache() {
        this.cache.clear();
        this.previousOI.clear();
    }

    /**
     * Get internal state (for debugging)
     */
    getState() {
        return {
            disabled: this.disabled,
            cache: Array.from(this.cache.entries()),
            previousOI: Array.from(this.previousOI.entries())
        };
    }

    _returnDefault() {
        return {
            totalVolUsd: 0,
            buyVolUsd: 0,
            sellVolUsd: 0,
            direction: 'none'
        };
    }
}

module.exports = new LiquidationService();
