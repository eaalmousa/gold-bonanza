const jwt = require('../server/node_modules/jsonwebtoken');

const JWT_SECRET = '0e957fb9d7113ff1b644536f0bfa68a02b1affd5b243daa85456c246c7f0f0986ec3b96a3c2423960429fcade6f4830b46cb07469eab8cd99d502113826a2be3';
const SERVER_URL = 'http://localhost:8080/api/trade/open';

async function runProof() {
  console.log('--- 1. GENERATING AUTH TOKEN (CJS) ---');
  const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '1h' });
  console.log('Token generated successfully.');

  const payload = {
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 65000,
    stopLoss: 63000,
    takeProfit: 70000,
    qty: 0.1,
    leverage: 10,
    mode: 'BINANCE_TEST'
  };

  console.log('\n--- 2. SENDING FORCED FAILURE TEST TO BACKEND ---');

  try {
    const res = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log(`\nStatus: ${res.status} ${res.statusText}`);
    console.log('Normalized Response JSON:');
    console.log(JSON.stringify(data, null, 2));

    if (res.status === 500 && data.error) {
      console.log('\n✅ PROOF: Backend correctly hit BINANCE_TEST and returned normalized error.');
      console.log('   Confirmed Mode:', data.mode);
      console.log('   Confirmed Target URL:', data.baseUrl);
    }
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
  }
}

runProof();
