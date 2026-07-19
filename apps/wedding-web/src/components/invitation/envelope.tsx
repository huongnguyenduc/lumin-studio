import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';

// top starts at 178 (not 0): the envelope box overlaps the hero by -178px
// (see below) for the flap/lace-panel bleed effect, but this plain border
// strip has no reason to bleed into the photo too — start it where the
// envelope is actually visible, i.e. right where the hero ends.
const laceV: CSSProperties = {
  position: 'absolute',
  top: 178,
  bottom: 0,
  width: 6,
  background: 'url(/invite/lace-v.png) repeat-y',
  backgroundSize: '6px auto',
};

// Envelope transition (§2.2): flap (clip-path), two rotated lace panels, wax
// stamp, vertical lace borders (matches Letter). Pure decoration, no
// interaction; overlaps the hero by −178px.
//
// --invite-envelope-clip trims that overlapping strip back off. InvitationCard
// sets it to 178px on desktop, where the hero is sized to exactly the viewport
// and the overlap would otherwise put the white lace panels on the first screen
// as a pale band. Clipping (rather than dropping the negative margin) keeps the
// envelope's visible content flush against the photo — zeroing the margin
// instead leaves a blank strip where the overlapped part used to be.
export function Envelope() {
  const t = useTranslations('hero');
  return (
    <div
      style={{
        position: 'relative',
        height: 350,
        marginTop: -178,
        clipPath: 'inset(var(--invite-envelope-clip, 0px) 0 0 0)',
        zIndex: 2,
      }}
    >
      <div style={{ ...laceV, left: 0 }} />
      <div style={{ ...laceV, left: 6 }} />
      <div style={{ ...laceV, right: 0 }} />
      <div style={{ ...laceV, right: 6 }} />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 176,
          transform: 'translateX(-50%)',
          width: 480,
          height: 121,
          clipPath: 'polygon(0% 0%, 100% 0%, 52.5% 94%, 47.5% 94%)',
          filter: 'drop-shadow(0px 14px 22px rgba(101,101,101,0.4))',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'url(/invite/flap.jpg) 50% 0.3% / 100% 375% no-repeat',
            filter: 'saturate(0.4) brightness(1.01)',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 382.9,
          top: 0,
          width: 205.3,
          height: 313.9,
          transform: 'rotate(62.47deg)',
          transformOrigin: '0 0',
          background: 'url(/invite/lace.png) center / cover no-repeat',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 11.9,
          top: 0,
          width: 205.3,
          height: 313.9,
          transform: 'rotate(-62.47deg) scaleX(-1)',
          transformOrigin: '0 0',
          background: 'url(/invite/lace.png) center / cover no-repeat',
        }}
      />
      <img
        src="/invite/stamp.png"
        alt={t('stampAlt')}
        style={{
          position: 'absolute',
          left: '50%',
          top: 271,
          transform: 'translateX(-50%)',
          width: 73,
          height: 73,
          filter: 'drop-shadow(1px 2px 5px rgba(101,101,101,0.35))',
        }}
      />
    </div>
  );
}
