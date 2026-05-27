import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { buildAestheticPrompt, buildAestheticTryOnPrompt, buildRecommendationPrompt, buildTryOnPrompt } from './prompts.js';

const root = fileURLToPath(new URL('.', import.meta.url));

function loadDotEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function loadJsonConfig(name) {
  const configPath = join(root, name);
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.warn(`配置文件 ${name} 读取失败：${err.message || String(err)}`);
    return {};
  }
}

const aestheticConfig = loadJsonConfig('aesthetic.config.json');

const port = Number(process.env.PORT || 8000);
const imageProvider = (process.env.IMAGE_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai')).toLowerCase();
const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
const geminiModel = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
const analysisProvider = (process.env.ANALYSIS_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'local')).toLowerCase();
const analysisModel = process.env.ANALYSIS_MODEL || (analysisProvider === 'gemini' ? 'gemini-2.5-pro' : 'gpt-4.1-mini');
const aestheticAnalysisProvider = (process.env.AESTHETIC_ANALYSIS_PROVIDER || aestheticConfig.analysisProvider || analysisProvider).toLowerCase();
const aestheticAnalysisModel = process.env.AESTHETIC_ANALYSIS_MODEL || aestheticConfig.analysisModel || (aestheticAnalysisProvider === 'gemini' ? 'gemini-2.5-pro' : analysisModel);
const aestheticImageProvider = (process.env.AESTHETIC_IMAGE_PROVIDER || aestheticConfig.imageProvider || 'gemini').toLowerCase();
const aestheticGeminiModel = process.env.AESTHETIC_GEMINI_IMAGE_MODEL || aestheticConfig.geminiImageModel || geminiModel;
const aestheticTryOnLimit = Number(process.env.AESTHETIC_TRYON_LIMIT || aestheticConfig.tryOnLimit || 3);
const aestheticTryOnConcurrency = Number(process.env.AESTHETIC_TRYON_CONCURRENCY || aestheticConfig.tryOnConcurrency || 1);
const agnesModel = process.env.AGNES_IMAGE_MODEL || 'agnes-image-1.2';
const liblibModel = process.env.LIBLIB_IMAGE_MODEL || 'star-3-alpha';
const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const geminiApiBase = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const agnesApiBase = process.env.AGNES_API_BASE || 'https://apihub.agnes-ai.com/v1';
const liblibApiBase = process.env.LIBLIB_API_BASE || 'https://openapi.liblibai.cloud';
const variantLimit = Number(process.env.HAIR_VARIANT_LIMIT || (imageProvider === 'liblib' ? 5 : 15));
const variantConcurrency = Number(process.env.HAIR_VARIANT_CONCURRENCY || (imageProvider === 'liblib' ? 1 : 3));
const tryOnLimit = Number(process.env.HAIR_TRYON_LIMIT || 5);
const dailyHairLimit = Number(process.env.DAILY_HAIR_LIMIT || 11);
const authSessions = new Map();
const quotaByUserDay = new Map();

function shortText(value, max = 80, fallback = '') {
  return String(value || fallback).trim().replace(/\s+/g, ' ').slice(0, max);
}

function stableIdFromText(text, prefix = 'ai-style') {
  const ascii = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  if (ascii) return ascii;
  return `${prefix}-${crypto.createHash('sha1').update(String(text || Date.now())).digest('hex').slice(0, 10)}`;
}

const styleGroups = [
  {
    title: '最适合',
    symbol: '✓',
    color: '#22796f',
    note: '拉长比例、提升质感',
    styles: [
      ['法式层次短发', '轻盈', 'airy French layered short haircut, soft volume around crown, natural broken texture, clean nape, flattering face-framing layers'],
      ['侧分微卷', '修饰', 'side-parted soft waves, medium length, natural S-shaped movement, polished salon finish, face-slimming side sweep'],
      ['锁骨内扣', '显脸小', 'collarbone length inward curved lob, smooth ends tucked inward, elegant volume, natural hairline'],
      ['空气刘海长卷', '柔和', 'long soft waves with transparent airy bangs, light forehead coverage, romantic but realistic texture'],
      ['纹理中短发', '利落', 'medium-short textured cut, subtle layers, controlled volume, modern clean silhouette']
    ]
  },
  {
    title: '普通',
    symbol: '○',
    color: '#9b7a38',
    note: '可尝试，需控制蓬松度',
    styles: [
      ['直顺中长发', '自然', 'straight medium-long hair, smooth healthy shine, center natural fall, simple everyday style'],
      ['低层次长发', '干净', 'long hair with low subtle layers, natural density, tidy ends, understated salon look'],
      ['八字刘海', '日常', 'curtain bangs parted softly in the middle, medium length hair, gentle face framing'],
      ['微湿背头', '个性', 'slightly wet slicked-back styling, controlled shine, editorial but realistic hairline'],
      ['齐肩外翻', '轻熟', 'shoulder length hair with outward flipped ends, mature clean styling, soft volume']
    ]
  },
  {
    title: '不建议',
    symbol: '×',
    color: '#a94b53',
    note: '容易压比例或显厚重',
    styles: [
      ['厚重齐刘海', '压低', 'heavy straight blunt bangs, dense fringe, compact silhouette, realistic but less flattering'],
      ['超短寸感', '挑脸型', 'very short cropped buzz-inspired haircut, close to scalp, realistic hair texture and hairline'],
      ['高贴头直发', '贴脸', 'very flat straight hair close to the scalp and cheeks, low volume, realistic shine'],
      ['宽蓬爆卷', '放宽', 'very wide voluminous tight curls, expanded side volume, realistic curly hair texture'],
      ['重层次碎发', '凌乱', 'heavily layered choppy shag, fragmented ends, messy texture, realistic salon photo']
    ]
  }
];

const styles = styleGroups.flatMap((group, groupIndex) => group.styles.map((style, styleIndex) => ({
  id: `${groupIndex}-${styleIndex}`,
  group: group.title,
  symbol: group.symbol,
  color: group.color,
  label: style[0],
  tag: style[1],
  prompt: style[2]
})));

