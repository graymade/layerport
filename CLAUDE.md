# Layerport, Claude Code Instructions

Open source Figma plugin (MIT) that exports frames to layered, editable PSD
files. Public-facing project by Sam Gray. TypeScript, esbuild, ag-psd.

## Rules

- This is public code. No client names, client fonts, or client file
  references anywhere in source, comments, or copy. Sam's Club/ISB specifics
  live only in the private predecessor at `~/figma-plugins/sc-psd-exporter`.
- The rename map must stay backward compatible with the DSS JSON format
  (`deliverable_id` / `export_filename` keys) so ISB workflows keep working.
- Keep sandbox logic (`src/code.ts`) and PSD composition (`src/ui/psd.ts`)
  behavior-stable. They are proven against real production exports. Improve
  via new options, not silent behavior changes.
- `npm run build` then `npm run typecheck` before any commit.
- Test loads happen via Figma desktop: Plugins > Development > Import plugin
  from manifest.
- No em dashes in copy or comments.

## Layout

- `src/code.ts` sandbox: walks selection, produces layer specs + PNG bytes
- `src/shared/spec.ts` spec types shared by both threads
- `src/ui/` UI thread: `main.ts` wiring, `psd.ts` ag-psd composition,
  `metrics.ts` font baseline math, `zip.ts` batch ZIP, `naming.ts` rename map
- `build.mjs` bundles to `dist/` and inlines the UI bundle into one HTML file
- `ROADMAP.md` planned features, ordered; update it when scope changes
