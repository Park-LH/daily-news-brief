/**
 * tools/gen-icons.js —— 生成 PWA 需要的图标（192 / 512 / maskable / apple-touch）
 *
 * 为什么自己画而不找一张图：
 *   1. 仓库里没有任何图片处理库，也不想为一个图标引入依赖；
 *   2. 用 Node 自带的 zlib 直接写 PNG，尺寸精确、边缘干净；
 *   3. 之后要换图标，只要改本脚本里的 drawIcon()，重新跑一次就全量更新。
 *
 * 用法：node tools/gen-icons.js
 */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/* ---------- 配色：跟 css/style.css 的 --accent 保持一致 ---------- */
const ACCENT = [0x4f, 0x46, 0xe5];   // #4f46e5 主题色（图标底色）
const ACCENT_D = [0x43, 0x38, 0xca]; // #4338ca 深一档（纸上的线条，保证对比度）
const PAPER = [0xff, 0xff, 0xff];    // 白纸

/* ---------- PNG 编码（IHDR / IDAT / IEND + CRC32）---------- */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // 位深
  ihdr[9] = 6;    // 颜色类型：RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // 过滤器类型 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- 图形：圆角矩形 / 矩形 ---------- */
function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (!inRect(x, y, x0, y0, x1, y1)) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * 画一个"报纸 / 简报"图标
 * @param {number} u 归一化横坐标 0~1
 * @param {number} v 归一化纵坐标 0~1
 * @param {boolean} maskable 是否按可遮罩图标画（底色铺满、图形缩到安全区）
 * @returns {number[]|null} [r,g,b]，圆角外返回 null（透明）
 */
function colorAt(u, v, maskable) {
  // 可遮罩图标：系统可能按任意形状裁切，所以底色必须铺满、图案缩到中间 ~62%
  const k = maskable ? 0.62 : 1;                 // 图案缩放
  const cx = 0.5, cy = 0.5;
  const uu = (u - cx) / k + cx;
  const vv = (v - cy) / k + cy;

  // 底：普通图标是圆角方块，maskable 是满幅方块
  if (maskable) {
    if (uu < 0 || uu > 1 || vv < 0 || vv > 1) return ACCENT;   // 安全区外仍是底色
  } else if (!inRoundRect(u, v, 0, 0, 1, 1, 0.22)) {
    return null;                                               // 圆角外透明
  }

  // 白纸
  let col = ACCENT;
  if (inRoundRect(uu, vv, 0.22, 0.16, 0.78, 0.84, 0.05)) col = PAPER;
  // 报头（实心色块）
  if (inRect(uu, vv, 0.30, 0.25, 0.70, 0.335)) col = ACCENT_D;
  // 三条正文线（最后一条短一点，看起来像文字段落）
  if (inRect(uu, vv, 0.30, 0.43, 0.70, 0.475)) col = ACCENT_D;
  if (inRect(uu, vv, 0.30, 0.535, 0.70, 0.58)) col = ACCENT_D;
  if (inRect(uu, vv, 0.30, 0.64, 0.62, 0.685)) col = ACCENT_D;
  return col;
}

/** 生成一张图标（4x4 超采样抗锯齿） */
function renderIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4;                       // 每像素 4x4 个子采样
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = colorAt(u, v, maskable);
          n++;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = maskable ? 255 : Math.round(a / n);
    }
  }
  return encodePng(size, size, rgba);
}

/* ---------- 输出 ---------- */
const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });

const files = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
];

for (const [name, size, maskable] of files) {
  const buf = renderIcon(size, maskable);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`已生成 icons/${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log("完成。");
