/**
 * ETH Hourly Watcher v3 - Cement Wins Edition
 *
 * Strategy:
 * - Only alerts on $12+ moves (not noise)
 * - BTC confirmation (same direction = safer)
 * - Optimal entry window: minute 40-50
 * - Polymarket odds check (<75% = good entry)
 * - Liquidation cascade detection (big signal)
 * - Clear BUY/SKIP recommendation
 */

const WebSocket = require('ws');
const axios = require('axios');

// ============ CONFIGURATION ============
const CONFIG = {
  DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1460806039011328171/kniEallTw7QPWTMSvLr2DWl4Vc4AyBVDfmdo2EKoYY9unp2m_RYq-kWzb9k7plE4tKp6',

  // Price alert (works at ALL times)
  PRICE_ALERT_THRESHOLD_USD: 10,    // Alert when price moves $10+ from open (any time)
  PRICE_ALERT_INCREMENT_USD: 10,    // Re-alert every additional $10

  // Price thresholds (strategy alerts - entry window only)
  MOVE_THRESHOLD_USD: 12,           // Only alert on $12+ moves
  REALERT_INCREMENT_USD: 6,         // Re-alert every additional $6

  // Entry window (minutes into hour)
  ENTRY_WINDOW_START: 40,           // Start alerting at minute 40
  ENTRY_WINDOW_END: 52,             // Stop at minute 52 (too late after)

  // Skip hours (ET timezone) - low liquidity, choppy
  SKIP_HOURS_ET: [3, 4, 5],         // 3-5 AM ET

  // Odds thresholds
  MAX_ODDS_FOR_BUY: 0.75,           // Skip if odds > 75%
  GOOD_ODDS: 0.65,                  // Great entry if < 65%

  // Liquidation threshold
  LIQUIDATION_THRESHOLD: 50000000,  // $50M in liquidations = big signal

  // BTC confirmation - ETH $12 move ~ BTC $150-200 move (ratio ~15x)
  BTC_CONFIRM_THRESHOLD: 150,

  // API endpoints
  GAMMA_API: 'https://gamma-api.polymarket.com',
  COINGLASS_API: 'https://open-api.coinglass.com/public/v2',

  // Intervals
  PRICE_CHECK_INTERVAL: 2000,
  STATUS_PRINT_INTERVAL: 30000,
};

// ============ STATE ============
const state = {
  // ETH data
  ethPrice: null,
  ethHourOpen: null,
  ethHourOpenTime: null,

  // BTC data
  btcPrice: null,
  btcHourOpen: null,

  // Polymarket odds
  upOdds: null,
  downOdds: null,

  // Liquidations (last 1 hour)
  recentLiquidations: 0,
  liquidationDirection: null,  // 'long' or 'short'

  // Alert tracking (strategy alerts)
  alertSentThisHour: false,
  lastAlertMoveUSD: null,

  // Price alert tracking (works at ALL times)
  lastPriceAlertLevel: 0,           // Last threshold crossed (e.g., 10, 20, 30...)

  // Connections
  ethWs: null,
  btcWs: null,
  isConnected: false
};

// ============ HELPERS ============
function getMinutesIntoHour() {
  const now = new Date();
  return now.getMinutes() + (now.getSeconds() / 60);
}

function getMinutesRemaining() {
  return 60 - getMinutesIntoHour();
}

function getCurrentHourET() {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etTime.getHours();
}

function isInEntryWindow() {
  const mins = getMinutesIntoHour();
  return mins >= CONFIG.ENTRY_WINDOW_START && mins <= CONFIG.ENTRY_WINDOW_END;
}

function isSkipHour() {
  const hourET = getCurrentHourET();
  return CONFIG.SKIP_HOURS_ET.includes(hourET);
}

function getEthMoveUSD() {
  if (!state.ethPrice || !state.ethHourOpen) return 0;
  return state.ethPrice - state.ethHourOpen;
}

function getBtcMoveUSD() {
  if (!state.btcPrice || !state.btcHourOpen) return 0;
  return state.btcPrice - state.btcHourOpen;
}

function getDirection() {
  return getEthMoveUSD() >= 0 ? 'UP' : 'DOWN';
}

