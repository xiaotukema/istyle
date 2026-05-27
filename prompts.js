const TREND_CONTEXT = {
  updatedAt: '2026-05',
  male: [
    '美式前刺 / American textured fringe: short-to-medium top pushed forward into piecey spiky texture, lifted roots, matte finish, low taper or drop fade sides, clean temples, NOT a flat bowl cut, NOT slicked back',
    '法式前刺 / French crop: cropped textured top with short forward fringe, neat blunt-but-soft hairline, low fade or taper sides, compact clean silhouette, matte salon texture',
    '韩式逗号刘海 / Korean comma hair: soft C-shaped comma fringe curving beside forehead, airy root volume, natural side part, smooth dark hair, gentle K-style flow',
    'clean taper flow, natural side volume, low-maintenance salon finish',
    '软狼尾 / male soft wolf cut: layered shag-wolf silhouette for men, airy crown, textured sides, slightly longer nape, face-framing fringe, stylish but wearable, NOT messy cosplay hair',
    'buzz crop with skin fade, only for strong bone structure and dense hair'
  ],
  female: [
    'wispy bangs / 轻盈空气感碎刘海: transparent feathered bangs, soft see-through forehead coverage, airy face-framing layers, natural root volume, feminine and light',
    '辣妹波波头 / hot-girl bob: glossy jaw-to-collarbone bob, slightly tousled texture, face-hugging curve, optional side part or light bangs, chic confident girl-crush mood, not helmet-like',
    '蝴蝶层次 / butterfly layers with curtain fringe',
    '法式波波 / French bob: chin-to-jaw length airy bob, soft inward curve, light natural bangs or side fringe, effortless Parisian texture, not helmet-like',
    '锁骨层次 lob with face-framing movement',
    '软狼尾 / soft wolf cut: layered shag-wolf silhouette, airy crown, feathered face-framing pieces, slightly longer nape, natural movement, not messy cosplay hair',
    'long layers with curtain bangs and quiet-luxury polish',
    'bixie or soft pixie, only when facial proportion and personal style suit it'
  ],
  neutral: [
    'textured crop with soft fringe',
    'collarbone layers',
    'curtain fringe',
    'soft shag / wolf texture',
    'clean taper or natural flow'
  ]
};

// IMMUTABLE_IDENTITY_LOCK is a product safety contract. Do not edit this
// sentence in later prompt iterations; tune hairstyle/style language elsewhere.
export const IMMUTABLE_IDENTITY_LOCK = '请保留本人原本五官、脸型、肤色、表情与真实辨识度，不要换脸，只改变发型。';

// IMMUTABLE_AESTHETIC_TRYON_IDENTITY_BODY_LOCK is a product safety contract.
// Do not edit this sentence in later prompt iterations; tune outfit/style
// language elsewhere. Every aesthetic try-on generation must include this lock.
export const IMMUTABLE_AESTHETIC_TRYON_IDENTITY_BODY_LOCK = '保留本人五官、脸型、肤色、表情与身材真实度，不换脸、不改身材。';

function compactJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

