// Layerport, sandbox side.
// Selection (frames or whole Sections) -> layer spec + PNG bytes -> the UI
// composes layered PSDs with ag-psd. Image-bearing layers export hi-res
// (up to 3x, capped at 6000px on the long edge) and embed as Smart Objects.
// Hidden layers can carry over as hidden PSD layers. Rotated subtrees are
// flattened safely. Opacity and blend modes carry per layer.

import type { ColorSpec, GroupSpec, LayerSpec, RasterSpec, TextRunSpec, TextSpec, UnitValue } from './shared/spec';

figma.showUI(__html__, { width: 420, height: 720, themeColors: false });

let EXPORT_SCALE = 1;
let JPG_SCALE = 0; // 0 = no JPG proof
let PNG_SCALE = 0; // 0 = no PNG proof
let INCLUDE_HIDDEN = false;
// After Effects handoff: AE ignores embedded Smart Object sources and works
// from the preview pixels, so hi-res embedding is wasted bytes. Image layers
// export at canvas resolution as plain pixel layers instead.
let AE_PRESET = false;
const HI_SCALE = 3;
const MAX_EDGE = 6000;

function psFontName(family: string, style: string): string {
  return String(family).replace(/\s+/g, '') + '-' + String(style).replace(/\s+/g, '');
}

function solidOf(paints: readonly Paint[] | PluginAPI['mixed'] | null | undefined): ColorSpec | null {
  if (paints === figma.mixed || !paints || !(paints as readonly Paint[]).length) return null;
  for (const p of paints as readonly Paint[]) {
    if (p.visible === false) continue;
    if (p.type === 'SOLID') {
      return {
        r: Math.round(p.color.r * 255),
        g: Math.round(p.color.g * 255),
        b: Math.round(p.color.b * 255),
        opacity: p.opacity == null ? 1 : p.opacity,
      };
    }
    return null;
  }
  return null;
}

function paintsHaveImage(paints: readonly Paint[] | PluginAPI['mixed'] | null | undefined): boolean {
  if (paints === figma.mixed || !paints) return false;
  for (const p of paints as readonly Paint[]) {
    if (p.visible !== false && p.type === 'IMAGE') return true;
  }
  return false;
}

function ownImage(node: SceneNode): boolean {
  const n = node as any;
  return ('fills' in node && paintsHaveImage(n.fills)) || ('strokes' in node && paintsHaveImage(n.strokes));
}

function subtreeHasImage(node: SceneNode): boolean {
  if (!INCLUDE_HIDDEN && node.visible === false) return false;
  if (ownImage(node)) return true;
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (subtreeHasImage(child)) return true;
    }
  }
  return false;
}

function hasOwnPaint(node: SceneNode): boolean {
  const n = node as any;
  const f: readonly Paint[] | PluginAPI['mixed'] | null = 'fills' in node ? n.fills : null;
  const s: readonly Paint[] | PluginAPI['mixed'] | null = 'strokes' in node ? n.strokes : null;
  const hasFill = f && f !== figma.mixed && (f as readonly Paint[]).some((p) => p.visible !== false);
  const hasStroke = s && s !== figma.mixed && (s as readonly Paint[]).some((p) => p.visible !== false);
  return !!(hasFill || hasStroke);
}

function hasTextDeep(node: SceneNode): boolean {
  if (node.type === 'TEXT') return true;
  if (!('children' in node)) return false;
  for (const c of (node as ChildrenMixin).children) {
    if (!INCLUDE_HIDDEN && c.visible === false) continue;
    if (hasTextDeep(c)) return true;
  }
  return false;
}

function isRotated(node: SceneNode): boolean {
  const t = node.absoluteTransform;
  return Math.abs(t[0][1]) > 0.001 || Math.abs(t[1][0]) > 0.001;
}

function relPos(node: SceneNode, base: { x: number; y: number }): { x: number; y: number } {
  const t = node.absoluteTransform;
  return { x: t[0][2] - base.x, y: t[1][2] - base.y };
}

function hiScaleFor(w: number, h: number): number {
  const edge = Math.max(w, h);
  return Math.max(1, Math.min(HI_SCALE, MAX_EDGE / edge));
}

const BLEND: Record<string, string> = {
  NORMAL: 'normal', DARKEN: 'darken', MULTIPLY: 'multiply', COLOR_BURN: 'color burn',
  LINEAR_BURN: 'linear burn', LIGHTEN: 'lighten', SCREEN: 'screen', COLOR_DODGE: 'color dodge',
  LINEAR_DODGE: 'linear dodge', OVERLAY: 'overlay', SOFT_LIGHT: 'soft light', HARD_LIGHT: 'hard light',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation',
  COLOR: 'color', LUMINOSITY: 'luminosity', PASS_THROUGH: 'pass through',
};

