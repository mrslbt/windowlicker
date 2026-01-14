/**
 * Window Licker Bot - End-of-Window Scalper
 *
 * Strategy: In the final 2-3 minutes of each 15-minute window, odds move
 * aggressively toward extremes (95%+ or 5%-). This bot front-runs the convergence.
 *
 * Logic:
 * - When 4-2 minutes remain, check which side is winning
 * - If one side is >55%, signal to BUY that side (it will likely push to 90%+)
 * - Exit signal when ~1 minute remains (before final settlement chaos)
 *
 * Usage: npm start
 */

const WebSocket = require('ws');
const axios = require('axios');

// ============ CONFIGURATION ============
const CONFIG = {
  // Discord webhook URL
  DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1460543914133164140/YM6_IKWbY3p60bwQUb_fZmIqzM3qtMhK0GS4MQsCOT0-_ZIArKF-oDEX8VaAKuDq166O',

  // Entry/Exit timing (in minutes remaining)
  ENTRY_WINDOW_START: 4,      // Start looking for entries at 4 minutes remaining
  ENTRY_WINDOW_END: 2,        // Stop entering after 2 minutes remaining
  EXIT_ALERT_TIME: 1,         // Send exit alert at 1 minute remaining

  // Signal thresholds
  MIN_LEAN_THRESHOLD: 0.55,   // Minimum odds to consider a "lean" (55%)
  STRONG_LEAN_THRESHOLD: 0.65, // Strong lean threshold (65%)

  // Timing
  MARKET_REFRESH_MS: 5000,    // Refresh market data every 5 seconds
  SIGNAL_COOLDOWN_MS: 60000,  // Don't repeat same signal within 60 seconds

  // Polymarket APIs
  CLOB_API: 'https://clob.polymarket.com',
  GAMMA_API: 'https://gamma-api.polymarket.com',
};

// ============ STATE ============
const state = {
  currentMarket: null,
  upTokenPrice: null,
  downTokenPrice: null,
  btcPrice: null,
  lastEntrySignal: null,      // Track last entry signal to avoid duplicates
  lastExitSignal: null,       // Track last exit signal
  entrySignalSent: false,     // Has entry signal been sent for current window?
  exitSignalSent: false,      // Has exit signal been sent for current window?
  currentWindowSlug: null,    // Track current window to reset signals on new window
  isConnected: false
};

// ============ DISCORD NOTIFICATIONS ============
async function sendEntryAlert(direction, odds, minutesRemaining, btcPrice) {
  const color = direction === 'UP' ? 0x00ff00 : 0xff0000;
  const emoji = direction === 'UP' ? '🟢' : '🔴';
  const strength = odds >= CONFIG.STRONG_LEAN_THRESHOLD ? 'STRONG' : 'MODERATE';

  const embed = {
    title: `${emoji} WINDOW LICKER: BUY ${direction}`,
    description: `**${strength} lean detected** - Odds likely to push toward 90%+`,
    color: color,
    fields: [
      {
        name: 'Action',
        value: `**BUY ${direction} (YES)**`,
        inline: true
      },
      {
        name: 'Current Odds',
        value: `${(odds * 100).toFixed(1)}%`,
        inline: true
      },
      {
        name: 'Time Remaining',
        value: `${minutesRemaining.toFixed(1)} minutes`,
        inline: true
      },
      {
        name: 'BTC Price',
        value: `$${btcPrice?.toLocaleString() || 'N/A'}`,
        inline: true
      },
      {
        name: 'UP Odds',
        value: `${(state.upTokenPrice * 100).toFixed(1)}%`,
        inline: true
      },
      {
        name: 'DOWN Odds',
        value: `${(state.downTokenPrice * 100).toFixed(1)}%`,
        inline: true
      },
      {
        name: 'Strategy',
        value: 'End-of-window convergence play. Exit before final minute!',
        inline: false
      }
    ],
    footer: {
      text: 'Window Licker Bot'
    },
    timestamp: new Date().toISOString()
  };

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `**ENTRY SIGNAL** - ${direction} is leading with ${minutesRemaining.toFixed(1)}m left. Expect push to 90%+!`,
      embeds: [embed]
    });
    console.log(`[${new Date().toLocaleTimeString()}] ENTRY ALERT sent: BUY ${direction} at ${(odds * 100).toFixed(1)}%`);
  } catch (error) {
    console.error('Failed to send entry alert:', error.message);
  }
}

