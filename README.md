# Window Licker Bot - ETH Hourly Strategy

A trading signal bot for Polymarket ETH hourly markets. Monitors price movements and sends Discord alerts with buy/skip recommendations during the optimal entry window.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Discord webhook URLs and bot token

# 3. Run the bot
npm start
```

---

## Features

### Core Features
- **6-Point Checklist** - Systematic evaluation of trade setups
- **Premium Index Analysis** - Real-time bounce risk detection
- **Automatic 40-Minute Alerts** - Signals during optimal entry window

### New Features (v2.1)
- **`/wdyt` Command** - Get instant market readings anytime via Discord
- **Odds Velocity Tracking** - Detect when moves are being priced in too fast
- **Exit Alerts** - Get notified when conditions change mid-trade
- **Performance Logging** - Track all signals for historical analysis

---

## How It Works

### The Strategy

The bot targets **Polymarket ETH hourly markets** (ETH up or down by end of hour).

**Core Logic:**
- Only alerts during minutes **40-52** of each hour (last 20 minutes)
- Requires ETH to move **$12+** from the hourly open price
- Runs a 6-point checklist to determine BUY / SKIP / SMALL BET
- Uses **premium index** (real-time) to assess bounce risk before entry
- Tracks **odds velocity** to detect if the move is already priced in

### Why Last 20 Minutes?

- Early in the hour = too much time for reversals
- Last 20 minutes = momentum is established, less time for reversal
- Before minute 52 = still get decent odds (not priced in yet)

---

## Discord Commands

### `/wdyt` - Get Current Status

Type `/wdyt` in Discord anytime to get:
- Current ETH price & move from hour open
- Current BTC price & move
- Polymarket odds (UP/DOWN)
- Odds velocity (how fast odds are changing)
- Premium index & bounce risk
- Time until entry window
- Current recommendation (if in window)
- Active position info (if any)

**Example Response:**
```
📊 ETH Hourly Status

💰 ETH Price: $2,450.50
📈 ETH Move: +$18.42
₿ BTC Move: +$245.00

⏱️ Current Minute: 35
🎯 Entry Window: ⏳ In 5 min
⏰ Hour Ends: 25 min

📊 UP Odds: 62.0%
📊 DOWN Odds: 38.0%

⚡ Odds Velocity: ➡️ STABLE (0.5%/min)

💹 Premium Index: +0.032%
🎢 Bounce Risk: ✅ LOW
```

---

## How to Read the Alerts

### Alert Structure

```
ETH HOURLY | UP +$18.42 | BUY (HIGH)

Checklist:
 Move $12+        ✅  (+$18.42)
 Entry Window     ✅  (Minute 45)
 BTC Confirms     ✅  (+$245)
 Odds < 75%       ✅  (62%)
 Good Hour        ✅  (2 PM ET)
 Low Bounce Risk  ✅  (+0.032%)

Odds Velocity:
 ➡️ STABLE (0.5%/min)

Premium Analysis (Real-time):
 Neutral premium - no crowding
 Bounce Risk: LOW

