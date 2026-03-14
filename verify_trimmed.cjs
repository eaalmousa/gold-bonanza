require('dotenv').config({ path: './server/.env' });

async function verify() {
  try {
    console.log('--- BINANCE CONNECTION VERIFICATION (TRIMMED) ---');
    
    // Trim keys to remove any invisible characters
    const API_KEY = process.env.BINANCE_API_KEY.trim();
    const API_SECRET = process.env.BINANCE_API_SECRET.trim();
    
    console.log('Key length:', API_KEY.length);
    console.log('Secret length:', API_SECRET.length);

    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const crypto = require('crypto');
    const signature = crypto.createHmac('sha256', API_SECRET).update(query).digest('hex');
    
    const url = `https://testnet.binancefuture.com/fapi/v2/balance?${query}&signature=${signature}`;
    
    const res = await fetch(url, {
        headers: { 'X-MBX-APIKEY': API_KEY }
    });
    
    const data = await res.json();
    if (!res.ok) {
        console.log('Status:', res.status);
        console.log('Response:', JSON.stringify(data));
        throw new Error(JSON.stringify(data));
    }
    
    const usdt = data.find(a => a.asset === 'USDT');
    if (usdt) {
        console.log(`✅ SUCCESS! Connection established.`);
        console.log(`Current Testnet Balance: $${parseFloat(usdt.balance).toFixed(2)} USDT`);
    } else {
        console.log('❌ USDT asset not found.');
    }
  } catch (err) {
    console.error('❌ CONNECTION FAILED:');
    console.error(err.message);
  }
}

verify();
