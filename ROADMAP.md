# Layerport Roadmap

Features ordered by how much they matter to the people this plugin serves:
designers handing layered files to retouchers, print production, packaging,
and motion teams.

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

- **CMYK output and TIFF export.** The print and packaging feature. Requires
  color conversion (likely via a bundled ICC transform) and ag-psd CMYK mode.
- **DPI tagging** (72/150/300) on export so files open at the right physical
  size in print workflows.
- **After Effects handoff preset.** PSD structured for AE import: no Smart
  Object nesting surprises, groups arranged for composition import, optional
  1080p/4K canvas presets.
- **Export presets.** Named bundles of settings (scale, JPG proof, hidden
  layers, rename map) switchable per project.
- **Naming templates.** Tokens like `{frame}`, `{page}`, `{date}`, `{#id}` for
  batch filenames, beyond the ID map.
- **Linked (not embedded) Smart Objects** writing the hi-res PNGs beside the
  PSD for smaller files and shared assets.

## Not planned

- Anything requiring network access. The no-network manifest is a feature.
- Full effect parity with Photoshop. Blurs and background blurs will stay
  rasterized.
