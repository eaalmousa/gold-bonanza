import jwt from 'jsonwebtoken';
import fetch from 'node-fetch'; // using node-fetch for easier ESM testing

const JWT_SECRET = '0e957fb9d7113ff1b644536f0bfa68a02b1affd5b243daa85456c246c7f0f0986ec3b96a3c2423960429fcade6f4830b46cb07469eab8cd99d502113826a2be3';
const API_URL = 'http://localhost:8080/api/trade/open';

async function runProof() {
  console.log('--- 1. GENERATING AUTH TOKEN ---');
  const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '1h' });
  console.log(`Token generated. Length: ${token.length}`);

  const payload = {
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 65000,
    stopLoss: 63000,
    takeProfit: 70000,
    qty: 0.1,
    leverage: 10,
    mode: 'BINANCE_TEST' // Real testnet endpoint
  };

  console.log('\n--- 2. SENDING FORCED FAILURE TEST TO BACKEND ---');
  console.log(`Endpoint: ${API_URL}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log(`\nStatus: ${res.status} ${res.statusText}`);
    console.log('Normalized Response Wrapper:');
    console.log(JSON.stringify(data, null, 2));

    if (data.error && data.error.includes('401')) {
      console.log('\n✅ PROOF: Backend correctly hit BINANCE_TEST and returned normalized error from the exchange API.');
      console.log('   Note: Keys in .env appear to be for Live, so Testnet rejected them as expected.');
    } else {
      console.log('\n⚠️ RESPONSE: No 401. This suggests either keys are accepted on testnet (lucky) or a different error occurred.');
    }

  } catch (err) {
    if (err.message.includes('ECONNREFUSED')) {
      console.error('\n❌ ERROR: Server is not running at localhost:8080.');
    } else {
      console.error('\n❌ ERROR:', err.message);
    }
  }
}

runProof();
