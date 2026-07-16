"""Pure colour helpers for the sprite renderer (f-5) — NO bpy, so this is unit-testable OFF the GPU box
(unlike _bl_render.py, which imports bpy and only runs inside Blender).

The one non-trivial bit: a filament hex is sRGB, but Blender's Principled BSDF 'Base Color' input is
interpreted in LINEAR space — feeding it raw sRGB renders every part noticeably too dark. hex_to_linear_rgb
does the sRGB→linear transfer so the rendered part matches the storefront swatch (which shows the sRGB hex).
"""

from __future__ import annotations


def _srgb_channel_to_linear(c: float) -> float:
    """sRGB → linear for one channel in [0, 1] (the standard IEC 61966-2-1 transfer function)."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgb(hex_str: str) -> tuple[float, float, float]:
    """Parse a '#RRGGBB' colour (leading '#' optional) → linear-space (r, g, b) in [0, 1] for a Blender
    Base Color input. Raises ValueError on anything that isn't exactly 6 hex digits. core-api already
    validated the hex at enqueue (D-E); the raise is a defensive backstop the caller turns into 'skip this
    object' rather than a crashed render."""
    s = hex_str.strip().lstrip("#")
    if len(s) != 6:
        raise ValueError(f"expected #RRGGBB, got {hex_str!r}")
    try:
        r, g, b = (int(s[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError as e:
        raise ValueError(f"non-hex digits in {hex_str!r}") from e
    return (
        _srgb_channel_to_linear(r),
        _srgb_channel_to_linear(g),
        _srgb_channel_to_linear(b),
    )


if __name__ == "__main__":
    # ponytail: assert-based self-check (this service has no pytest) — run `python3 _color.py`.
    def _approx(a, b, eps=1e-6):
        return all(abs(x - y) < eps for x, y in zip(a, b))

    assert hex_to_linear_rgb("#000000") == (0.0, 0.0, 0.0)
    assert _approx(hex_to_linear_rgb("#ffffff"), (1.0, 1.0, 1.0))
    assert _approx(hex_to_linear_rgb("ffffff"), (1.0, 1.0, 1.0))  # leading '#' optional
    # sRGB 0x80 (~0.502) MUST linearize downward to ~0.21 — not pass through as 0.502. This is the bug the
    # whole helper exists to prevent (Base Color fed raw sRGB → parts too dark).
    mid = hex_to_linear_rgb("#808080")[0]
    assert 0.20 < mid < 0.23, mid
    # pure red: R→1.0, G/B→0.0 (channels are independent)
    assert _approx(hex_to_linear_rgb("#ff0000"), (1.0, 0.0, 0.0))
    # uppercase hex digits parse the same
    assert _approx(hex_to_linear_rgb("#FF0000"), (1.0, 0.0, 0.0))
    for bad in ("#fff", "#gggggg", "12345", "", "#1234567"):
        try:
            hex_to_linear_rgb(bad)
            raise AssertionError(f"expected ValueError for {bad!r}")
        except ValueError:
            pass
    print("_color self-check OK")
