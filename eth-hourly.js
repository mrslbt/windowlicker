/**
 * ETH Hourly Watcher - Polymarket Hourly UP/DOWN Signal Bot
 *
 * Features:
 * - IMMEDIATE alert when price moves $8+ from open
 * - Shows Polymarket odds so you know if still worth buying
 * - Clear actionable notifications
 */

const WebSocket = require('ws');
const axios = require('axios');

// ============ CONFIGURATION ============
const CONFIG = {
  DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1460806039011328171/kniEallTw7QPWTMSvLr2DWl4Vc4AyBVDfmdo2EKoYY9unp2m_RYq-kWzb9k7plE4tKp6',

  // IMMEDIATE ALERT: $8 move triggers alert right away
  IMMEDIATE_THRESHOLD_USD: 8,

  // Re-alert every $5 additional move
  REALERT_INCREMENT_USD: 5,

  // Polymarket API
  GAMMA_API: 'https://gamma-api.polymarket.com',

  // Polling intervals
  PRICE_CHECK_INTERVAL: 2000,
  ODDS_REFRESH_INTERVAL: 5000,
  STATUS_PRINT_INTERVAL: 10000,
};

// ============ STATE ============
const state = {
  currentPrice: null,
  hourOpenPrice: null,
  hourOpenTime: null,

  // Polymarket odds
  upOdds: null,
  downOdds: null,
  marketSlug: null,

  // Alert tracking
  lastAlertMoveUSD: null,
  lastAlertDirection: null,
  immediateAlertSent: false,

  isConnected: false,
  ws: null
};

// ============ HELPERS ============
function getMinutesIntoHour() {
  const now = new Date();
  return now.getMinutes() + (now.getSeconds() / 60);
}

function getMinutesRemaining() {
  return 60 - getMinutesIntoHour();
}

function getMoveUSD() {
  if (!state.currentPrice || !state.hourOpenPrice) return 0;
  return state.currentPrice - state.hourOpenPrice;
}

function getDirection() {
  return getMoveUSD() >= 0 ? 'UP' : 'DOWN';
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getOddsAssessment(odds) {
  if (odds >= 0.85) return { text: 'TOO LATE', color: 0x666666, worth: false };
  if (odds >= 0.75) return { text: 'RISKY', color: 0xffaa00, worth: false };
  if (odds >= 0.65) return { text: 'OK', color: 0xffff00, worth: true };
  if (odds >= 0.55) return { text: 'GOOD', color: 0x00ff00, worth: true };
  return { text: 'GREAT', color: 0x00ff00, worth: true };
}

// ============ POLYMARKET ODDS ============
function getCurrentMarketSlug() {
  // Get current time in ET (Eastern Time)
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];

  const month = months[etTime.getMonth()];
  const day = etTime.getDate();
  let hour = etTime.getHours();
  const ampm = hour >= 12 ? 'pm' : 'am';

  // Convert to 12-hour format
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;

  // Format: ethereum-up-or-down-january-14-3pm-et
  return `ethereum-up-or-down-${month}-${day}-${hour}${ampm}-et`;
}

async function fetchPolymarketOdds() {
  try {
    const slug = getCurrentMarketSlug();

    const response = await axios.get(`${CONFIG.GAMMA_API}/events`, {
      params: { slug },
      timeout: 5000
    });

    if (response.data && response.data.length > 0) {
      const event = response.data[0];
      const market = event.markets?.[0];

      if (market) {
        let outcomePrices = market.outcomePrices;
        if (typeof outcomePrices === 'string') {
          outcomePrices = JSON.parse(outcomePrices);
        }

        let outcomes = market.outcomes;
        if (typeof outcomes === 'string') {
          outcomes = JSON.parse(outcomes);
        }

        if (outcomePrices && outcomes) {
          for (let i = 0; i < outcomes.length; i++) {
            const outcome = outcomes[i].toLowerCase();
            if (outcome === 'up' || outcome === 'yes') {
              state.upOdds = parseFloat(outcomePrices[i]);
            } else if (outcome === 'down' || outcome === 'no') {
              state.downOdds = parseFloat(outcomePrices[i]);
            }
          }
          state.marketSlug = slug;
        }
      }
    }
  } catch (error) {
    // Silently fail - odds just won't be shown
  }
}

