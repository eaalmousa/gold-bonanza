"use strict";
// ============================================
// Gold Bonanza — Trading Types & Constants
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.FUTURES_API = exports.SPOT_API = exports.METAL_SYMBOLS = exports.DEFAULT_SYMBOLS = exports.MODES = void 0;
// ============================================
// RISK MODE CONSTANTS
// ============================================
exports.MODES = {
    CONSERVATIVE: {
        key: 'CONSERVATIVE',
        riskPct: 0.0075,
        maxTrades: 2,
        leverage: 3,
        pullback: {
            rsiMin: 28, rsiMax: 52, volMult: 1.50, // Require 1.5x volume
            minDollarVol15m: 500000, volSpikeMult: 1.25,
            accelPctMin: 0.00040, atrPctMin: 0.25, atrPctMax: 2.00,
            valueZoneSlack: 0.0030, scoreMin: 14 // Extremely strict scoring
        },
        breakout: {
            breakPct: 0.0040, volMult: 1.75, // Require 1.75x volume
            minDollarVol15m: 600000, volSpikeMult: 1.30,
            accelPctMin: 0.00045, coilBars: 12, coilRangePctMax: 1.80,
            rsiMin: 55, rsiMax: 78, scoreMin: 14 // Extremely strict scoring
        }
    },
    BALANCED: {
        key: 'BALANCED',
        riskPct: 0.01,
        maxTrades: 3,
        leverage: 5,
        pullback: {
            rsiMin: 22, rsiMax: 58, volMult: 1.25, // Require 1.25x volume
            minDollarVol15m: 250000, volSpikeMult: 1.15,
            accelPctMin: 0.00030, atrPctMin: 0.20, atrPctMax: 3.00,
            valueZoneSlack: 0.0050, scoreMin: 11 // Moderately strict scoring
        },
        breakout: {
            breakPct: 0.0035, volMult: 1.40, // Require 1.4x volume
            minDollarVol15m: 350000, volSpikeMult: 1.20,
            accelPctMin: 0.00035, coilBars: 8, coilRangePctMax: 2.50,
            rsiMin: 50, rsiMax: 82, scoreMin: 11 // Moderately strict scoring
        }
    },
    AGGRESSIVE: {
        key: 'AGGRESSIVE',
        riskPct: 0.015,
        maxTrades: 8,
        leverage: 7,
        pullback: {
            rsiMin: 15, rsiMax: 70, volMult: 1.0,
            minDollarVol15m: 50000, volSpikeMult: 1.0,
            accelPctMin: 0.00010, atrPctMin: 0.10, atrPctMax: 5.00,
            valueZoneSlack: 0.008, // Hard cap at 0.8% — 2% was meaningless
            scoreMin: 8 // Raised floor from 5 to 8
        },
        breakout: {
            breakPct: 0.0010, volMult: 1.0,
            minDollarVol15m: 50000, volSpikeMult: 1.0,
            accelPctMin: 0.00010, coilBars: 4, coilRangePctMax: 4.00, // Tightened from 6%
            rsiMin: 40, rsiMax: 90, scoreMin: 8
        }
    }
};
exports.DEFAULT_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT',
    'TRXUSDT', 'OPUSDT', 'ARBUSDT', 'NEARUSDT', 'APTUSDT',
    'MATICUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT', 'ATOMUSDT',
    'STXUSDT', 'INJUSDT', 'SEIUSDT', 'PEPEUSDT', 'RUNEUSDT',
    'AAVEUSDT', 'SANDUSDT', 'MANAUSDT', 'FILUSDT', 'ICPUSDT',
    'AXSUSDT', 'THETAUSDT', 'VETUSDT', 'EGLDUSDT', 'FETUSDT',
    'GRTUSDT', 'SNXUSDT', 'CRVUSDT', 'MKRUSDT', 'QNTUSDT',
    'ALGOUSDT', 'EOSUSDT', 'FTMUSDT', 'ZILUSDT', 'COMPUSDT',
    'KAVAUSDT', 'CHZUSDT', 'ENJUSDT', 'ROSEUSDT', 'WAVESUSDT',
    'GALAUSDT', 'CELOUSDT', 'YFIUSDT', 'SUSHIUSDT', 'KSMUSDT',
    'ZECUSDT', 'DASHUSDT', 'XMRUSDT', 'NEOUSDT', 'RNDRUSDT',
    'AGIXUSDT', 'INJUSDT', 'IDUSDT', 'MAGICUSDT', 'GMXUSDT',
    'LDOUSDT', 'ENSUSDT', 'MINAUSDT', 'IMXUSDT', '1INCHUSDT',
    'BATUSDT', 'ENJUSDT', 'LRCUSDT', 'HOTUSDT', 'RVNUSDT',
    'ONEUSDT', 'OCEANUSDT', 'BANDUSDT', 'ONTUSDT', 'IOTAUSDT',
    'FLRUSDT', 'XEMUSDT', 'ZRXUSDT', 'IOSTUSDT', 'ANKRUSDT',
    'DGBUSDT', 'SCUSDT', 'LSKUSDT', 'XVGUSDT', 'SFPUSDT',
    'C98USDT', 'SXPUSDT', 'ALPHAUSDT', 'DODOUSDT', 'REEFUSDT',
    'TWTUSDT', 'BALUSDT', 'RENUSDT', 'CELRUSDT', 'STORJUSDT',
    'BLURUSDT'
];
exports.METAL_SYMBOLS = ['XAUUSDT', 'XAGUSDT'];
exports.SPOT_API = 'https://api.binance.com';
exports.FUTURES_API = 'https://fapi.binance.com';
