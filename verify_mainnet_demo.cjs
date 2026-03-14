require('dotenv').config({ path: './server/.env' });
const crypto = require('crypto');

async function test(label, urlBase) {
    console.log(`\n--- TESTING: ${label} ---`);
    const key = process.env.BINANCE_API_KEY.trim();
    const secret = process.env.BINANCE_API_SECRET.trim();
    
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
    
    const fullUrl = `${urlBase}/fapi/v2/balance?${query}&signature=${signature}`;
    console.log(`Target: ${fullUrl}`);
    
    try {
        const res = await fetch(fullUrl, {
            headers: { 'X-MBX-APIKEY': key }
        });
        const data = await res.json();
        console.log(`Status: ${res.status}`);
        console.log(`Data:   ${JSON.stringify(data)}`);
    } catch (e) {
        console.log(`Err:    ${e.message}`);
    }
}

async function run() {
    // Test Mainnet Endpoint with these keys (since Demo now uses Live endpoints)
    await test('Mainnet Endpoint (Demo Keys?)', 'https://fapi.binance.com');
}

run();
