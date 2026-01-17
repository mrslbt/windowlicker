const CONFIG = require('../config');
const discordService = require('../services/discord');
const polymarketService = require('../services/polymarket');
const binanceService = require('../services/binance');
const coinglassService = require('../services/coinglass');
const loggerService = require('../services/logger');
const positionMonitor = require('../services/position-monitor');
const emailService = require('../services/email');
const axios = require('axios');

class EthHourlyStrategy {
    constructor() {
        this.state = {
            ethPrice: null,
            ethHourOpen: null,
            btcHourOpen: null,
            ethHourOpenTime: null,

            // Unused legacy alerts
            lastPriceAlertLevel: 0,
            alertSentThisHour: false,

            // Technical Indicators
            atr14: null,
            avgVolume20: null,
            currentVolRelative: null,

            // New state for /stat command & analysis
            lastScore: 0,
            lastSignalStrength: 'NONE',
            lastOddsData: null,
            lastPremiumAnalysis: null,
            lastRecommendation: null,

            // Candle History for calculation
            candles: [] // Store last N candles
        };
    }

    async start() {
        console.log('[ETH Hourly] Strategy started (Weighted Confidence Edition).');

        // Set up Discord bot state callback for /stat command
        discordService.setStateCallback(() => this.getStateForDiscord());

        // Initialize Email Service
        emailService.init();

        // Initial candle fetch (historical for ATR)
        await this.fetchHourlyCandles();

        setInterval(() => this.analyze(), CONFIG.ETH_HOURLY.PRICE_CHECK_INTERVAL);
        setInterval(() => this.fetchHourlyCandles(), 60000); // Update candles every minute
        setInterval(() => this.printStatus(), CONFIG.ETH_HOURLY.STATUS_PRINT_INTERVAL);
    }

    async fetchHourlyCandles() {
        try {
            // Fetch 50 candles to ensure enough data for ATR(14) + padding
            // Binance: [Open Time, Open, High, Low, Close, Volume, ...]
            const ethRes = await axios.get('https://api.binance.com/api/v3/klines', {
                params: { symbol: 'ETHUSDT', interval: '1h', limit: 50 }
            });

            // Fetch BTC just for current open
            const btcRes = await axios.get('https://api.binance.com/api/v3/klines', {
                params: { symbol: 'BTCUSDT', interval: '1h', limit: 1 }
            });

            if (ethRes.data?.length > 0) {
                const latest = ethRes.data[ethRes.data.length - 1];
                const [openTime, openPrice] = latest;

                // Historical candles (exclude current incomplete candle for ATR calc usually, 
                // but we can include previous 49)
                const completedCandles = ethRes.data.slice(0, -1);

                // Calculate Indicators
                this.calculateIndicators(completedCandles);

                const wasNewHour = this.state.ethHourOpenTime !== openTime;

                this.state.ethHourOpen = parseFloat(openPrice);
                this.state.ethHourOpenTime = openTime;

                if (btcRes.data?.[0]) {
                    this.state.btcHourOpen = parseFloat(btcRes.data[0][1]);
                }

                if (wasNewHour) {
                    // === End of Hour Summary (Polymarket Resolution) ===
                    // Check which token (UP/DOWN) won in the PREVIOUS hour's market
                    const prevSlug = polymarketService.getPreviousHourSlug();
                    const resolution = await polymarketService.getMarketResolution(prevSlug);

                    if (resolution.resolved) {
                        const icon = resolution.winner === 'UP' ? '📈' : '📉';
                        const msg = `🏁 **Hour Result**\n` +
                            `**${icon} ${resolution.winner} WON**\n` +
                            `UP: $${resolution.upPrice?.toFixed(2)} | DOWN: $${resolution.downPrice?.toFixed(2)}`;

                        discordService.sendAlert(CONFIG.DISCORD.ETH_HOURLY_WEBHOOK, msg);
                    } else {
                        // Fallback: market not yet resolved, show prices
                        const msg = `⏳ **Hour Pending**\n` +
                            `UP: ${(resolution.upPrice * 100)?.toFixed(0)}% | DOWN: ${(resolution.downPrice * 100)?.toFixed(0)}%`;
                        discordService.sendAlert(CONFIG.DISCORD.ETH_HOURLY_WEBHOOK, msg);
                    }

                    this.state.alertSentThisHour = false;
                    this.state.lastRecommendation = null;

                    // Clear odds history for new hour
                    polymarketService.clearHistory();

                    // Clear position monitor at new hour
                    positionMonitor.clearPosition();

                    console.log(`[ETH Hourly] New Hour Open: ETH $${this.state.ethHourOpen?.toFixed(2)} | ATR: $${this.state.atr14?.toFixed(2)}`);
                }
            }
        } catch (error) {
            console.error('[ETH Hourly] Failed to fetch candles:', error.message);
        }
    }

