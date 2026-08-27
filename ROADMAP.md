# Layerport Roadmap

Features ordered by how much they matter to the people this plugin serves:
designers handing layered files to retouchers, print production, packaging,
and motion teams.

## Shipped in 1.1

- PNG or JPG flat proofs at 1x to 4x.
- Flattened TIFF export, RGB or standard-conversion CMYK, with DPI tagging.
- DPI tagging on the PSD itself (72/150/300 PPI).
- After Effects handoff preset (plain pixel layers instead of Smart Objects,
  since AE reads preview pixels only).
- Naming templates with {frame} {page} {date} {n} {width} {height} tokens,
  plus the [#ID] rename map as an explicit per-frame override.
- Brand mark, themed UI with cards, Figma light/dark support.

## Near term (free, high value)

- **Effects as layer styles.** Map Figma drop shadow, inner shadow, and
  stroke to native PSD layer styles instead of baking them into pixels.
  ag-psd supports `effects` on layers, so this is mostly a mapping exercise.
- **Vector shapes as PSD shape layers.** Rectangles, ellipses, and simple
  vector fills become editable shape layers instead of rasters. Keeps logos
  and dividers editable.
- **Per-layer export overrides.** A naming convention or plugin data flag to
  force a subtree to flatten, force a Smart Object, or exclude a layer from
  export.
- **Custom font metrics.** Let users paste ascent/descent/upm for their brand
  fonts in the UI instead of editing `src/ui/metrics.ts`. Persist in client
  storage next to the rename map.
- **Gradient fills on shapes** as PSD gradient fill layers where they map
  cleanly.

## Later (candidates for a paid Pro tier)

- **ICC-profiled CMYK.** Today's CMYK TIFF uses the standard formula. Real
  profile-based separation (GRACoL, FOGRA) needs a bundled ICC transform.
- **Layered CMYK PSD.** Blocked on the PSD writer; ag-psd composes RGB only.
- **Export presets.** Named bundles of settings (scale, proofs, TIFF, hidden
  layers, naming) switchable per project.
- **Linked (not embedded) Smart Objects** writing the hi-res PNGs beside the
  PSD. Deliberately deferred: linked files break with "missing file" alerts
  whenever assets move, which turns into support burden. Embedded is the
  safer default; revisit only if users ask.

## Not planned

- Anything requiring network access. The no-network manifest is a feature.
- Full effect parity with Photoshop. Blurs and background blurs will stay
  rasterized.
