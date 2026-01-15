const WebSocket = require('ws');

class BinanceService {
    constructor() {
        this.ws = null;
        this.btcPrice = null;
        this.ethPrice = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.callbacks = []; // List of functions to call on price update
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
}

module.exports = new BinanceService();
