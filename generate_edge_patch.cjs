const fs = require('fs');

const fileOut = 'd:\\\\360 WorkPlace\\\\Gold Bonanza\\\\Building Process\\\\GB_FINAL_ANTI_SHORT_READY.html';
let html = fs.readFileSync(fileOut, 'utf8');

// 1. Guard loadPending
const loadPendingOld = `  function loadPending() {
    try {
      const stored = localStorage.getItem('gb76_pending');
      if (stored) {
        const arr = JSON.parse(stored);
        arr.forEach(([k, v]) => pending.set(k, v));
      }
    } catch(e) {}
  }`;

const loadPendingNew = `  function loadPending() {
    try {
      const stored = localStorage.getItem('gb76_pending');
      if (!stored) return;
      const arr = JSON.parse(stored);
      if (!Array.isArray(arr)) throw new Error("Invalid array");
      
      const nowTs = Date.now();
      arr.forEach((item) => {
        if (!Array.isArray(item) || item.length !== 2 || !item[0] || !item[1]) return;
        const [k, v] = item;
        if (typeof v !== 'object') return;
        
        // Repair corrupted fields
        v.state = String(v.state || "PENDING").toUpperCase();
        v.status = String(v.status || v.state);
        v.type = String(v.type || "SNIPER").toUpperCase();
        v.hint = v.hint != null ? String(v.hint) : "";
        v.createdAt = Number(v.createdAt) || nowTs;
        v.level = Number(v.level) || 0;
        v.lowestSeen = Number(v.lowestSeen) || v.level;
        v.data = typeof v.data === 'object' ? v.data : {};
        
        pending.set(String(k), v);
      });
    } catch(e) {
      console.warn("Storage read failed, clearing corrupt payload.", e);
      localStorage.removeItem('gb76_pending');
    }
  }`;

html = html.replace(loadPendingOld, loadPendingNew);

// 2. Guard updateState from mutating terminal states (like a CANCELLED card becoming EXPIRED) 
const updateStateStart = `  function updateState(st, price){
    st.lastPrice = price;
    const type = st.type, side = st.side, lvl = st.level;
    const cfg = (type === "SUPER") ? CFG.super : CFG.sniper;`;

const updateStateNew = `  function updateState(st, price){
    if (isTerminalState(st)) return "HOLD";
    
    st.lastPrice = price;
    const type = st.type, side = st.side, lvl = st.level;
    const cfg = (type === "SUPER") ? CFG.super : CFG.sniper;`;

html = html.replace(updateStateStart, updateStateNew);

fs.writeFileSync(fileOut, html);
console.log('Final edge-case patch applied successfully.');