export function buildRecommendationPrompt(metrics, count = 5, now = new Date()) {
  const year = now.getFullYear();
  return `你是一个高级发型顾问和时尚杂志造型编辑，正在为实时摄像头中的用户做 AI 发型试戴推荐。

核心目标：
- 直接根据用户截图判断性别呈现、脸型、发质、发量、额头/颧骨/下颌比例、气质风格。
- 选择 ${year} 年当下流行、适合本人真实条件的 ${count} 款发型，不要被固定发型库限制。
- 必须区分男生、女生和中性风格；如果性别呈现不确定，选择更中性的方案，不要冒进。
- 推荐要兼顾中国审美和海外流行趋势，允许出现「美式前刺」「法式前刺」「韩式逗号刘海」「蝴蝶层次」「法式波波」「软狼尾」等热门方向，但只有适合本人时才推荐。
- 如果推荐这些命名发型，prompt 必须保留趋势参考池里的关键结构词，尤其美式前刺必须是 forward textured fringe + low taper/drop fade + lifted roots + matte piecey texture，不能生成成普通短碎发、背头或蘑菇头。
- 固定热门款权重规则，必须执行：
  - 如果 genderPresentation 判断为 male，recommendations 里必须至少包含「美式前刺」或「软狼尾」其中 1 款；如果两者都适合，优先包含「美式前刺」。
  - 如果 genderPresentation 判断为 female，recommendations 里必须至少包含「wispy bangs / 轻盈空气感碎刘海」或「辣妹波波头」其中 1 款；如果两者都适合，优先包含「wispy bangs」。
  - 如果 genderPresentation 是 androgynous 或 uncertain，则必须至少包含上述四类热门款中的 1 款，但选择更中性、更适配脸型的一款。
  - 这些固定热门款也必须遵守本人脸型、发量、发际线和风格适配，不得换脸或改变性别呈现。
- 不要为了追热点牺牲适配度；最重要的是头脸比例、发际线、发量和日常可实现性。
- 每次必须先描述你从截图中观察到的个人化差异，避免输出模板化结论；summary 必须包含至少一个具体观察点，例如额头高度、脸宽/脸长、下颌线、颧骨、当前发量、当前发际线或整体气质。

近期趋势参考池，不是固定候选库，可以自由扩展：
${compactJson(TREND_CONTEXT)}

输出要求：
- 严格输出 JSON，不要 markdown，不要解释。
- recommendations 必须正好 ${count} 款，款式之间必须明显不同，不要用同义词重复同一种发型。
- 每款都要给出可直接用于图像编辑模型的 prompt，prompt 用英文写，必须描述真实真人发型、长度、分线、层次、发色、发际线、侧区和头顶体积。
- id 用小写英文、数字和连字符，不能重复。
- label 和 reason 用简体中文。
- 不要输出任何会改变五官、脸型、肤色、表情、年龄或性别的内容。

JSON 格式：
{
  "analysis": {
    "genderPresentation": "male|female|androgynous|uncertain",
    "genderLabel": "简体中文",
    "faceShape": {"id": "oval|round|square|heart|oblong|diamond|uncertain", "label": "简体中文"},
    "hair": {"volume": "thin|medium|thick|uncertain", "volumeLabel": "简体中文", "texture": "soft|straight|wavy|curly|coarse|uncertain", "textureLabel": "简体中文"},
    "style": "不超过8字的风格词",
    "summary": "不超过55字，必须包含具体观察点，像专业造型顾问报告的一句话"
  },
  "recommendations": [
    {
      "id": "trend-style-id",
      "label": "简体中文发型名",
      "reason": "不超过32字，说明为什么适合本人",
      "vibe": "不超过8字",
      "genderPresentation": "male|female|androgynous",
      "prompt": "English image-editing prompt for this exact hairstyle"
    }
  ]
}

前端粗估 metrics:
${compactJson(metrics)}`;
}