function isBtcConfirming() {
  const ethMove = getEthMoveUSD();
  const btcMove = getBtcMoveUSD();

  // Both moving same direction with significant BTC move
  if (ethMove > 0 && btcMove > CONFIG.BTC_CONFIRM_THRESHOLD) return true;
  if (ethMove < 0 && btcMove < -CONFIG.BTC_CONFIRM_THRESHOLD) return true;
  return false;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatUSD(num) {
  return num >= 0 ? `+$${num.toFixed(2)}` : `-$${Math.abs(num).toFixed(2)}`;
}

// ============ POLYMARKET ODDS ============
function getCurrentMarketSlug() {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];

  const month = months[etTime.getMonth()];
  const day = etTime.getDate();
  let hour = etTime.getHours();
  const ampm = hour >= 12 ? 'pm' : 'am';

  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;

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
      const market = response.data[0].markets?.[0];
      if (market) {
        let outcomePrices = market.outcomePrices;
        let outcomes = market.outcomes;

        if (typeof outcomePrices === 'string') outcomePrices = JSON.parse(outcomePrices);
        if (typeof outcomes === 'string') outcomes = JSON.parse(outcomes);

        if (outcomePrices && outcomes) {
          for (let i = 0; i < outcomes.length; i++) {
            const outcome = outcomes[i].toLowerCase();
            if (outcome === 'up' || outcome === 'yes') {
              state.upOdds = parseFloat(outcomePrices[i]);
            } else if (outcome === 'down' || outcome === 'no') {
              state.downOdds = parseFloat(outcomePrices[i]);
            }
          }
        }
      }
    }
  } catch (e) {
    // Silent fail
  }
}

// ============ LIQUIDATION DATA ============
async function fetchLiquidations() {
  try {
    // Fetch from Coinglass public API
    const response = await axios.get('https://open-api.coinglass.com/public/v2/liquidation_history', {
      params: { symbol: 'ETH', time_type: 'h1' },
      timeout: 5000
    });

    if (response.data?.data) {
      const data = response.data.data;
      const longLiq = data.longLiquidationUsd || 0;
      const shortLiq = data.shortLiquidationUsd || 0;

      state.recentLiquidations = longLiq + shortLiq;
      state.liquidationDirection = longLiq > shortLiq ? 'long' : 'short';
    }
  } catch (e) {
    // Try alternative endpoint or silent fail
    try {
      const response = await axios.get('https://api.coinglass.com/api/futures/liquidation/detail?symbol=ETH', {
        timeout: 5000
      });
      if (response.data?.data) {
        state.recentLiquidations = response.data.data.totalVolUsd || 0;
      }
    } catch (e2) {
      // Silent fail - liquidation data optional
    }
  }
}

// ============ BINANCE WEBSOCKETS ============
function connectBinance() {
  console.log('[Binance] Connecting to ETH & BTC feeds...');

  // ETH WebSocket
  const ethWs = new WebSocket('wss://stream.binance.com:9443/ws/ethusdt@aggTrade');
  state.ethWs = ethWs;

  ethWs.on('open', () => {
    console.log('[Binance] ETH connected');
    state.isConnected = true;
    fetchHourlyCandles();
  });

  ethWs.on('message', (data) => {
    try {
      const trade = JSON.parse(data);
      state.ethPrice = parseFloat(trade.p);
    } catch (e) {}
  });

  ethWs.on('close', () => {
    console.log('[Binance] ETH disconnected, reconnecting...');
    setTimeout(() => connectBinance(), 5000);
  });

  ethWs.on('error', (e) => console.error('[ETH WS Error]', e.message));

  // BTC WebSocket
  const btcWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');
  state.btcWs = btcWs;

  btcWs.on('open', () => console.log('[Binance] BTC connected'));

  btcWs.on('message', (data) => {
    try {
      const trade = JSON.parse(data);
      state.btcPrice = parseFloat(trade.p);
    } catch (e) {}
  });

  btcWs.on('error', (e) => console.error('[BTC WS Error]', e.message));

  // Heartbeat
  setInterval(() => {
    if (ethWs.readyState === WebSocket.OPEN) ethWs.ping();
    if (btcWs.readyState === WebSocket.OPEN) btcWs.ping();
  }, 30000);
}

