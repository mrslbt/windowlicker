const http = require('http');
const CONFIG = require('./src/config');
const binanceService = require('./src/services/binance');
const discordService = require('./src/services/discord');

const ethHourlyStrategy = require('./src/strategies/eth-hourly');

async function main() {
  console.log('Starting Windowlicker Bot (ETH Hourly)...');
  console.log(`Strategies: ETH_HOURLY`);
  console.log(`Discord Bot Token exists: ${!!CONFIG.DISCORD.BOT_TOKEN}`);
  console.log(`Discord Guild ID: ${CONFIG.DISCORD.GUILD_ID}`);

  // Connect Shared Services
  binanceService.connect();

  // Initialize Discord Bot (for /wdyt command)
  console.log('Initializing Discord bot...');
  try {
    await discordService.initBot();
    console.log('Discord bot initialization completed');
  } catch (error) {
    console.error('Discord bot initialization FAILED:', error);
  }

  // Start Strategy
  ethHourlyStrategy.start();

  // Health Check Server
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200);
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(CONFIG.PORT, () => {
    console.log(`Health check running on port ${CONFIG.PORT}`);
  });
}

main().catch(console.error);