const recommendationCatalog = [
  {
    id: 'real-layered-brown',
    label: '真人层次卷',
    shapes: ['oval', 'oblong', 'square'],
    volume: ['thin', 'medium'],
    texture: ['soft', 'wavy'],
    vibe: '柔和修饰',
    reason: '侧边层次能修饰颧骨和下颌，保留柔和女性化轮廓。'
  },
  {
    id: 'real-black-long',
    label: '真人黑长卷',
    shapes: ['heart', 'oval', 'round'],
    volume: ['medium', 'thick'],
    texture: ['soft', 'wavy'],
    vibe: '显脸小',
    reason: '长卷度包裹脸侧，适合希望弱化脸宽和增加温柔感的人。'
  },
  {
    id: 'best-french-layered',
    label: '法式层次',
    shapes: ['oval', 'heart', 'square'],
    volume: ['medium', 'thick'],
    texture: ['soft', 'straight'],
    vibe: '高级感',
    reason: '轻层次和颅顶空气感能提升质感，同时不压五官。'
  },
  {
    id: 'best-side-waves',
    label: '侧分微卷',
    shapes: ['round', 'square', 'oval'],
    volume: ['thin', 'medium'],
    texture: ['wavy', 'soft'],
    vibe: '提气场',
    reason: '侧分线条能制造不对称修饰，让脸部比例更利落。'
  },
  {
    id: 'best-textured-mid',
    label: '纹理中短',
    shapes: ['oblong', 'oval', 'heart'],
    volume: ['medium', 'thick'],
    texture: ['straight', 'soft'],
    vibe: '利落',
    reason: '中短长度减少拖沓感，纹理能让头脸比例更干净。'
  },
  {
    id: 'best-collarbone-lob',
    label: '锁骨内扣',
    shapes: ['round', 'square', 'heart'],
    volume: ['thin', 'medium'],
    texture: ['straight', 'soft'],
    vibe: '修饰下颌',
    reason: '锁骨长度和内扣弧线能柔化脸侧，并拉开脖颈空间。'
  },
  {
    id: 'best-air-bangs-long',
    label: '空气刘海',
    shapes: ['oblong', 'heart', 'oval'],
    volume: ['medium', 'thick'],
    texture: ['soft', 'straight'],
    vibe: '缩短中庭',
    reason: '轻薄刘海能降低额头和脸长视觉，同时保持通透感。'
  },
  {
    id: 'ok-curtain-bangs',
    label: '八字刘海',
    shapes: ['round', 'square', 'heart'],
    volume: ['thin', 'medium'],
    texture: ['soft', 'wavy'],
    vibe: '柔化颧骨',
    reason: '八字弧度自然衔接太阳穴和颧骨，适合多数日常风格。'
  },
  {
    id: 'ok-shoulder-flip',
    label: '齐肩外翻',
    shapes: ['oval', 'oblong', 'square'],
    volume: ['medium'],
    texture: ['straight', 'soft'],
    vibe: '轻熟',
    reason: '齐肩外翻能增加横向轻盈感，适合清爽但不夸张的造型。'
  },
  {
    id: 'ok-low-layer-long',
    label: '低层次长发',
    shapes: ['heart', 'oval', 'square'],
    volume: ['thick', 'medium'],
    texture: ['straight', 'wavy'],
    vibe: '自然',
    reason: '低层次保留发量和质感，适合不想大幅改变的人。'
  },
  {
    id: 'ok-wet-back',
    label: '湿发后梳',
    shapes: ['oval', 'oblong'],
    volume: ['medium', 'thick'],
    texture: ['straight', 'soft'],
    vibe: '锋利',
    reason: '露出额头和五官，适合轮廓清晰、想要时装感的人。'
  }
];

const recommendationPrompts = {
  'real-layered-brown': 'soft layered medium-long salon waves, warm brunette tone, face-framing layers around cheekbones and jaw, airy crown volume, natural realistic hairline and temples',
  'real-black-long': 'long black soft waves with natural density, gentle face-framing curtain shape, glossy healthy texture, realistic roots and hairline, elegant feminine silhouette',
  'best-french-layered': 'airy French layered haircut, soft volume around crown, natural broken texture, refined face-framing layers, clean salon finish',
  'best-side-waves': 'side-parted soft waves, medium length, natural S-shaped movement, polished salon finish, face-slimming side sweep',
  'best-textured-mid': 'medium-short textured haircut, subtle layers, controlled volume, modern clean silhouette, natural hairline',
  'best-collarbone-lob': 'collarbone length inward curved lob, smooth ends tucked inward, elegant volume, natural hairline, flattering jawline contour',
  'best-air-bangs-long': 'long soft waves with transparent airy bangs, light forehead coverage, romantic realistic texture, natural roots',
  'ok-curtain-bangs': 'curtain bangs parted softly in the middle, medium length hair, gentle face framing, natural salon texture',
  'ok-shoulder-flip': 'shoulder length hair with outward flipped ends, mature clean styling, soft volume, realistic highlights',
  'ok-low-layer-long': 'long hair with low subtle layers, natural density, tidy ends, understated salon look, realistic hairline',
  'ok-wet-back': 'slightly wet slicked-back styling, controlled shine, editorial but realistic hairline, clean temples'
};

function providerStyleFromRecommendation(style) {
  return {
    id: style.id,
    group: '最适合',
    symbol: '✓',
    color: '#22796f',
    label: style.label,
    tag: style.vibe || '推荐',
    prompt: style.prompt || style.generationPrompt || recommendationPrompts[style.id] || style.label,
    genderPresentation: style.genderPresentation
  };
}

function recommendationById(id) {
  return recommendationCatalog.find((style) => style.id === id);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = 18 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('上传图片过大，请离摄像头近一些或降低截图分辨率。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!match) {
    throw new Error('前端上传的图片格式无效。');
  }
  const mime = match[1].replace('image/jpg', 'image/jpeg');
  const buffer = Buffer.from(match[2], 'base64');
  return new Blob([buffer], { type: mime });
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1] : '';
}

function cloudOpenid(req) {
  return req.headers['x-wx-openid'] || req.headers['x-wx-from-openid'] || '';
}

function sessionUser(req) {
  const openid = cloudOpenid(req);
  if (openid) {
    return { openid, source: 'wechat-cloud' };
  }
  const token = bearerToken(req);
  return token ? authSessions.get(token) : null;
}

function quotaState(userId) {
  const key = `${userId}:${todayKey()}`;
  const used = quotaByUserDay.get(key) || 0;
  return { key, used, remaining: Math.max(0, dailyHairLimit - used), limit: dailyHairLimit };
}

