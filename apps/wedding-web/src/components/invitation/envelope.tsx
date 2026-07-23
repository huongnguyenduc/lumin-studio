import type { CSSProperties } from 'react';

// top starts at 178 (not 0): the envelope box overlaps the hero by -178px
// (see below) for the flap/lace-panel bleed effect, but this plain border
// strip has no reason to bleed into the photo too — start it where the
// envelope is actually visible, i.e. right where the hero ends.
const laceV: CSSProperties = {
  position: 'absolute',
  top: 178,
  bottom: 0,
  width: 6,
  background: 'url(/image/lace-v.webp) repeat-y',
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
  return (
    <div
      style={{
        position: 'relative',
        height: 350,
        // clipPath: 'inset(var(--invite-envelope-clip, 0px) 0 0 0)',
        marginTop: -168,
        zIndex: 2,
      }}
    >
      <div style={{ ...laceV, left: 0 }} />
      <div style={{ ...laceV, left: 5 }} />
      <div style={{ ...laceV, right: 0 }} />
      <div style={{ ...laceV, right: 5 }} />
      <img
        src="/image/envelope.webp"
        alt="envelope decor"
        style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% + 32px)',
          height: 'auto',
          objectFit: 'cover',
        }}
      />
    </div>
  );
}
