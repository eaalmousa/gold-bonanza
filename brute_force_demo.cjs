const crypto = require('crypto');

async function test(apiKey, apiSecret) {
    const urlBase = 'https://demo-fapi.binance.com';
    const timestamp = Date.now();
    const query = `recvWindow=60000&timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    const fullUrl = `${urlBase}/fapi/v2/balance?${query}&signature=${signature}`;
    
    try {
        const res = await fetch(fullUrl, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        const data = await res.json();
        return { status: res.status, code: data.code, data };
    } catch (e) {
        return { status: 999, code: 0, err: e.message };
    }
}

async function run() {
    const baseKey = 'Gdvh6i1fKV4O1rDpvXdVbcydknrCgAvxgbaYYI7gF4SwJCPKAXwiBMJGKvPgMeU9';
    const baseSecret = 'GrhX6cjLVzHD1RgA3CJBQzXbJUGhWfl6asHbgNoh9RAal0Ev9Qdpe17oF22TdpKv';
    
    const keyParts = {
        k1: ['1', 'l', 'I'],
        k2: ['O', '0'],
        k3: ['I', 'l', '1']
    };

    console.log('--- REFINED BRUTE FORCE (DEMO ENDPOINT) ---');
    
    for (let k1 of keyParts.k1) {
        for (let k2 of keyParts.k2) {
            for (let k3 of keyParts.k3) {
                const k = `Gdvh6i${k1}fKV4${k2}1rDpvXdVbcydknrCgAvxgbaYY${k3}gF4SwJCPKAXwiBMJGKvPgMeU9`;
                const res = await test(k, baseSecret);
                
                if (res.code !== -2015) {
                    console.log(`\n\n🎯 FOUND VALID KEY FORMAT!`);
                    console.log(`Key: ${k}`);
                    console.log(`Response Code: ${res.code} (Status: ${res.status})`);
                    
                    if (res.status === 200) {
                        console.log('✅ COMPLETE SUCCESS!');
                        return;
                    }
                    
                    console.log('Now checking Secret variations...');
                    const secParts = {
                        s1: ['1', 'l', 'I'],
                        s2: ['22', 'ZZ', 'zz']
                    };
                    
                    for (let s1 of secParts.s1) {
                        for (let s2 of secParts.s2) {
                            const s = `GrhX6cjLVzHD${s1}RgA3CJBQzXbJUGhWfl6asHbgNoh9RAal0Ev9Qdpe17oF${s2}TdpKv`;
                            const res2 = await test(k, s);
                            if (res2.status === 200) {
                                console.log(`✅ FOUND VALID SECRET!`);
                                console.log(`Secret: ${s}`);
                                return;
                            } else {
                                process.stdout.write('.');
                            }
                        }
                    }
                } else {
                    process.stdout.write('.');
                }
            }
        }
    }
    console.log('\nAll variations failed on demo-fapi.');
}

run();
