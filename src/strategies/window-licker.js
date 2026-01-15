const CONFIG = require('../config');
const discordService = require('../services/discord');
const polymarketService = require('../services/polymarket');
const binanceService = require('../services/binance');

class WindowLickerStrategy {
    constructor() {
        this.state = {
            currentMarket: null,
            lastEntrySignal: null,
            lastExitSignal: null,
            entrySignalSent: false,
            exitSignalSent: false,
            currentWindowSlug: null
        };
    }

    async start() {
        console.log('[WindowLicker] Strategy started.');

        // Initial check
        await this.refreshMarket();

        // Loops
        setInterval(() => this.loop(), 1000); // Analysis loop
        setInterval(() => this.refreshMarket(), CONFIG.WINDOW_LICKER.MARKET_REFRESH_MS);
        setInterval(() => this.printStatus(), 10000);
    }

    async refreshMarket() {
        const market = await this.findActiveMarket();
        if (market) {
            if (!this.state.currentMarket || this.state.currentMarket.slug !== market.slug) {
                console.log(`\n[WindowLicker] Found active market: ${market.title}`);
                this.state.currentMarket = market;
            }
        }
    }

    async findActiveMarket() {
        // Generate timestamps for current/next 15m window
        const now = Math.floor(Date.now() / 1000);
        const baseTs = Math.floor(now / 900) * 900;
        const timestamps = [baseTs - 900, baseTs, baseTs + 900];

        const markets = [];

        for (const ts of timestamps) {
            // Try to fetch markets "btc-updown-15m-..."
            // NOTE: The original code logic logic hardcoded "btc-updown-15m-"
            // We will stick to that logic for now.
            const slug = `btc-updown-15m-${ts}`;
            const market = await polymarketService.getMarketBySlug(slug);
            if (market) markets.push(market);
        }

        if (markets.length === 0) return null;

        // Filter active
        const nowMs = Date.now();
        const activeMarkets = markets.filter(m => m.endTime > nowMs);

        if (activeMarkets.length > 0) {
            activeMarkets.sort((a, b) => a.endTime - b.endTime); // Soonest ending first
            return activeMarkets[0];
        }

        return null;
    }

    async loop() {
        if (!this.state.currentMarket) return;

        // Refresh prices for current market
        // Get latest prices from Polymarket (Gamma API)
        // PolymarketService keeps it stateless, so we re-fetch the specific market slug to get prices
        const marketData = await polymarketService.getMarketBySlug(this.state.currentMarket.slug);
        if (!marketData) return;

        const { up, down } = polymarketService.parseOutcomePrices(marketData.market);
        if (up === null || down === null) return;

        const now = Date.now();
        const minutesRemaining = (this.state.currentMarket.endTime - now) / 60000;

        // New Window Check
        if (this.state.currentWindowSlug !== this.state.currentMarket.slug) {
            this.state.currentWindowSlug = this.state.currentMarket.slug;
            this.state.entrySignalSent = false;
            this.state.exitSignalSent = false;
            this.state.lastEntrySignal = null;

            await discordService.sendAlert(
                CONFIG.DISCORD.WINDOW_LICKER_WEBHOOK,
                `**NEW WINDOW** - ${this.state.currentMarket.title}\nWaiting for entry window...`
            );
        }

        // Logic
        const upOdds = up;
        const downOdds = down;
        const leadingSide = upOdds > downOdds ? 'UP' : 'DOWN';
        const leadingOdds = Math.max(upOdds, downOdds);
        const btcPrice = binanceService.getPrices().btc;

        // Entry
        if (
            minutesRemaining <= CONFIG.WINDOW_LICKER.ENTRY_WINDOW_START &&
            minutesRemaining > CONFIG.WINDOW_LICKER.ENTRY_WINDOW_END &&
            !this.state.entrySignalSent
        ) {
            if (leadingOdds >= CONFIG.WINDOW_LICKER.MIN_LEAN_THRESHOLD) {
                const strength = leadingOdds >= CONFIG.WINDOW_LICKER.STRONG_LEAN_THRESHOLD ? 'STRONG' : 'MODERATE';
                const color = leadingSide === 'UP' ? 0x00ff00 : 0xff0000;
                const emoji = leadingSide === 'UP' ? '🟢' : '🔴';

                const embed = discordService.createEmbed(
                    `${emoji} WINDOW LICKER: BUY ${leadingSide}`,
                    `**${strength} lean detected** - Odds likely to push to 90%+`,
                    color,
                    [
                        { name: 'Action', value: `**BUY ${leadingSide} (YES)**`, inline: true },
                        { name: 'Current Odds', value: `${(leadingOdds * 100).toFixed(1)}%`, inline: true },
                        { name: 'Time Remaining', value: `${minutesRemaining.toFixed(1)}m`, inline: true },
                        { name: 'BTC Price', value: `$${btcPrice?.toLocaleString() || 'N/A'}`, inline: true }
                    ]
                );

                await discordService.sendAlert(CONFIG.DISCORD.WINDOW_LICKER_WEBHOOK, `**ENTRY SIGNAL** - ${leadingSide} leading`, embed);
                this.state.entrySignalSent = true;
                this.state.lastEntrySignal = leadingSide;
            }
        }

        // Exit
        if (
            minutesRemaining <= CONFIG.WINDOW_LICKER.EXIT_ALERT_TIME &&
            minutesRemaining > 0 &&
            this.state.entrySignalSent &&
            !this.state.exitSignalSent
        ) {
            const embed = discordService.createEmbed(
                `⚠️ WINDOW LICKER: EXIT NOW`,
                `**Time to take profits!** Window closing soon.`,
                0xffaa00,
                [
                    { name: 'Action', value: `**SELL ${this.state.lastEntrySignal}**`, inline: true },
                    { name: 'Time Remaining', value: `${minutesRemaining.toFixed(1)}m`, inline: true }
                ]
            );
            await discordService.sendAlert(CONFIG.DISCORD.WINDOW_LICKER_WEBHOOK, `**EXIT SIGNAL** - Take profits!`, embed);
            this.state.exitSignalSent = true;
        }
    }

    printStatus() {
        if (!this.state.currentMarket) {
            console.log(`[WindowLicker] Waiting for market...`);
            return;
        }
        const minutesRemaining = (this.state.currentMarket.endTime - Date.now()) / 60000;
        console.log(`[WindowLicker] Active: ${this.state.currentMarket.slug} | Time: ${minutesRemaining.toFixed(1)}m`);
    }
}

module.exports = new WindowLickerStrategy();