function consumeQuota(userId, amount) {
  const state = quotaState(userId);
  if (state.used + amount > dailyHairLimit) {
    const err = new Error('您的今日生成次数已达上限，请明天再来试试吧');
    err.status = 429;
    err.quota = state;
    throw err;
  }
  quotaByUserDay.set(state.key, state.used + amount);
  return quotaState(userId);
}

async function createWechatSession(code) {
  if (!code) throw new Error('缺少微信登录 code。');
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_APP_SECRET;
  let openid = '';
  if (appid && secret) {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', appid);
    url.searchParams.set('secret', secret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.errcode) {
      throw new Error(payload.errmsg || `微信登录失败：HTTP ${response.status}`);
    }
    openid = payload.openid;
  } else {
    openid = `dev-${crypto.createHash('sha1').update(code).digest('hex').slice(0, 16)}`;
  }
  const token = crypto.randomUUID();
  const user = { openid, createdAt: Date.now() };
  authSessions.set(token, user);
  return { token, user, quota: quotaState(openid) };
}

function portraitPrompt(style) {
  return buildTryOnPrompt(style);
}

async function createStyleVariant(imageDataUrl, style) {
  if (imageProvider === 'liblib') {
    return createLiblibStyleVariant(imageDataUrl, style);
  }
  if (imageProvider === 'agnes') {
    return createAgnesStyleVariant(imageDataUrl, style);
  }
  if (imageProvider === 'gemini') {
    return createGeminiStyleVariant(imageDataUrl, style);
  }
  return createOpenAiStyleVariant(imageDataUrl, style);
}

function liblibSignedUrl(path) {
  const timestamp = Date.now().toString();
  const signatureNonce = crypto.randomUUID();
  const content = `${path}&${timestamp}&${signatureNonce}`;
  const digest = crypto.createHmac('sha1', process.env.LIBLIB_SECRET_KEY || '').update(content).digest();
  const signature = digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const url = new URL(path, liblibApiBase);
  url.searchParams.set('AccessKey', process.env.LIBLIB_ACCESS_KEY || '');
  url.searchParams.set('Signature', signature);
  url.searchParams.set('Timestamp', timestamp);
  url.searchParams.set('SignatureNonce', signatureNonce);
  return url.toString();
}

function liblibPrompt(style) {
  return `${style.prompt}, photorealistic salon portrait, same person as reference image, preserve original face identity, same eyes nose mouth jaw skin tone expression age head angle, only change hairstyle, realistic hairline roots temples strands flyaway hairs, natural shadows and highlights, high-end hair retouching, no text, no logo, no frame, no accessories, no face change, no beauty model replacement, no plastic hair, no wig edge`;
}

async function postLiblib(path, body) {
  const response = await fetch(liblibSignedUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.msg || payload.message || `LIBLIB 请求失败：HTTP ${response.status}`);
  }
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg || payload.message || `LIBLIB 返回错误 code=${payload.code}`);
  }
  return payload.data || payload;
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!match) {
    throw new Error('前端上传的图片格式无效。');
  }
  return {
    mimeType: match[1].replace('image/jpg', 'image/jpeg'),
    data: match[2]
  };
}

function localStyleScore(style, metrics = {}) {
  let score = 0;
  const faceShape = metrics.faceShape?.id || metrics.faceShape || 'oval';
  const volume = metrics.hair?.volume || metrics.volume || 'medium';
  const texture = metrics.hair?.texture || metrics.texture || 'soft';
  if (style.shapes.includes(faceShape)) score += 4;
  if (style.volume.includes(volume)) score += 1.4;
  if (style.texture.includes(texture)) score += 1;
  if (style.id.startsWith('real-')) score += 0.35;
  if (faceShape === 'round' && /侧分|锁骨|八字/.test(style.label)) score += 1.5;
  if (faceShape === 'oblong' && /刘海|纹理|齐肩/.test(style.label)) score += 1.5;
  if (faceShape === 'square' && /层次|侧分|锁骨/.test(style.label)) score += 1.3;
  if (faceShape === 'heart' && /刘海|长|八字/.test(style.label)) score += 1.2;
  if (volume === 'thin' && /微卷|层次|锁骨/.test(style.label)) score += 0.9;
  if (volume === 'thick' && /低层次|中短|后梳/.test(style.label)) score += 0.7;
  return score;
}

