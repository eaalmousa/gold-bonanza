import { evaluateSniperSignal, globalDebugLogs } from '../src/engines/sniperEngine';
import { Kline, ModeConfig } from '../src/types/trading';
import { calcSMA } from '../src/engines/indicators';

const activeMode: ModeConfig = {
  key: 'BALANCED', maxTrades: 3, leverage: 5, riskPct: 0.02,
  pullback: { rsiMin: 22, rsiMax: 65, atrPctMin: 0.05, atrPctMax: 5.0, volMult: 1.3, volSpikeMult: 0, scoreMin: 10, accelPctMin: 0.0001, valueZoneSlack: 0.003, minDollarVol15m: 1000 },
  breakout: { breakPct: 0.003, minDollarVol15m: 1000, coilBars: 8, coilRangePctMax: 2.0, scoreMin: 12, rsiMin: 30, rsiMax: 70, accelPctMin: 0.0001, volMult: 1.5, volSpikeMult: 1.5 }
};

async function fetchBinanceKlines(symbol: string, interval: string, startTime: number, endTime: number): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
  const res = await fetch(url);
  const data = await res.json() as any[][];
  return data.map(d => ({
    openTime: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]),
    low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]), closeTime: d[6]
  }));
}

async function fetchReplayData(symbol: string, startT: number, endT: number) {
  const primeTime = startT - (14 * 24 * 60 * 60 * 1000);
  const k1h_prime = await fetchBinanceKlines(symbol, '1h', primeTime, startT);
  const k1h_event = await fetchBinanceKlines(symbol, '1h', startT, endT);
  const k1h = [...k1h_prime, ...k1h_event].sort((a,b)=>a.openTime-b.openTime);

  const k15_prime = await fetchBinanceKlines(symbol, '15m', startT - (7*24*3600*1000), startT);
  const k15_event = await fetchBinanceKlines(symbol, '15m', startT, endT);
  const k15 = [...k15_prime, ...k15_event].sort((a,b)=>a.openTime-b.openTime);
  return {k1h, k15};
}

async function runDiagnostic() {
  console.log('\n======================================================');
  console.log('--- VOLUME GATE DIAGNOSTIC ---');
  console.log('======================================================');

  const crashEvents = [
    { type: 'ALT', name: 'LUNA Crash Altcoin Dump (AVAX)', symbol: 'AVAXUSDT', startT: 1652054400000, endT: 1652313600000 },
    { type: 'ALT', name: 'FTX Crash Sol Ecosystem (SOL)', symbol: 'SOLUSDT', startT: 1667865600000, endT: 1668124800000 },
    { type: 'ALT', name: 'Aug 2024 Flash Crash Altcoin (ETH)', symbol: 'ETHUSDT', startT: 1722729600000, endT: 1722988800000 },
    { type: 'ALT', name: 'Fake Altcoin Dump (MATIC)', symbol: 'MATICUSDT', startT: 1696118400000, endT: 1696377600000 }
  ];

  for (const ev of crashEvents) {
    console.log(`\nAnalyzing ${ev.name} (${ev.symbol})...`);
    
    try {
        const { k1h, k15 } = await fetchReplayData(ev.symbol, ev.startT, ev.endT);
        if (k1h.length < 210 || k15.length < 90) continue;

        const vols = k15.map(k => k.volume);
        const sma20 = calcSMA(vols, 20);
        const sma50 = calcSMA(vols, 50);

        let startIndex15 = k15.findIndex(k => k.openTime >= ev.startT);
        if(startIndex15 === -1) startIndex15 = 100;
        if(startIndex15 < 100) startIndex15 = 100;

        let blockedByVol = 0;
        // To find out what WOULD happen if volume was relaxed, we'll temporarily set volMult to 0
        const relaxedMode = JSON.parse(JSON.stringify(activeMode));
        relaxedMode.pullback.volMult = 0;
        relaxedMode.pullback.volSpikeMult = 0;

        for (let i = startIndex15; i < k15.length; i++) {
            const cur15 = k15[i];
            const cur1HBase = k1h.filter(h => h.openTime <= cur15.openTime);
            if (cur1HBase.length < 210) continue;

            const slice15 = k15.slice(0, i + 1);
            globalDebugLogs.length = 0;
            
            // Replay strictly
            const sigStrict = evaluateSniperSignal(cur1HBase, slice15, activeMode, 10000, 'TRENDING_DOWN', 2, undefined, 'DOWN', 'NORMAL', ev.symbol);
            const logsStrict = [...(globalDebugLogs[globalDebugLogs.length - 1] || [])];
            const logsStrStrict = logsStrict.join(' | ');

            // Replay relaxed
            globalDebugLogs.length = 0;
            const sigRelaxed = evaluateSniperSignal(cur1HBase, slice15, relaxedMode, 10000, 'TRENDING_DOWN', 2, undefined, 'DOWN', 'NORMAL', ev.symbol);
            
            if (sigStrict === null && logsStrStrict.includes('Volume ratio below minimum')) {
                blockedByVol++;
                
                const lastIdx = slice15.length - 2;
                const vol = slice15[lastIdx].volume;
                const volAvg = sma20[lastIdx];
                const volLongAvg = sma50[lastIdx] ?? volAvg;
                const volRatio = vol / volAvg!;
                const volSpike = volLongAvg ? (vol / volLongAvg!) : 0;
                
                const futurePrice = slice15.length + 12 < k15.length ? k15[slice15.length + 12].close : k15[k15.length-1].close;
                const entryPrice = cur15.close;
                const wouldBeProfitable = futurePrice < entryPrice;

                console.log(`  [Vol Blocked] Time: ${new Date(cur15.openTime).toISOString()} | Price: ${entryPrice}`);
                console.log(`    - Raw Vol: ${vol.toFixed(2)}, VolAvg(20): ${volAvg?.toFixed(2)}, VolLongAvg(50): ${volLongAvg?.toFixed(2)}`);
                console.log(`    - Ratio: ${volRatio.toFixed(2)}x (cfg: ${activeMode.pullback.volMult}x), Spike: ${volSpike.toFixed(2)}x (cfg: ${activeMode.pullback.volSpikeMult}x)`);
                console.log(`    - Failed on: volRatio only`);
                
                if (sigRelaxed) {
                    console.log(`    - Relaxed Outcome: ACCEPTED SHORT (Score: ${sigRelaxed.score})`);
                    console.log(`    - 3-Hour Forward Price: ${futurePrice} -> ${wouldBeProfitable ? 'PROFITABLE/SAFE' : 'DANGEROUS (Price rose)'}`);
                } else {
                    const logsRelaxed = globalDebugLogs[globalDebugLogs.length - 1] || [];
                    let gateRejected = 'Unknown';
                    for(let j = logsRelaxed.length-1; j >= 0; j--) {
                        if (logsRelaxed[j].includes('REJECT:')) {
                            gateRejected = logsRelaxed[j].split('REJECT: ')[1].split('—')[0].split('-')[0].trim();
                            break;
                        }
                    }
                    console.log(`    - Relaxed Outcome: STILL REJECTED by [${gateRejected}]`);
                }
            }
        }
        
        console.log(`  Total occurrences blocked strictly by volume: ${blockedByVol}`);
    } catch(err) {
        console.error(err);
    }
  }
}

runDiagnostic().catch(console.error);
