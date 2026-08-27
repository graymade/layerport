// Layerport UI thread. Receives layer specs + PNG bytes from the sandbox,
// composes PSD documents with ag-psd, and hands the files to the browser.

import { writePsdUint8Array } from 'ag-psd';
import type { GroupSpec, LayerSpec } from '../shared/spec';
import { exportName, parseRenameMap } from './naming';
import { canvasToImageData, decodePng, imgToCanvas, toPsdLayer, type LinkedFile } from './psd';
import { buildZip, type ZipEntry } from './zip';

let renameMap: Record<string, string> = {};
let batchFiles: ZipEntry[] = [];
let batchCount = 0;

const $ = (id: string) => document.getElementById(id)!;
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
  parent.postMessage(
    {
      pluginMessage: {
        type: 'export',
        scale: ($('scale2') as HTMLInputElement).checked ? 2 : 1,
        jpgScale: ($('jpgPair') as HTMLInputElement).checked ? parseInt(($('jpgScale') as HTMLSelectElement).value, 10) : 0,
        includeHidden: ($('includeHidden') as HTMLInputElement).checked,
      },
    },
    '*',
  );
};

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
    batchFiles = [];
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
    if (batchFiles.length > 0) {
      const zipRow = addRow('Zipping ' + batchFiles.length + ' files...');
      const zip = buildZip(batchFiles);
      download(zip, 'Layerport_' + batchFiles.length + 'files_' + Math.round(zip.size / 1048576) + 'MB.zip');
      zipRow.textContent = 'ZIP downloaded (' + batchFiles.length + ' files, one save dialog).';
      zipRow.className = 'row ok';
      batchFiles = [];
    }
    addRow('All done.', 'ok');
    return;
  }
  if (msg.type !== 'piece') return;
  const row = addRow('Composing ' + msg.name + '...');
  try {
    const scale: number = msg.scale || 1;
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
      children,
    };
    if (linkedFiles.length) psd.linkedFiles = linkedFiles;
    const buf = writePsdUint8Array(psd, { generateThumbnail: true });
    const base = exportName(msg.name, renameMap);
    let jpgBytes: Uint8Array | null = null;
    if (msg.jpgComposite) {
      const jpgImg = await decodePng(msg.jpgComposite);
      const jpgCanvas = imgToCanvas(jpgImg, jpgImg.naturalWidth, jpgImg.naturalHeight);
      jpgBytes = await new Promise((resolve) => {
        jpgCanvas.toBlob(
          (blob) => {
            blob!.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)));
          },
          'image/jpeg',
          0.92,
        );
      });
    }
    if (batchCount > 1) {
      batchFiles.push({ name: base + '.psd', data: buf });
      if (jpgBytes) batchFiles.push({ name: base + '.jpg', data: jpgBytes });
    } else {
      download(new Blob([buf as BlobPart], { type: 'image/vnd.adobe.photoshop' }), base + '.psd');
      if (jpgBytes) download(new Blob([jpgBytes as BlobPart], { type: 'image/jpeg' }), base + '.jpg');
    }
    row.textContent = base + ' -> PSD (' + Math.round(buf.byteLength / 1024) + ' KB, ' + linkedFiles.length + ' smart objects)';
    row.className = 'row ok';
    (msg.warnings || []).forEach((w: string) => addRow(msg.name + ': ' + w, 'warn'));
  } catch (err: any) {
    row.textContent = msg.name + ' FAILED: ' + err.message;
    row.className = 'row err';
  }
  parent.postMessage({ pluginMessage: { type: 'ack' } }, '*');
};
