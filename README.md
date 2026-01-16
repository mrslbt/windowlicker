# Window Licker Bot - ETH Hourly Strategy

A trading signal bot for Polymarket ETH hourly markets. Monitors price movements and sends Discord alerts with buy/skip recommendations during the optimal entry window.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Discord webhook URLs

# 3. Run the bot
npm start
```

---

## How It Works

### The Strategy

The bot targets **Polymarket ETH hourly markets** (ETH up or down by end of hour).

**Core Logic:**
- Only alerts during minutes **40-52** of each hour (last 20 minutes)
- Requires ETH to move **$12+** from the hourly open price
- Runs a 6-point checklist to determine BUY / SKIP / SMALL BET
- Uses **premium index** (real-time) to assess bounce risk before entry

### Why Last 20 Minutes?

- Early in the hour = too much time for reversals
- Last 20 minutes = momentum is established, less time for reversal
- Before minute 52 = still get decent odds (not priced in yet)

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
| **BUY (HIGH)** | 5-6 of 6 | Strong signal - full position |
| **BUY (MEDIUM)** | 4 of 6 | Decent signal - standard position |
| **SMALL BET** | 3 of 6 | Weak signal - reduced size only |
| **SKIP** | <3 or critical fail | Do not enter |
| **WAIT** | Move too small or outside window | Not enough data yet |

### Critical Fails (Auto-SKIP)

These conditions override the checklist and force SKIP:
- **Odds > 75%** - Too late, move already priced in
- **Skip Hours (3-5 AM ET)** - Low liquidity, unreliable
- **HIGH Bounce Risk** - Premium shows crowded trade

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

### Examples

```
Scenario: ETH down $12, considering buying DOWN

Premium: -0.18% (very negative)
→ Futures trading below spot
→ Shorts are crowded
→ If price ticks up, shorts panic cover
→ Bounce likely
→ SKIP or SMALL BET
```

```
Scenario: ETH down $12, considering buying DOWN

Premium: +0.05% (positive)
→ Futures trading above spot
→ Longs still bagholding
→ More room for downside
→ BUY with confidence
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

  // Timing
  ENTRY_WINDOW_START: 40,        // Start alerting at minute 40
  ENTRY_WINDOW_END: 52,          // Stop at minute 52
  SKIP_HOURS_ET: [3, 4, 5],      // Skip 3-5 AM Eastern

  // Odds
  MAX_ODDS_FOR_BUY: 0.75,        // Skip if odds > 75%
  GOOD_ODDS: 0.65,               // Great entry if < 65%

  // Alert Frequency
  PRICE_ALERT_THRESHOLD_USD: 10, // Price alert on $10+ move (any time)
  REALERT_INCREMENT_USD: 6,      // Re-alert every $6 additional
}
```

---

## Data Sources

| Data | Source | Update Freq | Purpose |
|------|--------|-------------|---------|
| ETH/BTC Price | Binance WebSocket | Real-time | Price tracking |
| Hourly Open | Binance REST API | Every 60s | Calculate move |
| Premium Index | Binance Futures API | Real-time (5s cache) | Bounce risk |
| Market Odds | Polymarket Gamma API | On-demand | Check if priced in |

---

## Environment Variables

```bash
# Discord Webhooks
DISCORD_WEBHOOK_ETH_HOURLY=https://discord.com/api/webhooks/...

# Optional
ACTIVE_STRATEGIES=ETH_HOURLY   # or ALL
PORT=8080                       # Health check port
```

---

## Interpreting Signals - Decision Framework

### When to BUY

```
Good Setup:
- ETH up $15+ from open
- Minute 42-48 (sweet spot)
- BTC also up $200+
- Polymarket UP odds at 58-68%
- Premium neutral or slightly negative
- Bounce Risk: LOW

= HIGH confidence BUY
```

### When to SKIP

```
Bad Setup:
- ETH up $14 but BTC flat/down
- Polymarket odds already at 78%
- It's 4 AM ET
- Premium +0.20% (longs very crowded)
- Bounce Risk: HIGH

= SKIP (momentum not confirmed, crowded trade)
```

### When to SMALL BET

```
Mixed Setup:
- ETH up $13
- BTC confirms (+$180)
- But odds at 71% (getting pricey)
- Premium +0.10% (somewhat crowded)
- Bounce Risk: MEDIUM

= SMALL BET (some confirmation but bounce possible)
```

---

## Alert Types

### 1. Price Alerts (Any Time)
Simple notifications when ETH moves $10+ from hourly open. No recommendation - just awareness.

### 2. Strategy Alerts (Minutes 40-52 Only)
Full checklist with BUY/SKIP/SMALL BET recommendation. Includes real-time premium analysis and bounce risk assessment.

---

## Potential Improvements (Future)

1. **Odds Velocity** - Track if odds are rising or falling, not just the level
2. **Weighted Scoring** - Some checks are more predictive than others
3. **Position Sizing** - Calculate bet size based on confidence level
4. **Historical Win Rate** - Track which setups actually win

---

## Troubleshooting

**No alerts appearing:**
- Check Discord webhook URL is correct
- Verify bot is running (`npm start`)
- Wait for minute 40+ with $12+ move

**Polymarket odds showing N/A:**
- Market may not exist yet for current hour
- API rate limiting - wait and retry

**Premium showing 0:**
- Binance Futures API may be temporarily unavailable
- Check internet connection

---

## File Structure

```
window-licker-bot/
├── index.js              # Entry point
├── src/
│   ├── config.js         # All parameters
│   ├── strategies/
│   │   └── eth-hourly.js # Main strategy logic
│   └── services/
│       ├── binance.js    # Price feed + premium index
│       ├── discord.js    # Notifications
│       ├── polymarket.js # Odds fetching
│       └── coinglass.js  # Liquidation proxy (secondary)
└── .env                  # Your config (not committed)
```

---

## License

Personal use only.
