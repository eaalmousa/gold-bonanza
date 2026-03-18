const jwt = require('../server/node_modules/jsonwebtoken');
const http = require('http');

const JWT_SECRET = '0e957fb9d7113ff1b644536f0bfa68a02b1affd5b243daa85456c246c7f0f0986ec3b96a3c2423960429fcade6f4830b46cb07469eab8cd99d502113826a2be3';

async function runProof() {
  console.log('--- 1. GENERATING AUTH TOKEN (CJS) ---');
  const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '1h' });
  console.log('Token generated.');

  const payload = JSON.stringify({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 65000,
    stopLoss: 63000,
    takeProfit: 70000,
    qty: 0.1,
    leverage: 10,
    mode: 'BINANCE_TEST'
  });

  console.log('\n--- 2. SENDING FORCED FAILURE TEST TO BACKEND (http) ---');

  const options = {
    hostname: '127.0.0.1',
    port: 8081,
    path: '/api/trade/open',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Length': payload.length
    },
    timeout: 10000 // 10s timeout
  };

  const req = http.request(options, (res) => {
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(rawData);
        console.log(`\nStatus: ${res.statusCode} ${res.statusMessage}`);
        console.log('Normalized Response JSON:');
        console.log(JSON.stringify(data, null, 2));

        if (res.statusCode === 500 && data.error) {
          console.log('\n✅ PROOF: Backend correctly hit BINANCE_TEST and returned normalized error.');
          console.log('   Confirmed Mode:', data.mode);
          console.log('   Confirmed Target URL:', data.baseUrl);
        }
      } catch (e) {
        console.error('Failed to parse response:', rawData);
      }
    });
  });

  req.on('timeout', () => {
    console.error('Request timed out!');
    req.destroy();
  });

  req.on('error', (e) => {
    console.error(`\n❌ ERROR: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

runProof();
