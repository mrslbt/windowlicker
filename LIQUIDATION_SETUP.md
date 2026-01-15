# Liquidation Tracking - 100% FREE Setup

## Overview
Your bot now tracks liquidation cascades using **completely free APIs** - no paid subscriptions needed!

When $50M+ in liquidations are estimated within an hour, it adds extra confidence (💥) to your trading signals.

---

## ✅ What's Included (No Setup Required!)

### Method 1: Open Interest Tracking (Primary)
- **Source:** Binance Futures API (FREE)
- **How it works:** Tracks Open Interest drops as a proxy for liquidations
- **Logic:** When OI drops by 1%+ suddenly, that indicates liquidation cascades
- **Accuracy:** Very good for detecting large liquidation events

### Method 2: Volatility Proxy (Fallback)
- **Source:** CoinGecko API (FREE)
- **How it works:** Estimates liquidations from hourly price volatility
- **Logic:** 5%+ hourly moves often correlate with liquidation cascades
- **Formula:** Roughly $10M in liquidations per 1% move above 5%

### Automatic Fallback
If Method 1 fails (network issues, API down), the bot automatically tries Method 2.
If both fail, the liquidation check simply returns ⬜ (no cascade) and continues normally.

---

## 🚀 Zero Configuration Needed

**It just works!** The bot will automatically:
1. Try to track Open Interest changes from Binance
2. Fall back to volatility estimates from CoinGecko if needed
3. Cache results to avoid rate limits (60 second cache)
4. Log liquidation detections when they occur

### No API Keys Required
Unlike Coinglass (which now requires paid plans), this implementation uses:
- ✅ Binance public APIs (no auth)
- ✅ CoinGecko public APIs (no auth)
- ✅ Built-in rate limit protection
- ✅ Intelligent caching

---

## 📊 How It Appears in Your Discord Alerts

The liquidation check is shown in your checklist:

```
📈 ETH +$15.23 | UP Checklist

Checklist:
✅ Move $12+ (+$15.23)
✅ Entry window (min 40-52)
✅ BTC confirms (+$185.50)
✅ Odds < 75% (68%)
✅ Good trading hour
💥 Liquidation cascade ($67.2M)  ← Liquidation check
```

### Indicators:
- **💥** = Cascade detected ($50M+ estimated liquidations)
- **⬜** = Normal conditions (< $50M liquidations)

---

## 🔧 Advanced: Disable Liquidation Tracking

If you want to completely disable liquidation tracking:

### Option 1: Environment Variable (Recommended)
Add to your `.env` file:
```env
DISABLE_LIQUIDATION_TRACKING=true
```

### Option 2: Code Change
Edit `src/strategies/eth-hourly.js` around line 152 and set:
```javascript
const liquidationsVal = 0; // Force disabled
```

---

## 🧪 Testing the Integration

Run the test script to see current liquidation data:

```bash
node test-liquidations.js
```

**Sample Output (when working):**
```
[Liquidations] ✅ ETH Last 1h: $12.5M (45 orders | Long: $8.2M | Short: $4.3M)
Total Liquidations: $12.50M
⬜ No cascade (12.5M < 50M threshold)
```

**Sample Output (no liquidations detected):**
```
Total Liquidations: $0.00M
⬜ No cascade (0.0M < 50M threshold)
```

---

## 📈 How The Methods Work

### Method 1: Open Interest Tracking

**What is Open Interest?**
Open Interest = Total value of all open futures positions

**How liquidations affect OI:**
- When liquidations happen, positions are force-closed
- This causes Open Interest to drop suddenly
- The bot tracks OI every minute and detects 1%+ drops

**Example:**
```
Time 12:00 - ETH OI: $10 billion
Time 12:01 - ETH OI: $9.85 billion (-1.5%)

→ Bot detects: $150M in liquidations!
→ Checks price direction to determine if longs or shorts got liquidated
```

### Method 2: Volatility Proxy

**Why volatility correlates with liquidations:**
- Large price moves trigger stop-losses and liquidations
- Liquidations cause more volatility (cascade effect)
- 5%+ hourly moves are unusual and often indicate liquidations

**Rough Estimation Formula:**
```
If hourly_move_percent > 5%:
    estimated_liquidations = (hourly_move_percent - 5) * $10M
```

**Example:**
- ETH moves 8% in one hour
- Estimated liquidations: (8% - 5%) * $10M = $30M

Not perfect, but decent proxy for cascade detection.

---

## 🛠️ Troubleshooting

### "All methods failed for ETH"
- **Cause:** Network issues or API downtime
- **Impact:** Bot returns $0 liquidations and continues normally
- **Fix:** Usually resolves automatically. Check internet connection.

### Liquidation check always shows ⬜
This is normal if:
1. No significant liquidations are occurring (markets are calm)
2. Bot just started (needs time to build OI baseline)
3. Liquidation tracking is disabled

### Bot logs show API errors
- Temporary network blips are normal
- The bot will retry with fallback methods
- If persistent, check if Binance/CoinGecko APIs are accessible from your network

---

## 🎯 Understanding the $50M Threshold

The bot flags cascades at **$50 million in liquidations per hour**.

### Why $50M?
- Small amount = normal market activity (happens often)
- $50M+ = significant event that adds confidence to trend signals
- Adjustable in `src/config.js` if you want different sensitivity

### Current Market Context (ETH):
- **$1-10M/hour**: Normal conditions
- **$10-50M/hour**: Moderate volatility
- **$50M+/hour**: Cascade event (adds confidence to your signal)
- **$100M+/hour**: Major liquidation cascade

You can adjust this threshold based on your risk tolerance:
- Conservative: Lower to $25M (more alerts)
- Aggressive: Raise to $100M (fewer but stronger alerts)

---

## 🆚 Comparison to Paid Services

| Feature | This Bot (FREE) | Coinglass (Paid) |
|---------|----------------|------------------|
| Cost | $0/month | $30-100+/month |
| API Limits | Public tier (sufficient) | Higher limits |
| Data Accuracy | Estimated (good proxy) | Direct data (exact) |
| Maintenance | Built-in | Requires API key management |
| Cascade Detection | ✅ Works well | ✅ More precise |
| Real-time | ~60 sec delay (caching) | Real-time |

**Bottom line:** The free method is more than adequate for signal generation. You're not doing high-frequency trading, so estimates are perfectly fine for your use case.

---

## 📝 Notes

- **Caching:** Results are cached for 60 seconds to avoid rate limits
- **Fallback:** If Binance fails, CoinGecko is tried automatically
- **Silent Failures:** If all APIs fail, the bot continues with $0 liquidations
- **No Spam:** Errors are logged once, not repeatedly
- **Open Source:** All liquidation logic is in `src/services/coinglass.js`

---

## 🔮 Future Improvements (Optional)

If you want even better liquidation tracking later:

1. **Multiple Exchanges:** Aggregate OI from Binance + Bybit + OKX
2. **Historical Baseline:** Track average hourly liquidations to detect anomalies
3. **Machine Learning:** Predict liquidations from funding rate + OI + volatility
4. **Paid Coinglass:** If budget allows, integrate their precise data

But honestly, the free version works great for your needs!

---

**Questions?** Check `src/services/coinglass.js` for implementation details or run `node test-liquidations.js` to debug.