async function sendExitAlert(direction, odds, minutesRemaining) {
  const emoji = '⚠️';

  const embed = {
    title: `${emoji} WINDOW LICKER: EXIT NOW`,
    description: `**Time to take profits!** Window closing soon.`,
    color: 0xffaa00,
    fields: [
      {
        name: 'Action',
        value: `**SELL ${direction} position**`,
        inline: true
      },
      {
        name: 'Current Odds',
        value: `${(odds * 100).toFixed(1)}%`,
        inline: true
      },
      {
        name: 'Time Remaining',
        value: `${minutesRemaining.toFixed(1)} minutes`,
        inline: true
      },
      {
        name: 'Reason',
        value: 'Final minute is chaotic - secure profits now!',
        inline: false
      }
    ],
    footer: {
      text: 'Window Licker Bot'
    },
    timestamp: new Date().toISOString()
  };

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `**EXIT SIGNAL** - Take profits on ${direction} position NOW! Only ${minutesRemaining.toFixed(1)}m remaining.`,
      embeds: [embed]
    });
    console.log(`[${new Date().toLocaleTimeString()}] EXIT ALERT sent: SELL ${direction}`);
  } catch (error) {
    console.error('Failed to send exit alert:', error.message);
  }
}

async function sendNewWindowAlert() {
  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `**NEW WINDOW** - ${state.currentMarket.title}\nWaiting for entry window (${CONFIG.ENTRY_WINDOW_START}-${CONFIG.ENTRY_WINDOW_END} minutes remaining)...`
    });
  } catch (error) {
    console.error('Failed to send new window alert:', error.message);
  }
}

// ============ BINANCE WEBSOCKET ============
function connectBinance() {
  const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');

  ws.on('open', () => {
    console.log('[Binance] Connected to BTC price feed');
    state.isConnected = true;
  });

  ws.on('message', (data) => {
    try {
      const trade = JSON.parse(data);
      state.btcPrice = parseFloat(trade.p);
    } catch (error) {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log('[Binance] Disconnected, reconnecting in 5s...');
    state.isConnected = false;
    setTimeout(connectBinance, 5000);
  });

  ws.on('error', (error) => {
    console.error('[Binance] WebSocket error:', error.message);
  });

  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);
}

// ============ POLYMARKET MARKET DISCOVERY ============
async function findActiveMarket() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const baseTs = Math.floor(now / 900) * 900;
    const timestamps = [baseTs - 900, baseTs, baseTs + 900];

    const markets = [];
    const nowMs = Date.now();

    for (const ts of timestamps) {
      const slug = `btc-updown-15m-${ts}`;
      const market = await fetchMarketBySlug(slug);
      if (market) {
        markets.push(market);
      }
    }

    if (markets.length === 0) return null;

    const activeMarkets = markets.filter(m => m.endTime > nowMs);

    if (activeMarkets.length > 0) {
      activeMarkets.sort((a, b) => a.endTime - b.endTime);
      return activeMarkets[0];
    }

    markets.sort((a, b) => b.endTime - a.endTime);
    return markets[0];
  } catch (error) {
    console.error('[Market] Failed to fetch markets:', error.message);
    return null;
  }
}

