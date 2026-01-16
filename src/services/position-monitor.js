const CONFIG = require('../config');
const discordService = require('./discord');
const binanceService = require('./binance');

class PositionMonitor {
    constructor() {
        this.activePosition = null;
        this.alertsSent = {
            premiumFlip: false,
            btcReversal: false,
            takeProfit: false,
            stopLoss: false,
            priceReversal: false,
        };
        this.monitorInterval = null;
    }

    /**
     * Register a new position after a BUY alert
     * @param {Object} entry - Entry data
     */
    registerPosition(entry) {
        this.activePosition = {
            direction: entry.direction,       // 'UP' or 'DOWN'
            entryPrice: entry.ethPrice,
            entryBtcPrice: entry.btcPrice,
            entryPremium: entry.premium,
            entryBounceRisk: entry.bounceRisk,
            entryOdds: entry.currentOdds,
            entryTime: new Date(),
            hourEnd: this.getHourEnd(),
        };

        // Reset alerts for new position
        this.alertsSent = {
            premiumFlip: false,
            btcReversal: false,
            takeProfit: false,
            stopLoss: false,
            priceReversal: false,
        };

        console.log(`[PositionMonitor] Position registered: ${entry.direction} @ $${entry.ethPrice.toFixed(2)}`);

        // Start monitoring if not already
        if (!this.monitorInterval) {
            this.startMonitoring();
        }
    }

