# Liquidation Data Setup Guide

## Overview
The bot tracks liquidation cascades to improve signal quality. When $50M+ in liquidations occur within an hour, it adds extra confidence to the trading signal.

## Current Status
✅ Liquidation tracking is now **fully implemented**
⚠️ Requires a Coinglass API key to function

---

## How to Enable Liquidation Data

### Step 1: Get a Coinglass API Key

1. Visit: **https://www.coinglass.com/pricing**
2. Sign up for a free account
3. Choose a plan:
   - **Free Tier**: Usually includes basic liquidation data
   - **Pro Tier**: Higher rate limits and more features
4. Navigate to your API settings and copy your API key

### Step 2: Add API Key to Your Bot

1. Create a `.env` file in the project root (if you don't have one):
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and add your Coinglass API key:
   ```env
   COINGLASS_API_KEY=your_actual_api_key_here
   ```

3. Save the file

### Step 3: Test the Integration

Run the test script to verify it's working:

```bash
node test-liquidations.js
```

**Expected output when working:**
```
[Coinglass] ✅ ETH Liquidations: $12.5M (Long: $8.2M, Short: $4.3M)
💥 LIQUIDATION CASCADE DETECTED! (12.5M >= 50M)
```

**Output without API key:**
```
[Coinglass] ⚠️  No API key provided. Liquidation data will be disabled.
[Coinglass] Get a free API key at: https://www.coinglass.com/pricing
```

---

## How It Works in Your Bot

Once configured, the liquidation check works automatically:

### In Discord Alerts

The checklist will show:
- **💥** - Liquidation cascade detected ($50M+ liquidations)
- **⬜** - Normal liquidation levels (< $50M)

### Example Alert

```
📈 ETH +$15.23 | UP Checklist

Checklist:
✅ Move $12+ (+$15.23)
✅ Entry window (min 40-52)
✅ BTC confirms (+$185.50)
✅ Odds < 75% (68%)
✅ Good trading hour
💥 Liquidation cascade ($67.2M)  ← This is the liquidation check!
```

### Signal Weighting

The bot counts passing checks:
- **5-6 checks pass** = HIGH confidence BUY signal
- **4 checks pass** = MEDIUM confidence BUY signal
- **3 checks pass** = LOW confidence (small bet)
- **< 3 checks pass** = SKIP

The liquidation check is one of these 6 validation criteria.

---

## Troubleshooting

### "Authentication failed (403)"
- Your API key is invalid or expired
- Solution: Regenerate key from Coinglass dashboard

### "Rate limit exceeded (429)"
- You've hit your API quota
- Solution: Upgrade your Coinglass plan or wait for reset

### "All endpoints failed"
- Network issues or Coinglass API is down
- The bot will gracefully fallback and continue working (liquidation check = ⬜)

---

## What If I Don't Want Liquidation Data?

No problem! The bot works fine without it:

1. **Don't add a Coinglass API key** - the liquidation check will always return ⬜ (no cascade)
2. The bot will only show a warning once when starting, then run silently
3. Your signals will still work, but you'll have **5 checks instead of 6**

This means HIGH confidence requires 4+ other checks to pass instead of 5.

---

## Cost

**Free tier** should be sufficient for this bot because:
- We only check liquidations when an alert is triggered (not constantly)
- Typically 5-15 API calls per day
- Free tier usually allows 100-1000 calls/day

**Estimated cost:** $0/month with free tier

---

## Alternative: Disable Liquidation Check Completely

If you want to remove liquidation checking entirely:

1. Open `src/strategies/eth-hourly.js`
2. Find line ~152: `const liquidationsVal = liquidations.totalVolUsd || 0;`
3. Change to: `const liquidationsVal = 0; // Disabled`
4. Find line ~171 and remove the liquidation line from the checklist

This removes it from your signal calculations completely.

---

## Questions?

- Coinglass docs: https://www.coinglass.com/api-doc
- Check bot logs for detailed error messages
- Run `node test-liquidations.js` to debug issues