async function fetchHourlyCandles() {
  try {
    // Fetch ETH and BTC candles in parallel
    const [ethRes, btcRes] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/klines', {
        params: { symbol: 'ETHUSDT', interval: '1h', limit: 1 }
      }),
      axios.get('https://api.binance.com/api/v3/klines', {
        params: { symbol: 'BTCUSDT', interval: '1h', limit: 1 }
      })
    ]);

    if (ethRes.data?.[0]) {
      const [openTime, openPrice] = ethRes.data[0];
      const wasNewHour = state.ethHourOpenTime !== openTime;

      state.ethHourOpen = parseFloat(openPrice);
      state.ethHourOpenTime = openTime;

      if (wasNewHour) {
        state.alertSentThisHour = false;
        state.lastAlertMoveUSD = null;
        state.lastPriceAlertLevel = 0;  // Reset price alert tracking
        console.log(`[New Hour] ETH Open: $${state.ethHourOpen.toFixed(2)}`);
      }
    }

    if (btcRes.data?.[0]) {
      state.btcHourOpen = parseFloat(btcRes.data[0][1]);
    }
  } catch (e) {
    console.error('[Candle fetch error]', e.message);
  }
}

// ============ DECISION ENGINE ============
function evaluateTrade() {
  const ethMove = getEthMoveUSD();
  const absMove = Math.abs(ethMove);
  const direction = getDirection();
  const minsRemaining = getMinutesRemaining();
  const currentOdds = direction === 'UP' ? state.upOdds : state.downOdds;

  const checks = {
    moveSize: absMove >= CONFIG.MOVE_THRESHOLD_USD,
    entryWindow: isInEntryWindow(),
    notSkipHour: !isSkipHour(),
    btcConfirms: isBtcConfirming(),
    oddsGood: currentOdds ? currentOdds < CONFIG.MAX_ODDS_FOR_BUY : true,
    liquidationSignal: state.recentLiquidations >= CONFIG.LIQUIDATION_THRESHOLD
  };

  const passedChecks = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.keys(checks).length;

  let recommendation = 'SKIP';
  let confidence = 'LOW';

  // Decision logic
  if (!checks.moveSize) {
    recommendation = 'WAIT';
    confidence = 'N/A';
  } else if (!checks.entryWindow) {
    recommendation = 'WAIT';
    confidence = 'N/A';
  } else if (!checks.notSkipHour) {
    recommendation = 'SKIP';
    confidence = 'LOW';
  } else if (!checks.oddsGood) {
    recommendation = 'SKIP';
    confidence = 'TOO LATE';
  } else if (passedChecks >= 5) {
    recommendation = 'BUY';
    confidence = 'HIGH';
  } else if (passedChecks >= 4) {
    recommendation = 'BUY';
    confidence = 'MEDIUM';
  } else if (passedChecks >= 3) {
    recommendation = 'SMALL BET';
    confidence = 'LOW';
  }

  return {
    recommendation,
    confidence,
    checks,
    passedChecks,
    totalChecks,
    direction,
    ethMove,
    btcMove: getBtcMoveUSD(),
    currentOdds,
    minsRemaining,
    liquidations: state.recentLiquidations
  };
}