    calculateIndicators(candles) {
        if (candles.length < 20) return; // Need enough data

        // 1. Calculate ATR (14)
        // TR = Max(H-L, |H-Cp|, |L-Cp|)
        let trValues = [];
        for (let i = 1; i < candles.length; i++) {
            const high = parseFloat(candles[i][2]);
            const low = parseFloat(candles[i][3]);
            const closePrev = parseFloat(candles[i - 1][4]);

            const tr = Math.max(high - low, Math.abs(high - closePrev), Math.abs(low - closePrev));
            trValues.push(tr);
        }

        // Simple SMA of TR for ATR (standard)
        const period = 14;
        const recentTR = trValues.slice(-period);
        const atr = recentTR.reduce((a, b) => a + b, 0) / period;
        this.state.atr14 = atr;

        // 2. Calculate Volume SMA (20)
        // Volume is index 5
        const volumes = candles.map(c => parseFloat(c[5]));
        const recentVol = volumes.slice(-20);
        const avgVol = recentVol.reduce((a, b) => a + b, 0) / 20;
        this.state.avgVolume20 = avgVol;
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

    getCurrentVolume() {
        // We can't easily get real-time volume from the websocket aggTrade sum without tracking it locally 
        // or fetching the current candle again. fetching is safer for accuracy.
        // For efficiency, we will fetch the single latest candle in the analyze loop if needed, 
        // or just use 1m candles.
        // Actually, simple strategy: approximate volume status or fetch 1h candle regularly.
        // We already fetch 1h candle every 60s. For the alert, we will assume the latest fetch is "good enough" 
        // or we can fast-fetch it.
        // Let's implement a fast-fetch for just the volume validation in the checkStatus.
        return 0; // Placeholder, handled in analysis
    }

    getMarketSlug() {
        const now = new Date();
        const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'America/New_York' }).toLowerCase();
        const day = now.toLocaleString('en-US', { day: 'numeric', timeZone: 'America/New_York' });
        const hour = now.toLocaleString('en-US', { hour: 'numeric', hour12: true, timeZone: 'America/New_York' }).toLowerCase().replace(' ', '');
        return `ethereum-up-or-down-${month}-${day}-${hour}-et`;
    }

    async analyze() {
        // Price Alert Logic (Legacy or Simplified) can go here if needed
        // For now, we focus on the Strategy Alert
        await this.checkStatus();
    }

    async checkStatus() {
        const now = new Date();
        const minutes = now.getMinutes();

        // fetch fresh current candle for volume data
        let currentVol = 0;
        try {
            const res = await axios.get('https://api.binance.com/api/v3/klines', {
                params: { symbol: 'ETHUSDT', interval: '1h', limit: 1 }
            });
            if (res.data?.[0]) {
                currentVol = parseFloat(res.data[0][5]);
            }
        } catch (e) { /* ignore */ }

        // Store relative volume
        // Gather Data
        const ethMove = this.getEthMoveUSD();
        const btcMove = this.getBtcMoveUSD();
        const currentPrice = binanceService.getPrices().eth;
        const btcPrice = binanceService.getPrices().btc;
        const liquidations = await coinglassService.getLiquidations('ETH');

        const direction = ethMove >= 0 ? 'UP' : 'DOWN';
        const premiumAnalysis = await binanceService.analyzePremium('ETH', direction);
        this.state.lastPremiumAnalysis = premiumAnalysis;

        const marketSlug = this.getMarketSlug();
        const oddsData = await polymarketService.getOddsWithVelocity(marketSlug, direction);
        this.state.lastOddsData = oddsData;

        // === WEIGHTED CONFIDENCE SCORING ===
        const scoreData = this.calculateConfidenceScore({
            ethMove,
            atr: this.state.atr14,
            relativeVolume: this.state.currentVolRelative,
            btcMove,
            odds: oddsData.currentOdds,
            premium: premiumAnalysis,
            liquidations: liquidations.totalVolUsd,
            direction
        });

        this.state.lastScore = scoreData.score;
        this.state.lastSignalStrength = scoreData.strength;

        // Check if we should alert
        // Only alert in window (last 20 mins: 40-60)
        if (minutes < CONFIG.ETH_HOURLY.ENTRY_WINDOW_START) return;

        // Only alert on meaningful signals (Score >= 50)
        if (scoreData.score < 50 && !this.state.alertSentThisHour) return;
        if (this.state.alertSentThisHour) return;

        // Alert
        await this.sendScorecardAlert(scoreData, currentPrice, minutes);
        this.state.alertSentThisHour = true;
        this.state.lastRecommendation = scoreData.recommendation;

        // Log
        loggerService.logSignal({
            ethPrice: currentPrice,
            ethMove: ethMove,
            score: scoreData.score,
            strength: scoreData.strength,
            volumeRelative: this.state.currentVolRelative,
            atr: this.state.atr14,
            recommendation: scoreData.recommendation
        });

        // Register Position if Strong
        if (scoreData.recommendation === 'BUY') {
            positionMonitor.registerPosition({
                direction: direction,
                ethPrice: currentPrice,
                btcPrice: btcPrice,
                premium: premiumAnalysis.premium,
                bounceRisk: premiumAnalysis.bounceRisk,
                currentOdds: oddsData.currentOdds,
            });
        }

        // Email Alert (Sure Shot)
        if (scoreData.score >= 80) {
            await emailService.sendHighConfidenceAlert({
                price: currentPrice,
                score: scoreData.score,
                move: ethMove,
                direction,
                recommendation: scoreData.recommendation
            });
        }
    }

    calculateConfidenceScore({ ethMove, atr, relativeVolume, btcMove, odds, premium, liquidations, direction }) {
        let score = 0;
        let breakdown = [];
        const absMove = Math.abs(ethMove);
        const atrValue = atr || 10; // Fallback if not ready

        // 1. Price vs ATR (Max 30pts)
        // If move > 1.0 ATR -> 30pts
        // If move > 0.5 ATR -> 15pts
        const atrRatio = absMove / atrValue;
        if (atrRatio >= 1.0) {
            score += 30;
            breakdown.push({ label: `Breakout (>1.0 ATR)`, pts: 30 });
        } else if (atrRatio >= 0.5) {
            score += 15;
            breakdown.push({ label: `Moderate Move (>0.5 ATR)`, pts: 15 });
        }

        // 2. Volume Energy (Max 25pts)
        // If Vol > 1.5x Avg -> 25pts
        // If Vol > 1.0x Avg -> 15pts
        if (relativeVolume >= 1.5) {
            score += 25;
            breakdown.push({ label: `High Volume (1.5x)`, pts: 25 });
        } else if (relativeVolume >= 1.1) {
            score += 15;
            breakdown.push({ label: `Above Avg Vol`, pts: 15 });
        } else {
            // Low volume penalty?
            // breakdown.push({ label: 'Low Volume', pts: 0 });
        }

        // 3. BTC Confirmation (Max 20pts)
        const btcConfirms = (direction === 'UP' && btcMove > 100) || (direction === 'DOWN' && btcMove < -100);
        if (btcConfirms) {
            score += 20;
            breakdown.push({ label: `BTC Confirm (Yes)`, pts: 20 });
        }

        // 4. Sentiment / Odds (Max 15pts)
        // If odds < 65% (contrarian/early entry) -> 15pts
        if (odds !== null && odds < 0.65) {
            score += 15;
            breakdown.push({ label: `Good Odds (<65%)`, pts: 15 });
        }

        // 5. Market Structure / Premium (Max 10pts)
        if (premium.bounceRisk === 'LOW') {
            score += 10;
            breakdown.push({ label: `Bounce Risk (Low)`, pts: 10 });
        }

        // 6. Liquidation 'Cherry on Top' (Bonus 10pts)
        if (liquidations > 30000000) { // 30M
            score += 10;
            breakdown.push({ label: `Liq. Cascade`, pts: 10 });
        }

        // Cap score at 100
        score = Math.min(score, 100);

        // Determine Strength
        let strength = 'WEAK';
        let recommendation = 'SKIP';
        let color = 0x666666;

        if (score >= 75) {
            strength = '🔥 EXTREME';
            recommendation = 'BUY';
            color = 0x00ff00; // Bright Green
        } else if (score >= 50) {
            strength = '✅ MODERATE';
            recommendation = 'SMALL BET';
            color = 0xffff00; // Yellow
        } else {
            strength = '☁️ LOW';
            recommendation = 'WAIT';
            color = 0xff0000; // Red
        }

        return { score, strength, recommendation, color, breakdown, atrRatio, btcConfirms, bounceRisk: premium.bounceRisk, btcMove };
    }

    async sendScorecardAlert(scoreData, currentPrice, minutes) {
        const { score, strength, recommendation, color, breakdown, atrRatio, btcConfirms, bounceRisk, btcMove } = scoreData;
        const ethMove = this.getEthMoveUSD();
        const direction = ethMove >= 0 ? 'UP' : 'DOWN';
        const emoji = direction === 'UP' ? '📈' : '📉';

        // Visual Score Bar
        const bars = Math.round(score / 10);
        const filled = '🟩'.repeat(bars);
        const empty = '⬜'.repeat(10 - bars);
        const progressBar = `${filled}${empty}`;

        const embed = discordService.createEmbed(
            `${emoji} ${recommendation} | ETH ${ethMove >= 0 ? '+' : ''}$${ethMove.toFixed(2)}`,
            `**${strength}**\n` +
            `\`${progressBar}\` **${score}/100**\n\n` +

            `**🔎 Why?**\n` +
            breakdown.map(b => `> ${b.label} \`+${b.pts}\``).join('\n') + '\n\n' +

            `**📊 Context**\n` +
            `• **Flow**: $${Math.abs(ethMove).toFixed(2)} (${atrRatio.toFixed(1)}x ATR)\n` +
            `• **Vol**: ${this.state.currentVolRelative?.toFixed(1) || 0}x Avg\n` +
            `• **BTC**: ${btcConfirms ? '✅ (Yes)' : '❌ (No)'} ${btcMove >= 0 ? '+' : ''}$${btcMove.toFixed(2)}\n` +
            `• **Risk**: ${bounceRisk === 'LOW' ? '🟢 (Low)' : bounceRisk === 'MEDIUM' ? '🟡 (Mid)' : '🔴 (High)'}\n` +
            `• **Time**: ${60 - minutes}m left`,
            color
        );

        await discordService.sendAlert(CONFIG.DISCORD.ETH_HOURLY_WEBHOOK, `**${recommendation}** | Score: ${score}`, embed);
        console.log(`[ETH Hourly] ALERT SENT: Score ${score} | ${recommendation}`);
    }

    async getStateForDiscord() {
        // Used for /wdyt command
        // We can reuse the calculation logic for real-time check or return last state
        // Return last valid state for speed
        const ethMove = this.getEthMoveUSD();
        const atrValue = this.state.atr14 || 10;

        return {
            ethPrice: binanceService.getPrices().eth,
            ethMove: ethMove,
            btcMove: this.getBtcMoveUSD(),
            // ... map other fields as existing discord service expects
            // or update discord service to read these new fields.
            // For now, mapping basic compat:
            recommendation: this.state.lastRecommendation || 'WAIT',
            score: this.state.lastScore || 0,
            velocity: this.state.lastOddsData?.velocity,
            upOdds: this.state.lastOddsData?.upOdds,
            downOdds: this.state.lastOddsData?.downOdds,
            premium: this.state.lastPremiumAnalysis?.premium,
            bounceRisk: this.state.lastPremiumAnalysis?.bounceRisk,
            hasPosition: positionMonitor.hasActivePosition(),
            positionDirection: positionMonitor.getPosition()?.direction,
            positionEntry: positionMonitor.getPosition()?.entryPrice
        };
    }

    printStatus() {

        if (!this.state.ethHourOpen) return;

        const ethMove = this.getEthMoveUSD();
        const atr = this.state.atr14 ? this.state.atr14.toFixed(2) : 'calc...';
        const score = this.state.lastScore || 0;
        const vol = this.state.currentVolRelative ? this.state.currentVolRelative.toFixed(1) + 'x' : '...';

        console.log(`[ETH Hourly] Move: $${ethMove.toFixed(2)} | ATR: $${atr} | Vol: ${vol} | Score: ${score}`);
    }
}

module.exports = new EthHourlyStrategy();
