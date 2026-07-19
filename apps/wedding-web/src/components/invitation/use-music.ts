'use client';

import { useEffect, useRef, useState } from 'react';

// Background music per HANDOFF §2.10: never on load — first attempt on first
// scroll; if the browser rejects (no gesture yet), a one-time pointerdown retry
// starts it on the first tap. Fade in to 0.6 over 2.4s, fade out 0.7s then
// pause — also fades out when the tab/window loses visibility (switching app
// or tab), so the music doesn't keep playing in the background unnoticed.
// Degrades silently when the source is absent/unplayable (audio 'error'
// event) — NOT via a HEAD existence check: admin-uploaded music lives on a
// different origin (wedding-assets.luminstudio.vn) with no CORS policy for
// reads, so a cross-origin `fetch(HEAD)` always network-errors even though
// plain <audio> playback needs no CORS at all.
const DEFAULT_SRC = '/invite/music.mp3';

export function useMusic(srcOverride?: string) {
  const SRC = srcOverride ?? DEFAULT_SRC;
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const triedRef = useRef(false);
  const retryRef = useRef<(() => void) | null>(null);
  const playingRef = useRef(false);
  playingRef.current = playing;

  const fadeVolume = (target: number, ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (fadeTimer.current) clearInterval(fadeTimer.current);
    const steps = 20;
    const step = (target - audio.volume) / steps;
    let i = 0;
    fadeTimer.current = setInterval(() => {
      i++;
      audio.volume = Math.min(1, Math.max(0, audio.volume + step));
      if (i >= steps) {
        if (fadeTimer.current) clearInterval(fadeTimer.current);
        if (target === 0) audio.pause();
      }
    }, ms / steps);
  };

  const start = () => {
    if (playingRef.current) return;
    const tryPlay = () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.volume = 0;
      audio.play().then(
        () => {
          setPlaying(true);
          fadeVolume(0.6, 2400);
        },
        () => {
          if (retryRef.current) return;
          retryRef.current = () => {
            if (retryRef.current) window.removeEventListener('pointerdown', retryRef.current);
            retryRef.current = null;
            if (!playingRef.current) tryPlay();
          };
          window.addEventListener('pointerdown', retryRef.current);
        },
      );
    };
    if (audioRef.current) {
      tryPlay();
      return;
    }
    if (triedRef.current) return;
    triedRef.current = true;
    const audio = new Audio(SRC);
    audio.loop = true;
    audio.addEventListener('error', () => {
      if (audioRef.current === audio) audioRef.current = null;
    });
    audioRef.current = audio;
    tryPlay();
  };

  const toggle = () => {
    if (playingRef.current) {
      setPlaying(false);
      fadeVolume(0, 700);
    } else {
      triedRef.current = false;
      start();
    }
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && playingRef.current) {
        setPlaying(false);
        fadeVolume(0, 700);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (fadeTimer.current) clearInterval(fadeTimer.current);
      if (retryRef.current) window.removeEventListener('pointerdown', retryRef.current);
      audioRef.current?.pause();
    };
  }, []);

  return { playing, start, toggle };
}
