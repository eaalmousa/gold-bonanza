const jwt = require('../server/node_modules/jsonwebtoken');
const http = require('http');

const JWT_SECRET = '0e957fb9d7113ff1b644536f0bfa68a02b1affd5b243daa85456c246c7f0f0986ec3b96a3c2423960429fcade6f4830b46cb07469eab8cd99d502113826a2be3';

async function runProof() {
  console.log('--- E2E SUCCESS PROOF: BINANCE_TEST ---');
  const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '1h' });

  // Use a standard testnet pair and small qty
  const payload = JSON.stringify({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 65000,
    stopLoss: 60000,
    takeProfit: 75000,
    qty: 0.001,
    leverage: 10,
    mode: 'BINANCE_TEST'
  });

  console.log('\n--- 1. SENDING FRONTEND PAYLOAD ---');
  console.log(payload);

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
    timeout: 30000 // Binance can be slow responding
  };

  const req = http.request(options, (res) => {
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(rawData);
        console.log(`\n--- 2. BACKEND RESPONSE (Status: ${res.statusCode}) ---`);
        console.log(`   Resolved Mode: ${data.mode}`);
        console.log(`   Resolved BaseUrl: ${data.baseUrl}`);
        console.log('\n--- 3. NORMALIZED SUCCESS RESPONSE ---');
        console.log(JSON.stringify(data, null, 2));

        if (data.success && data.orderId) {
          console.log('\n✅ PROOF: Full E2E Success through BINANCE_TEST.');
        } else {
          console.log('\n❌ PROOF: Submission failed.');
        }
      } catch (e) {
        console.error('Failed to parse:', rawData);
      }
    });
  });

  req.on('error', (e) => console.error(`❌ ERROR: ${e.message}`));
  req.write(payload);
  req.end();
}

runProof();
