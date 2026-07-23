'use client';

import { useEffect, useRef, useState } from 'react';

// Background music per HANDOFF §2.10 (autoplay-on-gesture): the first attempt
// fires on mount; browsers reject it (no gesture yet), which arms a one-time
// pointerdown retry that starts it on the guest's first tap. Fade in over
// 2.4s, fade out 0.7s then pause.
// Degrades silently when the source is absent/unplayable (audio 'error'
// event) — NOT via a HEAD existence check: admin-uploaded music lives on a
// different origin (wedding-assets.luminstudio.vn) with no CORS policy for
// reads, so a cross-origin `fetch(HEAD)` always network-errors even though
// plain <audio> playback needs no CORS at all.
//
// Three invariants this hook exists to keep — each one was a real bug:
//  1. VOLUME IS NOT A STOP SIGNAL. The old fade helper paused the element
//     whenever its target was 0, so an admin default volume of 0 played the
//     track (loud, on iOS — see 3) for 2.4s and then killed it. "Quiet" and
//     "stopped" are now two different things: `stop()` pauses, `fadeTo()`
//     never does.
//  2. INTENT IS THE SOURCE OF TRUTH, `playing` MIRRORS THE ELEMENT.
//     `wantRef` is what the guest/auto-start asked for; the `playing` flag is
//     synced from the element's own play/pause events, so an OS interruption
//     (call, another app grabbing audio) can't leave the button lying. Every
//     restart path checks intent first, so nothing ever un-mutes itself
//     against an explicit "off".
//  3. iOS SAFARI IGNORES `audio.volume` — it is read-only there, hardware
//     buttons only. Assigning it silently does nothing, which made both the
//     fade and the admin volume no-ops on the host's own iPhone. We probe for
//     it once and fall back to `muted` (which iOS *does* honour), skipping
//     fades rather than pretending they happened.
const DEFAULT_SRC = '/invite/music.mp3';
const FADE_IN_MS = 2400;
const FADE_OUT_MS = 700;
const FADE_STEPS = 20;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6);