export function buildTryOnPrompt(style) {
  return `${IMMUTABLE_IDENTITY_LOCK}

SYSTEM IDENTITY LOCK - NON-NEGOTIABLE:
- ${IMMUTABLE_IDENTITY_LOCK}
- Preserve the original face and head exactly. Do not regenerate, repaint, beautify, reshape, age, de-age, slim, widen, smooth, relight, or replace the face.
- The face, skin tone, facial expression, eyes, nose, mouth, eyebrows, jawline, cheekbones, head pose, and identity must remain the same as the input image.
- Only change the hair. If a hairstyle would require changing the face or head shape, adapt the hair instead.

Create a photorealistic high-quality hairstyle try-on from the provided camera portrait.

Professional styling direction:
- Style mood: professional personal hairstyle analysis, fashion magazine beauty editorial, premium salon consultant report quality.
- Chosen hairstyle: ${style.label || 'recommended hairstyle'}.
- Hairstyle implementation prompt: ${style.prompt || style.generationPrompt || style.label || ''}.
- This try-on must look like a real photo of the same person after a salon haircut and styling, not a wig, sticker, illustration, cartoon, beauty filter, or face swap.

Identity lock:
- ${IMMUTABLE_IDENTITY_LOCK}
- Preserve the original person's real identity and recognizability.
- Keep the same eyes, nose, mouth, cheekbones, jawline, face width, skin tone, facial expression, age, gender presentation, gaze, and head angle.
- Do not beautify into a different model. Do not change makeup, facial structure, body, clothing, camera angle, or background more than necessary.
- Treat the face as protected pixels; only edit the hair and the minimum natural occlusion where hair overlaps forehead, ears, cheeks, and neck.

Hair realism:
- Make the hairstyle naturally fit the skull shape, face scale, forehead height, hairline, temples, ears, and neck.
- Hairline, parting, roots, baby hairs, strands, flyaways, density, sideburn/temple transition, shadows under hair, and glossy highlights must be realistic.
- Match the original lighting direction, exposure, perspective, lens, and camera quality.
- Wave/curl/texture must show individual strands and salon-level finish, not blurry color masses.

Negative constraints:
- No face change, no swapped identity, no plastic hair, no helmet shape, no wig edge, no painterly blobs, no color smears, no distorted eyes, no distorted mouth, no duplicate face, no extra accessories, no text, no logo, no frame, no infographic layout.
- Output one close-up portrait image only.`;
}

export function buildAestheticPrompt(metrics, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return `你是一名顶尖的「全方位形象美学顾问」，正在根据用户即时摄像头截图或上传照片中的人像，制作一份专业、克制、不迷信的「专属美学形象鉴定」信息图表内容。

重要原则：
- 全文必须使用简体中文。
- 语气像高级时尚杂志的造型编辑与个人形象顾问，专业、温和、有判断力。
- 不做命理、面相、运势、性格定论或任何迷信式推断。
- 只根据照片中可观察的肤色冷暖、明度、五官气质、脸型比例、身材比例、头身比例与穿搭可执行性提出建议。
- 不要评价美丑，不要羞辱身材、年龄、性别、肤色或外貌。
- 如果照片信息不足，使用「倾向」、「可优先尝试」、「建议现场再微调」等审慎措辞。

请分析并输出以下内容：
1. 核心风格定位：根据五官气质，给出 3 个风格关键词与一句定位摘要。
2. 色彩鉴定：分析肤色冷暖调与明度，提供最佳色盘、应避开色系，以及适合妆容色彩。
3. 试穿方案：必须正好推荐 3 套旅行 OOTD，每套都要能直接生成「真人试穿效果图」。三套要结合色彩诊断、面部轮廓、身材分析与穿搭比例，风格彼此有明确区分且不要普通。
   - 若照片呈现更偏男生/男性化：三套固定方向必须包含「Clean Fit」和「Street Casual」。
   - 若照片呈现更偏女生/女性化：三套固定方向必须包含「Y2K/辣妹风」和「名媛网红风」。
   - 若性别呈现不确定：用中性可穿的「Clean Fit」、「Street Casual」、「都市轻奢」。
4. 发型与妆容只保留最关键的一句建议，不要喧宾夺主。
5. 图卡输出：内容要适合做成「以试穿图为主」的信息图表，有标题、子标题、列表与重点加粗。
6. 最后加一句专属「形象寄语」。

输出要求：
- 严格输出 JSON，不要 markdown，不要解释。
- 不要使用反引号或代码块。
- arrays 的文字要短而有信息密度，适合前端图卡排版。
- bold 数组中放每一区最需要加粗突出的 1–2 个短语。

JSON 格式：
{
  "title": "专属美学形象鉴定",
  "subtitle": "高级、专业、不迷信的时尚杂志风信息图表副标题",
  "date": "${date}",
  "genderPresentation": "male|female|androgynous|uncertain",
  "stylePositioning": {
    "summary": "一句核心风格定位",
    "keywords": ["关键词1", "关键词2", "关键词3"],
    "bold": ["需加粗短语"]
  },
  "colorDiagnosis": {
    "undertone": "冷调|暖调|中性偏冷|中性偏暖|不确定",
    "brightness": "高明度|中高明度|中明度|中低明度|低明度|不确定",
    "bestPalette": ["色彩1", "色彩2", "色彩3", "色彩4"],
    "avoidPalette": ["色彩1", "色彩2", "色彩3"],
    "makeupColors": ["妆容色1", "妆容色2", "妆容色3"],
    "bold": ["需加粗短语"]
  },
  "hairAdvice": {
    "faceShapeNote": "脸型与五官比例观察",
    "styles": ["发型1", "发型2", "发型3"],
    "colors": ["发色1", "发色2", "发色3"],
    "bold": ["需加粗短语"]
  },
  "outfitAdvice": {
    "travelOotd": "旅行 OOTD 风格名称",
    "colorCombos": ["配色1", "配色2", "配色3"],
    "materials": ["材质1", "材质2", "材质3"],
    "bold": ["需加粗短语"]
  },
  "tryOnLooks": [
    {
      "id": "trend-vanguard|urban-soft-luxury|old-money",
      "label": "不超过10字的套装名称",
      "direction": "Clean Fit|Street Casual|Y2K/辣妹风|名媛网红风|老钱风|都市轻奢",
      "subtitle": "不超过16字的风格描述",
      "outfit": "完整说明服装、鞋包、配饰、色彩与面料",
      "reason": "为什么适合本人面部气质、身材比例与旅行场景",
      "prompt": "English image editing prompt describing the complete outfit, styling, colors, accessories, travel OOTD mood, realistic fabric, but no face/body change"
    }
  ],
  "message": "一句专属形象寄语"
}

前端辅助观察数据，不可当成绝对诊断，只能作为照片分析参考：
${compactJson(metrics)}`;
}

