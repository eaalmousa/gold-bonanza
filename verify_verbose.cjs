require('dotenv').config({ path: './server/.env' });

async function verify() {
  try {
    console.log('--- BINANCE CONNECTION VERIFICATION ---');
    
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
    
    console.log('Fetching from:', url);
    const res = await fetch(url, {
        headers: { 'X-MBX-APIKEY': API_KEY }
    });
    
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Data:', JSON.stringify(data));

    if (!res.ok) throw new Error(JSON.stringify(data));
    
    const usdt = data.find(a => a.asset === 'USDT');
    if (usdt) {
        console.log(`✅ SUCCESS! Connection established.`);
        console.log(`Current Testnet Balance: $${parseFloat(usdt.balance).toFixed(2)} USDT`);
    } else {
        console.log('❌ USDT asset not found in balance list.');
    }
    console.log('----------------------------------------');
  } catch (err) {
    console.error('❌ CONNECTION FAILED:');
    console.error(err.message);
  }
}

verify();
