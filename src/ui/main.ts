// Layerport UI thread. Receives layer specs + PNG bytes from the sandbox,
// composes PSD documents with ag-psd, and hands the files to the browser.

import { writePsdUint8Array } from 'ag-psd';
import type { GroupSpec, LayerSpec } from '../shared/spec';
import { exportName, parseRenameMap } from './naming';
import { canvasToImageData, decodePng, imgToCanvas, toPsdLayer, type LinkedFile } from './psd';
import { encodeTiff, type TiffMode } from './tiff';
import { buildZip, type ZipEntry } from './zip';

let renameMap: Record<string, string> = {};
// Every file the run produces accumulates here and is delivered ONCE at the
// end: a single file downloads directly, anything more becomes one ZIP.
// Figma's plugin sandbox honors only the first synthetic download click per
// burst, so firing psd + proofs + tiff as separate downloads loses files.
let runFiles: ZipEntry[] = [];
let runBase: string | null = null;
let batchCount = 0;
const usedNames = new Set<string>();
// Settings snapshot taken when Export is pressed, so changing controls while
// a batch is composing cannot produce mixed output.
let settings = { dpi: 72, tiff: false, tiffMode: 'rgb' as TiffMode, jpgScale: 0, pngScale: 0, template: '{frame}' };

const MIME: Record<string, string> = {
  psd: 'image/vnd.adobe.photoshop',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
};

const $ = (id: string) => document.getElementById(id)!;
const checked = (id: string) => ($(id) as HTMLInputElement).checked;
const selValue = (id: string) => ($(id) as HTMLSelectElement).value;
const log = $('log');

function addRow(text: string, cls?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'row' + (cls ? ' ' + cls : '');
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function uniqueName(base: string): string {
  let name = base;
  for (let i = 2; usedNames.has(name); i++) name = base + '-' + i;
  usedNames.add(name);
  return name;
}

$('saveRenameMap').onclick = () => {
  try {
    const map = parseRenameMap(($('renameMapBox') as HTMLTextAreaElement).value);
    renameMap = map;
    parent.postMessage({ pluginMessage: { type: 'saveRenameMap', map } }, '*');
  } catch (e: any) {
    addRow('Rename map parse failed: ' + e.message, 'err');
  }
};

$('go').onclick = () => {
  log.replaceChildren();
  usedNames.clear();
  settings = {
    dpi: parseInt(selValue('dpi'), 10) || 72,
    tiff: checked('tiffOut'),
    tiffMode: selValue('tiffMode') as TiffMode,
    jpgScale: checked('jpgProof') ? parseInt(selValue('jpgScale'), 10) : 0,
    pngScale: checked('pngProof') ? parseInt(selValue('pngScale'), 10) : 0,
    template: ($('nameTemplate') as HTMLInputElement).value,
  };
  parent.postMessage(
    {
      pluginMessage: {
        type: 'export',
        scale: checked('scale2') ? 2 : 1,
        jpgScale: settings.jpgScale,
        pngScale: settings.pngScale,
        includeHidden: checked('includeHidden'),
        aePreset: checked('aePreset'),
      },
    },
    '*',
  );
};

async function toJpegBytes(pngBytes: Uint8Array): Promise<Uint8Array> {
  const img = await decodePng(pngBytes);
  const canvas = imgToCanvas(img, img.naturalWidth, img.naturalHeight);
  return await new Promise<Uint8Array>((resolve) => {
    canvas.toBlob(
      (blob) => {
        blob!.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)));
      },
      'image/jpeg',
      0.92,
    );
  });
}

function tiffFromCanvas(canvas: HTMLCanvasElement, mode: TiffMode, dpi: number): Uint8Array {
  // Composite over white first: print files have no alpha, and JPEG-style
  // black fill is the wrong default for paper.
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  const rgba = ctx.getImageData(0, 0, flat.width, flat.height).data;
  return encodeTiff(rgba, flat.width, flat.height, dpi, mode);
}

