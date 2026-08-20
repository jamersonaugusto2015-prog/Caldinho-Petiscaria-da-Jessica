/**
 * Gerador dos ícones do PWA — FONTE DA VERDADE dos PNGs em `public/icons/`.
 *
 * Para regerar:  node scripts/generate-icons.mjs
 *
 * Os PNGs ficam versionados no repositório (não estão no .gitignore) porque o
 * build do Render não roda este script: `vite build` só copia `public/`. Editar
 * um PNG à mão, portanto, é perder a edição na próxima execução daqui — a cor,
 * o traço e o tamanho de cada ícone se mudam NESTE arquivo.
 *
 * Por que escrever PNG na unha: o projeto não tem (e não pode ganhar) nenhuma
 * biblioteca de imagem. Só `node:zlib` e um escritor de chunk PNG de vinte
 * linhas — que é literalmente tudo que o formato exige: assinatura, IHDR, IDAT
 * comprimido com deflate e IEND, cada um com seu CRC-32.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** Tabela do CRC-32 do PNG (polinômio 0xEDB88320), montada uma vez. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Um chunk PNG: tamanho (4) + tipo (4) + dados + CRC do tipo+dados (4). */
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * `pixels` é RGBA cru, 4 bytes por pixel, sem os bytes de filtro. O PNG exige
 * um byte de filtro no início de CADA linha — esquecê-lo é o erro que faz o
 * decodificador recusar a imagem inteira. Usamos filtro 0 (nenhum): o desenho
 * é chapado e o deflate já resolve a compressão.
 */
function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // truecolor com alfa (RGBA)
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro adaptativo padrão
  ihdr[12] = 0; // sem entrelaçamento

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Geometria — tudo em coordenadas 0..1 para o desenho não depender do tamanho
// ---------------------------------------------------------------------------

/** Distância de um ponto ao segmento AB: é o que transforma um traço em cápsula. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function inRoundedRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  // Distância ao ponto mais próximo do retângulo "encolhido" pelo raio: dentro
  // das faixas centrais ela dá zero, e só nos quatro cantos vira um arco.
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/**
 * A marca: tigela + vapor, em coordenadas locais 0..1 dentro da caixa da marca.
 *
 * Nada de curva bezier ou fonte: um meio-elipse para a tigela, uma cápsula
 * horizontal para a borda e três cápsulas verticais para o vapor. É o mínimo
 * que ainda se lê como "caldo quente" a 48 px, que é o tamanho em que o Android
 * desenha o ícone na barra de notificação.
 */
function inMark(x, y) {
  // Vapor: três hastes de alturas diferentes (iguais viram uma cerca).
  const steam = [
    [0.325, 0.10, 0.325, 0.29],
    [0.5, 0.0, 0.5, 0.29],
    [0.675, 0.13, 0.675, 0.29],
  ];
  for (const [ax, ay, bx, by] of steam) {
    if (distToSegment(x, y, ax, ay, bx, by) <= 0.043) return true;
  }

  // Borda da tigela: cápsula horizontal, um pouco mais larga que a tigela.
  if (distToSegment(x, y, 0.075, 0.435, 0.925, 0.435) <= 0.058) return true;

  // Corpo: metade de baixo de uma elipse ancorada na borda.
  if (y >= 0.435) {
    const nx = (x - 0.5) / 0.365;
    const ny = (y - 0.435) / 0.47;
    if (nx * nx + ny * ny <= 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rasterização
// ---------------------------------------------------------------------------

const SUB = 4; // 4x4 amostras por pixel: sem isso a tigela sai serrilhada

function hex(color) {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

/**
 * @param {number} size lado do PNG em pixels
 * @param {string} color cor da marca (hexadecimal)
 * @param {'rounded'|'full'} field 'rounded' recorta um quadrado arredondado com
 *   fundo transparente; 'full' pinta de borda a borda — é o que o ícone
 *   maskable e o apple-touch-icon precisam, porque quem recorta é o sistema.
 * @param {number} markScale fração do lado ocupada pela marca
 */
function render(size, color, field, markScale) {
  const px = Buffer.alloc(size * size * 4);
  const [r, g, b] = hex(color);

  const inset = field === 'full' ? 0 : 0.045;
  const radius = field === 'full' ? 0 : 0.225;
  const markLeft = (1 - markScale) / 2;
  // A tigela é pesada embaixo; descer 1,5% centra a marca opticamente.
  const markTop = (1 - markScale) / 2 + 0.015;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let fieldHits = 0;
      let markHits = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const u = (x + (sx + 0.5) / SUB) / size;
          const v = (y + (sy + 0.5) / SUB) / size;
          if (field === 'full' || inRoundedRect(u, v, inset, inset, 1 - inset, 1 - inset, radius)) {
            fieldHits += 1;
            const mu = (u - markLeft) / markScale;
            const mv = (v - markTop) / markScale;
            if (mu >= 0 && mu <= 1 && mv >= 0 && mv <= 1 && inMark(mu, mv)) markHits += 1;
          }
        }
      }

      const total = SUB * SUB;
      const alpha = fieldHits / total;
      const white = markHits / total;
      const i = (y * size + x) * 4;
      if (alpha === 0) continue;
      // A marca é branca sobre a cor do papel: mistura os dois pela cobertura.
      px[i] = Math.round(r + (255 - r) * (white / alpha));
      px[i + 1] = Math.round(g + (255 - g) * (white / alpha));
      px[i + 2] = Math.round(b + (255 - b) * (white / alpha));
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, px);
}

// ---------------------------------------------------------------------------
// Os três papéis
// ---------------------------------------------------------------------------

const ROLES = [
  { slug: 'cliente', color: '#B91C1C' },
  { slug: 'cozinha', color: '#1C1917' },
  { slug: 'entregador', color: '#7C3AED' },
];

const VARIANTS = [
  { name: 'icon-192.png', size: 192, field: 'rounded', mark: 0.6 },
  { name: 'icon-512.png', size: 512, field: 'rounded', mark: 0.6 },
  // Maskable: o sistema recorta um círculo de 80% do lado. A marca fica em
  // 52% para nenhum fio de vapor encostar no corte, em nenhum formato.
  { name: 'maskable-512.png', size: 512, field: 'full', mark: 0.52 },
  // O iOS aplica a própria máscara arredondada — entregar já arredondado
  // deixaria uma borda transparente feia por dentro do recorte dele.
  { name: 'apple-touch-180.png', size: 180, field: 'full', mark: 0.62 },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const role of ROLES) {
  for (const variant of VARIANTS) {
    const file = join(OUT_DIR, `${role.slug}-${variant.name}`);
    writeFileSync(file, render(variant.size, role.color, variant.field, variant.mark));
    console.log(`ok ${file}`);
  }
}
