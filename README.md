# Layerport

**Export Figma frames to layered, editable PSD files.**

Most Figma-to-PSD tools flatten everything into pixels. Layerport builds PSDs the way a production designer would by hand:

- **Live, editable text.** Text layers arrive in Photoshop as real point text with font, size, color, letter spacing, line height, alignment, and per-run styling (mixed fonts, sizes, colors, superscript and subscript). Figma's soft wraps are baked in as real line breaks so layout matches.
- **Hi-res Smart Objects.** Image-bearing layers export at up to 3x (capped at a 6000px long edge) and embed as Smart Objects placed at layout size, so retouchers can scale and transform without quality loss.
- **Structure carries over.** Groups stay groups, blend modes map to their Photoshop equivalents, layer opacity carries, and hidden layers can come along as hidden PSD layers.
- **Batch export.** Select multiple frames or a whole Section. Batches download as a single ZIP instead of a queue of save dialogs.
- **Naming templates.** Filenames build from tokens like `{frame}`, `{page}`, `{date}`, `{n}`, `{width}`, `{height}`. An optional rename map exports frames tagged `[#ID]` under canonical filenames, which is handy for deliverable lists.
- **Print-aware output.** Tag PSDs at 72, 150, or 300 PPI so they open at the right physical size. Optionally export a flattened TIFF (RGB or standard-conversion CMYK) with the same resolution tag.
- **After Effects handoff preset.** AE reads preview pixels rather than embedded Smart Object sources, so this preset exports image layers as plain pixel layers at canvas resolution. Pair with 2x for scaling headroom.
- **Flat proofs** as JPG or PNG at 1x to 4x alongside each PSD, and an optional 2x canvas export.
- **Private by design.** No network access. Everything runs inside Figma on your machine.

## Install

From the Figma Community: search for "Layerport" (link coming after first publish).

To run the development build:

1. `npm install`
2. `npm run build`
3. In the Figma desktop app: Plugins > Development > Import plugin from manifest, and choose this folder's `manifest.json`.

## Use

1. Select one or more frames, groups, components, or a whole Section.
2. Run Layerport and press **Export selection to PSD**.
3. Files land in your Downloads folder. Single exports save directly, batches save as one ZIP.

### Batch rename map

Frames named with a `[#ID]` tag anywhere in the name (for example `Hero [#123]`) export under the filename mapped to that ID. Paste any of these into the rename map box:

```json
{ "123": "hero_banner_wk36" }
```

```json
[{ "id": "123", "filename": "hero_banner_wk36" }]
```

```csv
123,hero_banner_wk36
```

The map persists between sessions.

## How it works

Figma plugins run in two contexts. The sandbox (`src/code.ts`) walks the selection and produces a layer spec: live text attributes for text nodes, PNG bytes for raster content, groups for structure. The UI thread (`src/ui/`) composes that spec into a PSD document with [ag-psd](https://github.com/Agamnentzar/ag-psd) and hands the file to the browser. Rotated subtrees are flattened safely through a temporary frame. Containers with no text or image content below them are flattened into single layers to keep files sane.

## Known limitations

- Gradient and image text fills export as solid black (with a warning). Photoshop point text has no gradient fill concept.
- Figma effects (shadows, blurs) on non-flattened layers are not yet mapped to PSD layer styles.
- Vector shapes rasterize; they do not become PSD shape layers yet.
- CMYK TIFF uses the standard conversion formula, not an ICC profile. It gives print vendors a correctly structured CMYK file, but final separations should go through a color-managed tool. The layered PSD itself stays RGB.
- Font baseline placement uses a metrics table (`src/ui/metrics.ts`). Fonts not in the table use a close default; add your brand fonts there for exact baselines.

See [ROADMAP.md](ROADMAP.md) for what is planned.

## Development

- `npm run build` builds `dist/code.js` and `dist/ui.html`
- `npm run watch` rebuilds on change
- `npm run typecheck` runs TypeScript checks

## License

Free and open source under the [MIT license](LICENSE): use it, modify it, ship it, just keep the copyright notice.

Made by [Sam Gray](https://x.com/samuelgrayart).
