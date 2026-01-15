const http = require('http');
const CONFIG = require('./src/config');
const binanceService = require('./src/services/binance');
const windowLickerStrategy = require('./src/strategies/window-licker');
const ethHourlyStrategy = require('./src/strategies/eth-hourly');

async function main() {
  console.log('Starting Bot...');
  console.log(`Strategies: ${CONFIG.ACTIVE_STRATEGIES.join(', ')}`);

  // Connect Shared Services
  binanceService.connect();

  // Start Active Strategies
  if (CONFIG.ACTIVE_STRATEGIES.includes('ALL') || CONFIG.ACTIVE_STRATEGIES.includes('WINDOW_LICKER')) {
    windowLickerStrategy.start();
  }

  if (CONFIG.ACTIVE_STRATEGIES.includes('ALL') || CONFIG.ACTIVE_STRATEGIES.includes('ETH_HOURLY')) {
    ethHourlyStrategy.start();
  }

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