async function fetchMarketBySlug(slug) {
  try {
    const response = await axios.get(`${CONFIG.GAMMA_API}/events`, {
      params: { slug }
    });

    if (!response.data || response.data.length === 0) return null;

    const event = response.data[0];
    if (!event.markets || event.markets.length === 0) return null;

    const market = event.markets[0];
    const endTime = new Date(market.endDate || event.endDate).getTime();
    const isClosed = market.closed === true || event.closed === true;

    let upTokenId, downTokenId;
    let tokenIds = market.clobTokenIds;
    if (typeof tokenIds === 'string') {
      try { tokenIds = JSON.parse(tokenIds); } catch (e) { tokenIds = null; }
    }

    if (tokenIds && Array.isArray(tokenIds) && tokenIds.length >= 2) {
      upTokenId = tokenIds[0];
      downTokenId = tokenIds[1];
    }

    if (!upTokenId || !downTokenId) return null;

    let outcomePrices = market.outcomePrices;
    if (typeof outcomePrices === 'string') {
      try { outcomePrices = JSON.parse(outcomePrices); } catch (e) { outcomePrices = null; }
    }

    let outcomes = market.outcomes;
    if (typeof outcomes === 'string') {
      try { outcomes = JSON.parse(outcomes); } catch (e) { outcomes = null; }
    }

    let initialUpPrice = null;
    let initialDownPrice = null;

    if (outcomePrices && outcomes && outcomes.length >= 2) {
      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i].toLowerCase();
        if (outcome === 'up' || outcome === 'yes') {
          initialUpPrice = parseFloat(outcomePrices[i]);
        } else if (outcome === 'down' || outcome === 'no') {
          initialDownPrice = parseFloat(outcomePrices[i]);
        }
      }
    }

    return {
      slug,
      title: event.title || market.question,
      endTime,
      closed: isClosed,
      upTokenId,
      downTokenId,
      initialUpPrice,
      initialDownPrice
    };

  } catch (error) {
    if (error.response?.status === 404) return null;
    return null;
  }
}

async function fetchMarketPrices() {
  if (!state.currentMarket) return;

  try {
    const response = await axios.get(`${CONFIG.GAMMA_API}/events`, {
      params: { slug: state.currentMarket.slug }
    });

    if (response.data && response.data.length > 0) {
      const market = response.data[0].markets?.[0];
      if (market) {
        let outcomePrices = market.outcomePrices;
        if (typeof outcomePrices === 'string') {
          try { outcomePrices = JSON.parse(outcomePrices); } catch (e) { outcomePrices = null; }
        }

        let outcomes = market.outcomes;
        if (typeof outcomes === 'string') {
          try { outcomes = JSON.parse(outcomes); } catch (e) { outcomes = null; }
        }

        if (outcomePrices && outcomes && outcomes.length >= 2) {
          for (let i = 0; i < outcomes.length; i++) {
            const outcome = outcomes[i].toLowerCase();
            if (outcome === 'up' || outcome === 'yes') {
              state.upTokenPrice = parseFloat(outcomePrices[i]);
            } else if (outcome === 'down' || outcome === 'no') {
              state.downTokenPrice = parseFloat(outcomePrices[i]);
            }
          }
        }
      }
    }
  } catch (error) {
    // Use cached prices
  }
}

// ============ STRATEGY LOGIC ============
async function analyzeWindow() {
  if (!state.currentMarket) return;
  if (!state.upTokenPrice || !state.downTokenPrice) return;

  const now = Date.now();
  const minutesRemaining = (state.currentMarket.endTime - now) / 60000;

  // Check for new window - reset signals
  if (state.currentWindowSlug !== state.currentMarket.slug) {
    state.currentWindowSlug = state.currentMarket.slug;
    state.entrySignalSent = false;
    state.exitSignalSent = false;
    state.lastEntrySignal = null;
    console.log(`[Strategy] New window detected, signals reset`);
    await sendNewWindowAlert();
  }

  // Determine which side is winning
  const upOdds = state.upTokenPrice;
  const downOdds = state.downTokenPrice;
  const leadingSide = upOdds > downOdds ? 'UP' : 'DOWN';
  const leadingOdds = Math.max(upOdds, downOdds);

  // ========== ENTRY LOGIC ==========
  // Check if we're in the entry window (4-2 minutes remaining)
  if (minutesRemaining <= CONFIG.ENTRY_WINDOW_START &&
      minutesRemaining > CONFIG.ENTRY_WINDOW_END &&
      !state.entrySignalSent) {

    // Check if there's a clear lean
    if (leadingOdds >= CONFIG.MIN_LEAN_THRESHOLD) {
      await sendEntryAlert(leadingSide, leadingOdds, minutesRemaining, state.btcPrice);
      state.entrySignalSent = true;
      state.lastEntrySignal = leadingSide;
    }
  }

  // ========== EXIT LOGIC ==========
  // Check if we should send exit alert (1 minute remaining)
  if (minutesRemaining <= CONFIG.EXIT_ALERT_TIME &&
      minutesRemaining > 0 &&
      state.entrySignalSent &&
      !state.exitSignalSent) {

    await sendExitAlert(state.lastEntrySignal || leadingSide, leadingOdds, minutesRemaining);
    state.exitSignalSent = true;
  }
}

