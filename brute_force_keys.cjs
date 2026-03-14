const crypto = require('crypto');

async function test(apiKey, apiSecret) {
    const urlBase = 'https://testnet.binancefuture.com';
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    const fullUrl = `${urlBase}/fapi/v2/balance?${query}&signature=${signature}`;
    
    try {
        const res = await fetch(fullUrl, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        const data = await res.json();
        if (res.status === 200) return { success: true, data };
        return { success: false, status: res.status, data };
    } catch (e) {
        return { success: false, err: e.message };
    }
}

async function run() {
    const baseKey = 'Gdvh6i1fKV4O1rDpvXdVbcydknrCgAvxgbaYYI7gF4SwJCPKAXwiBMJGKvPgMeU9';
    const baseSecret = 'GrhX6cjLVzHD1RgA3CJBQzXbJUGhWfl6asHbgNoh9RAal0Ev9Qdpe17oF22TdpKv';
    
    const keyVariations = [
        baseKey,
        baseKey.replace('6i1', '6il'),
        baseKey.replace('YYI7', 'YY17'),
        baseKey.replace('YYI7', 'YYl7'),
    ];
    
    const secretVariations = [
        baseSecret,
        baseSecret.replace('HD1', 'HDl'),
    ];

    console.log('--- BRUTE FORCING AMBIGUOUS CHARACTERS ---');
    for (const k of keyVariations) {
        for (const s of secretVariations) {
            process.stdout.write(`Testing Key[...${k.slice(-4)}] Sec[...${s.slice(-4)}] ... `);
            const res = await test(k, s);
            if (res.success) {
                console.log('✅ SUCCESS!');
                console.log('VALID KEY:', k);
                console.log('VALID SECRET:', s);
                return;
            } else {
                console.log(`❌ ${res.status} (${res.data.code})`);
            }
        }
    }
    console.log('All variations failed.');
}

run();