function localHairRecommendation(metrics = {}, count = 5) {
  const faceShape = metrics.faceShape || { id: 'oval', label: '鹅蛋脸' };
  const hair = metrics.hair || { volume: 'medium', volumeLabel: '中等', texture: 'soft', textureLabel: '柔顺' };
  const recommendations = recommendationCatalog
    .map((style) => ({ ...style, score: localStyleScore(style, { faceShape, hair }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((style, index) => ({
      id: style.id,
      label: style.label,
      rank: index + 1,
      reason: style.reason,
      vibe: style.vibe
    }));
  return {
    provider: 'local',
    analysis: {
      faceShape,
      hair,
      style: recommendations[0]?.vibe || '自然',
      summary: `根据脸型、发量和发质，优先推荐 ${recommendations.map((style) => style.label).join('、')}。`
    },
    recommendations
  };
}

function recommendationPrompt(metrics, count = 5) {
  return buildRecommendationPrompt(metrics, count);
}

function aestheticPrompt(metrics) {
  return buildAestheticPrompt(metrics);
}

function stripJsonFence(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function normalizeRecommendation(payload, fallback, count = 5) {
  const picked = [];
  for (const item of payload.recommendations || []) {
    const label = shortText(item.label, 24);
    const prompt = shortText(item.prompt || item.generationPrompt || item.description, 520);
    if (!label || !prompt) continue;
    const id = stableIdFromText(item.id || label || prompt);
    if (picked.some((candidate) => candidate.id === id || candidate.label === label)) continue;
    picked.push({
      id,
      label,
      rank: picked.length + 1,
      reason: shortText(item.reason, 64, '根据脸型和发质匹配。'),
      vibe: shortText(item.vibe, 16, '推荐'),
      genderPresentation: shortText(item.genderPresentation, 16, payload.analysis?.genderPresentation || ''),
      prompt
    });
  }
  for (const item of fallback.recommendations) {
    if (picked.length >= count) break;
    if (!picked.some((candidate) => candidate.id === item.id)) {
      picked.push({
        ...item,
        rank: picked.length + 1,
        prompt: recommendationPrompts[item.id] || item.label
      });
    }
  }
  return {
    provider: payload.provider || analysisProvider,
    analysis: {
      faceShape: payload.analysis?.faceShape || fallback.analysis.faceShape,
      hair: payload.analysis?.hair || fallback.analysis.hair,
      genderPresentation: shortText(payload.analysis?.genderPresentation, 16, 'uncertain'),
      genderLabel: shortText(payload.analysis?.genderLabel, 16, '未确定'),
      style: shortText(payload.analysis?.style, 16, fallback.analysis.style || '自然'),
      summary: shortText(payload.analysis?.summary, 90, fallback.analysis.summary || '')
    },
    recommendations: picked.slice(0, count)
  };
}

async function createGeminiRecommendation(imageDataUrl, metrics, count = 5) {
  if (!process.env.GEMINI_API_KEY) throw new Error('缺少 GEMINI_API_KEY。');
  const input = parseDataUrl(imageDataUrl);
  const response = await fetch(`${geminiApiBase}/models/${analysisModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: recommendationPrompt(metrics, count) },
          { inline_data: { mime_type: input.mimeType, data: input.data } }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.35
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini 推荐失败：HTTP ${response.status}`);
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('\n');
  if (!text) throw new Error('Gemini 推荐没有返回文本。');
  return JSON.parse(stripJsonFence(text));
}

async function createOpenAiRecommendation(imageDataUrl, metrics, count = 5) {
  if (!process.env.OPENAI_API_KEY) throw new Error('缺少 OPENAI_API_KEY。');
  const input = parseDataUrl(imageDataUrl);
  const response = await fetch(`${apiBase}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: analysisModel,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: recommendationPrompt(metrics, count) },
          { type: 'input_image', image_url: `data:${input.mimeType};base64,${input.data}` }
        ]
      }],
      text: { format: { type: 'json_object' } },
      temperature: 0.35
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI 推荐失败：HTTP ${response.status}`);
  }
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((part) => part.text).filter(Boolean).join('\n');
  if (!text) throw new Error('OpenAI 推荐没有返回文本。');
  return JSON.parse(stripJsonFence(text));
}

async function createHairRecommendation(imageDataUrl, metrics = {}, options = {}) {
  const count = Math.max(1, Math.min(15, Number(options.count || 5)));
  const fallback = localHairRecommendation(metrics, count);
  if (analysisProvider === 'local') return fallback;
  try {
    const aiPayload = analysisProvider === 'openai'
      ? await createOpenAiRecommendation(imageDataUrl, metrics, count)
      : await createGeminiRecommendation(imageDataUrl, metrics, count);
    return normalizeRecommendation({ ...aiPayload, provider: analysisProvider }, fallback, count);
  } catch (err) {
    return {
      ...fallback,
      provider: `${analysisProvider}-fallback`,
      warning: err.message || String(err)
    };
  }
}

function asList(value, fallback = [], max = 5) {
  const list = Array.isArray(value) ? value : [];
  const cleaned = list.map((item) => shortText(item, 42)).filter(Boolean);
  return (cleaned.length ? cleaned : fallback).slice(0, max);
}

function genderBucket(value = '') {
  const text = String(value || '').toLowerCase();
  if (/^male|masculine|男/.test(text)) return 'male';
  if (/^female|feminine|女/.test(text)) return 'female';
  return 'uncertain';
}

function aestheticPresetLooks(genderPresentation = 'uncertain') {
  const bucket = genderBucket(genderPresentation);
  const maleLooks = [
    {
      id: 'clean-fit',
      label: 'Clean Fit',
      direction: 'Clean Fit',
      subtitle: '干净高级感',
      outfit: '白色挺版 T 恤或衬衫、深灰直筒西裤、短版夹克、极简皮带、白色德训鞋或乐福鞋。',
      reason: '清爽线条能拉开头肩比例，直筒裤修饰腿型，整体更干净耐看。',
      prompt: 'men clean fit travel outfit, crisp white structured t-shirt or shirt, charcoal straight tailored trousers, cropped jacket, minimal leather belt, white german trainer sneakers or loafers, clean elevated everyday styling, realistic cotton and wool fabric'
    },
    {
      id: 'street-casual',
      label: 'Street Casual',
      direction: 'Street Casual',
      subtitle: '街头松弛感',
      outfit: '宽松短版卫衣或棒球外套、内搭白 T、深色工装裤、斜挎包、棒球帽与复古运动鞋。',
      reason: '上短下长提高腰线，街头配件让五官气质更有记忆点。',
      prompt: 'men street casual travel outfit, relaxed cropped hoodie or varsity jacket, white inner tee, dark cargo pants, crossbody bag, baseball cap, retro sneakers, modern streetwear proportions, realistic fleece cotton and nylon fabric'
    }
  ];
  const femaleLooks = [
    {
      id: 'y2k-hot-girl',
      label: 'Y2K辣妹',
      direction: 'Y2K/辣妹风',
      subtitle: '高腰线高存在感',
      outfit: '短版修身上衣、低腰或高腰微喇牛仔裤、金属腰链、窄框墨镜、小腋下包与厚底鞋。',
      reason: '短上衣与长裤线条强化腰腿比例，金属配件增加潮流感。',
      prompt: 'women Y2K hot girl travel outfit, cropped fitted top, low-rise or high-waist slight flare jeans, metal waist chain, slim sunglasses, small shoulder bag, platform shoes, confident trendy styling, realistic denim and stretch fabric'
    },
    {
      id: 'socialite-influencer',
      label: '名媛网红',
      direction: '名媛网红风',
      subtitle: '精致上镜感',
      outfit: '短版小香风外套或修身针织套装、高腰 A 字短裙或直筒裤、珍珠耳饰、小号链条包与尖头鞋。',
      reason: '精致面料和短版轮廓提升上镜度，能修饰肩颈与腰线。',
      prompt: 'women socialite influencer travel outfit, cropped tweed jacket or fitted knit set, high-waist A-line mini skirt or straight trousers, pearl earrings, small chain bag, pointed shoes, polished photogenic styling, realistic tweed knit and leather texture'
    }
  ];
  const common = {
    id: 'old-money',
    label: '老钱风',
    direction: '老钱风',
    subtitle: bucket === 'male' ? '克制绅士感' : '克制度假感',
    outfit: bucket === 'male'
      ? '奶油白针织 Polo、燕麦色休闲西裤、棕色乐福鞋、皮革托特包与细框腕表。'
      : '奶油白针织 Polo、燕麦色百慕大短裤或直筒长裤、棕色乐福鞋、皮革托特包、珍珠或金色细饰。',
    reason: '低饱和中性色降低造型噪音，挺感剪裁强化肩线与身材比例。',
    prompt: `${bucket === 'male' ? 'men' : 'women'} old money resort travel outfit, cream knit polo, oatmeal tailored trousers, brown loafers, structured leather tote, understated elegant vacation styling, realistic knit cotton and linen fabric`
  };
  if (bucket === 'male') return [...maleLooks, common];
  if (bucket === 'female') return [...femaleLooks, common];
  return [...maleLooks, { ...common, id: 'urban-soft-luxury', label: '都市轻奢', direction: '都市轻奢', subtitle: '低调精致感' }];
}

function localAestheticCard(metrics = {}) {
  const skin = metrics.skin || {};
  const faceShape = metrics.faceShape || {};
  const genderPresentation = metrics.genderPresentation || metrics.gender || 'uncertain';
  const warm = skin.undertone === 'warm' || skin.undertone === 'neutral-warm';
  const cool = skin.undertone === 'cool' || skin.undertone === 'neutral-cool';
  const bright = Number(skin.lightness || 0.56) > 0.58;
  const faceLabel = faceShape.label || '自然柔和轮廓';
  const bestPalette = warm
    ? ['奶油白', '燕麦米', '番茄红', '橄榄绿']
    : ['雾白', '灰粉', '宝石蓝', '冷松绿'];
  const avoidPalette = warm
    ? ['冷荧光粉', '灰紫蓝', '过重黑灰']
    : ['土橘棕', '黄绿色', '暗沉卡其'];
  const makeupColors = warm
    ? ['蜜桃裸色腮红', '焦糖棕眼影', '豆沙珊瑚唇']
    : ['玫瑰豆沙腮红', '灰棕眼影', '莓果或冷粉唇'];
  return {
    provider: 'local',
    title: '专属美学形象鉴定',
    subtitle: '依据即时照片的色彩、轮廓、身材比例，整理可执行的形象方案。',
    date: new Date().toISOString().slice(0, 10),
    genderPresentation,
    stylePositioning: {
      summary: `整体适合走「干净有质感」路线，以${faceLabel}保留亲和度，再用线条与材质提升精致感。`,
      keywords: ['清透质感', '轻熟松弛', '比例修饰'],
      bold: ['干净有质感', '比例修饰']
    },
    colorDiagnosis: {
      undertone: cool ? '中性偏冷' : warm ? '中性偏暖' : '中性',
      brightness: bright ? '中高明度' : '中明度',
      bestPalette,
      avoidPalette,
      makeupColors,
      bold: [bestPalette[0], makeupColors[0]]
    },
    hairAdvice: {
      faceShapeNote: `${faceLabel}适合保留头顶空气感与脸侧层次，避免发尾过厚造成重心下沉。`,
      styles: ['锁骨层次 Lob', '八字刘海长层次', '侧分微卷中长发'],
      colors: ['雾棕', cool ? '冷茶棕' : '暖栗棕', '深可可棕'],
      bold: ['头顶空气感', '脸侧层次']
    },
    outfitAdvice: {
      travelOotd: '固定风格试穿方案',
      colorCombos: ['雾白＋深灰', '燕麦米＋丹宁蓝', '黑色＋橄榄绿'],
      materials: ['细致棉质', '挺感斜纹', '雾面金属或皮革'],
      bold: ['固定风格', '挺感斜纹']
    },
    tryOnLooks: aestheticPresetLooks(genderPresentation),
    message: '让色彩先变干净，让线条替你说话，你的高级感会自然浮现。'
  };
}

function normalizeTryOnLooks(value, fallback = localAestheticCard().tryOnLooks, genderPresentation = 'uncertain') {
  const source = Array.isArray(value) ? value : [];
  const required = aestheticPresetLooks(genderPresentation);
  const picked = [...required.slice(0, 2)];
  for (const item of source) {
    const label = shortText(item?.label, 20);
    const outfit = shortText(item?.outfit, 140);
    const prompt = shortText(item?.prompt, 620);
    if (!label || !outfit || !prompt) continue;
    const id = stableIdFromText(item.id || label || outfit, 'look');
    if (picked.some((look) => look.id === id || look.label === label)) continue;
    picked.push({
      id,
      label,
      direction: shortText(item.direction, 18, item.direction || label),
      subtitle: shortText(item.subtitle, 28, '旅行 OOTD'),
      outfit,
      reason: shortText(item.reason, 90, '根据比例与气质匹配。'),
      prompt
    });
    if (picked.length >= 3) break;
  }
  for (const item of fallback) {
    if (picked.length >= 3) break;
    if (!picked.some((look) => look.id === item.id)) picked.push(item);
  }
  return picked.slice(0, 3);
}

function normalizeAestheticCard(payload = {}, fallback = localAestheticCard()) {
  const style = payload.stylePositioning || {};
  const color = payload.colorDiagnosis || {};
  const hair = payload.hairAdvice || {};
  const outfit = payload.outfitAdvice || {};
  const genderPresentation = shortText(payload.genderPresentation, 18, fallback.genderPresentation || 'uncertain');
  return {
    provider: payload.provider || analysisProvider,
    title: shortText(payload.title, 28, fallback.title),
    subtitle: shortText(payload.subtitle, 80, fallback.subtitle),
    date: shortText(payload.date, 16, fallback.date),
    genderPresentation,
    stylePositioning: {
      summary: shortText(style.summary, 110, fallback.stylePositioning.summary),
      keywords: asList(style.keywords, fallback.stylePositioning.keywords, 3),
      bold: asList(style.bold, fallback.stylePositioning.bold, 2)
    },
    colorDiagnosis: {
      undertone: shortText(color.undertone, 18, fallback.colorDiagnosis.undertone),
      brightness: shortText(color.brightness, 18, fallback.colorDiagnosis.brightness),
      bestPalette: asList(color.bestPalette, fallback.colorDiagnosis.bestPalette, 4),
      avoidPalette: asList(color.avoidPalette, fallback.colorDiagnosis.avoidPalette, 3),
      makeupColors: asList(color.makeupColors, fallback.colorDiagnosis.makeupColors, 3),
      bold: asList(color.bold, fallback.colorDiagnosis.bold, 2)
    },
    hairAdvice: {
      faceShapeNote: shortText(hair.faceShapeNote, 110, fallback.hairAdvice.faceShapeNote),
      styles: asList(hair.styles, fallback.hairAdvice.styles, 3),
      colors: asList(hair.colors, fallback.hairAdvice.colors, 3),
      bold: asList(hair.bold, fallback.hairAdvice.bold, 2)
    },
    outfitAdvice: {
      travelOotd: shortText(outfit.travelOotd, 32, fallback.outfitAdvice.travelOotd),
      colorCombos: asList(outfit.colorCombos, fallback.outfitAdvice.colorCombos, 3),
      materials: asList(outfit.materials, fallback.outfitAdvice.materials, 3),
      bold: asList(outfit.bold, fallback.outfitAdvice.bold, 2)
    },
    tryOnLooks: normalizeTryOnLooks(payload.tryOnLooks, fallback.tryOnLooks, genderPresentation),
    message: shortText(payload.message, 100, fallback.message)
  };
}

async function createGeminiAestheticCard(imageDataUrl, metrics) {
  if (!process.env.GEMINI_API_KEY) throw new Error('缺少 GEMINI_API_KEY。');
  const input = parseDataUrl(imageDataUrl);
  const response = await fetch(`${geminiApiBase}/models/${aestheticAnalysisModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: aestheticPrompt(metrics) },
          { inline_data: { mime_type: input.mimeType, data: input.data } }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.45
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini 形象鉴定失败：HTTP ${response.status}`);
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('\n');
  if (!text) throw new Error('Gemini 形象鉴定没有返回文本。');
  return JSON.parse(stripJsonFence(text));
}

async function createOpenAiAestheticCard(imageDataUrl, metrics) {
  if (!process.env.OPENAI_API_KEY) throw new Error('缺少 OPENAI_API_KEY。');
  const input = parseDataUrl(imageDataUrl);
  const response = await fetch(`${apiBase}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: aestheticAnalysisModel,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: aestheticPrompt(metrics) },
          { type: 'input_image', image_url: `data:${input.mimeType};base64,${input.data}` }
        ]
      }],
      text: { format: { type: 'json_object' } },
      temperature: 0.45
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI 形象鉴定失败：HTTP ${response.status}`);
  }
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((part) => part.text).filter(Boolean).join('\n');
  if (!text) throw new Error('OpenAI 形象鉴定没有返回文本。');
  return JSON.parse(stripJsonFence(text));
}

async function createAestheticCard(imageDataUrl, metrics = {}) {
  const fallback = localAestheticCard(metrics);
  if (aestheticAnalysisProvider === 'local') return fallback;
  try {
    const aiPayload = aestheticAnalysisProvider === 'openai'
      ? await createOpenAiAestheticCard(imageDataUrl, metrics)
      : await createGeminiAestheticCard(imageDataUrl, metrics);
    return normalizeAestheticCard({ ...aiPayload, provider: aestheticAnalysisProvider }, fallback);
  } catch (err) {
    return {
      ...fallback,
      provider: `${aestheticAnalysisProvider}-fallback`,
      warning: err.message || String(err)
    };
  }
}

function aestheticTryOnPrompt(look) {
  return buildAestheticTryOnPrompt(look);
}

async function createGeminiAestheticTryOn(imageDataUrl, look) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('缺少 GEMINI_API_KEY。请在 .env 中配置 GEMINI_API_KEY 后重启 npm start。');
  }

  const input = parseDataUrl(imageDataUrl);
  const response = await fetch(`${geminiApiBase}/models/${aestheticGeminiModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: aestheticTryOnPrompt(look) },
          {
            inline_data: {
              mime_type: input.mimeType,
              data: input.data
            }
          }
        ]
      }],
      generationConfig: {
        responseModalities: ['IMAGE']
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `Gemini 试穿图生成失败：HTTP ${response.status}`;
    throw new Error(`${look.label}: ${message}`);
  }

  const parts = payload.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
  const inline = imagePart?.inlineData || imagePart?.inline_data;
  if (!inline?.data) {
    const text = parts.map((part) => part.text).filter(Boolean).join('\n').trim();
    throw new Error(`${look.label}: Gemini 没有返回试穿图片${text ? `，返回文本：${text}` : ''}`);
  }

  const mimeType = inline.mimeType || inline.mime_type || 'image/png';
  return {
    ...look,
    image: `data:${mimeType};base64,${inline.data}`,
    provider: 'gemini',
    model: aestheticGeminiModel
  };
}

async function createAestheticTryOns(imageDataUrl, looks = [], options = {}) {
  if (aestheticImageProvider !== 'gemini') {
    throw new Error('形象试穿页目前固定使用 Gemini 生图。请使用 AESTHETIC_IMAGE_PROVIDER=gemini。');
  }
  const limit = Math.max(1, Math.min(3, Number(options.limit || aestheticTryOnLimit)));
  const normalized = normalizeTryOnLooks(looks, aestheticPresetLooks(options.genderPresentation), options.genderPresentation).slice(0, limit);
  const variants = await mapLimited(normalized, aestheticTryOnConcurrency, async (look, index) => {
    try {
      const variant = await createGeminiAestheticTryOn(imageDataUrl, look);
      return {
        ...variant,
        rank: index + 1
      };
    } catch (err) {
      return {
        ...look,
        rank: index + 1,
        error: err.message || String(err),
        provider: 'gemini',
        model: aestheticGeminiModel
      };
    }
  });
  return {
    provider: aestheticImageProvider,
    model: aestheticGeminiModel,
    variants
  };
}

async function createRecommendedTryOns(imageDataUrl, recommendations = [], options = {}) {
  const limit = Math.max(1, Math.min(5, Number(options.limit || tryOnLimit)));
  const normalized = [];
  for (const item of recommendations) {
    const id = typeof item === 'string' ? item : item.id;
    const catalogStyle = recommendationById(id);
    const source = catalogStyle || (typeof item === 'object' ? item : null);
    if (!source) continue;
    const label = shortText(source.label, 24, catalogStyle?.label || '推荐发型');
    const prompt = shortText(source.prompt || source.generationPrompt || recommendationPrompts[source.id] || source.label, 560, label);
    const styleId = stableIdFromText(source.id || label || prompt);
    if (normalized.some((style) => style.id === styleId || style.label === label)) continue;
    normalized.push({
      ...source,
      id: styleId,
      label,
      prompt,
      reason: shortText(source.reason || catalogStyle?.reason, 70, '根据脸型、发量和气质匹配。'),
      vibe: shortText(source.vibe || catalogStyle?.vibe, 16, '推荐'),
      genderPresentation: source.genderPresentation || ''
    });
    if (normalized.length >= limit) break;
  }
  if (!normalized.length) {
    throw new Error('没有可生成的推荐发型。');
  }

  const variants = await mapLimited(normalized, variantConcurrency, async (style, index) => {
    try {
      const variant = await createStyleVariant(imageDataUrl, providerStyleFromRecommendation(style));
      return {
        id: style.id,
        label: style.label,
        rank: index + 1,
        reason: style.reason,
        vibe: style.vibe,
        image: variant.image,
        provider: imageProvider
      };
    } catch (err) {
      return {
        id: style.id,
        label: style.label,
        rank: index + 1,
        reason: style.reason,
        vibe: style.vibe,
        error: err.message || String(err),
        provider: imageProvider
      };
    }
  });

  return {
    provider: imageProvider,
    variants,
    generated: variants.filter((variant) => variant.image).length,
    failed: variants.filter((variant) => variant.error).length
  };
}

async function uploadLiblibImage(imageDataUrl) {
  const input = parseDataUrl(imageDataUrl);
  const extension = input.mimeType.includes('jpeg') ? 'jpg' : input.mimeType.includes('webp') ? 'webp' : 'png';
  const name = `istyle_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const signData = await postLiblib('/api/generate/upload/signature', { name, extension });
  if (!signData.postUrl || !signData.key) {
    throw new Error('LIBLIB 上传签名接口没有返回 postUrl/key。');
  }

  const blob = new Blob([Buffer.from(input.data, 'base64')], { type: input.mimeType });
  const formData = new FormData();
  formData.append('x-oss-signature', signData.xossSignature || signData.xOssSignature);
  formData.append('x-oss-date', signData.xossDate || signData.xOssDate);
  formData.append('x-oss-signature-version', signData.xossSignatureVersion || signData.xOssSignatureVersion);
  formData.append('policy', signData.policy);
  formData.append('key', signData.key);
  formData.append('x-oss-credential', signData.xossCredential || signData.xOssCredential);
  formData.append('x-oss-expires', String(signData.xossExpires || signData.xOssExpires));
  formData.append('file', blob, `${name}.${extension}`);

  const response = await fetch(signData.postUrl, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) {
    throw new Error(`LIBLIB 图片上传失败：HTTP ${response.status} ${await response.text()}`);
  }

  return new URL(signData.key, signData.postUrl).toString();
}

async function createLiblibStyleVariant(imageDataUrl, style) {
  if (!process.env.LIBLIB_ACCESS_KEY || !process.env.LIBLIB_SECRET_KEY) {
    throw new Error('缺少 LIBLIB_ACCESS_KEY 或 LIBLIB_SECRET_KEY。请在 .env 中配置后重启 npm start。');
  }
  const sourceImage = process.env.LIBLIB_PUBLIC_IMAGE_URL || (imageDataUrl.startsWith('data:') ? await uploadLiblibImage(imageDataUrl) : imageDataUrl);

  const submit = await postLiblib('/api/generate/webui/img2img/ultra', {
    templateUuid: '07e00af4fc464c7ab55ff906f8acf1b7',
    generateParams: {
      prompt: liblibPrompt(style),
      width: 768,
      height: 1024,
      imgCount: 1,
      cfgScale: 3.5,
      randnSource: 0,
      seed: -1,
      clipSkip: 2,
      sampler: 1,
      steps: Number(process.env.LIBLIB_STEPS || 30),
      restoreFaces: 0,
      sourceImage,
      resizeMode: 1,
      resizedWidth: 768,
      resizedHeight: 1024,
      mode: 0,
      denoisingStrength: Number(process.env.LIBLIB_DENOISING || 0.48)
    }
  });

  const generateUuid = submit.generateUuid;
  if (!generateUuid) {
    throw new Error(`${style.label}: LIBLIB 没有返回 generateUuid。`);
  }

  const deadline = Date.now() + Number(process.env.LIBLIB_TIMEOUT_MS || 180000);
  let lastStatus = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.LIBLIB_POLL_MS || 3000)));
    const status = await postLiblib('/api/generate/webui/status', { generateUuid });
    lastStatus = status;
    if (status.generateStatus === 5) {
      const imageUrl = status.images?.[0]?.imageUrl;
      if (!imageUrl) {
        throw new Error(`${style.label}: LIBLIB 任务成功但没有返回图片。`);
      }
      return {
        ...style,
        image: await dataUrlFromRemoteImage(imageUrl)
      };
    }
    if (status.generateStatus === 6 || status.generateStatus === 7) {
      throw new Error(`${style.label}: LIBLIB 任务失败：${status.generateMsg || `status=${status.generateStatus}`}`);
    }
  }

  throw new Error(`${style.label}: LIBLIB 生成超时，最后状态：${lastStatus?.generateStatus ?? 'unknown'} ${lastStatus?.generateMsg || ''}`);
}

