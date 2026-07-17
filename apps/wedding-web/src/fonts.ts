import localFont from 'next/font/local';

// Self-hosted per HANDOFF §7 (no Google CDN at runtime): DFVN Kaelyna Script for
// display/names (licensed VN script — verify license before public deploy, §8),
// Playfair Display variable (400–600 used) for everything else.
export const fontScript = localFont({
  src: './fonts/DFVN-KaelynaScript.otf',
  variable: '--font-script',
  display: 'swap',
});

export const fontSerif = localFont({
  src: [
    { path: './fonts/PlayfairDisplay-VariableFont_wght.ttf', style: 'normal' },
    { path: './fonts/PlayfairDisplay-Italic-VariableFont_wght.ttf', style: 'italic' },
  ],
  variable: '--font-serif',
  display: 'swap',
});
