import 'dotenv/config';
import crypto from 'crypto';

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

async function checkKeys() {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = crypto.createHmac('sha256', API_SECRET).update(query).digest('hex');
  const urlParams = `${query}&signature=${signature}`;

  const endpoints = [
    { name: 'TESTNET', url: 'https://testnet.binancefuture.com/fapi/v1/account?' + urlParams },
    { name: 'LIVE',    url: 'https://fapi.binance.com/fapi/v1/account?' + urlParams },
  ];

  console.log(`Checking keys ending in ...${API_KEY.slice(-4)}`);

  for (const e of endpoints) {
    try {
      const res = await fetch(e.url, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': API_KEY }
      });
      const data = await res.json();
      console.log(`${e.name}: Status ${res.status}. Error: ${data.msg || 'None'}`);
    } catch (err) {
      console.error(`${e.name}: Fetch Error: ${err.message}`);
    }
  }
}

checkKeys();