async function createOpenAiStyleVariant(imageDataUrl, style) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', portraitPrompt(style));
  form.append('size', process.env.OPENAI_VARIANT_SIZE || '1024x1024');
  form.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high');
  form.append('output_format', 'png');
  form.append('image', dataUrlToBlob(imageDataUrl), 'portrait.jpg');

  const response = await fetch(`${apiBase}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: form
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `OpenAI 图片编辑失败：HTTP ${response.status}`;
    if (/billing hard limit/i.test(message)) {
      throw new Error(`${style.label}: OpenAI 账号已达到 Billing hard limit。请提高项目/账号消费上限，或换一个还有额度的 API key 后重启服务。`);
    }
    throw new Error(`${style.label}: ${message}`);
  }

  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`${style.label}: OpenAI 没有返回图片数据。`);
  }

  return {
    ...style,
    image: `data:image/png;base64,${b64}`
  };
}

async function dataUrlFromRemoteImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载 Agnes 返回图片失败：HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function createAgnesStyleVariant(imageDataUrl, style) {
  if (!process.env.AGNES_API_KEY) {
    throw new Error('缺少 AGNES_API_KEY。请在 .env 中配置 AGNES_API_KEY 后重启 npm start。');
  }

  const response = await fetch(`${agnesApiBase}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AGNES_API_KEY}`
    },
    body: JSON.stringify({
      model: agnesModel,
      tags: ['img2img'],
      prompt: portraitPrompt(style),
      size: process.env.AGNES_IMAGE_SIZE || '1024x1024',
      extra_body: {
        image: [imageDataUrl],
        response_format: 'url'
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `Agnes 图片编辑失败：HTTP ${response.status}`;
    throw new Error(`${style.label}: ${message}`);
  }

  const url = payload.data?.[0]?.url;
  const b64 = payload.data?.[0]?.b64_json;
  if (b64) {
    return {
      ...style,
      image: `data:image/png;base64,${b64}`
    };
  }
  if (!url) {
    throw new Error(`${style.label}: Agnes 没有返回图片 URL。`);
  }

  return {
    ...style,
    image: await dataUrlFromRemoteImage(url)
  };
}

async function createGeminiStyleVariant(imageDataUrl, style) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('缺少 GEMINI_API_KEY。请在 .env 中配置 GEMINI_API_KEY 后重启 npm start。');
  }

  const input = parseDataUrl(imageDataUrl);
  const response = await fetch(`${geminiApiBase}/models/${geminiModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: portraitPrompt(style) },
          {
            inline_data: {
              mime_type: input.mimeType,
              data: input.data
            }
          }
        ]
      }],
      generationConfig: {
        responseModalities: ['IMAGE']
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `Gemini 图片编辑失败：HTTP ${response.status}`;
    if (/quota exceeded|limit:\s*0|free_tier/i.test(message)) {
      throw new Error(`${style.label}: Gemini 图片模型额度不可用或已用完。请在 Google AI Studio / Google Cloud 为该 API key 启用计费并提高 Gemini image generation quota，或换一个有图片生成额度的 key 后重启服务。`);
    }
    throw new Error(`${style.label}: ${message}`);
  }

  const parts = payload.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
  const inline = imagePart?.inlineData || imagePart?.inline_data;
  if (!inline?.data) {
    const text = parts.map((part) => part.text).filter(Boolean).join('\n').trim();
    throw new Error(`${style.label}: Gemini 没有返回图片数据${text ? `，返回文本：${text}` : ''}`);
  }

  const mimeType = inline.mimeType || inline.mime_type || 'image/png';
  return {
    ...style,
    image: `data:${mimeType};base64,${inline.data}`
  };
}