function commonProps<T extends LayerSpec>(node: SceneNode, spec: T): T {
  spec.opacity = 'opacity' in node ? (node as any).opacity : 1;
  spec.blend = BLEND[(node as any).blendMode] || 'normal';
  return spec;
}

// Instance sublayers must not be mutated, not even visibility. Writing an
// override makes Figma rebuild that instance's sublayer tree, and every node
// reference the plugin still holds into it throws "node does not exist" on
// the next read or write. Reviewer-reported on a six-level nested instance.
// Anything that needs a temporary change is done on a detached clone.
function inInstance(node: SceneNode): boolean {
  return node.type === 'INSTANCE' || node.id.charAt(0) === 'I';
}

// Clone a node into a temp page-level frame at the same absolute transform,
// detached from its component so it can be edited freely. Caller disposes.
function stageClone(node: SceneNode): { shell: SceneNode; dispose: () => void } {
  const tmp = figma.createFrame();
  figma.currentPage.appendChild(tmp);
  tmp.name = '__layerport_tmp';
  tmp.fills = [];
  tmp.clipsContent = false;
  let shell: SceneNode = node.clone();
  tmp.appendChild(shell);
  shell.relativeTransform = node.absoluteTransform;
  if (shell.type === 'INSTANCE') shell = shell.detachInstance();
  return { shell, dispose: () => tmp.remove() };
}

async function exportPng(node: SceneNode, scale: number): Promise<Uint8Array> {
  return await (node as ExportMixin & SceneNode).exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
}

// Export a rotated node by cloning into a temp frame at its render bounds.
async function exportRotated(node: SceneNode, base: { x: number; y: number }, warnings: string[]): Promise<RasterSpec | null> {
  const rb = (node as SceneNode & { absoluteRenderBounds: Rect | null }).absoluteRenderBounds;
  if (!rb) return null;
  const tmp = figma.createFrame();
  figma.currentPage.appendChild(tmp);
  tmp.name = '__layerport_export_tmp';
  tmp.fills = [];
  tmp.clipsContent = false;
  tmp.resizeWithoutConstraints(Math.max(1, rb.width), Math.max(1, rb.height));
  tmp.x = rb.x;
  tmp.y = rb.y;
  const clone = node.clone();
  tmp.appendChild(clone);
  const t = node.absoluteTransform;
  clone.relativeTransform = [
    [t[0][0], t[0][1], t[0][2] - rb.x],
    [t[1][0], t[1][1], t[1][2] - rb.y],
  ];
  clone.visible = true;
  const hi = !AE_PRESET && subtreeHasImage(node);
  const scale = hi ? hiScaleFor(rb.width, rb.height) : EXPORT_SCALE;
  let bytes: Uint8Array;
  try {
    bytes = await exportPng(tmp, scale);
  } finally {
    tmp.remove();
  }
  warnings.push('Rotated layer "' + node.name + '" flattened to raster.');
  return {
    kind: 'raster', name: node.name,
    x: rb.x - base.x, y: rb.y - base.y, w: rb.width, h: rb.height,
    png: bytes, hiRes: hi && scale > 1 ? scale : 0,
  };
}

