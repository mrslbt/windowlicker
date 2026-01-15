#!/usr/bin/env node
/**
 * Test script to verify Coinglass liquidation data is working
 */

require('dotenv').config();
const coinglassService = require('./src/services/coinglass');

async function testLiquidations() {
    console.log('Testing Coinglass Liquidation API...\n');

    console.log('Fetching ETH liquidations (last 1 hour)...');
    const ethLiq = await coinglassService.getLiquidations('ETH');

    console.log('\n=== RESULTS ===');
    console.log('Total Liquidations:', `$${(ethLiq.totalVolUsd / 1e6).toFixed(2)}M`);
    console.log('Long Liquidations (sell pressure):', `$${(ethLiq.sellVolUsd / 1e6).toFixed(2)}M`);
    console.log('Short Liquidations (buy pressure):', `$${(ethLiq.buyVolUsd / 1e6).toFixed(2)}M`);

    if (ethLiq.direction) {
        console.log('Liquidation Direction:', ethLiq.direction === 'long' ? 'More LONGS liquidated' : 'More SHORTS liquidated');
    }

    console.log('\n=== CHECKLIST CHECK ===');
    const threshold = 50000000; // $50M
    if (ethLiq.totalVolUsd >= threshold) {
        console.log(`💥 LIQUIDATION CASCADE DETECTED! (${(ethLiq.totalVolUsd / 1e6).toFixed(1)}M >= ${threshold / 1e6}M)`);
    } else {
        console.log(`⬜ No cascade (${(ethLiq.totalVolUsd / 1e6).toFixed(1)}M < ${threshold / 1e6}M)`);
    }

    console.log('\nTest complete!');
}

testLiquidations().catch(console.error);