onmessage = async (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (!msg) return;
  if (msg.type === 'renameMapLoaded') {
    if (msg.map) renameMap = msg.map;
    $('renameMapStatus').textContent = '(' + msg.count + ' names loaded)';
    return;
  }
  if (msg.type === 'begin') {
    batchCount = msg.count;
    runFiles = [];
    runBase = null;
    return;
  }
  if (msg.type === 'status') {
    addRow(msg.text);
    return;
  }
  if (msg.type === 'pieceError') {
    addRow(msg.name + ' FAILED while reading: ' + msg.error, 'err');
    return;
  }
  if (msg.type === 'done') {
    if (runFiles.length === 1) {
      const f = runFiles[0];
      const ext = f.name.slice(f.name.lastIndexOf('.') + 1);
      download(new Blob([f.data as BlobPart], { type: MIME[ext] || 'application/octet-stream' }), f.name);
      addRow('Downloaded ' + f.name + '.', 'ok');
    } else if (runFiles.length > 1) {
      const zipRow = addRow('Zipping ' + runFiles.length + ' files...');
      const zip = buildZip(runFiles);
      const zipName = batchCount === 1 && runBase ? runBase + '.zip' : 'Layerport_' + runFiles.length + 'files_' + Math.round(zip.size / 1048576) + 'MB.zip';
      download(zip, zipName);
      zipRow.textContent = zipName + ' downloaded (' + runFiles.length + ' files in one ZIP; Figma allows one save per export).';
      zipRow.className = 'row ok';
    }
    runFiles = [];
    addRow('All done.', 'ok');
    return;
  }
  if (msg.type !== 'piece') return;
  const row = addRow('Composing ' + msg.name + '...');
  try {
    const scale: number = msg.scale || 1;
    const dpi = settings.dpi;
    const spec: LayerSpec = msg.spec;
    const rootLayers = spec.kind === 'group' ? (spec as GroupSpec).layers : [spec];
    const linkedFiles: LinkedFile[] = [];
    const children = [];
    for (const l of rootLayers) children.push(await toPsdLayer(l, scale, linkedFiles));
    const compImg = await decodePng(msg.composite);
    const compCanvas = imgToCanvas(compImg, compImg.naturalWidth, compImg.naturalHeight);
    const psd: any = {
      width: msg.width * scale,
      height: msg.height * scale,
      imageData: canvasToImageData(compCanvas),
      imageResources: {
        resolutionInfo: {
          horizontalResolution: dpi,
          horizontalResolutionUnit: 'PPI',
          widthUnit: 'Inches',
          verticalResolution: dpi,
          verticalResolutionUnit: 'PPI',
          heightUnit: 'Inches',
        },
      },
      children,
    };
    if (linkedFiles.length) psd.linkedFiles = linkedFiles;
    const buf = writePsdUint8Array(psd, { generateThumbnail: true });
    const base = uniqueName(
      exportName(msg.name, renameMap, settings.template, {
        frame: msg.name,
        page: msg.page || '',
        n: msg.index || 1,
        width: msg.width,
        height: msg.height,
      }),
    );
    if (!runBase) runBase = base;
    let tiff: Uint8Array | null = null;
    if (settings.tiff) tiff = tiffFromCanvas(compCanvas, settings.tiffMode, dpi);
    runFiles.push({ name: base + '.psd', data: buf });
    if (msg.proofJpg) runFiles.push({ name: base + '.jpg', data: await toJpegBytes(msg.proofJpg) });
    if (msg.proofPng) runFiles.push({ name: base + '.png', data: new Uint8Array(msg.proofPng) });
    if (tiff) runFiles.push({ name: base + '.tif', data: tiff });
    const extras = [msg.proofJpg && 'JPG', msg.proofPng && 'PNG', tiff && 'TIFF'].filter(Boolean).join(', ');
    row.textContent = base + ' -> PSD (' + Math.round(buf.byteLength / 1024) + ' KB, ' + linkedFiles.length + ' smart objects' + (extras ? ', +' + extras : '') + ')';
    row.className = 'row ok';
    (msg.warnings || []).forEach((w: string) => addRow(msg.name + ': ' + w, 'warn'));
  } catch (err: any) {
    row.textContent = msg.name + ' FAILED: ' + err.message;
    row.className = 'row err';
  }
  parent.postMessage({ pluginMessage: { type: 'ack' } }, '*');
};
