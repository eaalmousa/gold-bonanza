import { config } from 'dotenv';
config();
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '24h' });

async function getTruth() {
    const urls = [
        'http://localhost:8086/api/trade/status',
        'http://localhost:8086/api/trade/signals'
    ];
    
    for (const url of urls) {
        console.log(`\n--- FETCHING: ${url} ---`);
        try {
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            console.log(JSON.stringify(data, null, 2));
        } catch (e: any) {
            console.error(`FAILED: ${e.message}`);
        }
    }
}

getTruth().catch(console.error);
