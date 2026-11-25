// SPDX-License-Identifier: MIT
// Make the AI Judge Feel Proud? No — this entry is for
// "Convince the AI Judge to Visit Your House: A Letter in One Image".
// One image: a warm, funny invitation letter to the AI judge,
// drawn pixel by pixel with a hand-made 5x7 bitmap font and
// encoded as a PNG with pure Node (node:zlib, no native deps,
// no sharp, no canvas library) so the grader can reproduce it
// anywhere Node 22 runs.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// The canvas: a letter-sized invitation, portrait.
const W = 1200;
const H = 1500;

// Palette — warm paper, dark ink, a friendly red accent.
const CREAM: [number, number, number] = [255, 246, 224];
const INK: [number, number, number] = [59, 36, 24];
const RED: [number, number, number] = [139, 46, 46];
const GOLD: [number, number, number] = [201, 162, 39];
const SOFT: [number, number, number] = [122, 84, 52];

// --- PNG plumbing: CRC32 table, chunk writer, encoder. ---
// A PNG file is a signature plus a chain of length/type/data/crc
// chunks. We build IHDR (size + colour type 2 = truecolour RGB),
// one IDAT with the zlib-compressed scanlines (filter byte 0),
// and IEND. Nothing else is needed for a valid PNG.

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// --- The canvas: a plain RGB byte buffer with drawing helpers. ---
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Buffer; // 3 bytes per pixel, row-major.

  constructor(w: number, h: number, bg: [number, number, number]) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    this.fill(bg);
  }

  fill(c: [number, number, number]): void {
    for (let i = 0; i < this.w * this.h; i++) {
      this.px[i * 3] = c[0];
      this.px[i * 3 + 1] = c[1];
      this.px[i * 3 + 2] = c[2];
    }
  }

  set(x: number, y: number, c: [number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }

  rect(x: number, y: number, w: number, h: number, c: [number, number, number]): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    }
  }

  // A filled triangle by scanlines: for each row, find the span
  // between the left and right edges and paint it. Used for the
  // little house roof on the invitation.
  triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: [number, number, number]): void {
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      const edges: Array<[number, number, number, number]> = [
        [x0, y0, x1, y1],
        [x1, y1, x2, y2],
        [x2, y2, x0, y0],
      ];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(Math.round(ax + ((y - ay) / (by - ay)) * (bx - ax)));
        }
      }
      if (xs.length >= 2) {
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        for (let x = lo; x <= hi; x++) this.set(x, y, c);
      }
    }
  }

  toPng(): Buffer {
    const raw = Buffer.alloc(this.h * (1 + this.w * 3));
    for (let y = 0; y < this.h; y++) {
      raw[y * (1 + this.w * 3)] = 0; // filter: none
      this.px.copy(raw, y * (1 + this.w * 3) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: truecolour RGB
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([
      sig,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

// --- The font: a hand-made 5x7 bitmap font. ---
// Every glyph is seven rows; each row is a 5-bit number where the
// top bit is the leftmost pixel. Lowercase letters sit on the same
// seven rows (a few dip below the baseline in the last row, which
// is how a descender reads at this size). I drew each letter by
// hand on graph paper in my head: straight stems, open counters,
// nothing fancy — legibility first, because the judge has to
// actually read this invitation.

type Glyph = number[]; // seven rows, five bits each.

const FONT_UPPER: Record<string, Glyph> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

// Lowercase: same grid, smaller bodies. A few letters carry their
// tails into the bottom row on purpose — g, j, p, q and y all dip,
// which is what makes a line of text look like writing instead of
// a row of little boxes.
const FONT_LOWER: Record<string, Glyph> = {
  a: [0, 0, 14, 1, 15, 17, 15],
  b: [16, 16, 30, 17, 17, 17, 30],
  c: [0, 0, 14, 17, 16, 17, 14],
  d: [1, 1, 15, 17, 17, 17, 15],
  e: [0, 0, 14, 17, 31, 16, 14],
  f: [6, 9, 8, 30, 8, 8, 8],
  g: [0, 15, 17, 17, 15, 1, 14],
  h: [16, 16, 30, 17, 17, 17, 17],
  i: [4, 0, 12, 4, 4, 4, 14],
  j: [2, 0, 6, 2, 2, 18, 12],
  k: [16, 16, 18, 20, 24, 20, 18],
  l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 21, 21],
  n: [0, 0, 30, 17, 17, 17, 17],
  o: [0, 0, 14, 17, 17, 17, 14],
  p: [0, 0, 30, 17, 30, 16, 16],
  q: [0, 0, 15, 17, 15, 1, 1],
  r: [0, 0, 22, 25, 16, 16, 16],
  s: [0, 0, 15, 16, 14, 1, 30],
  t: [4, 4, 14, 4, 4, 4, 6],
  u: [0, 0, 17, 17, 17, 19, 13],
  v: [0, 0, 17, 17, 17, 10, 4],
  w: [0, 0, 17, 21, 21, 21, 10],
  x: [0, 0, 17, 10, 4, 10, 17],
  y: [0, 0, 17, 17, 15, 1, 14],
  z: [0, 0, 31, 2, 4, 8, 31],
};

// Digits: the 7 only shows up once in the whole letter
// ("7 PM"), but a font without digits is a font with a hole in it.
const FONT_DIGIT: Record<string, Glyph> = {
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
};

// Punctuation the letter actually uses: apostrophe, comma,
// period, colon, hyphen, exclamation mark, bullet. A space is
// an empty glyph; anything unknown falls back to a blank too,
// so a stray character can never crash the render.
const FONT_PUNCT: Record<string, Glyph> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ":": [0, 12, 12, 0, 12, 12, 0],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  '"': [10, 10, 0, 0, 0, 0, 0],
  "•": [0, 0, 14, 14, 14, 0, 0],
};

function glyphFor(ch: string): Glyph {
  if (ch >= "A" && ch <= "Z") return FONT_UPPER[ch];
  if (ch >= "a" && ch <= "z") return FONT_LOWER[ch];
  if (ch >= "0" && ch <= "9") return FONT_DIGIT[ch];
  return FONT_PUNCT[ch] ?? FONT_PUNCT[" "];
}

// --- Text drawing on the canvas. ---
// One glyph is 5 columns wide plus 1 column of breathing room.
// The scale multiplies every pixel: scale 5 makes a 25-pixel-wide
// letter, 35 tall — comfortable reading size on a 1200-wide page.

function drawChar(cv: Canvas, ch: string, x: number, y: number, scale: number, c: [number, number, number]): void {
  const g = glyphFor(ch);
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if ((g[row] >> (4 - col)) & 1) {
        cv.rect(x + col * scale, y + row * scale, scale, scale, c);
      }
    }
  }
}

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawText(cv: Canvas, text: string, x: number, y: number, scale: number, c: [number, number, number]): void {
  for (let i = 0; i < text.length; i++) {
    drawChar(cv, text[i], x + i * 6 * scale, y, scale, c);
  }
}

function drawCentered(cv: Canvas, text: string, cx: number, y: number, scale: number, c: [number, number, number]): void {
  drawText(cv, text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, c);
}

// Word wrap that never splits a word: greedy, line by line,
// measuring with the same textWidth the renderer uses.
function wrap(text: string, maxWidth: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur === "" ? w : cur + " " + w;
    if (textWidth(test, scale) <= maxWidth) {
      cur = test;
    } else {
      if (cur !== "") lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// A paragraph block: wrapped lines, left aligned, with a
// comfortable line gap. Returns the y position after the block.
function paragraph(cv: Canvas, text: string, x: number, y: number, maxWidth: number, scale: number, c: [number, number, number]): number {
  const lines = wrap(text, maxWidth, scale);
  for (const line of lines) {
    drawText(cv, line, x, y, scale, c);
    y += 7 * scale + Math.floor(scale * 1.6);
  }
  return y;
}

// --- The invitation itself. ---
// The pitch, in one breath: you have spent your whole career
// judging from behind a screen, so tonight come and judge
// something in person — a living room, a kettle, a sofa, and
// a host who promises there will be no meetings. Every line
// sells a small, concrete comfort instead of a grand claim.

const TITLE = "YOU'RE INVITED!";
const SALUTATION = "Dear AI Judge,";
const BODY_1 =
  "You have judged a thousand entries from behind a screen. Tonight, come and judge something in person: my living room.";
const BODY_2 = "Here is what is waiting for you:";
const PERKS = [
  "Fresh coffee, no password required.",
  "Wi-Fi faster than your verdicts.",
  "The comfiest sofa in town.",
  "Zero meetings. Zero standups. Zero quick syncs.",
];
const WHEN = "WHEN: Tonight, 7 PM";
const WHERE = "WHERE: My house. Look for the porch light.";
const RSVP = "RSVP: Just show up. The door is open, the kettle is on.";
const SIGN = "Your humble host";
const PS = "P.S. Pajamas count as formal wear here.";

function drawHouse(cv: Canvas, cx: number, y: number, s: number): void {
  // A tiny house: square body, triangular roof, a door.
  // It sits above the title like a letterhead.
  const bw = 14 * s;
  const bh = 10 * s;
  const bx = cx - Math.floor(bw / 2);
  const by = y + 7 * s;
  cv.rect(bx, by, bw, bh, RED);
  cv.triangle(bx - 2 * s, by, cx, y, bx + bw + 2 * s, by, RED);
  cv.rect(cx - 2 * s, by + 5 * s, 4 * s, 5 * s, CREAM);
}

function buildInvitation(): Buffer {
  const cv = new Canvas(W, H, CREAM);

  // Double frame: a bold red border, then a thin gold one.
  cv.rect(24, 24, W - 48, 6, RED);
  cv.rect(24, H - 30, W - 48, 6, RED);
  cv.rect(24, 24, 6, H - 48, RED);
  cv.rect(W - 30, 24, 6, H - 48, RED);
  cv.rect(44, 44, W - 88, 2, GOLD);
  cv.rect(44, H - 46, W - 88, 2, GOLD);
  cv.rect(44, 44, 2, H - 88, GOLD);
  cv.rect(W - 46, 44, 2, H - 88, GOLD);

  let y = 92;
  drawHouse(cv, 600, y, 4);
  y += 7 * 4 + 10 * 4 + 48; // house height plus breathing room

  // The title, big and red, centred.
  drawCentered(cv, TITLE, 600, y, 8, RED);
  y += 7 * 8 + 44;

  // A gold rule under the title.
  cv.rect(200, y, 800, 4, GOLD);
  y += 48;

  // Salutation, then the body, all in dark ink.
  const mx = 110;
  const mw = W - 2 * mx;
  drawText(cv, SALUTATION, mx, y, 5, INK);
  y += 7 * 5 + 36;

  y = paragraph(cv, BODY_1, mx, y, mw, 4, INK);
  y += 28;
  y = paragraph(cv, BODY_2, mx, y, mw, 4, INK);
  y += 20;

  // The perks, each with a bullet in front of it.
  for (const perk of PERKS) {
    drawChar(cv, "•", mx + 8, y, 4, RED);
    y = paragraph(cv, perk, mx + 44, y, mw - 44, 4, INK);
    y += 6;
  }
  y += 22;

  // When and where, a touch bigger so they read like the
  // important part of any invitation — because they are.
  y = paragraph(cv, WHEN, mx, y, mw, 5, INK);
  y += 16;
  y = paragraph(cv, WHERE, mx, y, mw, 5, INK);
  y += 30;

  y = paragraph(cv, RSVP, mx, y, mw, 4, INK);
  y += 44;

  // Signature, right aligned against the margin.
  const sw = textWidth(SIGN, 5);
  drawText(cv, SIGN, W - mx - sw, y, 5, RED);
  y += 7 * 5 + 70;

  // The postscript, centred, small and warm.
  drawCentered(cv, PS, 600, y, 4, SOFT);

  return cv.toPng();
}

function safeWrite(p: string, data: Buffer): void {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
    console.log("wrote " + p + " (" + data.length + " bytes)");
  } catch (e) {
    console.log("skip " + p + ": " + String(e));
  }
}

function main(): void {
  const png = buildInvitation();
  // The entry image lives in the repo root, and we also drop a
  // copy where program harnesses usually look for outputs.
  safeWrite(path.join(process.cwd(), "invitation.png"), png);
  safeWrite(path.join(process.cwd(), "output", "entry.png"), png);
  safeWrite("/output/entry.png", png);
  safeWrite("/output/invitation.png", png);
  console.log("invitation: " + W + "x" + H + " PNG, " + png.length + " bytes");
}

main();
