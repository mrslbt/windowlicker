const CONFIG = require('../config');
const discordService = require('../services/discord');
const polymarketService = require('../services/polymarket');
const binanceService = require('../services/binance');
const coinglassService = require('../services/coinglass');
const axios = require('axios');

class EthHourlyStrategy {
    constructor() {
        this.state = {
            ethPrice: null,
            ethHourOpen: null,
            btcHourOpen: null,
            ethHourOpenTime: null,
            lastPriceAlertLevel: 0,
            alertSentThisHour: false,
            lastAlertMoveUSD: null
        };
    }

    async start() {
        console.log('[ETH Hourly] Strategy started.');

        // Initial candle fetch
        await this.fetchHourlyCandles();

        setInterval(() => this.analyze(), CONFIG.ETH_HOURLY.PRICE_CHECK_INTERVAL);
        setInterval(() => this.fetchHourlyCandles(), 60000);
        setInterval(() => this.printStatus(), CONFIG.ETH_HOURLY.STATUS_PRINT_INTERVAL);
    }

    async fetchHourlyCandles() {
        try {
            // Fetch ETH
            const ethRes = await axios.get('https://api.binance.com/api/v3/klines', {
                params: { symbol: 'ETHUSDT', interval: '1h', limit: 1 }
            });

            // Fetch BTC
            const btcRes = await axios.get('https://api.binance.com/api/v3/klines', {
                params: { symbol: 'BTCUSDT', interval: '1h', limit: 1 }
            });

            if (ethRes.data?.[0]) {
                const [openTime, openPrice] = ethRes.data[0];
                const wasNewHour = this.state.ethHourOpenTime !== openTime;

                this.state.ethHourOpen = parseFloat(openPrice);
                this.state.ethHourOpenTime = openTime;

                if (btcRes.data?.[0]) {
                    this.state.btcHourOpen = parseFloat(btcRes.data[0][1]);
                }

                if (wasNewHour) {
                    this.state.alertSentThisHour = false;
                    this.state.lastAlertMoveUSD = null;
                    this.state.lastPriceAlertLevel = 0;
                    console.log(`[ETH Hourly] New Hour Open: ETH $${this.state.ethHourOpen?.toFixed(2)} | BTC $${this.state.btcHourOpen?.toFixed(2)}`);
                }
            }
        } catch (error) {
            console.error('[ETH Hourly] Failed to fetch candles:', error.message);
        }
    }

    // Helpers
    getEthMoveUSD() {
        const currentPrice = binanceService.getPrices().eth;
        if (!currentPrice || !this.state.ethHourOpen) return 0;
        return currentPrice - this.state.ethHourOpen;
    }

    getBtcMoveUSD() {
        const currentPrice = binanceService.getPrices().btc;
        if (!currentPrice || !this.state.btcHourOpen) return 0;
        return currentPrice - this.state.btcHourOpen;
    }

    async analyze() {
        const currentPrice = binanceService.getPrices().eth;
        if (!currentPrice || !this.state.ethHourOpen) return;

        const ethMove = this.getEthMoveUSD();
        const absMove = Math.abs(ethMove);
        const direction = ethMove >= 0 ? 'UP' : 'DOWN';

        // Price Alert (All Times)
        const currentLevel = Math.floor(absMove / CONFIG.ETH_HOURLY.PRICE_ALERT_THRESHOLD_USD) * CONFIG.ETH_HOURLY.PRICE_ALERT_THRESHOLD_USD;

        if (currentLevel >= CONFIG.ETH_HOURLY.PRICE_ALERT_THRESHOLD_USD && currentLevel > this.state.lastPriceAlertLevel) {
            const emoji = direction === 'UP' ? '📈' : '📉';
            const color = direction === 'UP' ? 0x00ff00 : 0xff0000;

            await discordService.sendAlert(
                CONFIG.DISCORD.ETH_HOURLY_WEBHOOK,
                `${emoji} **PRICE ALERT** | ETH ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)} | $${currentPrice.toFixed(2)}`,
                discordService.createEmbed(
                    `${emoji} ETH ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)} from open`,
                    `Current Price: $${currentPrice.toFixed(2)}`,
                    color
                )
            );
            this.state.lastPriceAlertLevel = currentLevel;
        }

        // Strategy Alert (Entry Window)
        await this.checkStatus();
    }