async function renderedLines(
  node: TextNode,
  fontName: FontName,
  fontSize: number,
  letterSpacing: UnitValue,
  lineHeight: UnitValue,
): Promise<string> {
  // Hug boxes never soft-wrap; fixed and auto-height boxes wrap at node width.
  if (node.textAutoResize === 'WIDTH_AND_HEIGHT') return node.characters;
  const chars = node.characters;
  if (chars.indexOf(' ') < 0) return chars;
  try {
    await figma.loadFontAsync(fontName);
    const m = figma.createText();
    m.fontName = fontName;
    m.fontSize = fontSize;
    if (letterSpacing && letterSpacing.unit) m.letterSpacing = letterSpacing as LetterSpacing;
    if (lineHeight && lineHeight.unit) m.lineHeight = lineHeight as LineHeight;
    m.textAutoResize = 'HEIGHT';
    m.resize(node.width, m.height);
    m.characters = 'Ag';
    const oneLine = m.height;
    const out: string[] = [];
    const paras = chars.split('\n');
    for (const para of paras) {
      const words = para.split(' ');
      let current = '';
      for (const word of words) {
        const test = current ? current + ' ' + word : word;
        m.characters = test;
        if (m.height > oneLine * 1.5 && current) {
          out.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      out.push(current);
    }
    m.remove();
    return out.join('\n');
  } catch (e) {
    return chars;
  }
}

async function textSpec(node: TextNode, base: { x: number; y: number }, warnings: string[]): Promise<TextSpec> {
  const pos = relPos(node, base);
  let segs: any[] | null;
  try {
    segs = node.getStyledTextSegments(['fontSize', 'fontName', 'fills', 'letterSpacing', 'lineHeight', 'openTypeFeatures']) as any[];
  } catch (e) {
    segs = null;
  }
  const s0 = segs && segs.length ? segs[0] : null;
  const fontName: FontName = s0 ? s0.fontName : (node.fontName as FontName);
  const fontSize: number = s0 ? s0.fontSize : (node.fontSize as number);
  let color = solidOf(s0 ? s0.fills : node.fills);
  if (!color) {
    color = { r: 0, g: 0, b: 0, opacity: 1 };
    warnings.push('Text "' + node.characters.slice(0, 24) + '" has a non-solid fill, exported black.');
  }
  const lh: any = s0 ? s0.lineHeight : node.lineHeight;
  const ls: any = s0 ? s0.letterSpacing : node.letterSpacing;
  const lhSafe: UnitValue = lh && lh.unit ? lh : { unit: 'AUTO' };
  const lsSafe: UnitValue = ls && ls.unit ? ls : { unit: 'PERCENT', value: 0 };
  const chars = await renderedLines(node, fontName, fontSize, lsSafe, lhSafe);
  let runs: TextRunSpec[] | null = null;
  if (segs && segs.length > 1) {
    runs = segs.map((s: any) => {
      const otf = s.openTypeFeatures || {};
      return {
        length: s.characters.length,
        fontSize: s.fontSize,
        psFont: psFontName(s.fontName.family, s.fontName.style),
        color: solidOf(s.fills) || { r: 0, g: 0, b: 0, opacity: 1 },
        letterSpacing: s.letterSpacing && s.letterSpacing.unit ? s.letterSpacing : { unit: 'PERCENT', value: 0 },
        sups: !!otf.SUPS,
        subs: !!otf.SUBS,
      };
    });
  }
  return commonProps(node, {
    kind: 'text', name: node.name, chars,
    x: pos.x, y: pos.y, w: node.width, h: node.height,
    fontSize, psFont: psFontName(fontName.family, fontName.style),
    color,
    lineHeight: lhSafe,
    letterSpacing: lsSafe,
    align: node.textAlignHorizontal,
    runs,
  } as TextSpec);
}

async function rasterSpec(node: SceneNode, base: { x: number; y: number }): Promise<RasterSpec> {
  const pos = relPos(node, base);
  const hi = !AE_PRESET && subtreeHasImage(node);
  const scale = hi ? hiScaleFor(node.width, node.height) : EXPORT_SCALE;
  const bytes = await exportPng(node, scale);
  return commonProps(node, {
    kind: 'raster', name: node.name,
    x: pos.x, y: pos.y, w: node.width, h: node.height,
    png: bytes, hiRes: hi && scale > 1 ? scale : 0,
  } as RasterSpec);
}

async function bgRaster(node: SceneNode, base: { x: number; y: number }): Promise<RasterSpec> {
  const hi = !AE_PRESET && ownImage(node);
  const scale = hi ? hiScaleFor(node.width, node.height) : EXPORT_SCALE;
  let bytes: Uint8Array | null = null;
  if (inInstance(node)) {
    // Render the container shell from a detached clone; the source instance
    // is never touched.
    const staged = stageClone(node);
    try {
      if ('children' in staged.shell) {
        for (const c of (staged.shell as ChildrenMixin).children) c.visible = false;
      }
      bytes = await exportPng(staged.shell, scale);
    } finally {
      staged.dispose();
    }
  } else {
    const hidden: SceneNode[] = [];
    if ('children' in node) {
      for (const c of (node as ChildrenMixin).children) {
        if (c.visible) {
          c.visible = false;
          hidden.push(c);
        }
      }
    }
    try {
      bytes = await exportPng(node, scale);
    } finally {
      for (const h of hidden) h.visible = true;
    }
  }
  const pos = relPos(node, base);
  return commonProps(node, {
    kind: 'raster', name: node.name + ' (bg)',
    x: pos.x, y: pos.y, w: node.width, h: node.height,
    png: bytes, hiRes: hi && scale > 1 ? scale : 0,
  } as RasterSpec);
}

async function walk(node: SceneNode, base: { x: number; y: number }, warnings: string[]): Promise<LayerSpec | null> {
  const wasHidden = node.visible === false;
  if (wasHidden && !INCLUDE_HIDDEN) return null;
  if (wasHidden && inInstance(node)) {
    // Cannot flip visibility inside an instance; walk a visible detached
    // clone at the same position instead and mark the result hidden.
    const staged = stageClone(node);
    try {
      staged.shell.visible = true;
      const spec = await walk(staged.shell, base, warnings);
      if (spec) {
        spec.hidden = true;
        spec.name = node.name;
      }
      return spec;
    } finally {
      staged.dispose();
    }
  }
  if (wasHidden) node.visible = true;
  let spec: LayerSpec | null = null;
  try {
    if (node.type === 'TEXT') {
      spec = await textSpec(node, base, warnings);
    } else if (isRotated(node)) {
      spec = await exportRotated(node, base, warnings);
    } else {
      const isContainer = 'children' in node && (node as ChildrenMixin).children.length > 0;
      // Flatten only when nothing below needs its own layer: no text AND no
      // image-bearing children (a lone image node itself stays a single
      // raster/Smart Object; siblings with images each get their own layer).
      let childHasImage = false;
      if (isContainer) {
        for (const c of (node as ChildrenMixin).children) {
          if (subtreeHasImage(c)) {
            childHasImage = true;
            break;
          }
        }
      }
      if (!isContainer || (!hasTextDeep(node) && !childHasImage)) {
        spec = await rasterSpec(node, base);
      } else {
        const layers: LayerSpec[] = [];
        if (hasOwnPaint(node)) layers.push(await bgRaster(node, base));
        for (const c of (node as ChildrenMixin).children) {
          const child = await walk(c, base, warnings);
          if (child) layers.push(child);
        }
        spec = commonProps(node, { kind: 'group', name: node.name, layers } as GroupSpec);
      }
    }
  } finally {
    if (wasHidden) node.visible = false;
  }
  if (spec && wasHidden) spec.hidden = true;
  return spec;
}

function expandSelection(): SceneNode[] {
  const out: SceneNode[] = [];
  function collect(n: SceneNode) {
    if (n.type === 'SECTION') {
      for (const c of n.children) collect(c);
    } else if (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'GROUP') {
      out.push(n);
    }
  }
  for (const n of figma.currentPage.selection) collect(n);
  return out;
}

async function run() {
  const sel = expandSelection();
  if (!sel.length) {
    figma.ui.postMessage({ type: 'status', text: 'Select frames or a Section first, then press Export again.' });
    return;
  }
  figma.ui.postMessage({ type: 'begin', count: sel.length });
  for (let i = 0; i < sel.length; i++) {
    const root = sel[i];
    const t = root.absoluteTransform;
    const base = { x: t[0][2], y: t[1][2] };
    const warnings: string[] = [];
    figma.ui.postMessage({ type: 'status', text: 'Reading ' + root.name + ' (' + (i + 1) + '/' + sel.length + ')...' });
    try {
      const spec = await walk(root, base, warnings);
      const composite = await exportPng(root, EXPORT_SCALE);
      // Proofs are PNG bytes at the requested scale; the UI converts the JPG
      // one. Renders are reused when scales coincide.
      let proofJpg: Uint8Array | null = null;
      if (JPG_SCALE === EXPORT_SCALE) proofJpg = composite;
      else if (JPG_SCALE > 0) proofJpg = await exportPng(root, JPG_SCALE);
      let proofPng: Uint8Array | null = null;
      if (PNG_SCALE === EXPORT_SCALE) proofPng = composite;
      else if (PNG_SCALE > 0 && PNG_SCALE === JPG_SCALE) proofPng = proofJpg;
      else if (PNG_SCALE > 0) proofPng = await exportPng(root, PNG_SCALE);
      figma.ui.postMessage({
        type: 'piece', name: root.name, page: figma.currentPage.name, index: i + 1,
        width: Math.round(root.width), height: Math.round(root.height),
        scale: EXPORT_SCALE, spec, composite,
        proofJpg, proofPng, warnings,
      });
      await new Promise<void>((resolve) => {
        figma.ui.once('message', () => resolve());
      });
    } catch (err: any) {
      figma.ui.postMessage({ type: 'pieceError', name: root.name, error: String((err && err.message) || err) });
    }
  }
  figma.ui.postMessage({ type: 'done' });
}

figma.ui.onmessage = async (msg: any) => {
  if (!msg) return;
  if (msg.type === 'export') {
    EXPORT_SCALE = msg.scale === 2 ? 2 : 1;
    JPG_SCALE = msg.jpgScale || 0;
    PNG_SCALE = msg.pngScale || 0;
    INCLUDE_HIDDEN = !!msg.includeHidden;
    AE_PRESET = !!msg.aePreset;
    run();
  } else if (msg.type === 'saveRenameMap') {
    await figma.clientStorage.setAsync('layerportRenameMap', msg.map);
    figma.ui.postMessage({ type: 'renameMapLoaded', count: Object.keys(msg.map).length });
  }
};

(async function init() {
  const map = await figma.clientStorage.getAsync('layerportRenameMap');
  if (map) figma.ui.postMessage({ type: 'renameMapLoaded', count: Object.keys(map).length, map });
})();
