
import { evaluateSniperSignal } from '../../src/engines/sniperEngine';
import { evaluateBreakoutSignal } from '../../src/engines/breakoutEngine';
import type { Kline, Signal, ModeConfig } from '../../src/types/trading';
import { MODES } from '../../src/types/trading';

const BINANCE_FUTURES = 'https://fapi.binance.com';
const TEST_SYMBOLS = [
  'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT',
  'LINKUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT', 'INJUSDT',
  'STXUSDT', 'LDOUSDT', 'RNDRUSDT', 'APTUSDT', 'ORDIUSDT'
];
const LOOKFORWARD_CANDLES = 12;
const HISTORY_LIMIT = 500;

// Override scoreMin to 1 so ALL structurally valid signals are collected.
// We then bin them post-hoc by actual raw score to find the quality cliff.
const SWEEP_MODE = {
  ...MODES.AGGRESSIVE,
  pullback: { ...MODES.AGGRESSIVE.pullback, scoreMin: 1 },
  breakout: { ...MODES.AGGRESSIVE.breakout, scoreMin: 1 },
} as ModeConfig;


async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `${BINANCE_FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${symbol} fetch failed: ${res.status}`);
  const raw: any[][] = await res.json();
  return raw.map(r => ({
    openTime: r[0], open: parseFloat(r[1]), high: parseFloat(r[2]),
    low: parseFloat(r[3]), close: parseFloat(r[4]), volume: parseFloat(r[5]),
    closeTime: r[6]
  }));
}

function analyzeOutcome(signal: Signal, future: Kline[]) {
  const entry = signal.entryPrice;
  const sl = signal.stopLoss;
  const isLong = signal.side === 'LONG';
  const stopDist = Math.abs(entry - sl);
  if (stopDist <= 0 || future.length === 0) return null;

  const calcCandle = (c: Kline) => {
    const mae = isLong ? Math.max(0, entry - c.low) / stopDist * 100 : Math.max(0, c.high - entry) / stopDist * 100;
    const mfe = isLong ? Math.max(0, c.high - entry) / stopDist * 100 : Math.max(0, entry - c.low) / stopDist * 100;
    return { mae, mfe };
  };

  let maxMFE = 0, maxMAE = 0;
  let mfe50hit = false, sl100hit = false;
  let mfe50idx = 999, sl100idx = 999;

  for (let i = 0; i < future.length; i++) {
    const { mae, mfe } = calcCandle(future[i]);
    if (mfe > maxMFE) maxMFE = mfe;
    if (mae > maxMAE) maxMAE = mae;
    if (mfe >= 50 && !mfe50hit) { mfe50hit = true; mfe50idx = i; }
    if (mae >= 100 && !sl100hit) { sl100hit = true; sl100idx = i; }
  }

  const c1 = calcCandle(future[0]);
  const firstMove = c1.mfe > c1.mae * 1.2 ? 'PROFIT' : (c1.mae > c1.mfe * 1.2 ? 'LOSS' : 'NEUTRAL');
  const hitTarget = maxMFE >= 100;
  const hitSL = maxMAE >= 100;
  const wrongDir = hitSL && !mfe50hit;
  const wellTimed = hitTarget && (!hitSL || mfe50idx < sl100idx) && maxMAE < 60;

  return { firstMove, maxMFE, maxMAE, wrongDir, wellTimed };
}

type Entry = { score: number; firstMove: string; wrongDir: boolean; wellTimed: boolean; maxMFE: number; maxMAE: number };

async function run() {
  const balance = 300;

  console.log(`\n📊  SCORE THRESHOLD SWEEP — finding minimum safe score`);
  console.log(`========================================================`);

  const allEntries: Entry[] = [];

  for (const symbol of TEST_SYMBOLS) {
    try {
      process.stdout.write(`  ${symbol}... `);
      const [tf15m, tf1h] = await Promise.all([
        fetchKlines(symbol, '15m', HISTORY_LIMIT),
        fetchKlines(symbol, '1h', 260),
      ]);

      let localCount = 0;
      for (let i = 110; i < tf15m.length - LOOKFORWARD_CANDLES; i++) {
        const slice15m = tf15m.slice(0, i + 1);
        const future = tf15m.slice(i + 1, i + 1 + LOOKFORWARD_CANDLES);

        const sigs: Signal[] = [];
        const push = (s: Signal | null) => { if (s) sigs.push(s); };
        push(evaluateSniperSignal(tf1h, slice15m, SWEEP_MODE, balance, 'TRENDING_UP' as any, 0, undefined, 'UP', 'Mock', symbol));
        push(evaluateBreakoutSignal(tf1h, slice15m, SWEEP_MODE, balance, 'TRENDING_UP' as any, 0, undefined, 'UP', 'Mock', symbol));
        push(evaluateSniperSignal(tf1h, slice15m, SWEEP_MODE, balance, 'TRENDING_DOWN' as any, 0, undefined, 'DOWN', 'Mock', symbol));
        push(evaluateBreakoutSignal(tf1h, slice15m, SWEEP_MODE, balance, 'TRENDING_DOWN' as any, 0, undefined, 'DOWN', 'Mock', symbol));

        for (const sig of sigs) {
          if (sig.entryType === 'PENDING_BREAKOUT' || sig.entryType === 'INVALIDATED') continue;
          const out = analyzeOutcome(sig, future);
          if (!out) continue;
          allEntries.push({ score: sig.score, ...out });
          localCount++;
        }
      }
      console.log(`${localCount} entries`);
    } catch (e: any) {
      console.log(`Error: ${e.message}`);
    }
  }

  console.log(`\nTotal raw entries collected: ${allEntries.length}`);
  console.log(`\n${'Score'.padEnd(8)}${'Count'.padEnd(10)}${'WrongDir%'.padEnd(13)}${'WellTimed%'.padEnd(14)}${'1stMove+%'.padEnd(12)}${'Avg MFE%'.padEnd(10)}VERDICT`);
  console.log(`─`.repeat(78));

  for (let threshold = 8; threshold <= 22; threshold++) {
    const group = allEntries.filter(e => e.score >= threshold);
    if (group.length === 0) continue;
    const wrongDirPct = group.filter(e => e.wrongDir).length / group.length * 100;
    const wellTimedPct = group.filter(e => e.wellTimed).length / group.length * 100;
    const firstProfitPct = group.filter(e => e.firstMove === 'PROFIT').length / group.length * 100;
    const avgMFE = group.reduce((a, b) => a + b.maxMFE, 0) / group.length;

    // Verdict logic
    let verdict = '';
    if (wrongDirPct <= 18 && wellTimedPct >= 18) verdict = '✅ SAFE';
    else if (wrongDirPct <= 25 && wellTimedPct >= 13) verdict = '⚠️  BORDERLINE';
    else verdict = '❌ RISKY';

    console.log(
      `≥${String(threshold).padEnd(7)}${String(group.length).padEnd(10)}${wrongDirPct.toFixed(1).padEnd(13)}${wellTimedPct.toFixed(1).padEnd(14)}${firstProfitPct.toFixed(1).padEnd(12)}${avgMFE.toFixed(1).padEnd(10)}${verdict}`
    );
  }

  console.log(`\n📝  NOTES:`);
  console.log(`   WrongDir%  = signals that went against you and stopped out without ever moving 50% toward TP`);
  console.log(`   WellTimed% = signals that hit TP first with low immediate drawdown (< 60% toward SL)`);
  console.log(`   Recommended: lowest threshold where WrongDir% ≤ 18% and WellTimed% ≥ 18%`);
}

run();