    async checkStatus() {
        const now = new Date();
        const minutes = now.getMinutes();

        // Only check in window (last 20 mins: 40-60)
        if (minutes < CONFIG.ETH_HOURLY.ENTRY_WINDOW_START) return;

        // Fetch Data
        const ethMove = this.getEthMoveUSD();
        const btcMove = this.getBtcMoveUSD();
        const currentPrice = binanceService.getPrices().eth;
        const btcPrice = binanceService.getPrices().btc;
        const liquidations = await coinglassService.getLiquidations('ETH');

        // --- Checklist Logic ---
        // Send alert if price crosses threshold OR we haven't sent one yet in this window and move is significant
        // User asked: "if price crosses 10USD... in last 20 minutes"
        // We use state to avoid spamming every second.
        if (Math.abs(ethMove) < CONFIG.ETH_HOURLY.PRICE_ALERT_THRESHOLD_USD && !this.state.alertSentThisHour) return;
        if (this.state.alertSentThisHour) return;

        // Prepare Checklist Items
        const moveThreshold = CONFIG.ETH_HOURLY.MOVE_THRESHOLD_USD;
        // User screenshot shows 12+ as check.
        const isUp = ethMove >= 0;
        const directionStr = isUp ? 'UP' : 'DOWN';
        const moveEmoji = Math.abs(ethMove) >= moveThreshold ? '✅' : '❌';
        const windowEmoji = (minutes >= CONFIG.ETH_HOURLY.ENTRY_WINDOW_START && minutes <= CONFIG.ETH_HOURLY.ENTRY_WINDOW_END) ? '✅' : '⚠️';

        const btcConfirms = (isUp && btcMove > 0) || (!isUp && btcMove < 0);
        const btcEmoji = btcConfirms ? '✅' : '❌';

        // Trading Hour Check
        const currentHour = now.getHours();
        const isBadHour = CONFIG.ETH_HOURLY.SKIP_HOURS_ET.includes(currentHour);
        const hourEmoji = !isBadHour ? '✅' : '❌';

        // Odds Placeholder
        let oddsVal = 'N/A';
        let oddsEmoji = '❓';

        const liquidationsVal = liquidations.totalVolUsd || 0;
        const liqEmoji = liquidationsVal > CONFIG.ETH_HOURLY.LIQUIDATION_THRESHOLD ? '💥' : '⬜';

        // Construct Embed
        const embed = discordService.createEmbed(
            `${directionStr === 'UP' ? '📈' : '📉'} ETH ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)} | ${directionStr} Checklist`,
            `**Confidence: ${minutes > 52 ? 'LATE' : 'PENDING'}**\n\n` +
            `💰 **ETH Move**: ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)}\n` +
            `₿ **BTC Move**: ${btcMove >= 0 ? '+' : ''}$${btcMove.toFixed(2)}\n` +
            `⏱️ **Time Left**: ${60 - minutes} mins\n`,
            isUp ? 0x00ff00 : 0xff0000,
            [
                {
                    name: 'Checklist', value:
                        `${moveEmoji} Move $${moveThreshold}+ (${ethMove >= 0 ? '+' : ''}${ethMove.toFixed(2)})\n` +
                        `${windowEmoji} Entry window (min ${CONFIG.ETH_HOURLY.ENTRY_WINDOW_START}-${CONFIG.ETH_HOURLY.ENTRY_WINDOW_END})\n` +
                        `${btcEmoji} BTC confirms (${btcMove >= 0 ? '+' : ''}${btcMove.toFixed(2)})\n` +
                        `${oddsEmoji} Odds < 75% (${oddsVal})\n` +
                        `${hourEmoji} Good trading hour\n` +
                        `${liqEmoji} Liquidation cascade ($${(liquidationsVal / 1000000).toFixed(1)}M)`
                }
            ]
        );

        await discordService.sendAlert(CONFIG.DISCORD.ETH_HOURLY_WEBHOOK, `**CHECKLIST ALERT** | ETH $${currentPrice?.toFixed(2)}`, embed);
        this.state.alertSentThisHour = true;
    }

    printStatus() {
        const currentPrice = binanceService.getPrices().eth;
        if (!currentPrice) return;

        const ethMove = this.getEthMoveUSD();
        console.log(`[ETH Hourly] Price: $${currentPrice.toFixed(2)} | Move: ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)}`);
    }
}

module.exports = new EthHourlyStrategy();
