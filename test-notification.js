const CONFIG = require('./src/config');
const discordService = require('./src/services/discord');
// Mock the process to prevent exit
process.on('unhandledRejection', console.error);

async function runTest() {
    console.log('Sending Test Scorecard Alert...');

    // Mock Data for a "STRONG BUY"
    const scoreData = {
        score: 85,
        strength: '🔥 EXTREME',
        recommendation: 'BUY',
        color: 0x00ff00, // Green
        breakout: true,
        breakdown: [
            { label: 'Breakout (>1.0 ATR)', pts: 30 },
            { label: 'High Volume (1.5x)', pts: 25 },
            { label: 'BTC Confirm', pts: 20 },
            { label: 'Low Bounce Risk', pts: 10 }
        ],
        atrRatio: 2.1
    };

    const ethMove = 22.50;
    const currentPrice = 3350.00;
    const minutes = 45;

    // Visual Score Bar
    const bars = Math.round(scoreData.score / 10);
    const filled = '🟩'.repeat(bars);
    const empty = '⬜'.repeat(10 - bars);
    const progressBar = `${filled}${empty}`;

    const embed = discordService.createEmbed(
        `📈 ${scoreData.recommendation} | ETH +$${ethMove.toFixed(2)}`,
        `**${scoreData.strength}**\n` +
        `\`${progressBar}\` **${scoreData.score}/100**\n\n` +

        `**🔎 Why?**\n` +
        scoreData.breakdown.map(b => `> ${b.label} \`+${b.pts}\``).join('\n') + '\n\n' +

        `**📊 Context**\n` +
        `• **Flow**: $${Math.abs(ethMove).toFixed(2)} (${scoreData.atrRatio}x ATR)\n` +
        `• **Vol**: 1.8x Avg\n` +
        `• **BTC**: ✅ (Yes) +$150.00\n` +
        `• **Risk**: 🟢 (Low)\n` +
        `• **Time**: ${60 - minutes}m left`,
        scoreData.color
    );

    // Send to ETH_HOURLY webhook
    await discordService.sendAlert(
        CONFIG.DISCORD.ETH_HOURLY_WEBHOOK,
        `**TEST ALERT** | ${scoreData.recommendation} (Score: ${scoreData.score}) | ETH $${currentPrice.toFixed(2)}`,
        embed
    );

    console.log('Test Alert Sent!');
}

runTest().catch(console.error);
