// ============================================
// Audio Engine — Web Audio API Beeps
// ============================================

import { useTradingStore } from '../store/tradingStore';

let ctx: AudioContext | null = null;
let audioUnlocked = false;

// ── Mute Guard ────────────────────────────────────────────────────────────────
// Reads live from Zustand store so the check is always current without any
// subscription or re-render dependency.
function isSoundMuted(): boolean {
  try {
    return useTradingStore.getState().soundMuted;
  } catch {
    return false;
  }
}

function getCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

export async function unlockAudio(): Promise<void> {
  try {
    const c = getCtx();
    if (c.state === 'suspended') await c.resume();
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.02);
    audioUnlocked = true;
  } catch {
    audioUnlocked = false;
  }
}

function createBeep(freq: number, durationMs: number = 180, volume: number = 0.95): void {
  if (!audioUnlocked) return;
  if (isSoundMuted()) return;           // ← mute guard
  const c = getCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.00001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.00001, volume), now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.00001, now + durationMs / 1000);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

export function playSniperSound(): void {
  if (!audioUnlocked) return;
  if (isSoundMuted()) return;           // ← mute guard
  createBeep(880, 180, 0.95);
  setTimeout(() => createBeep(880, 180, 0.95), 220);
}

export function playSuperSniperSound(): void {
  if (!audioUnlocked) return;
  if (isSoundMuted()) return;           // ← mute guard
  createBeep(1200, 160, 0.98);
  setTimeout(() => createBeep(1200, 160, 0.98), 200);
  setTimeout(() => createBeep(1200, 160, 0.98), 400);
  setTimeout(() => createBeep(1200, 160, 0.98), 600);
}

// ── MP3 alert helper ─────────────────────────────────────────────────────────
// Used by PipelineSignals.tsx for file-based alerts. Centralising here so
// the mute flag covers both Web Audio and <Audio> paths.
export function playAlert(src: string): void {
  if (isSoundMuted()) return;           // ← mute guard
  new Audio(src).play().catch((e) => console.warn('Audio play failed', e));
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

// Auto-unlock on first gesture
if (typeof document !== 'undefined') {
  const events = ['pointerdown', 'touchstart', 'keydown', 'mousedown'];
  events.forEach(ev => {
    document.addEventListener(ev, () => {
      if (!audioUnlocked) unlockAudio();
    }, { passive: true, once: false });
  });
}