// ============ DISCORD NOTIFICATIONS ============
async function sendImmediateAlert(direction, moveUSD) {
  const absMoveUSD = Math.abs(moveUSD);
  const minsRemaining = getMinutesRemaining();
  const minsIntoHour = getMinutesIntoHour();

  // Get current odds for the winning direction
  const currentOdds = direction === 'UP' ? state.upOdds : state.downOdds;
  const assessment = currentOdds ? getOddsAssessment(currentOdds) : null;

  const color = direction === 'UP' ? 0x00ff00 : 0xff0000;
  const emoji = direction === 'UP' ? '🟢' : '🔴';
  const arrow = direction === 'UP' ? '📈' : '📉';

  // Build clear message
  let buyAdvice = '';
  let oddsDisplay = 'N/A';

  if (currentOdds) {
    oddsDisplay = `${(currentOdds * 100).toFixed(0)}%`;
    if (assessment.worth) {
      buyAdvice = `BUY ${direction} @ ${oddsDisplay} odds`;
    } else {
      buyAdvice = `${assessment.text} - Odds already at ${oddsDisplay}`;
    }
  } else {
    buyAdvice = `BUY ${direction} - Check Polymarket for odds`;
  }

  const embed = {
    title: `${arrow} ETH MOVED $${absMoveUSD.toFixed(0)} ${direction}!`,
    description: assessment?.worth
      ? `**${buyAdvice}**`
      : `**${buyAdvice}**`,
    color: assessment?.color || color,
    fields: [
      {
        name: '💰 Price Move',
        value: `**$${absMoveUSD.toFixed(2)} ${direction}**`,
        inline: true
      },
      {
        name: '🎯 Polymarket Odds',
        value: `**${direction}: ${oddsDisplay}**`,
        inline: true
      },
      {
        name: '⏱️ Time Left',
        value: `**${minsRemaining.toFixed(0)} mins**`,
        inline: true
      },
      {
        name: '📊 Hour Open',
        value: `$${state.hourOpenPrice?.toFixed(2)}`,
        inline: true
      },
      {
        name: '💵 Current Price',
        value: `$${state.currentPrice?.toFixed(2)}`,
        inline: true
      },
      {
        name: '📍 Minutes In',
        value: `${minsIntoHour.toFixed(0)}/60`,
        inline: true
      }
    ],
    footer: {
      text: assessment?.worth
        ? `WORTH BUYING - ${assessment.text} entry`
        : `MIGHT BE TOO LATE - ${assessment?.text || 'Check odds'}`
    },
    timestamp: new Date().toISOString()
  };

  // Add recommendation field
  if (assessment) {
    let recommendation = '';
    if (assessment.worth && minsRemaining > 10) {
      recommendation = `Entry looks ${assessment.text}. ${minsRemaining.toFixed(0)} mins to settlement.`;
    } else if (assessment.worth && minsRemaining <= 10) {
      recommendation = `Quick! Only ${minsRemaining.toFixed(0)} mins left. Entry ${assessment.text}.`;
    } else {
      recommendation = `Odds at ${oddsDisplay} - most profit already taken. Skip or small bet only.`;
    }

    embed.fields.push({
      name: '💡 Recommendation',
      value: recommendation,
      inline: false
    });
  }

  try {
    const urgency = assessment?.worth ? '🚨' : '⚠️';
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `${urgency} **ETH $${absMoveUSD.toFixed(0)} ${direction}** | ${direction} odds: ${oddsDisplay} | ${minsRemaining.toFixed(0)}m left`,
      embeds: [embed]
    });
    console.log(`[${formatTime(new Date())}] ALERT: $${absMoveUSD.toFixed(2)} ${direction} | Odds: ${oddsDisplay}`);
  } catch (error) {
    console.error('Discord alert failed:', error.message);
  }
}

async function sendUpdateAlert(direction, moveUSD) {
  const absMoveUSD = Math.abs(moveUSD);
  const minsRemaining = getMinutesRemaining();
  const currentOdds = direction === 'UP' ? state.upOdds : state.downOdds;
  const oddsDisplay = currentOdds ? `${(currentOdds * 100).toFixed(0)}%` : 'N/A';

  const emoji = direction === 'UP' ? '📈' : '📉';

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `${emoji} **UPDATE: ETH now $${absMoveUSD.toFixed(0)} ${direction}** | Odds: ${oddsDisplay} | ${minsRemaining.toFixed(0)}m left | Price: $${state.currentPrice?.toFixed(2)}`
    });
    console.log(`[${formatTime(new Date())}] UPDATE: $${absMoveUSD.toFixed(2)} ${direction}`);
  } catch (error) {
    console.error('Discord update failed:', error.message);
  }
}

async function sendNewHourAlert() {
  const hourEnd = new Date();
  hourEnd.setMinutes(0, 0, 0);
  hourEnd.setHours(hourEnd.getHours() + 1);

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `⏰ **NEW HOUR** | ETH Open: **$${state.hourOpenPrice?.toFixed(2)}** | Closes ${formatTime(hourEnd)} | Watching for $${CONFIG.IMMEDIATE_THRESHOLD_USD}+ moves...`
    });
  } catch (error) {
    console.error('New hour alert failed:', error.message);
  }
}

// ============ BINANCE WEBSOCKET ============
function connectBinance() {
  console.log('[Binance] Connecting...');

  const ws = new WebSocket('wss://stream.binance.com:9443/ws/ethusdt@aggTrade');
  state.ws = ws;

  ws.on('open', () => {
    console.log('[Binance] Connected to ETH/USDT');
    state.isConnected = true;
    fetchHourlyCandle();
  });

  ws.on('message', (data) => {
    try {
      const trade = JSON.parse(data);
      state.currentPrice = parseFloat(trade.p);
    } catch (e) {}
  });

  ws.on('close', () => {
    console.log('[Binance] Disconnected, reconnecting...');
    state.isConnected = false;
    setTimeout(connectBinance, 5000);
  });

  ws.on('error', (e) => console.error('[Binance] Error:', e.message));

  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 30000);
}

