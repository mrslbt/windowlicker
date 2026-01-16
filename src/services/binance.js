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

        // Funding rate cache
        this.fundingRates = { ETH: null, BTC: null };
        this.fundingRateTimestamp = 0;
        this.fundingRateCacheMs = 60000; // Cache for 60s (funding only changes every 8h)
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
     * Get funding rate for a symbol (from Binance Futures)
     * Positive = longs pay shorts (longs crowded)
     * Negative = shorts pay longs (shorts crowded)
     * @param {string} symbol - 'ETH' or 'BTC'
     * @returns {Promise<{rate: number, nextFundingTime: number}>}
     */
    async getFundingRate(symbol = 'ETH') {
        const now = Date.now();

        // Return cached if fresh
        if (this.fundingRates[symbol] !== null && (now - this.fundingRateTimestamp) < this.fundingRateCacheMs) {
            return this.fundingRates[symbol];
        }

        try {
            const response = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
                params: { symbol: `${symbol}USDT` },
                timeout: 5000
            });

            const data = response.data;
            const result = {
                rate: parseFloat(data.lastFundingRate),       // e.g., 0.0001 = 0.01%
                ratePercent: parseFloat(data.lastFundingRate) * 100, // e.g., 0.01
                nextFundingTime: data.nextFundingTime,
                markPrice: parseFloat(data.markPrice)
            };

            this.fundingRates[symbol] = result;
            this.fundingRateTimestamp = now;

            return result;
        } catch (error) {
            console.error(`[Binance] Failed to fetch funding rate for ${symbol}:`, error.message);
            return { rate: 0, ratePercent: 0, nextFundingTime: 0, markPrice: 0 };
        }
    }

    /**
     * Analyze funding rate for bounce risk
     * @param {string} symbol - 'ETH' or 'BTC'
     * @param {string} direction - 'UP' or 'DOWN'
     * @returns {Promise<{crowded: boolean, bounceRisk: string, rate: number, analysis: string}>}
     */
    async analyzeFundingRate(symbol = 'ETH', direction = 'UP') {
        const funding = await this.getFundingRate(symbol);
        const rate = funding.ratePercent;

        let crowded = false;
        let bounceRisk = 'LOW';
        let analysis = '';

        // Thresholds (typical funding is -0.01% to +0.01%)
        // Extreme: > 0.03% or < -0.03%
        // High: > 0.02% or < -0.02%

        if (direction === 'UP') {
            // Buying UP - worried about longs being crowded
            if (rate > 0.03) {
                crowded = true;
                bounceRisk = 'HIGH';
                analysis = 'Longs extremely crowded - squeeze risk';
            } else if (rate > 0.015) {
                crowded = true;
                bounceRisk = 'MEDIUM';
                analysis = 'Longs crowded - some bounce risk';
            } else if (rate < -0.01) {
                bounceRisk = 'LOW';
                analysis = 'Shorts paying longs - room to run up';
            } else {
                bounceRisk = 'LOW';
                analysis = 'Neutral funding - no crowding';
            }
        } else {
            // Buying DOWN - worried about shorts being crowded
            if (rate < -0.03) {
                crowded = true;
                bounceRisk = 'HIGH';
                analysis = 'Shorts extremely crowded - squeeze risk';
            } else if (rate < -0.015) {
                crowded = true;
                bounceRisk = 'MEDIUM';
                analysis = 'Shorts crowded - some bounce risk';
            } else if (rate > 0.01) {
                bounceRisk = 'LOW';
                analysis = 'Longs paying shorts - room to run down';
            } else {
                bounceRisk = 'LOW';
                analysis = 'Neutral funding - no crowding';
            }
        }

        return {
            crowded,
            bounceRisk,
            rate,
            rateRaw: funding.rate,
            analysis
        };
    }
}

module.exports = new BinanceService();
