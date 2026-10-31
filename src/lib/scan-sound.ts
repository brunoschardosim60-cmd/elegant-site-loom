/**
 * Short synthesized tones for scan results, so the person checking boxes does
 * not need to look at the screen. No audio files; nothing leaves the browser.
 */
export type ScanSound = "ok" | "done" | "warning" | "error";

const STORAGE_KEY = "confere-scan-sound";
// Frequency (Hz) and length (s) of each tone; "done" and "error" play two.
const tones: Record<ScanSound, [number, number][]> = {
  ok: [[1046, 0.09]],
  done: [
    [1046, 0.08],
    [1568, 0.14],
  ],
  warning: [[660, 0.16]],
  error: [
    [330, 0.16],
    [247, 0.22],
  ],
};

let context: AudioContext | undefined;

export function scanSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setScanSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* Private mode: the choice lasts for this page only. */
  }
}

export function playScanSound(kind: ScanSound) {
  if (!scanSoundEnabled()) return;
  try {
    const Audio =
      typeof window === "undefined"
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === "suspended") void context.resume();
    let start = context.currentTime;
    for (const [frequency, length] of tones[kind]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "error" ? "square" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + length + 0.02);
      start += length + 0.03;
    }
  } catch {
    /* A browser without audio still scans normally. */
  }
}