// ============ MAIN LOOP ============
async function refreshMarket() {
  const market = await findActiveMarket();

  if (market) {
    if (!state.currentMarket || state.currentMarket.slug !== market.slug) {
      console.log(`\n[Market] Found active market: ${market.title}`);
      console.log(`[Market] Slug: ${market.slug}`);
      console.log(`[Market] Expires at: ${new Date(market.endTime).toLocaleTimeString()}\n`);
      state.currentMarket = market;
      state.upTokenPrice = market.initialUpPrice;
      state.downTokenPrice = market.initialDownPrice;
    }
  } else if (state.currentMarket) {
    console.log('[Market] No active market found, waiting...');
    state.currentMarket = null;
  }
}

async function mainLoop() {
  await fetchMarketPrices();
  await analyzeWindow();
}

function printStatus() {
  if (!state.isConnected) {
    console.log('[Status] Waiting for connection...');
    return;
  }

  if (!state.currentMarket) {
    console.log(`[${new Date().toLocaleTimeString()}] No active market`);
    return;
  }

  const minutesRemaining = (state.currentMarket.endTime - Date.now()) / 60000;
  const upOdds = state.upTokenPrice ? (state.upTokenPrice * 100).toFixed(1) + '%' : 'N/A';
  const downOdds = state.downTokenPrice ? (state.downTokenPrice * 100).toFixed(1) + '%' : 'N/A';

  // Determine window phase
  let phase = '';
  if (minutesRemaining > CONFIG.ENTRY_WINDOW_START) {
    phase = 'WAITING';
  } else if (minutesRemaining > CONFIG.ENTRY_WINDOW_END) {
    phase = state.entrySignalSent ? 'ENTRY SENT' : 'ENTRY WINDOW';
  } else if (minutesRemaining > CONFIG.EXIT_ALERT_TIME) {
    phase = 'HOLDING';
  } else if (minutesRemaining > 0) {
    phase = state.exitSignalSent ? 'EXIT SENT' : 'EXIT WINDOW';
  } else {
    phase = 'CLOSING';
  }

  let status = `[${new Date().toLocaleTimeString()}] `;
  status += `BTC: $${state.btcPrice?.toLocaleString() || 'N/A'} | `;
  status += `Time: ${minutesRemaining.toFixed(1)}m | `;
  status += `UP: ${upOdds} | DOWN: ${downOdds} | `;
  status += `Phase: ${phase}`;

  console.log(status);
}

// ============ STARTUP ============
async function start() {
  console.log('');
  console.log('==============================================');
  console.log('  WINDOW LICKER BOT');
  console.log('  End-of-Window Scalper Strategy');
  console.log('==============================================');
  console.log('');
  console.log('Strategy:');
  console.log('  - Enter when 4-2 minutes remain and one side leads >55%');
  console.log('  - Ride the convergence toward 90%+');
  console.log('  - Exit at 1 minute remaining (before chaos)');
  console.log('');
  console.log('Configuration:');
  console.log(`  Entry Window: ${CONFIG.ENTRY_WINDOW_START}-${CONFIG.ENTRY_WINDOW_END} minutes remaining`);
  console.log(`  Exit Alert: ${CONFIG.EXIT_ALERT_TIME} minute remaining`);
  console.log(`  Min Lean: ${CONFIG.MIN_LEAN_THRESHOLD * 100}%`);
  console.log(`  Strong Lean: ${CONFIG.STRONG_LEAN_THRESHOLD * 100}%`);
  console.log('');
  console.log('Starting up...');
  console.log('');

  connectBinance();
  await new Promise(resolve => setTimeout(resolve, 2000));
  await refreshMarket();

  setInterval(mainLoop, 1000);
  setInterval(refreshMarket, CONFIG.MARKET_REFRESH_MS);
  setInterval(printStatus, 10000);

  console.log('Window Licker Bot running. Watching for end-of-window opportunities...\n');
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

start().catch(error => {
  console.error('Failed to start:', error);
  process.exit(1);
});