// ============ DISCORD ALERT ============
async function sendAlert(evaluation) {
  const { recommendation, confidence, checks, direction, ethMove, btcMove, currentOdds, minsRemaining, liquidations } = evaluation;

  const absMove = Math.abs(ethMove);
  const oddsDisplay = currentOdds ? `${(currentOdds * 100).toFixed(0)}%` : 'N/A';

  // Color based on recommendation
  let color = 0x666666; // gray
  if (recommendation === 'BUY' && confidence === 'HIGH') color = 0x00ff00; // green
  else if (recommendation === 'BUY') color = 0x90EE90; // light green
  else if (recommendation === 'SMALL BET') color = 0xffff00; // yellow
  else if (recommendation === 'SKIP') color = 0xff0000; // red

  const emoji = direction === 'UP' ? '📈' : '📉';
  const actionEmoji = recommendation === 'BUY' ? '✅' : recommendation === 'SMALL BET' ? '⚠️' : '❌';

  const embed = {
    title: `${emoji} ETH ${formatUSD(ethMove)} | ${actionEmoji} ${recommendation}`,
    description: `**Confidence: ${confidence}**`,
    color: color,
    fields: [
      {
        name: '💰 ETH Move',
        value: `**${formatUSD(ethMove)}**`,
        inline: true
      },
      {
        name: '₿ BTC Move',
        value: `**${formatUSD(btcMove)}**`,
        inline: true
      },
      {
        name: '⏱️ Time Left',
        value: `**${minsRemaining.toFixed(0)} mins**`,
        inline: true
      },
      {
        name: '🎯 Odds',
        value: `**${direction}: ${oddsDisplay}**`,
        inline: true
      },
      {
        name: '💥 Liquidations',
        value: `$${(liquidations / 1000000).toFixed(1)}M`,
        inline: true
      },
      {
        name: '📊 Checks',
        value: `${evaluation.passedChecks}/${evaluation.totalChecks}`,
        inline: true
      }
    ],
    footer: {
      text: `ETH: $${state.ethPrice?.toFixed(2)} | BTC: $${state.btcPrice?.toFixed(0)}`
    },
    timestamp: new Date().toISOString()
  };

  // Add checklist
  const checklistLines = [
    `${checks.moveSize ? '✅' : '❌'} Move $12+ (${formatUSD(ethMove)})`,
    `${checks.entryWindow ? '✅' : '❌'} Entry window (min 40-52)`,
    `${checks.btcConfirms ? '✅' : '❌'} BTC confirms (${formatUSD(btcMove)})`,
    `${checks.oddsGood ? '✅' : '❌'} Odds < 75% (${oddsDisplay})`,
    `${checks.notSkipHour ? '✅' : '❌'} Good trading hour`,
    `${checks.liquidationSignal ? '✅' : '⬜'} Liquidation cascade`
  ];

  embed.fields.push({
    name: '📋 Checklist',
    value: checklistLines.join('\n'),
    inline: false
  });

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `${actionEmoji} **${recommendation}** ${direction} | ETH ${formatUSD(ethMove)} | Odds: ${oddsDisplay} | ${minsRemaining.toFixed(0)}m left (${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })} ET)`,
      embeds: [embed]
    });
    console.log(`[${formatTime(new Date())}] ALERT: ${recommendation} ${direction} | ${formatUSD(ethMove)}`);
  } catch (e) {
    console.error('Discord alert failed:', e.message);
  }
}

// ============ PRICE ALERT (ALL TIMES) ============
async function sendPriceAlert(ethMove, direction) {
  const emoji = direction === 'UP' ? '📈' : '📉';
  const color = direction === 'UP' ? 0x00ff00 : 0xff0000;
  const minsRemaining = getMinutesRemaining();

  const embed = {
    title: `${emoji} ETH ${formatUSD(ethMove)} from open`,
    color: color,
    fields: [
      {
        name: '💰 Current Price',
        value: `**$${state.ethPrice?.toFixed(2)}**`,
        inline: true
      },
      {
        name: '📊 Hour Open',
        value: `**$${state.ethHourOpen?.toFixed(2)}**`,
        inline: true
      },
      {
        name: '⏱️ Time Left',
        value: `**${minsRemaining.toFixed(0)} mins**`,
        inline: true
      }
    ],
    footer: {
      text: 'Price Alert (all times)'
    },
    timestamp: new Date().toISOString()
  };

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      content: `${emoji} **PRICE ALERT** | ETH ${formatUSD(ethMove)} | $${state.ethPrice?.toFixed(2)}`,
      embeds: [embed]
    });
    console.log(`[${formatTime(new Date())}] PRICE ALERT: ETH ${formatUSD(ethMove)}`);
  } catch (e) {
    console.error('Price alert failed:', e.message);
  }
}

