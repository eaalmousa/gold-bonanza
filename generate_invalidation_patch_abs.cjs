const fs = require('fs');

const fileOut = 'd:\\\\360 WorkPlace\\\\Gold Bonanza\\\\Building Process\\\\GB_FINAL_ANTI_SHORT_READY.html';
let html = fs.readFileSync(fileOut, 'utf8');

const newFunctions = `  function updateState(st, price){
    st.lastPrice = price;
    const type = st.type, side = st.side, lvl = st.level;
    const cfg = (type === "SUPER") ? CFG.super : CFG.sniper;

    if (Date.now() - st.createdAt > cfg.timeoutMs) {
      st.state = "EXPIRED"; st.hint = "Expired (timeout)."; return "EXPIRE";
    }

    const isLong = side === "LONG";

    // ---- SHORT EXPLICIT INVALIDATION ----
    if (!isLong && st.data && st.state !== "TRIGGERED" && st.state !== "CONFIRMED") {
      const sl = st.data.stopLoss || (lvl * 1.02);
      const atr = st.data.atr15 || (lvl * 0.005);
      
      st.lowestSeen = Math.min(st.lowestSeen || price, price);
      
      // 1. & 3. Reclaims EMA rejection zone or local reclaim structure
      if (price > sl || price > lvl + (atr * 0.8)) {
        st.state = "CANCELLED"; st.hint = "Cancelled: Reclaimed above EMA / local structure."; return "CANCEL";
      }
      // 2. Forms higher low after bearish setup
      if (st.lowestSeen < lvl - (atr * 0.2) && price >= lvl) {
        st.state = "CANCELLED"; st.hint = "Cancelled: Formed higher low after sweep."; return "CANCEL";
      }
      // 4. Rejection does not occur within allowed bar window (15 mins)
      const ageMs = Date.now() - st.createdAt;
      if (ageMs > 15 * 60 * 1000 && st.state === "WAIT") {
        st.state = "CANCELLED"; st.hint = "Cancelled: Stalled rejection (15m elapsed)."; return "CANCEL";
      }
    }

    if (type === "SNIPER") {
      if (st.state === "WAIT") {
        const swept = isLong ? (price <= lvl * (1 - cfg.sweepPct)) : (price >= lvl * (1 + cfg.sweepPct));
        if (swept) { st.state = "SWEPT"; st.hint = "Sweep detected. Waiting for reclaim back through level."; return "PROGRESS"; }
      } else if (st.state === "SWEPT") {
        const reclaimed = isLong ? (price >= lvl) : (price <= lvl);
        if (reclaimed) { st.state = "RECLAIMED"; st.hint = "Reclaim confirmed. Waiting for retest hold."; return "PROGRESS"; }
      } else if (st.state === "RECLAIMED") {
        const near = Math.abs(price - lvl) <= lvl * cfg.retestTolPct;
        if (near) { st.state = "RETEST"; st.hint = "Retest in progress. Waiting for confirmation move."; return "PROGRESS"; }
      } else if (st.state === "RETEST") {
        const confirmed = isLong ? (price >= lvl * (1 + cfg.confirmMovePct)) : (price <= lvl * (1 - cfg.confirmMovePct));
        if (confirmed) { st.state = "TRIGGERED"; st.hint = "Trigger confirmed ✅ forwarding to Sniper engine."; return "TRIGGER"; }
      }
    } else {
      if (st.state === "WAIT") {
        const broken = isLong ? (price >= lvl * (1 + cfg.breakPct)) : (price <= lvl * (1 - cfg.breakPct));
        if (broken) { st.state = "BROKE"; st.hint = "Break detected. Waiting for retest back to level."; return "PROGRESS"; }
      } else if (st.state === "BROKE") {
        const near = Math.abs(price - lvl) <= lvl * cfg.retestTolPct;
        if (near) { st.state = "RETEST"; st.hint = "Retest in progress. Waiting for confirmation move."; return "PROGRESS"; }
      } else if (st.state === "RETEST") {
        const confirmed = isLong ? (price >= lvl * (1 + cfg.confirmMovePct)) : (price <= lvl * (1 - cfg.confirmMovePct));
        if (confirmed) { st.state = "TRIGGERED"; st.hint = "Trigger confirmed ✅ forwarding to Super Sniper engine."; return "TRIGGER"; }
      }
    }
    return "HOLD";
  }

  function poll(){
    if (!CFG.enabled) { renderUI(); return; }
    let changed = false;
    for (const [k, st] of pending.entries()){
      const px = getLastPrice(st.symbol);
      if (px == null) continue;
      const res = updateState(st, px);
      if (res !== "HOLD") changed = true;

      if (res === "TRIGGER") {
        if (typeof speak === 'function') {
          speak(st.type === "SUPER"
            ? \`Super sniper trigger confirmed on \${String(st.symbol).replace("USDT","")}\`
            : \`Sniper trigger confirmed on \${String(st.symbol).replace("USDT","")}\`
          );
        }
        const dispatch = confirmAndDispatch(st);
        if (dispatch && dispatch.ok && !dispatch.skipped) {
          st.hint = st.hint || "Confirmed ✅ forwarded to signal engine.";
        }
        changed = true;
      }
      if (res === "EXPIRE") {
        markState(st, "EXPIRED", st.hint || "Expired (timeout)." );
        changed = true;
      }
      if (res === "CANCEL") {
        markState(st, "CANCELLED", st.hint || "Cancelled by struct validation." );
        changed = true;
      }
    }
    if (changed) renderUI();
  }`;

const startIdx = html.indexOf('  function updateState(st, price){');
const endIdx = html.indexOf('  // Wrap triggers (preserve previous wrappers');

if (startIdx !== -1 && endIdx !== -1) {
  html = html.substring(0, startIdx) + newFunctions + '\n\n' + html.substring(endIdx);
  fs.writeFileSync(fileOut, html);
  console.log('Invalidation patch applied successfully to Absolute Path');
} else {
  console.log('Error locating function. Start:', startIdx, 'End:', endIdx);
}
