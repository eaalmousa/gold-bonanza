import { evaluateSniperSignal, globalDebugLogs } from '../src/engines/sniperEngine';
import { ModeConfig, Kline } from '../src/types/trading';

// Mock Mock Data - Slope
const mock1h: Kline[] = new Array(600).fill({ close: 10, open: 10, high: 11, low: 9.5, volume: 10000, time: 0 });
for(let i=0; i<600; i++) {
    mock1h[i] = { ...mock1h[i], close: 10 + i*0.01 };
}

const mock15m: Kline[] = new Array(300).fill({ close: 16, open: 15.9, high: 16.1, low: 15.8, volume: 100, time: 0 });

const activeMode: ModeConfig = {
  key: 'AGGRESSIVE',
  riskPct: 0.01,
  pullback: {
    rsiMin: 0, rsiMax: 100, volMult: 0, scoreMin: 0, 
    valueZoneSlack: 1.0, atrPctMin: 0, atrPctMax: 100
  }
} as any;

console.log("=== SIZING TRACE FORENSICS (SLOPE MOCK) ===\n");

evaluateSniperSignal(mock1h, mock15m, activeMode, 100, 'TRENDING', 10, {} as any, 'UP', 'BTC_UP', 'WIF');

console.log("\n--- Debug Logs ---");
globalDebugLogs.forEach(log => console.log(log.join('\n')));
