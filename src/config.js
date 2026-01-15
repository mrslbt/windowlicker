require('dotenv').config();

const CONFIG = {
  // General
  PORT: process.env.PORT || 8080,
  ACTIVE_STRATEGIES: (process.env.ACTIVE_STRATEGIES || 'ALL').split(',').map(s => s.trim().toUpperCase()),

  // Discord
  DISCORD: {
    WINDOW_LICKER_WEBHOOK: process.env.DISCORD_WEBHOOK_WINDOW_LICKER,
    ETH_HOURLY_WEBHOOK: process.env.DISCORD_WEBHOOK_ETH_HOURLY,
  },

  // Window Licker Strategy Config
  WINDOW_LICKER: {
    ENTRY_WINDOW_START: 4,
    ENTRY_WINDOW_END: 2,
    EXIT_ALERT_TIME: 1,
    MIN_LEAN_THRESHOLD: 0.55,
    STRONG_LEAN_THRESHOLD: 0.65,
    MARKET_REFRESH_MS: 5000,
    SIGNAL_COOLDOWN_MS: 60000,
    CLOB_API: 'https://clob.polymarket.com',
    GAMMA_API: 'https://gamma-api.polymarket.com',
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
    GAMMA_API: 'https://gamma-api.polymarket.com',
    COINGLASS_API: 'https://open-api.coinglass.com/public/v2',
    PRICE_CHECK_INTERVAL: 2000,
    STATUS_PRINT_INTERVAL: 30000,
  }
};

module.exports = CONFIG;
