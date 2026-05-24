import { useCallback } from 'react';

export type AlertSound = 'Institutional Pulse' | 'Mechanical Click' | 'Target Chime';

export const AVAILABLE_ALERT_FILES = [
  'dead_zone.mp3',
  'flow_state.wav',
  'fvg_alert.mp3',
  'objective_update.wav',
  'pricing_shift.wav',
  'session_transition.wav',
  'smt_trap.wav',
  'sweep_alert.mp3'
] as const;

export function useAlertSounds() {
  const playSound = useCallback((soundName: AlertSound) => {
    if (typeof window === 'undefined') return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      
      const ctx = new AudioContextClass();
      
      // Safety gate: resume context if suspended (browser security autoplay policies)
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (soundName === 'Institutional Pulse') {
        // Deep low-frequency double pulse sine wave
        const now = ctx.currentTime;

        // 1. Primary Low Pulse
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(140, now);
        osc1.frequency.exponentialRampToValueAtTime(70, now + 0.18);
        
        gain1.gain.setValueAtTime(0.35, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        
        osc1.start(now);
        osc1.stop(now + 0.18);

        // 2. Secondary Delayed Pulse
        const delay = 0.13;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(120, now + delay);
        osc2.frequency.exponentialRampToValueAtTime(60, now + delay + 0.22);
        
        gain2.gain.setValueAtTime(0.28, now + delay);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.22);
        
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        
        osc2.start(now + delay);
        osc2.stop(now + delay + 0.22);

      } else if (soundName === 'Mechanical Click') {
        // High frequency sharp triangle wave + bandpass filtered white noise block
        const now = ctx.currentTime;
        
        // Dynamic Tone Sweep
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1600, now);
        osc.frequency.exponentialRampToValueAtTime(350, now + 0.025);
        
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        // 10ms White Noise Burst for Mechanical Switch Texture
        const bufferSize = ctx.sampleRate * 0.01; // 10ms length
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(3000, now);
        noiseFilter.Q.setValueAtTime(4, now);
        
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.12, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.008);
        
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.04);
        noise.start(now);
        noise.stop(now + 0.015);

      } else if (soundName === 'Target Chime') {
        // Dual harmonic crystal pure bells (Octave + Perfect Fifth Ratio)
        const now = ctx.currentTime;
        
        // Fundemental Bell (A5 - 880Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        
        gain1.gain.setValueAtTime(0.18, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.55);

        // Fifth Ratio Harmonic Bell (E6 - 1318.51Hz)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1318.51, now);
        
        gain2.gain.setValueAtTime(0.10, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
        
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.75);
      }
    } catch (e) {
      console.warn('[SoundEngine] Synthesis initialization failed:', e);
    }
  }, []);

  const playFile = useCallback((fileName: string) => {
    if (typeof window === 'undefined') return;
    try {
      const audio = new Audio(`/audio/${fileName}`);
      audio.play().catch((err) => {
        if (err.name === 'NotAllowedError') {
          console.log(`[SoundEngine] Playback blocked by browser autoplay policy for ${fileName} until user interacts.`);
        } else {
          console.warn(`[SoundEngine] Playback failed for ${fileName}:`, err);
        }
      });
    } catch (e) {
      console.warn(`[SoundEngine] playFile execution failed for ${fileName}:`, e);
    }
  }, []);

  return { playSound, playFile };
}