Recommendation: BUY
```

### The 6-Point Checklist

| Check | What It Means | Pass Condition |
|-------|---------------|----------------|
| **Move $12+** | ETH moved enough to signal conviction | \|move\| >= $12 |
| **Entry Window** | We're in the optimal timing window | Minutes 40-52 |
| **BTC Confirms** | Bitcoin moving same direction | BTC move matches ETH direction, $150+ |
| **Odds < 75%** | Market hasn't fully priced in the move | Polymarket odds < 75% |
| **Good Hour** | Avoid low-liquidity hours | NOT 3-5 AM ET |
| **Low Bounce Risk** | Premium shows trade isn't crowded | See premium section below |

### Recommendation Meanings

| Signal | Checks Passed | What To Do |
|--------|---------------|------------|
| **BUY** | 4-6 of 6 | Strong signal - enter position |
| **SMALL BET** | 3 of 6, or rapid odds | Weak signal - reduced size only |
| **SKIP** | <3 or critical fail | Do not enter |
| **WAIT** | Move too small or outside window | Not enough data yet |

### Critical Fails (Auto-SKIP)

These conditions override the checklist and force SKIP:
- **Odds > 75%** - Too late, move already priced in
- **Skip Hours (3-5 AM ET)** - Low liquidity, unreliable
- **HIGH Bounce Risk** - Premium shows crowded trade
- **RAPID_RISE Odds Velocity** - Move being priced in too fast

---

## Odds Velocity

Odds velocity measures how fast Polymarket odds are changing. This helps detect when a move is being "priced in" before you can enter.

### Velocity Status Levels

| Status | Meaning | Impact on Recommendation |
|--------|---------|--------------------------|
| **RAPID_RISE** 🚀 | Odds rising >2%/min | Downgrade to SMALL BET or SKIP |
| **RISING** 📈 | Odds rising 1-2%/min | Caution - monitor closely |
| **STABLE** ➡️ | Odds moving <1%/min | Normal - proceed with checklist |
| **FALLING** 📉 | Odds falling >1%/min | Favorable - odds improving |

### Why It Matters

If odds are rising rapidly:
- The market is pricing in the move before you
- By the time you enter, you may be paying too much
- Even if other checks pass, the opportunity may be gone

---

## Exit Alerts

The bot monitors your position after entry and sends alerts when conditions change.

### Alert Types

| Alert | Trigger | What It Means |
|-------|---------|---------------|
| **⚠️ PRICE REVERSAL** | ETH reverses $15+ | Price moving against your position |
| **⚠️ BTC REVERSAL** | BTC reverses $200+ | Bitcoin no longer confirms direction |
| **🔴 BOUNCE RISK INCREASED** | Premium flips LOW→HIGH | Trade becoming crowded mid-position |
| **💰 TAKE PROFIT** | Odds drop below 50% | Good profit opportunity |
| **🛑 STOP LOSS** | Odds spike above 85% | Position at significant risk |

### How It Works

1. When a BUY or SMALL BET alert is sent, the bot registers your entry
2. It continuously monitors price, BTC, and premium
3. When exit conditions trigger, you get an alert
4. Position is automatically cleared at the end of the hour

---

## Premium Index - Bounce Risk Indicator (Real-Time)

The premium index tells you **how crowded the current trade is RIGHT NOW**. Unlike funding rate (which updates every 8 hours), premium updates every second.

### What Is Premium?

```
Premium = (Futures Price - Spot Price) / Spot Price

Positive premium → Futures > Spot → Longs crowded (paying premium to be long)
Negative premium → Futures < Spot → Shorts crowded (paying premium to be short)
```

### Why It Predicts Bounces

When one side is crowded:
- They're paying a premium to hold their position
- Any small move against them triggers panic closing
- This causes the bounce

### Reading the Signal

**When buying UP:**
| Premium | Meaning | Bounce Risk |
|---------|---------|-------------|
| > +0.15% | Perp way above spot - longs crowded | **HIGH** |
| > +0.08% | Perp above spot - some crowding | **MEDIUM** |
| < +0.08% | Neutral or negative | **LOW** |

**When buying DOWN:**
| Premium | Meaning | Bounce Risk |
|---------|---------|-------------|
| < -0.15% | Perp way below spot - shorts crowded | **HIGH** |
| < -0.08% | Perp below spot - some crowding | **MEDIUM** |
| > -0.08% | Neutral or positive | **LOW** |

---

## Performance Logging

Every signal is logged to `logs/signals.jsonl` for historical analysis.

### Log Format

Each line is a JSON object:
```json
{
  "timestamp": "2024-01-15T14:40:00.000Z",
  "hour": "2024-01-15T14:00:00.000Z",
  "ethPrice": 2450.50,
  "ethMove": 18.42,
  "btcPrice": 43500,
  "btcMove": 180,
  "upOdds": 0.62,
  "downOdds": 0.38,
  "currentOdds": 0.62,
  "oddsVelocity": 0.8,
  "oddsVelocityStatus": "STABLE",
  "premium": 0.032,
  "bounceRisk": "LOW",
  "liquidations": 12000000,
  "recommendation": "BUY",
  "checksCount": 5,
  "direction": "UP",
  "minute": 42
}
```

### Analyzing Logs

You can analyze with Python:
```python
import pandas as pd
import json

# Read JSONL file
signals = []
with open('logs/signals.jsonl', 'r') as f:
    for line in f:
        signals.append(json.loads(line))

df = pd.DataFrame(signals)