async function mapLimited(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run);
  await Promise.all(runners);
  return results;
}

async function createHairVariants(imageDataUrl, options = {}) {
  if (imageProvider === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('缺少 OPENAI_API_KEY。请在当前终端执行 export OPENAI_API_KEY=你的key，然后重启 npm start。');
  }
  if (imageProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
    throw new Error('缺少 GEMINI_API_KEY。请在 .env 中配置 GEMINI_API_KEY 后重启 npm start。');
  }
  if (imageProvider === 'agnes' && !process.env.AGNES_API_KEY) {
    throw new Error('缺少 AGNES_API_KEY。请在 .env 中配置 AGNES_API_KEY 后重启 npm start。');
  }
  if (imageProvider === 'liblib' && (!process.env.LIBLIB_ACCESS_KEY || !process.env.LIBLIB_SECRET_KEY)) {
    throw new Error('缺少 LIBLIB_ACCESS_KEY 或 LIBLIB_SECRET_KEY。请在 .env 中配置后重启 npm start。');
  }

  const requestedLimit = Number(options.limit || variantLimit);
  const selectedStyles = styles.slice(0, Math.max(1, Math.min(15, requestedLimit)));
  const variants = await mapLimited(selectedStyles, variantConcurrency, (style) => createStyleVariant(imageDataUrl, style));
  return {
    groups: styleGroups,
    variants
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, safePath);

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(file);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/hair-card') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const result = await createHairVariants(payload.image, { limit: payload.limit });
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/hair-recommendation') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const result = await createHairRecommendation(payload.image, payload.metrics || {}, { count: payload.count });
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/aesthetic-card') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const result = await createAestheticCard(payload.image, payload.metrics || {});
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/aesthetic-tryon') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const result = await createAestheticTryOns(payload.image, payload.looks || [], { limit: payload.limit, genderPresentation: payload.genderPresentation });
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/hair-tryon') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const user = sessionUser(req);
      const requested = Math.max(1, Math.min(15, Number(payload.limit || (payload.recommendations || []).length || tryOnLimit)));
      if (user) consumeQuota(user.openid, requested);
      const result = await createRecommendedTryOns(payload.image, payload.recommendations || [], { limit: payload.limit });
      if (user) result.quota = quotaState(user.openid);
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/auth/wechat-login') {
      const body = await readBody(req, 128 * 1024);
      const payload = JSON.parse(body || '{}');
      const result = await createWechatSession(payload.code);
      json(res, 200, result);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/quota') {
      const user = sessionUser(req);
      if (!user) {
        json(res, 401, { error: '未登录' });
        return;
      }
      json(res, 200, { quota: quotaState(user.openid) });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res);
      return;
    }

    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    json(res, err.status || 500, { error: err.message || String(err), quota: err.quota });
  }
});