    /**
     * Get the end of the current hour
     */
    getHourEnd() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
    }

    /**
     * Start the position monitoring loop
     */
    startMonitoring() {
        // Check every 5 seconds
        this.monitorInterval = setInterval(() => this.checkExitConditions(), 5000);
        console.log('[PositionMonitor] Monitoring started');
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    /**
     * Check all exit conditions
     */
    async checkExitConditions() {
        if (!this.activePosition) return;

        const now = new Date();

        // Auto-clear at hour end
        if (now >= this.activePosition.hourEnd) {
            console.log('[PositionMonitor] Hour ended, clearing position');
            this.clearPosition();
            return;
        }

        const prices = binanceService.getPrices();
        if (!prices.eth || !prices.btc) return;

        const pos = this.activePosition;
        const isUp = pos.direction === 'UP';

        // 1. Check price reversal against entry
        const priceMove = prices.eth - pos.entryPrice;
        const priceReversed = isUp ? priceMove < -CONFIG.ETH_HOURLY.EXIT_PRICE_REVERSAL_USD
                                   : priceMove > CONFIG.ETH_HOURLY.EXIT_PRICE_REVERSAL_USD;

        if (priceReversed && !this.alertsSent.priceReversal) {
            await this.sendExitAlert('PRICE_REVERSAL', {
                message: `ETH reversed $${Math.abs(priceMove).toFixed(2)} against your ${pos.direction} position!`,
                currentPrice: prices.eth,
                entryPrice: pos.entryPrice,
                move: priceMove,
            });
            this.alertsSent.priceReversal = true;
        }

        // 2. Check BTC reversal
        const btcMove = prices.btc - pos.entryBtcPrice;
        const btcReversed = isUp ? btcMove < -CONFIG.ETH_HOURLY.EXIT_BTC_REVERSAL_USD
                                 : btcMove > CONFIG.ETH_HOURLY.EXIT_BTC_REVERSAL_USD;

        if (btcReversed && !this.alertsSent.btcReversal) {
            await this.sendExitAlert('BTC_REVERSAL', {
                message: `BTC reversed $${Math.abs(btcMove).toFixed(2)} against your ${pos.direction} position!`,
                currentBtcPrice: prices.btc,
                entryBtcPrice: pos.entryBtcPrice,
                btcMove: btcMove,
            });
            this.alertsSent.btcReversal = true;
        }

        // 3. Check premium flip (bounce risk increased)
        try {
            const premiumAnalysis = await binanceService.analyzePremium('ETH', pos.direction);

            if (pos.entryBounceRisk === 'LOW' && premiumAnalysis.bounceRisk === 'HIGH' && !this.alertsSent.premiumFlip) {
                await this.sendExitAlert('PREMIUM_FLIP', {
                    message: `Bounce risk flipped from LOW to HIGH! Consider exiting your ${pos.direction} position.`,
                    entryPremium: pos.entryPremium,
                    currentPremium: premiumAnalysis.premium,
                    bounceRisk: premiumAnalysis.bounceRisk,
                    analysis: premiumAnalysis.analysis,
                });
                this.alertsSent.premiumFlip = true;
            }
        } catch (error) {
            // Ignore premium check errors
        }
    }

    /**
     * Update odds and check take-profit / stop-loss
     * Called externally when odds are fetched
     */
    async checkOddsConditions(currentOdds) {
        if (!this.activePosition) return;

        // Take profit: odds dropped significantly (position is winning)
        if (currentOdds < CONFIG.ETH_HOURLY.EXIT_TAKE_PROFIT_ODDS && !this.alertsSent.takeProfit) {
            await this.sendExitAlert('TAKE_PROFIT', {
                message: `Odds dropped to ${(currentOdds * 100).toFixed(0)}%! Consider taking profit on your ${this.activePosition.direction} position.`,
                entryOdds: this.activePosition.entryOdds,
                currentOdds: currentOdds,
            });
            this.alertsSent.takeProfit = true;
        }

        // Stop loss: odds spiked (position is losing)
        if (currentOdds > CONFIG.ETH_HOURLY.EXIT_STOP_LOSS_ODDS && !this.alertsSent.stopLoss) {
            await this.sendExitAlert('STOP_LOSS', {
                message: `Odds spiked to ${(currentOdds * 100).toFixed(0)}%! Your ${this.activePosition.direction} position may be at risk.`,
                entryOdds: this.activePosition.entryOdds,
                currentOdds: currentOdds,
            });
            this.alertsSent.stopLoss = true;
        }
    }

    /**
     * Send exit alert to Discord
     */
    async sendExitAlert(type, data) {
        const colors = {
            PRICE_REVERSAL: 0xff6600,  // Orange
            BTC_REVERSAL: 0xff6600,    // Orange
            PREMIUM_FLIP: 0xff0000,    // Red
            TAKE_PROFIT: 0x00ff00,     // Green
            STOP_LOSS: 0xff0000,       // Red
        };

        const titles = {
            PRICE_REVERSAL: '⚠️ PRICE REVERSAL WARNING',
            BTC_REVERSAL: '⚠️ BTC REVERSAL WARNING',
            PREMIUM_FLIP: '🔴 BOUNCE RISK INCREASED',
            TAKE_PROFIT: '💰 TAKE PROFIT OPPORTUNITY',
            STOP_LOSS: '🛑 STOP LOSS WARNING',
        };

        const embed = discordService.createEmbed(
            titles[type] || '⚠️ EXIT ALERT',
            data.message,
            colors[type] || 0xff6600,
            Object.entries(data)
                .filter(([key]) => key !== 'message')
                .map(([key, value]) => ({
                    name: key.replace(/([A-Z])/g, ' $1').trim(),
                    value: typeof value === 'number' ? value.toFixed(4) : String(value),
                    inline: true,
                }))
        );

        await discordService.sendAlert(CONFIG.DISCORD.ETH_HOURLY_WEBHOOK, `**${titles[type]}**`, embed);
        console.log(`[PositionMonitor] Exit alert sent: ${type}`);
    }

    /**
     * Clear the active position
     */
    clearPosition() {
        this.activePosition = null;
        this.alertsSent = {
            premiumFlip: false,
            btcReversal: false,
            takeProfit: false,
            stopLoss: false,
            priceReversal: false,
        };
        console.log('[PositionMonitor] Position cleared');
    }

    /**
     * Check if there's an active position
     */
    hasActivePosition() {
        return this.activePosition !== null;
    }

    /**
     * Get current position info
     */
    getPosition() {
        return this.activePosition;
    }
}

module.exports = new PositionMonitor();
