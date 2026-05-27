import { mkdir, writeFile } from 'node:fs/promises';

const outDir = new URL('../assets/hair/', import.meta.url);

const styles = [
  ['best-french-layered', '法式层次短发', '#2c1f1b', 'short-layered'],
  ['best-side-waves', '侧分微卷', '#3a241e', 'side-wave'],
  ['best-collarbone-lob', '锁骨内扣', '#241c18', 'lob'],
  ['best-air-bangs-long', '空气刘海长卷', '#34231f', 'long-bangs'],
  ['best-textured-mid', '纹理中短发', '#221b19', 'textured'],
  ['ok-straight-medium', '直顺中长发', '#2b211d', 'straight'],
  ['ok-low-layer-long', '低层次长发', '#3a2a22', 'long-layer'],
  ['ok-curtain-bangs', '八字刘海', '#2f211d', 'curtain'],
  ['ok-wet-back', '微湿背头', '#171615', 'wet'],
  ['ok-shoulder-flip', '齐肩外翻', '#3b2922', 'flip'],
  ['bad-heavy-bangs', '厚重齐刘海', '#211918', 'heavy-bang'],
  ['bad-buzz', '超短寸感', '#2a211d', 'buzz'],
  ['bad-flat-straight', '高贴头直发', '#171514', 'flat'],
  ['bad-wide-curls', '宽蓬爆卷', '#3a231b', 'curls'],
  ['bad-choppy-shag', '重层次碎发', '#2b201d', 'shag']
];

function strandPaths(kind) {
  const common = `
    <path class="shine" d="M258 105 C240 190 238 280 214 365"/>
    <path class="shine" d="M360 94 C342 188 360 276 328 372"/>
    <path class="shine" d="M458 110 C492 195 478 290 512 384"/>
  `;
  const bangs = `
    <path fill="var(--hair)" d="M232 162 C270 108 386 90 484 154 C442 188 386 206 308 202 C270 198 245 184 232 162Z"/>
    <path class="shine" d="M304 126 C326 158 316 186 300 214"/>
    <path class="shine" d="M382 118 C378 154 394 184 380 222"/>
  `;
  if (kind === 'wet') {
    return `
      <path fill="var(--hair)" d="M170 218 C190 82 490 72 554 214 C500 252 252 258 170 218Z"/>
      <path class="shine" d="M256 102 C302 154 306 198 270 238"/>
      <path class="shine" d="M348 92 C386 150 384 198 334 240"/>
      <path class="shine" d="M442 112 C462 152 454 200 404 238"/>
    `;
  }
  if (kind === 'buzz') {
    return `
      <path fill="var(--hair)" d="M206 210 C238 94 476 90 520 210 C456 246 282 246 206 210Z"/>
      <path fill="rgba(255,255,255,.12)" d="M248 164 C304 118 422 122 484 166 C424 150 316 150 248 164Z"/>
    `;
  }
  if (kind === 'heavy-bang') {
    return bangs + `
      <path fill="var(--hair)" d="M190 210 C206 68 526 70 548 216 C520 306 492 402 514 502 C430 455 282 455 198 502 C222 390 174 308 190 210Z"/>
    `;
  }
  if (kind === 'curls') {
    let curls = '';
    for (let i = 0; i < 22; i++) {
      const x = 150 + (i % 7) * 72 + (i % 2) * 12;
      const y = 156 + Math.floor(i / 7) * 92;
      curls += `<ellipse fill="var(--hair)" cx="${x}" cy="${y}" rx="54" ry="62" transform="rotate(${(i % 5 - 2) * 12} ${x} ${y})"/>`;
    }
    return curls + common;
  }
  const long = ['straight', 'long-layer', 'long-bangs', 'flat'].includes(kind);
  const wide = kind === 'shag' ? 0.48 : 0.42;
  const length = long ? 0.92 : 0.66;
  const bangPart = ['long-bangs', 'curtain', 'flat'].includes(kind) ? bangs : '';
  return `
    <path fill="var(--hair)" d="
      M${360 - 360 * wide} 238
      C${110} 70 ${610} 64 ${640 - 360 * (1 - wide)} 238
      C${650} ${330 * length + 168} ${500} ${520 * length + 130} 360 ${470 * length + 164}
      C${220} ${520 * length + 130} ${70} ${330 * length + 168} ${360 - 360 * wide} 238 Z"/>
    ${bangPart}
    ${common}
    ${kind === 'side-wave' ? '<path class="shine thick" d="M340 94 C470 168 510 272 450 438"/>' : ''}
    ${kind === 'flip' ? '<path fill="var(--hair)" d="M174 456 C218 512 286 524 342 470 C268 492 220 478 174 456ZM546 456 C502 512 434 524 378 470 C452 492 500 478 546 456Z"/>' : ''}
    ${kind === 'textured' || kind === 'shag' ? '<path fill="rgba(0,0,0,.18)" d="M190 220 C238 188 278 196 318 228 C258 222 224 236 190 220ZM402 218 C462 190 516 198 548 232 C492 220 454 232 402 218Z"/>' : ''}
  `;
}

function svgFor([id, label, color, kind]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
  <defs>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
      <feOffset dy="6"/>
      <feComponentTransfer><feFuncA type="linear" slope=".28"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <style>
      :root { --hair: ${color}; }
      .shine { fill: none; stroke: rgba(255,255,255,.22); stroke-width: 8; stroke-linecap: round; }
      .thick { stroke-width: 14; opacity: .5; }
    </style>
  </defs>
  <g filter="url(#soft)">
    ${strandPaths(kind)}
  </g>
  <metadata>${label}</metadata>
</svg>`;
}

await mkdir(outDir, { recursive: true });
await Promise.all(styles.map((style) => writeFile(new URL(`${style[0]}.svg`, outDir), svgFor(style))));
console.log(`Generated ${styles.length} hair assets in ${outDir.pathname}`);
