require('dotenv').config();

const CONFIG = {
  // General
  PORT: process.env.PORT || 8080,
  ACTIVE_STRATEGIES: (process.env.ACTIVE_STRATEGIES || 'ALL').split(',').map(s => s.trim().toUpperCase()),

  // Discord
  DISCORD: {
    WINDOW_LICKER_WEBHOOK: process.env.DISCORD_WEBHOOK_WINDOW_LICKER,
    ETH_HOURLY_WEBHOOK: process.env.DISCORD_WEBHOOK_ETH_HOURLY,
    BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    GUILD_ID: process.env.DISCORD_GUILD_ID,
  },

  // ETH Hourly Strategy Config
  ETH_HOURLY: {
    PRICE_ALERT_THRESHOLD_USD: 10,
    PRICE_ALERT_INCREMENT_USD: 10,
    MOVE_THRESHOLD_USD: 12,
    REALERT_INCREMENT_USD: 6,
    ENTRY_WINDOW_START: 40,
    ENTRY_WINDOW_END: 52,
    SKIP_HOURS_ET: [3, 4, 5],
    MAX_ODDS_FOR_BUY: 0.75,
    GOOD_ODDS: 0.65,
    LIQUIDATION_THRESHOLD: 50000000,
    BTC_CONFIRM_THRESHOLD: 150,

    // Premium Index Thresholds (real-time, as percentage)
    PREMIUM_HIGH_THRESHOLD: 0.15,    // Extreme crowding - HIGH bounce risk
    PREMIUM_MEDIUM_THRESHOLD: 0.08,  // Moderate crowding - MEDIUM bounce risk

    // Odds Velocity Thresholds (change per minute, as decimal)
    ODDS_VELOCITY_RAPID: 0.02,       // +2%/min = move is being priced in fast
    ODDS_VELOCITY_RISING: 0.01,      // +1%/min = odds rising, caution
    ODDS_HISTORY_WINDOW: 10,         // Keep last 10 readings for velocity calc

    // Exit/Risk Management Thresholds
    EXIT_BTC_REVERSAL_USD: 200,      // Alert if BTC reverses $200+ against position
    EXIT_PRICE_REVERSAL_USD: 15,     // Alert if ETH reverses $15 against entry
    EXIT_TAKE_PROFIT_ODDS: 0.50,     // Alert if odds drop below 50% (good profit)
    EXIT_STOP_LOSS_ODDS: 0.85,       // Alert if odds spike above 85% (bad entry)

    GAMMA_API: 'https://gamma-api.polymarket.com',
    COINGLASS_API: 'https://open-api.coinglass.com/public/v2',
    PRICE_CHECK_INTERVAL: 2000,
    STATUS_PRINT_INTERVAL: 30000,
  },

  // Logging
  LOGGING: {
    SIGNALS_FILE: './logs/signals.jsonl',
    ENABLED: true,
  }
};

module.exports = CONFIG;