server.listen(port, () => {
  console.log(`Hair analysis server running at http://127.0.0.1:${port}/`);
  console.log(`Image provider: ${imageProvider}`);
  console.log(`Analysis provider: ${analysisProvider}`);
  console.log(`Analysis model: ${analysisModel}`);
  console.log(`Image model: ${imageProvider === 'liblib' ? liblibModel : imageProvider === 'agnes' ? agnesModel : imageProvider === 'gemini' ? geminiModel : model}`);
  console.log(`Aesthetic analysis provider: ${aestheticAnalysisProvider}`);
  console.log(`Aesthetic analysis model: ${aestheticAnalysisModel}`);
  console.log(`Aesthetic image provider: ${aestheticImageProvider}`);
  console.log(`Aesthetic image model: ${aestheticGeminiModel}`);
  console.log(`Variant count: ${Math.max(1, Math.min(15, variantLimit))}, concurrency: ${variantConcurrency}`);
  console.log(process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY: set' : 'OPENAI_API_KEY: missing');
  console.log(process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY: set' : 'GEMINI_API_KEY: missing');
  console.log(process.env.AGNES_API_KEY ? 'AGNES_API_KEY: set' : 'AGNES_API_KEY: missing');
  console.log(process.env.LIBLIB_ACCESS_KEY && process.env.LIBLIB_SECRET_KEY ? 'LIBLIB_KEYS: set' : 'LIBLIB_KEYS: missing');
});
