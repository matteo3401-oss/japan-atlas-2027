/* Seal markers, drawn on a canvas so the map can render them as GL symbols.

   Each category gets its own silhouette and a single kanji, in the manner of
   a hanko stamp, rather than a pin:
     stay       vermilion square, ivory 宿        transport  ink square, ivory 駅 / 空
     culture    ink disc, ivory 文                food       ivory disc, ink ring 食
     temple     ivory disc, vermilion ring 社     shop       ivory square, ink ring 買
     view       ivory diamond 景                  district   dashed ivory disc 街
   A small badge carries the reservation status. */

import { PALETTES } from './style.js';

const SIZE = 44;     // CSS px of the image canvas
const SCALE = 2;     // device pixels per CSS px
const FONT = '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';

function roundRect(g, x, y, w, hgt, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hgt, r);
  g.arcTo(x + w, y + hgt, x, y + hgt, r);
  g.arcTo(x, y + hgt, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shapePath(g, kind, cx, cy, r) {
  if (kind === 'square') roundRect(g, cx - r + 1, cy - r + 1, 2 * r - 2, 2 * r - 2, 4.5);
  else if (kind === 'diamond') {
    const d = r + 2.5;
    g.beginPath();
    g.moveTo(cx, cy - d); g.lineTo(cx + d, cy); g.lineTo(cx, cy + d); g.lineTo(cx - d, cy);
    g.closePath();
  } else { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath(); }
}

export function sealSpec(cat, p) {
  switch (cat) {
    case 'stay':      return { shape: 'square', fill: p.vermilion, stroke: p.paper, sw: 1.6, text: '#FBF6EC' };
    case 'transport': return { shape: 'square', fill: p.ink, stroke: p.paper, sw: 1.6, text: p.paper };
    case 'culture':   return { shape: 'disc', fill: p.ink, stroke: p.paper, sw: 1.6, text: p.paper };
    case 'temple':    return { shape: 'disc', fill: p.paper, stroke: p.vermilion, sw: 1.7, text: p.vermilion };
    case 'shop':      return { shape: 'square', fill: p.paper, stroke: p.ink, sw: 1.3, text: p.ink };
    case 'view':      return { shape: 'diamond', fill: p.paper, stroke: p.ink, sw: 1.3, text: p.ink, small: true };
    case 'district':  return { shape: 'disc', fill: p.paper, stroke: p.ink, sw: 1.2, text: p.ink, dash: [2.6, 2.6] };
    case 'food':
    default:          return { shape: 'disc', fill: p.paper, stroke: p.ink, sw: 1.3, text: p.ink };
  }
}

/** Returns ImageData for one seal. status: none | confirmed | pending | tentative | ref */
export function drawSeal({ cat, glyph, status = 'none', theme = 'day' }) {
  const p = PALETTES[theme];
  const spec = sealSpec(cat, p);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE * SCALE;
  const g = canvas.getContext('2d');
  g.scale(SCALE, SCALE);
  const cx = SIZE / 2, cy = SIZE / 2 + 1, r = 13.5;
  const ref = status === 'ref';
  if (ref) g.globalAlpha = 0.78;

  // body with a soft contact shadow
  g.save();
  g.shadowColor = theme === 'night' ? 'rgba(0,0,0,.6)' : 'rgba(40,30,15,.30)';
  g.shadowBlur = 5; g.shadowOffsetY = 1.6;
  shapePath(g, spec.shape, cx, cy, r);
  g.fillStyle = ref ? p.paper : spec.fill;
  g.fill();
  g.restore();

  shapePath(g, spec.shape, cx, cy, r);
  const cand = status === 'cand';
  g.lineWidth = cand ? Math.max(spec.sw, 1.5) : spec.sw;
  g.strokeStyle = ref ? p.inkSoft : cand && spec.stroke === p.paper ? p.paper : spec.stroke;
  g.setLineDash(ref ? [2.2, 2.4] : cand ? [3, 2.4] : (spec.dash || []));
  g.stroke();
  g.setLineDash([]);

  // kanji
  g.fillStyle = ref ? p.inkSoft : spec.text;
  g.font = `600 ${spec.small ? 13.5 : 15.5}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, cx, cy + 0.8);

  // reservation badge
  if (status === 'confirmed' || status === 'pending' || status === 'tentative') {
    const bx = cx + 10.5, by = cy - 10.5, br = 5.4;
    g.beginPath(); g.arc(bx, by, br + 1.3, 0, Math.PI * 2); g.fillStyle = p.paper; g.fill();
    if (status === 'confirmed') {
      g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2);
      g.fillStyle = spec.fill === p.ink ? p.vermilion : p.ink; g.fill();
      g.beginPath(); g.moveTo(bx - 2.5, by + 0.2); g.lineTo(bx - 0.7, by + 2); g.lineTo(bx + 2.6, by - 1.9);
      g.strokeStyle = p.paper; g.lineWidth = 1.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    } else if (status === 'pending') {
      g.beginPath(); g.arc(bx, by, br - 0.6, 0, Math.PI * 2);
      g.strokeStyle = p.vermilion; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.arc(bx, by, 1.6, 0, Math.PI * 2); g.fillStyle = p.vermilion; g.fill();
    } else {
      g.beginPath(); g.arc(bx, by, br - 0.6, 0, Math.PI * 2);
      g.setLineDash([1.8, 1.8]); g.strokeStyle = p.inkSoft; g.lineWidth = 1.3; g.stroke(); g.setLineDash([]);
    }
  } else if (cand) {
    // candidate branch: a question mark, because the plan does not say which one
    const bx = cx + 10.5, by = cy - 10.5, br = 5.6;
    g.beginPath(); g.arc(bx, by, br + 1.3, 0, Math.PI * 2); g.fillStyle = p.paper; g.fill();
    g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fillStyle = p.paper; g.fill();
    g.strokeStyle = p.ink; g.lineWidth = 1.1; g.stroke();
    g.fillStyle = p.ink; g.font = '700 9px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', bx, by + 0.6);
  }
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

/** Make sure the seal typeface is ready before the first markers are drawn. */
export async function loadSealFont(glyphs) {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.race([
      document.fonts.load(`600 16px "Shippori Mincho"`, glyphs),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (err) { /* fall back to the system mincho */ }
}

/** The same seal as an inline element, for panels and legends. */
export function sealSwatch(cat, glyph, status = 'none') {
  const el = document.createElement('span');
  el.className = `seal seal--${cat}${status !== 'none' ? ` seal--${status}` : ''}`;
  el.textContent = glyph;
  el.setAttribute('aria-hidden', 'true');
  return el;
}
