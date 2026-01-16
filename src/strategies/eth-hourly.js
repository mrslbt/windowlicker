const CONFIG = require('../config');
const discordService = require('../services/discord');
const polymarketService = require('../services/polymarket');
const binanceService = require('../services/binance');
const coinglassService = require('../services/coinglass');
const loggerService = require('../services/logger');
const positionMonitor = require('../services/position-monitor');
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
            lastAlertMoveUSD: null,
            // New state for /stat command
            lastOddsData: null,
            lastPremiumAnalysis: null,
            lastRecommendation: null,
            lastChecksCount: 0,
        };
    }

    async start() {
        console.log('[ETH Hourly] Strategy started.');

        // Set up Discord bot state callback for /stat command
        discordService.setStateCallback(() => this.getStateForDiscord());

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
                    this.state.lastRecommendation = null;
                    this.state.lastChecksCount = 0;

                    // Clear odds history for new hour
                    polymarketService.clearHistory();

                    // Clear position monitor at new hour
                    positionMonitor.clearPosition();

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

    /**
     * Generate market slug for current hour
     */
    getMarketSlug() {
        const now = new Date();
        const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'America/New_York' }).toLowerCase();
        const day = now.toLocaleString('en-US', { day: 'numeric', timeZone: 'America/New_York' });
        const hour = now.toLocaleString('en-US', { hour: 'numeric', hour12: true, timeZone: 'America/New_York' }).toLowerCase().replace(' ', '');
        return `ethereum-up-or-down-${month}-${day}-${hour}-et`;
    }

    async analyze() {
        const currentPrice = binanceService.getPrices().eth;
        if (!currentPrice || !this.state.ethHourOpen) return;

        this.state.ethPrice = currentPrice;
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

        // Fetch Premium Index (real-time bounce risk indicator)
        const direction = ethMove >= 0 ? 'UP' : 'DOWN';
        const premiumAnalysis = await binanceService.analyzePremium('ETH', direction);
        this.state.lastPremiumAnalysis = premiumAnalysis;

        // Fetch Odds with Velocity
        const marketSlug = this.getMarketSlug();
        const oddsData = await polymarketService.getOddsWithVelocity(marketSlug, direction);
        this.state.lastOddsData = oddsData;

        const currentOdds = oddsData.currentOdds;
        const velocity = oddsData.velocity;

        // Check position monitor for odds-based exits
        if (currentOdds !== null && positionMonitor.hasActivePosition()) {
            await positionMonitor.checkOddsConditions(currentOdds);
        }

        // --- Checklist Logic ---
        if (Math.abs(ethMove) < CONFIG.ETH_HOURLY.PRICE_ALERT_THRESHOLD_USD && !this.state.alertSentThisHour) return;
        if (this.state.alertSentThisHour) return;

        // Prepare Checklist Items
        const moveThreshold = CONFIG.ETH_HOURLY.MOVE_THRESHOLD_USD;
        const isUp = ethMove >= 0;
        const directionStr = isUp ? 'UP' : 'DOWN';

        // Check 1: Move size
        const moveCheck = Math.abs(ethMove) >= moveThreshold;
        const moveEmoji = moveCheck ? '✅' : '❌';

        // Check 2: Entry window
        const windowCheck = minutes >= CONFIG.ETH_HOURLY.ENTRY_WINDOW_START && minutes <= CONFIG.ETH_HOURLY.ENTRY_WINDOW_END;
        const windowEmoji = windowCheck ? '✅' : '⚠️';

        // Check 3: BTC confirms
        const btcConfirms = (isUp && btcMove > CONFIG.ETH_HOURLY.BTC_CONFIRM_THRESHOLD) ||
                          (!isUp && btcMove < -CONFIG.ETH_HOURLY.BTC_CONFIRM_THRESHOLD);
        const btcEmoji = btcConfirms ? '✅' : '❌';

        // Check 4: Odds < 75%
        const oddsCheck = currentOdds !== null && currentOdds < CONFIG.ETH_HOURLY.MAX_ODDS_FOR_BUY;
        const oddsEmoji = currentOdds === null ? '❓' : (oddsCheck ? '✅' : '❌');
        const oddsVal = currentOdds !== null ? `${(currentOdds * 100).toFixed(0)}%` : 'N/A';

        // Check 5: Good trading hour
        const currentHour = now.getHours();
        const isBadHour = CONFIG.ETH_HOURLY.SKIP_HOURS_ET.includes(currentHour);
        const hourCheck = !isBadHour;
        const hourEmoji = hourCheck ? '✅' : '❌';

        // Check 6: Low bounce risk
        const bounceCheck = premiumAnalysis.bounceRisk === 'LOW';
        const premiumEmoji = bounceCheck ? '✅' : (premiumAnalysis.bounceRisk === 'MEDIUM' ? '⚠️' : '❌');
        const premiumDisplay = premiumAnalysis.premium >= 0 ?
                               `+${premiumAnalysis.premium.toFixed(3)}%` :
                               `${premiumAnalysis.premium.toFixed(3)}%`;

        // Liquidations (secondary indicator)
        const liquidationsVal = liquidations.totalVolUsd || 0;
        const liqEmoji = liquidationsVal > CONFIG.ETH_HOURLY.LIQUIDATION_THRESHOLD ? '💥' : '⬜';

        // Velocity check (new - affects recommendation)
        const velocityCheck = velocity && velocity.velocityStatus !== 'RAPID_RISE';
        const velEmoji = !velocity ? '❓' :
                        (velocity.velocityStatus === 'RAPID_RISE' ? '🚀' :
                        velocity.velocityStatus === 'RISING' ? '📈' :
                        velocity.velocityStatus === 'FALLING' ? '📉' : '➡️');
        const velDisplay = velocity ? `${velocity.velocityStatus} (${velocity.velocityPercent?.toFixed(2) || 0}%/min)` : 'N/A';

        // Count passed checks
        const checksCount = [moveCheck, windowCheck, btcConfirms, oddsCheck, hourCheck, bounceCheck].filter(Boolean).length;
        this.state.lastChecksCount = checksCount;

        // Determine recommendation
        let recommendation = 'SKIP';

        // Critical fails - auto SKIP
        if (!oddsCheck && currentOdds !== null) {
            recommendation = 'SKIP'; // Odds too high
        } else if (!hourCheck) {
            recommendation = 'SKIP'; // Bad hour
        } else if (premiumAnalysis.bounceRisk === 'HIGH') {
            recommendation = 'SKIP'; // High bounce risk
        } else if (velocity && velocity.velocityStatus === 'RAPID_RISE') {
            // Odds rising rapidly - downgrade
            if (checksCount >= 5) {
                recommendation = 'SMALL BET';
            } else {
                recommendation = 'SKIP';
            }
        } else if (checksCount >= 5) {
            recommendation = 'BUY';
        } else if (checksCount >= 4) {
            recommendation = 'BUY';
        } else if (checksCount >= 3) {
            recommendation = 'SMALL BET';
        }

        this.state.lastRecommendation = recommendation;

        // Construct Embed
        const embed = discordService.createEmbed(
            `${directionStr === 'UP' ? '📈' : '📉'} ETH ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)} | ${directionStr} Checklist`,
            `**Recommendation: ${recommendation}** (${checksCount}/6 checks)\n\n` +
            `💰 **ETH Move**: ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)}\n` +
            `₿ **BTC Move**: ${btcMove >= 0 ? '+' : ''}$${btcMove.toFixed(2)}\n` +
            `⏱️ **Time Left**: ${60 - minutes} mins\n`,
            isUp ? 0x00ff00 : 0xff0000,
            [
                {
                    name: 'Checklist', value:
                        `${moveEmoji} Move $${moveThreshold}+ (${ethMove >= 0 ? '+' : ''}${ethMove.toFixed(2)})\n` +
                        `${windowEmoji} Entry window (min ${CONFIG.ETH_HOURLY.ENTRY_WINDOW_START}-${CONFIG.ETH_HOURLY.ENTRY_WINDOW_END})\n` +
                        `${btcEmoji} BTC confirms $${CONFIG.ETH_HOURLY.BTC_CONFIRM_THRESHOLD}+ (${btcMove >= 0 ? '+' : ''}${btcMove.toFixed(2)})\n` +
                        `${oddsEmoji} Odds < 75% (${oddsVal})\n` +
                        `${hourEmoji} Good trading hour\n` +
                        `${premiumEmoji} Low bounce risk (${premiumDisplay})`
                },
                {
                    name: 'Odds Velocity', value:
                        `${velEmoji} ${velDisplay}\n` +
                        (velocity && velocity.velocityStatus === 'RAPID_RISE' ?
                            '⚠️ Move may be priced in - proceed with caution' : '')
                },
                {
                    name: 'Premium Analysis (Real-time)', value:
                        `${premiumAnalysis.analysis}\n` +
                        `Bounce Risk: **${premiumAnalysis.bounceRisk}**`
                }
            ]
        );

        await discordService.sendAlert(CONFIG.DISCORD.ETH_HOURLY_WEBHOOK, `**${recommendation}** | ETH $${currentPrice?.toFixed(2)}`, embed);
        this.state.alertSentThisHour = true;

        // Log the signal for performance tracking
        loggerService.logSignal({
            ethPrice: currentPrice,
            ethMove: ethMove,
            btcPrice: btcPrice,
            btcMove: btcMove,
            upOdds: oddsData.upOdds,
            downOdds: oddsData.downOdds,
            currentOdds: currentOdds,
            oddsVelocity: velocity?.velocityPercent || 0,
            oddsVelocityStatus: velocity?.velocityStatus || 'UNKNOWN',
            premium: premiumAnalysis.premium,
            bounceRisk: premiumAnalysis.bounceRisk,
            liquidations: liquidationsVal,
            recommendation: recommendation,
            checksCount: checksCount,
            direction: directionStr,
            minute: minutes,
        });

        // Register position if BUY recommendation
        if (recommendation === 'BUY' || recommendation === 'SMALL BET') {
            positionMonitor.registerPosition({
                direction: directionStr,
                ethPrice: currentPrice,
                btcPrice: btcPrice,
                premium: premiumAnalysis.premium,
                bounceRisk: premiumAnalysis.bounceRisk,
                currentOdds: currentOdds,
            });
        }
    }

    /**
     * Get current state for Discord /stat command
     */
    async getStateForDiscord() {
        const ethMove = this.getEthMoveUSD();
        const btcMove = this.getBtcMoveUSD();
        const prices = binanceService.getPrices();

        // Get fresh premium analysis
        const direction = ethMove >= 0 ? 'UP' : 'DOWN';
        let premiumAnalysis = this.state.lastPremiumAnalysis;
        try {
            premiumAnalysis = await binanceService.analyzePremium('ETH', direction);
        } catch (e) {
            // Use cached
        }

        // Get fresh odds
        let oddsData = this.state.lastOddsData;
        try {
            const marketSlug = this.getMarketSlug();
            oddsData = await polymarketService.getOddsWithVelocity(marketSlug, direction);
        } catch (e) {
            // Use cached
        }

        const position = positionMonitor.getPosition();

        return {
            ethPrice: prices.eth,
            ethMove: ethMove,
            btcMove: btcMove,
            upOdds: oddsData?.upOdds || null,
            downOdds: oddsData?.downOdds || null,
            velocity: oddsData?.velocity || null,
            premium: premiumAnalysis?.premium,
            bounceRisk: premiumAnalysis?.bounceRisk,
            recommendation: this.state.lastRecommendation,
            checksCount: this.state.lastChecksCount,
            hasPosition: positionMonitor.hasActivePosition(),
            positionDirection: position?.direction,
            positionEntry: position?.entryPrice,
        };
    }

    printStatus() {
        const currentPrice = binanceService.getPrices().eth;
        if (!currentPrice) return;

        const ethMove = this.getEthMoveUSD();
        console.log(`[ETH Hourly] Price: $${currentPrice.toFixed(2)} | Move: ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)}`);
    }
}

module.exports = new EthHourlyStrategy();