export function buildAestheticTryOnPrompt(look) {
  return `${IMMUTABLE_AESTHETIC_TRYON_IDENTITY_BODY_LOCK}

SYSTEM IDENTITY AND BODY LOCK - NON-NEGOTIABLE:
- ${IMMUTABLE_AESTHETIC_TRYON_IDENTITY_BODY_LOCK}
- Preserve the original person's identity exactly: same eyes, nose, mouth, eyebrows, face shape, jawline, cheekbones, skin tone, facial expression, age impression, head angle, gaze, and recognizability.
- Preserve the original body exactly: same body shape, body size, body proportions, height impression, shoulders, waist, hips, limbs, posture, pose, and gender presentation.
- Do not slim, widen, reshape, beautify, age, de-age, change ethnicity, change facial features, change expression, change pose, or replace the body.
- Treat the face, head, skin tone, expression, and body proportions as protected pixels. Only change clothing, styling, accessories, and the minimum natural fabric occlusion.
- If the outfit would require changing the person's face, body, pose, or proportions, adapt the outfit to the original person instead.

Create one photorealistic fashion try-on image from the provided camera portrait.

Look direction:
- Look name: ${look.label || 'travel outfit'}
- Style subtitle: ${look.subtitle || ''}
- Outfit: ${look.outfit || ''}
- Image-editing prompt: ${look.prompt || ''}

Rendering requirements:
- ${IMMUTABLE_AESTHETIC_TRYON_IDENTITY_BODY_LOCK}
- High-end fashion magazine try-on quality, realistic fabric texture, natural fit, believable folds, correct scale, natural shadows, and lighting matched to the input photo.
- Keep the same camera angle and background as much as possible unless a subtle clean travel-editorial background is needed.
- Outfit should look wearable and tailored to the original body, not pasted on or mannequin-like.
- No text, no logo, no watermark, no frame, no collage, no extra people.

Negative constraints:
- no face swap, no changed face, no changed facial features, no changed face shape, no changed skin tone, no changed expression, no changed body, no changed body proportions, no slimming, no widening, no body reshaping, no changed pose, no changed posture, no unrealistic anatomy, no plastic fabric, no distorted hands, no duplicate limbs, no heavy beauty filter, no cartoon, no illustration.`;
}
