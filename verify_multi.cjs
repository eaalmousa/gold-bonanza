require('dotenv').config({ path: './server/.env' });
const crypto = require('crypto');

async function test(label, urlBase, endpoint) {
    console.log(`\n--- TESTING: ${label} ---`);
    const key = process.env.BINANCE_API_KEY.trim();
    const secret = process.env.BINANCE_API_SECRET.trim();
    
    const timestamp = Date.now();
    const recvWindow = 10000;
    const query = `recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
    
    const fullUrl = `${urlBase}${endpoint}?${query}&signature=${signature}`;
    console.log(`Target: ${urlBase}${endpoint}`);
    
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
    // 1. Standard Futures Testnet
    await test('Futures Testnet (Standard)', 'https://testnet.binancefuture.com', '/fapi/v2/balance');
    
    // 2. Spot Testnet
    await test('Spot Testnet', 'https://testnet.binance.vision', '/api/v3/account');
    
    // 3. Mainnet (in case these are mainnet keys)
    // await test('Mainnet (READ ONLY CHECK)', 'https://fapi.binance.com', '/fapi/v2/balance');
}

run();
