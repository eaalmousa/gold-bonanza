const fs = require('fs');
const path = require('path');

const STATE_FILE = path.resolve(__dirname, 'trader_state.json');

const TRADER_CONFIG = {
  MIN_SCORE: 20,
  ENABLED: false
};

function applyConfig(c) {
  console.log('Applying:', JSON.stringify(c));
  if (c.minScore !== undefined || c.MIN_SCORE !== undefined)
      TRADER_CONFIG.MIN_SCORE = c.minScore ?? c.MIN_SCORE;
  if (c.enabled !== undefined || c.ENABLED !== undefined)
      TRADER_CONFIG.ENABLED = c.enabled ?? c.ENABLED;
}

const saveState = () => {
    const canonicalExport = { ...TRADER_CONFIG };
    console.log('Saving to disk:', JSON.stringify(canonicalExport));
    fs.writeFileSync(STATE_FILE, JSON.stringify(canonicalExport, null, 2));
};

// SIMULATE STARTUP
console.log('INIT STATE:', JSON.stringify(TRADER_CONFIG));
if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log('LOADED FROM DISK:', JSON.stringify(saved));
    applyConfig(saved);
}
console.log('POST-LOAD STATE:', JSON.stringify(TRADER_CONFIG));

// SIMULATE UPDATE
applyConfig({ minScore: 85, enabled: true });
saveState();
console.log('POST-SAVE STATE:', JSON.stringify(TRADER_CONFIG));

const final = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
console.log('FINAL FILE CONTENT:', JSON.stringify(final));
