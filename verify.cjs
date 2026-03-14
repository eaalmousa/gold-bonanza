require('dotenv').config({ path: './server/.env' });
const { getBalance } = require('./server/lib/binance.ts');

async function verify() {
  try {
    console.log('--- BINANCE CONNECTION VERIFICATION ---');
    // We need to bypass the TS compilation for this quick check if possible
    // or just use the compiled logic if backend is running.
    // Instead, let's just use the fetch directly here to be absolute.
    
    const API_KEY = process.env.BINANCE_API_KEY;
    const API_SECRET = process.env.BINANCE_API_SECRET;
    
    if (!API_KEY || !API_SECRET) {
        throw new Error('Keys missing in .env');
    }

    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const crypto = require('crypto');
    const signature = crypto.createHmac('sha256', API_SECRET).update(query).digest('hex');
    
    const url = `https://testnet.binancefuture.com/fapi/v2/balance?${query}&signature=${signature}`;
    
    const res = await fetch(url, {
        headers: { 'X-MBX-APIKEY': API_KEY }
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    
    const usdt = data.find(a => a.asset === 'USDT');
    console.log(`✅ SUCCESS! Connection established.`);
    console.log(`Current Testnet Balance: $${parseFloat(usdt.balance).toFixed(2)} USDT`);
    console.log('----------------------------------------');
  } catch (err) {
    console.error('❌ CONNECTION FAILED:');
    console.error(err.message);
  }
}

verify();