export function useMusic(srcOverride?: string, defaultVolume = 0.6) {
  const SRC = srcOverride ?? DEFAULT_SRC;
  const initial = clamp01(defaultVolume);

  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(initial);
  // Desktop/Android: true. iOS Safari: false → the slider is pointless there
  // and MusicButton hides it instead of showing a control that does nothing.
  const [volumeSupported, setVolumeSupported] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped by every fade; a tick whose token is stale exits instead of writing
  // volume onto an element a newer start()/stop() already took over. Without
  // it, a fade-out still in flight when the guest tapped play again could land
  // its final pause() on freshly-started playback.
  const fadeToken = useRef(0);
  const wantRef = useRef(false);
  const volumeRef = useRef(initial);
  const supportedRef = useRef(true);
  const retryRef = useRef<(() => void) | null>(null);
  // Paused because the tab/app went to the background — the only pause we undo
  // by ourselves when the guest comes back.
  const hiddenPauseRef = useRef(false);
  volumeRef.current = volume;

  const clearRetry = () => {
    if (retryRef.current) {
      window.removeEventListener('pointerdown', retryRef.current);
      retryRef.current = null;
    }
  };

  // Writes the audible level. On iOS `volume` is read-only, so the only lever
  // is muted — a 0 default still means silence there, just without in-between
  // levels.
  const applyVolume = (v: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (supportedRef.current) {
      audio.volume = clamp01(v);
      audio.muted = false;
    } else {
      audio.muted = v <= 0.001;
    }
  };

  // Ramps volume only — never pauses. Callers that want a stop pass `onDone`.
  const fadeTo = (targetVol: number, ms: number, onDone?: () => void) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (fadeTimer.current) clearInterval(fadeTimer.current);
    const token = ++fadeToken.current;
    if (!supportedRef.current) {
      applyVolume(targetVol);
      onDone?.();
      return;
    }
    const from = audio.volume;
    const step = (clamp01(targetVol) - from) / FADE_STEPS;
    let i = 0;
    fadeTimer.current = setInterval(() => {
      if (token !== fadeToken.current) return;
      i++;
      audio.volume = clamp01(from + step * i);
      if (i >= FADE_STEPS) {
        if (fadeTimer.current) clearInterval(fadeTimer.current);
        fadeTimer.current = null;
        onDone?.();
      }
    }, ms / FADE_STEPS);
  };

  const ensureAudio = (): HTMLAudioElement | null => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = 'auto';
    // Capability probe: iOS Safari accepts the assignment and keeps 1.
    audio.volume = 0.5;
    const supported = Math.abs(audio.volume - 0.5) < 0.01;
    supportedRef.current = supported;
    setVolumeSupported(supported);
    // The element is the truth about whether sound is coming out — including
    // pauses we didn't ask for (incoming call, another tab taking audio focus).
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('error', () => {
      if (audioRef.current !== audio) return;
      audioRef.current = null;
      wantRef.current = false;
      clearRetry();
      setPlaying(false);
    });
    audioRef.current = audio;
    return audio;
  };

  // Live slider drag — no fade, just set it. Volume 0 here means "silent",
  // never "stop": the track keeps running so raising the slider is instant.
  const setVolume = (v: number) => {
    const clamped = clamp01(v);
    setVolumeState(clamped);
    volumeRef.current = clamped;
    if (wantRef.current) {
      fadeToken.current++; // cancel any in-flight fade; the drag wins
      if (fadeTimer.current) {
        clearInterval(fadeTimer.current);
        fadeTimer.current = null;
      }
      applyVolume(clamped);
    }
  };

  const tryPlay = () => {
    const audio = ensureAudio();
    if (!audio) return;
    if (supportedRef.current) applyVolume(0);
    else applyVolume(volumeRef.current);
    audio.play().then(
      () => {
        if (!wantRef.current) {
          // Intent flipped off while the play promise was in flight.
          audio.pause();
          return;
        }
        if (supportedRef.current) fadeTo(volumeRef.current, FADE_IN_MS);
      },
      () => {
        // Autoplay refused (no gesture yet) — arm a one-shot retry on the next
        // pointerdown. On mobile the first scroll-touch is that gesture.
        if (retryRef.current) return;
        retryRef.current = () => {
          clearRetry();
          if (wantRef.current && audioRef.current?.paused !== false) tryPlay();
        };
        window.addEventListener('pointerdown', retryRef.current);
      },
    );
  };

  const start = () => {
    if (wantRef.current) return;
    wantRef.current = true;
    tryPlay();
  };

  const stop = () => {
    wantRef.current = false;
    hiddenPauseRef.current = false;
    clearRetry();
    setPlaying(false); // immediate button feedback; the pause event confirms
    const audio = audioRef.current;
    if (!audio) return;
    fadeTo(0, FADE_OUT_MS, () => {
      if (wantRef.current) return; // restarted mid-fade — leave it alone
      audio.pause();
      applyVolume(volumeRef.current); // ready at the guest's level next time
    });
  };

  // Three cases, not two: "on and audible" → stop; "on but the element is
  // actually paused" (OS interruption, a refused resume) → re-play instead of
  // making the guest tap twice; "off" → start.
  const toggle = () => {
    const audible = audioRef.current ? !audioRef.current.paused : false;
    if (wantRef.current && audible) {
      stop();
      return;
    }
    if (wantRef.current) {
      hiddenPauseRef.current = false;
      tryPlay();
      return;
    }
    start();
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      const audio = audioRef.current;
      if (document.hidden) {
        // Pause outright, not via fade: hidden tabs throttle timers, so a fade
        // may never finish — which used to leave the track running unheard.
        if (wantRef.current && audio && !audio.paused) {
          hiddenPauseRef.current = true;
          audio.pause();
        }
      } else if (hiddenPauseRef.current) {
        hiddenPauseRef.current = false;
        // Only if the guest never turned it off while we were away. If the
        // browser refuses this resume, tryPlay arms the pointerdown retry.
        if (wantRef.current) tryPlay();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (fadeTimer.current) clearInterval(fadeTimer.current);
      clearRetry();
      wantRef.current = false;
      audioRef.current?.pause();
    };
  }, []);

  return { playing, start, stop, toggle, volume, setVolume, volumeSupported };
}
