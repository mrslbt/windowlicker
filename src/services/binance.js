const WebSocket = require('ws');
const axios = require('axios');

class BinanceService {
    constructor() {
        this.ws = null;
        this.btcPrice = null;
        this.ethPrice = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.callbacks = []; // List of functions to call on price update

        // Premium index cache (real-time, not stale like funding rate)
        this.premiumData = { ETH: null, BTC: null };
        this.premiumTimestamp = 0;
        this.premiumCacheMs = 5000; // Cache for 5s only - we want fresh data
    }

    connect() {
        // We want both BTC and ETH. Using combined stream.
        const streams = ['btcusdt@aggTrade', 'ethusdt@aggTrade'].join('/');
        const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            console.log('[Binance] Connected to price feeds');
            this.isConnected = true;
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                const stream = message.stream;
                const trade = message.data;
                const price = parseFloat(trade.p);

                if (stream.includes('btcusdt')) {
                    this.btcPrice = price;
                } else if (stream.includes('ethusdt')) {
                    this.ethPrice = price;
                }

                // Notify listeners
                this.notifyListeners();
            } catch (error) {
                // Ignore parse errors
            }
        });

        this.ws.on('close', () => {
            console.log('[Binance] Disconnected, reconnecting in 5s...');
            this.isConnected = false;
            this.reconnectTimer = setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', (error) => {
            console.error('[Binance] WebSocket error:', error.message);
        });

        // Heartbeat
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000);
    }

    onPriceUpdate(callback) {
        this.callbacks.push(callback);
    }

    notifyListeners() {
        const data = { btc: this.btcPrice, eth: this.ethPrice };
        this.callbacks.forEach(cb => cb(data));
    }

    getPrices() {
        return { btc: this.btcPrice, eth: this.ethPrice };
    }

    /**
     * Get premium index for a symbol (REAL-TIME from Binance Futures)
     * Premium = (markPrice - indexPrice) / indexPrice
     * Positive premium = perp > spot = longs crowded NOW
     * Negative premium = perp < spot = shorts crowded NOW
     * @param {string} symbol - 'ETH' or 'BTC'
     */
    async getPremiumIndex(symbol = 'ETH') {
        const now = Date.now();

        // Return cached if fresh (5 second cache)
        if (this.premiumData[symbol] !== null && (now - this.premiumTimestamp) < this.premiumCacheMs) {
            return this.premiumData[symbol];
        }

        try {
            const response = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
                params: { symbol: `${symbol}USDT` },
                timeout: 5000
            });

            const data = response.data;
            const markPrice = parseFloat(data.markPrice);
            const indexPrice = parseFloat(data.indexPrice);

            // Calculate premium (real-time crowding indicator)
            const premium = ((markPrice - indexPrice) / indexPrice) * 100; // As percentage

            const result = {
                premium,                    // e.g., 0.05 means perp is 0.05% above spot
                markPrice,                  // Futures price
                indexPrice,                 // Spot price
                lastFundingRate: parseFloat(data.lastFundingRate) * 100 // Keep for reference
            };

            this.premiumData[symbol] = result;
            this.premiumTimestamp = now;

            return result;
        } catch (error) {
            console.error(`[Binance] Failed to fetch premium index for ${symbol}:`, error.message);
            return { premium: 0, markPrice: 0, indexPrice: 0, lastFundingRate: 0 };
        }
    }

    /**
     * Analyze premium for bounce risk (REAL-TIME)
     * @param {string} symbol - 'ETH' or 'BTC'
     * @param {string} direction - 'UP' or 'DOWN'
     * @returns {Promise<{crowded: boolean, bounceRisk: string, premium: number, analysis: string}>}
     */
    async analyzePremium(symbol = 'ETH', direction = 'UP') {
        const data = await this.getPremiumIndex(symbol);
        const premium = data.premium;

        let crowded = false;
        let bounceRisk = 'LOW';
        let analysis = '';

        // Premium thresholds (typical range: -0.1% to +0.1%)
        // >0.15% or <-0.15% = extreme crowding
        // >0.08% or <-0.08% = moderate crowding

        if (direction === 'UP') {
            // Buying UP - worried about longs being crowded (positive premium)
            if (premium > 0.15) {
                crowded = true;
                bounceRisk = 'HIGH';
                analysis = 'Perp trading way above spot - longs crowded';
            } else if (premium > 0.08) {
                crowded = true;
                bounceRisk = 'MEDIUM';
                analysis = 'Perp above spot - some long crowding';
            } else if (premium < -0.05) {
                bounceRisk = 'LOW';
                analysis = 'Perp below spot - room to run up';
            } else {
                bounceRisk = 'LOW';
                analysis = 'Neutral premium - no crowding';
            }
        } else {
            // Buying DOWN - worried about shorts being crowded (negative premium)
            if (premium < -0.15) {
                crowded = true;
                bounceRisk = 'HIGH';
                analysis = 'Perp trading way below spot - shorts crowded';
            } else if (premium < -0.08) {
                crowded = true;
                bounceRisk = 'MEDIUM';
                analysis = 'Perp below spot - some short crowding';
            } else if (premium > 0.05) {
                bounceRisk = 'LOW';
                analysis = 'Perp above spot - room to run down';
            } else {
                bounceRisk = 'LOW';
                analysis = 'Neutral premium - no crowding';
            }
        }

        return {
            crowded,
            bounceRisk,
            premium,
            markPrice: data.markPrice,
            indexPrice: data.indexPrice,
            analysis
        };
    }
}

module.exports = new BinanceService();