async function fetchHourlyCandle() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: 'ETHUSDT', interval: '1h', limit: 1 }
    });

    if (response.data?.[0]) {
      const [openTime, openPrice] = response.data[0];
      const wasNewHour = state.hourOpenTime !== openTime;

      state.hourOpenPrice = parseFloat(openPrice);
      state.hourOpenTime = openTime;

      if (wasNewHour) {
        // Reset for new hour
        state.immediateAlertSent = false;
        state.lastAlertMoveUSD = null;
        state.lastAlertDirection = null;

        console.log(`[New Hour] Open: $${state.hourOpenPrice.toFixed(2)}`);
        await sendNewHourAlert();
      }
    }
  } catch (e) {
    console.error('[Candle] Fetch failed:', e.message);
  }
}

// ============ ANALYSIS ============
async function analyze() {
  if (!state.currentPrice || !state.hourOpenPrice) return;

  const moveUSD = getMoveUSD();
  const absMoveUSD = Math.abs(moveUSD);
  const direction = getDirection();

  // IMMEDIATE ALERT: $8+ move
  if (absMoveUSD >= CONFIG.IMMEDIATE_THRESHOLD_USD && !state.immediateAlertSent) {
    await fetchPolymarketOdds(); // Get fresh odds before alerting
    await sendImmediateAlert(direction, moveUSD);
    state.immediateAlertSent = true;
    state.lastAlertMoveUSD = absMoveUSD;
    state.lastAlertDirection = direction;
    return;
  }

  // UPDATE ALERTS: Every additional $5 move
  if (state.immediateAlertSent && state.lastAlertMoveUSD !== null) {
    const additionalMove = absMoveUSD - state.lastAlertMoveUSD;

    // Same direction, moved more
    if (additionalMove >= CONFIG.REALERT_INCREMENT_USD && direction === state.lastAlertDirection) {
      await fetchPolymarketOdds();
      await sendUpdateAlert(direction, moveUSD);
      state.lastAlertMoveUSD = absMoveUSD;
    }
    // Direction REVERSED significantly
    else if (direction !== state.lastAlertDirection && absMoveUSD >= CONFIG.IMMEDIATE_THRESHOLD_USD) {
      await fetchPolymarketOdds();
      await sendImmediateAlert(direction, moveUSD);
      state.lastAlertMoveUSD = absMoveUSD;
      state.lastAlertDirection = direction;
    }
  }
}

// ============ STATUS ============
function printStatus() {
  if (!state.isConnected || !state.currentPrice) {
    console.log('[Status] Waiting for data...');
    return;
  }

  const moveUSD = getMoveUSD();
  const direction = getDirection();
  const minsRemaining = getMinutesRemaining();
  const upOdds = state.upOdds ? `${(state.upOdds * 100).toFixed(0)}%` : '?';
  const downOdds = state.downOdds ? `${(state.downOdds * 100).toFixed(0)}%` : '?';
  const slug = getCurrentMarketSlug();

  console.log(
    `[${formatTime(new Date())}] ` +
    `ETH: $${state.currentPrice.toFixed(2)} | ` +
    `Move: ${moveUSD >= 0 ? '+' : ''}$${moveUSD.toFixed(2)} ${direction} | ` +
    `Odds: UP ${upOdds} / DOWN ${downOdds} | ` +
    `${minsRemaining.toFixed(0)}m left`
  );
  console.log(`  Market: ${slug}`);
}

// ============ MAIN ============
async function start() {
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  ETH HOURLY WATCHER');
  console.log('══════════════════════════════════════════════');
  console.log('');
  console.log(`  IMMEDIATE ALERT: $${CONFIG.IMMEDIATE_THRESHOLD_USD}+ move`);
  console.log(`  UPDATE ALERTS: Every additional $${CONFIG.REALERT_INCREMENT_USD}`);
  console.log('  Shows Polymarket odds + buy recommendation');
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('');

  connectBinance();
  await new Promise(r => setTimeout(r, 3000));

  // Fetch initial odds
  await fetchPolymarketOdds();

  setInterval(analyze, CONFIG.PRICE_CHECK_INTERVAL);
  setInterval(fetchHourlyCandle, 60000);
  setInterval(fetchPolymarketOdds, CONFIG.ODDS_REFRESH_INTERVAL);
  setInterval(printStatus, CONFIG.STATUS_PRINT_INTERVAL);

  console.log('Watching for $8+ moves...\n');
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (state.ws) state.ws.close();
  process.exit(0);
});

start().catch(e => {
  console.error('Start failed:', e);
  process.exit(1);
});