async function checkPriceAlert() {
  if (!state.ethPrice || !state.ethHourOpen) return;

  const ethMove = getEthMoveUSD();
  const absMove = Math.abs(ethMove);
  const direction = ethMove >= 0 ? 'UP' : 'DOWN';

  // Calculate which threshold level we're at (10, 20, 30, etc.)
  const currentLevel = Math.floor(absMove / CONFIG.PRICE_ALERT_THRESHOLD_USD) * CONFIG.PRICE_ALERT_THRESHOLD_USD;

  // Only alert if we crossed a new threshold
  if (currentLevel >= CONFIG.PRICE_ALERT_THRESHOLD_USD && currentLevel > state.lastPriceAlertLevel) {
    await sendPriceAlert(ethMove, direction);
    state.lastPriceAlertLevel = currentLevel;
  }
}

// ============ ANALYSIS LOOP ============
async function analyze() {
  if (!state.ethPrice || !state.ethHourOpen) return;

  // Check for price alerts first (works at ALL times)
  await checkPriceAlert();

  const ethMove = getEthMoveUSD();
  const absMove = Math.abs(ethMove);

  // Only proceed with strategy alerts if move is significant AND in entry window
  if (absMove < CONFIG.MOVE_THRESHOLD_USD) return;
  if (!isInEntryWindow()) return;

  // Check if we already alerted
  if (state.alertSentThisHour) {
    // Re-alert only if move increased significantly
    if (state.lastAlertMoveUSD !== null) {
      const additionalMove = absMove - Math.abs(state.lastAlertMoveUSD);
      if (additionalMove < CONFIG.REALERT_INCREMENT_USD) return;
    }
  }

  // Fetch fresh data
  await Promise.all([
    fetchPolymarketOdds(),
    fetchLiquidations()
  ]);

  // Evaluate and alert
  const evaluation = evaluateTrade();

  // Only alert for actionable recommendations
  if (evaluation.recommendation !== 'WAIT') {
    await sendAlert(evaluation);
    state.alertSentThisHour = true;
    state.lastAlertMoveUSD = ethMove;
  }
}

// ============ STATUS (minimal) ============
function printStatus() {
  if (!state.isConnected || !state.ethPrice) {
    console.log('[Status] Waiting for data...');
    return;
  }

  const ethMove = getEthMoveUSD();
  const btcMove = getBtcMoveUSD();
  const mins = getMinutesIntoHour();
  const inWindow = isInEntryWindow() ? 'ACTIVE' : 'waiting';

  console.log(
    `[${formatTime(new Date())}] ` +
    `ETH: ${formatUSD(ethMove)} | BTC: ${formatUSD(btcMove)} | ` +
    `Min: ${mins.toFixed(0)}/60 | ${inWindow}`
  );
}

// ============ MAIN ============
async function start() {
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  ETH HOURLY WATCHER v3 - CEMENT WINS EDITION');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log('  Price Alerts (ALL times):');
  console.log(`    - ETH moves $${CONFIG.PRICE_ALERT_THRESHOLD_USD}+ from open`);
  console.log('');
  console.log('  Strategy Alerts (entry window only):');
  console.log(`    - ETH moves $${CONFIG.MOVE_THRESHOLD_USD}+ from open`);
  console.log(`    - Entry window: minute ${CONFIG.ENTRY_WINDOW_START}-${CONFIG.ENTRY_WINDOW_END}`);
  console.log('    - Includes BUY/SKIP recommendation');
  console.log('');
  console.log('  Checks: Move size, BTC confirm, Odds, Liquidations');
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  connectBinance();

  await new Promise(r => setTimeout(r, 3000));

  // Initial data fetch
  await Promise.all([
    fetchPolymarketOdds(),
    fetchLiquidations()
  ]);

  // Start loops
  setInterval(analyze, CONFIG.PRICE_CHECK_INTERVAL);
  setInterval(fetchHourlyCandles, 60000);
  setInterval(printStatus, CONFIG.STATUS_PRINT_INTERVAL);

  console.log(`Bot running. Price alerts on $${CONFIG.PRICE_ALERT_THRESHOLD_USD}+ moves (all times). Strategy alerts on $${CONFIG.MOVE_THRESHOLD_USD}+ moves in entry window.\n`);
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (state.ethWs) state.ethWs.close();
  if (state.btcWs) state.btcWs.close();
  process.exit(0);
});

start().catch(e => {
  console.error('Start failed:', e);
  process.exit(1);
});
