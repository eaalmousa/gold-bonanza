const fs = require('fs');

const fileOut = 'd:\\\\360 WorkPlace\\\\Gold Bonanza\\\\Building Process\\\\GB_FINAL_ANTI_SHORT_READY.html';
let html = fs.readFileSync(fileOut, 'utf8');

// 1. Add shortCancelWindowMs to CFG
html = html.replace('sniper: { sweepPct: 0.0015, retestTolPct: 0.0028, confirmMovePct: 0.0012, timeoutMs: 45*60*1000 },', 'sniper: { sweepPct: 0.0015, retestTolPct: 0.0028, confirmMovePct: 0.0012, timeoutMs: 45*60*1000, shortCancelWindowMs: 15*60*1000 },');
html = html.replace('super:  { breakPct: 0.0012, retestTolPct: 0.0028, confirmMovePct: 0.0010, timeoutMs: 45*60*1000 }', 'super:  { breakPct: 0.0012, retestTolPct: 0.0028, confirmMovePct: 0.0010, timeoutMs: 45*60*1000, shortCancelWindowMs: 15*60*1000 }');

// 2. Add Persistence logic
// Find the pending map declaration: `const pending = new Map();`
const pendingIndex = html.indexOf('const pending = new Map();');
const newPendingBlock = `const pending = new Map();
  function loadPending() {
    try {
      const stored = localStorage.getItem('gb76_pending');
      if (stored) {
        const arr = JSON.parse(stored);
        arr.forEach(([k, v]) => pending.set(k, v));
      }
    } catch(e) {}
  }
  function savePending() {
    try {
      localStorage.setItem('gb76_pending', JSON.stringify(Array.from(pending.entries())));
    } catch(e) {}
  }
  loadPending();
`;
html = html.substring(0, pendingIndex) + newPendingBlock + html.substring(pendingIndex + 'const pending = new Map();'.length);

// Also need to call `savePending()` whenever state is marked, polled, or removed.
html = html.replace(/function markState\(st, state, hint\)\{/g, 'function markState(st, state, hint){\n    try{ st.state = String(state||"").toUpperCase(); if (hint != null) st.hint = String(hint); st.completedAt = st.completedAt || now(); savePending(); }catch(e){} return;\n    /*');
html = html.replace(/function poll\(\)\{([\s\S]*?)if \(changed\) renderUI\(\);/g, 'function poll(){$1if (changed) { renderUI(); savePending(); }');
html = html.replace('pending.set(k, {', 'pending.set(k, {'); // this happens in `gbAddPending`. We'll just hook savePending to renderUI.

html = html.replace(/function renderUI\(\)\{/g, 'function renderUI(){\n    try{ savePending(); }catch(e){}\n');
html = html.replace(/function renderPendingTable\(\)\{/g, 'function renderPendingTable(){\n    try{ savePending(); }catch(e){}\n');

// 3. Improve the SHORT cancel explicit logic to use cfg
const updateStateStr = `      // 4. Rejection does not occur within allowed bar window (15 mins)
      const ageMs = Date.now() - st.createdAt;
      if (ageMs > 15 * 60 * 1000 && st.state === "WAIT") {`;
const newUpdateStateStr = `      // 4. Rejection does not occur within allowed bar window
      const ageMs = Date.now() - st.createdAt;
      if (ageMs > (cfg.shortCancelWindowMs || 15*60*1000) && st.state === "WAIT") {`;

html = html.replace(updateStateStr, newUpdateStateStr);

// 4. Highlight CANCELLED hints visually
const visualCancelOld = `\${hint ? \`<div style="font-size:10px;line-height:1.35;opacity:.78;max-width:360px;white-space:normal;">\${hint}</div>\` : ""}`;
const visualCancelNew = `\${hint ? \`<div style="font-size:10px;line-height:1.35;opacity:.78;max-width:360px;white-space:normal;\${st === "CANCELLED" ? "color:rgba(255,140,140,0.95);" : ""}">\${hint}</div>\` : ""}`;
html = html.replace(visualCancelOld, visualCancelNew);


fs.writeFileSync(fileOut, html);
console.log('Final polish patch applied successfully to Absolute Path');
