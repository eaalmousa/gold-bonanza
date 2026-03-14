async function checkEndpoint() {
    const endpoints = [
        'https://testnet.binancefuture.com',
        'https://fapi.binance.com',
        'https://demo-fapi.binance.com'
    ];
    
    for (const url of endpoints) {
        try {
            const res = await fetch(`${url}/fapi/v1/exchangeInfo`);
            console.log(`${url}: ${res.status}`);
        } catch (e) {
            console.log(`${url}: FAILED (${e.message})`);
        }
    }
}
checkEndpoint();