# Stats
print(f"Total signals: {len(df)}")
print(f"BUY signals: {len(df[df.recommendation == 'BUY'])}")
print(f"SKIP signals: {len(df[df.recommendation == 'SKIP'])}")
```

---

## Configuration

All parameters are in `src/config.js`:

```javascript
ETH_HOURLY: {
  // Thresholds
  MOVE_THRESHOLD_USD: 12,        // Minimum move to trigger alert
  BTC_CONFIRM_THRESHOLD: 150,    // BTC must move $150+ to confirm

  // Premium Index (real-time bounce risk)
  PREMIUM_HIGH_THRESHOLD: 0.15,  // >0.15% = HIGH bounce risk
  PREMIUM_MEDIUM_THRESHOLD: 0.08, // >0.08% = MEDIUM bounce risk

  // Odds Velocity
  ODDS_VELOCITY_RAPID: 0.02,     // >2%/min = RAPID_RISE
  ODDS_VELOCITY_RISING: 0.01,    // >1%/min = RISING

  // Exit Thresholds
  EXIT_BTC_REVERSAL_USD: 200,    // Alert if BTC reverses $200+
  EXIT_PRICE_REVERSAL_USD: 15,   // Alert if ETH reverses $15
  EXIT_TAKE_PROFIT_ODDS: 0.50,   // Alert if odds < 50%
  EXIT_STOP_LOSS_ODDS: 0.85,     // Alert if odds > 85%

  // Timing
  ENTRY_WINDOW_START: 40,        // Start alerting at minute 40
  ENTRY_WINDOW_END: 52,          // Stop at minute 52
  SKIP_HOURS_ET: [3, 4, 5],      // Skip 3-5 AM Eastern

  // Odds
  MAX_ODDS_FOR_BUY: 0.75,        // Skip if odds > 75%
  GOOD_ODDS: 0.65,               // Great entry if < 65%
}
```

---

## Environment Variables

```bash
# Discord Webhooks (for automatic alerts)
DISCORD_WEBHOOK_ETH_HOURLY=https://discord.com/api/webhooks/...

# Discord Bot (for /wdyt command)
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_here

# Optional
ACTIVE_STRATEGIES=ETH_HOURLY   # or ALL
PORT=8080                       # Health check port
```

### Getting Discord Credentials

1. **Webhook URL**: Server Settings → Integrations → Webhooks → New Webhook
2. **Bot Token**: Discord Developer Portal → Create Application → Bot → Token
3. **Guild ID**: Enable Developer Mode → Right-click server → Copy Server ID

---

## Data Sources

| Data | Source | Update Freq | Purpose |
|------|--------|-------------|---------|
| ETH/BTC Price | Binance WebSocket | Real-time | Price tracking |
| Hourly Open | Binance REST API | Every 60s | Calculate move |
| Premium Index | Binance Futures API | Real-time (5s cache) | Bounce risk |
| Market Odds | Polymarket Gamma API | On-demand | Check if priced in |

---

## File Structure

```
window-licker-bot/
├── index.js                  # Entry point
├── logs/
│   └── signals.jsonl         # Performance log (auto-created)
├── src/
│   ├── config.js             # All parameters
│   ├── strategies/
│   │   └── eth-hourly.js     # Main strategy logic
│   └── services/
│       ├── binance.js        # Price feed + premium index
│       ├── discord.js        # Webhooks + /wdyt bot
│       ├── polymarket.js     # Odds fetching + velocity
│       ├── coinglass.js      # Liquidation proxy (secondary)
│       ├── logger.js         # Performance logging
│       └── position-monitor.js # Exit alerts
└── .env                      # Your config (not committed)
```

---

## Troubleshooting

**No alerts appearing:**
- Check Discord webhook URL is correct
- Verify bot is running (`npm start`)
- Wait for minute 40+ with $12+ move

**`/wdyt` command not working:**
- Check `DISCORD_BOT_TOKEN` in .env
- Check `DISCORD_GUILD_ID` in .env
- Ensure bot is invited to your server with slash command permissions

**Polymarket odds showing N/A:**
- Market may not exist yet for current hour
- API rate limiting - wait and retry

**Premium showing 0:**
- Binance Futures API may be temporarily unavailable
- Check internet connection

**Logs not being created:**
- Check `logs/` directory exists
- Check write permissions

---

## License

Personal use only.
