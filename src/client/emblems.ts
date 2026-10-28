// Faction emblems drawn in code, for sails, flags and card headers.

type Ctx = CanvasRenderingContext2D;

function skull(g: Ctx, s: number, col: string) {
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineCap = 'round';
  // Crossed bones.
  g.lineWidth = s * 0.09;
  for (const k of [1, -1]) {
    g.beginPath();
    g.moveTo(-s * 0.42, -s * 0.05 * k + s * 0.2);
    g.lineTo(s * 0.42, s * 0.05 * k + s * 0.2 + k * s * 0.0);
    g.stroke();
  }
  g.lineWidth = s * 0.08;
  g.beginPath();
  g.moveTo(-s * 0.4, s * 0.38);
  g.lineTo(s * 0.4, s * 0.02);
  g.moveTo(-s * 0.4, s * 0.02);
  g.lineTo(s * 0.4, s * 0.38);
  g.stroke();
  for (const [x, y] of [[-0.4, 0.38], [0.4, 0.02], [-0.4, 0.02], [0.4, 0.38]]) {
    g.beginPath();
    g.arc(x * s, y * s, s * 0.06, 0, Math.PI * 2);
    g.fill();
  }
  // Skull.
  g.beginPath();
  g.ellipse(0, -s * 0.12, s * 0.24, s * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-s * 0.13, -s * 0.02, s * 0.26, s * 0.16);
  // Eyes and nose cut out.
  g.globalCompositeOperation = 'destination-out';
  for (const x of [-0.09, 0.09]) {
    g.beginPath();
    g.arc(x * s, -s * 0.12, s * 0.06, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.moveTo(0, -s * 0.04);
  g.lineTo(-s * 0.03, s * 0.01);
  g.lineTo(s * 0.03, s * 0.01);
  g.fill();
  g.globalCompositeOperation = 'source-over';
}

function star(g: Ctx, s: number, points: number, inner: number) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? s : s * inner;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

/** Draw a faction emblem centred at (0,0), roughly `s` across. */
export function drawEmblem(g: Ctx, faction: string | undefined, s: number, col: string) {
  g.save();
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  switch (faction) {
    case 'Pirate':
      skull(g, s, col);
      break;
    case 'English':
      g.fillRect(-s * 0.08, -s * 0.45, s * 0.16, s * 0.9);
      g.fillRect(-s * 0.45, -s * 0.08, s * 0.9, s * 0.16);
      break;
    case 'Spanish': {
      // Ragged saltire.
      g.lineWidth = s * 0.13;
      g.beginPath();
      g.moveTo(-s * 0.38, -s * 0.38);
      g.lineTo(s * 0.38, s * 0.38);
      g.moveTo(s * 0.38, -s * 0.38);
      g.lineTo(-s * 0.38, s * 0.38);
      g.stroke();
      g.lineWidth = s * 0.05;
      for (const [x, y] of [[-0.2, -0.2], [0.2, 0.2], [0.2, -0.2], [-0.2, 0.2]]) {
        g.beginPath();
        g.moveTo(x * s - s * 0.08, y * s + s * 0.08);
        g.lineTo(x * s + s * 0.08, y * s - s * 0.08);
        g.stroke();
      }
      break;
    }
    case 'French': {
      g.beginPath();
      g.ellipse(0, -s * 0.1, s * 0.09, s * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      for (const k of [-1, 1]) {
        g.beginPath();
        g.ellipse(k * s * 0.2, 0, s * 0.08, s * 0.22, k * 0.7, 0, Math.PI * 2);
        g.fill();
      }
      g.fillRect(-s * 0.3, s * 0.08, s * 0.6, s * 0.08);
      break;
    }
    case 'American':
      star(g, s * 0.45, 5, 0.42);
      break;
    case 'Brethren': {
      // Crossed cutlasses.
      g.lineWidth = s * 0.08;
      for (const k of [1, -1]) {
        g.beginPath();
        g.moveTo(-k * s * 0.38, s * 0.38);
        g.quadraticCurveTo(k * s * 0.05, 0, k * s * 0.38, -s * 0.4);
        g.stroke();
        g.beginPath();
        g.moveTo(-k * s * 0.38 - s * 0.1, s * 0.22);
        g.lineTo(-k * s * 0.22, s * 0.38 + s * 0.06);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, -s * 0.05, s * 0.12, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'Azure Crown': {
      g.beginPath();
      g.moveTo(-s * 0.4, s * 0.25);
      g.lineTo(-s * 0.4, -s * 0.2);
      g.lineTo(-s * 0.2, s * 0.02);
      g.lineTo(0, -s * 0.35);
      g.lineTo(s * 0.2, s * 0.02);
      g.lineTo(s * 0.4, -s * 0.2);
      g.lineTo(s * 0.4, s * 0.25);
      g.closePath();
      g.fill();
      g.fillRect(-s * 0.42, s * 0.3, s * 0.84, s * 0.1);
      break;
    }
    case 'Sunreach': {
      g.beginPath();
      g.arc(0, 0, s * 0.2, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = s * 0.06;
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        g.beginPath();
        g.moveTo(Math.cos(a) * s * 0.27, Math.sin(a) * s * 0.27);
        g.lineTo(Math.cos(a) * s * (i % 2 ? 0.38 : 0.46), Math.sin(a) * s * (i % 2 ? 0.38 : 0.46));
        g.stroke();
      }
      break;
    }
    case 'Jade Tide': {
      // Lotus: three petals over a wave line.
      for (const [rot, len] of [[0, 0.42], [-0.6, 0.34], [0.6, 0.34]] as [number, number][]) {
        g.save();
        g.rotate(rot);
        g.beginPath();
        g.moveTo(0, s * 0.12);
        g.quadraticCurveTo(-s * 0.16, -s * (len - 0.1), 0, -s * len);
        g.quadraticCurveTo(s * 0.16, -s * (len - 0.1), 0, s * 0.12);
        g.fill();
        g.restore();
      }
      g.lineWidth = s * 0.07;
      g.beginPath();
      g.moveTo(-s * 0.42, s * 0.28);
      for (let k = 0; k < 4; k++) g.quadraticCurveTo(-s * 0.42 + s * 0.21 * k + s * 0.105, s * (k % 2 ? 0.36 : 0.2), -s * 0.42 + s * 0.21 * (k + 1), s * 0.28);
      g.stroke();
      break;
    }
    default:
      star(g, s * 0.45, 4, 0.3);
  }
  g.restore();
}

const urlCache = new Map<string, string>();

/** Emblem as an image URL (for card headers). */
export function emblemURL(faction: string | undefined, col: string, size = 64): string {
  const key = `${faction}|${col}|${size}`;
  let u = urlCache.get(key);
  if (u) return u;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  drawEmblem(g, faction, size * 0.9, col);
  u = c.toDataURL();
  urlCache.set(key, u);
  return u;
}
