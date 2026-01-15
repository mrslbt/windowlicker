const http = require('http');
const CONFIG = require('./src/config');
const binanceService = require('./src/services/binance');

const ethHourlyStrategy = require('./src/strategies/eth-hourly');

async function main() {
  console.log('Starting Windowlicker Bot (ETH Hourly)...');
  console.log(`Strategies: ETH_HOURLY`);

  // Connect Shared Services
  binanceService.connect();

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
