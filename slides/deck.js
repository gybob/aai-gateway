const PptxGenJS = require("pptxgenjs");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./pptxgenjs_helpers");

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches

// ── Theme ──
const COLORS = {
  white: "FFFFFF",
  black: "1A1A1A",
  gray: "999999",
  lightGray: "E8E8E8",
  blue: "2563EB",
  red: "DC2626",
  bgGray: "F5F5F5",
  barInactive: "E5E5E5",
  barActive: "2563EB",
  barText: "666666",
  barActiveText: "FFFFFF",
};
const FONT = "Microsoft YaHei"; // CJK-safe
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

// ── Chapter definitions ──
const chapters = [
  "封面", "痛点", "Token浪费", "解决方案", "核心机制", "架构",
  "安装Gateway", "安装MCP", "安装技能", "控制Agent", "片尾",
];

// ── Progress bar helper ──
function addProgressBar(slide, activeIndex) {
  const barY = SLIDE_H - 0.55;
  const barH = 0.4;
  const margin = 0.4;
  const totalW = SLIDE_W - margin * 2;
  const gap = 0.06;
  const count = chapters.length;
  const cellW = (totalW - gap * (count - 1)) / count;

  // thin separator line above bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: barY - 0.06, w: SLIDE_W, h: 0.02,
    fill: { color: COLORS.lightGray },
    line: { width: 0 },
  });

  chapters.forEach((ch, i) => {
    const isActive = i === activeIndex;
    const x = margin + i * (cellW + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: barY, w: cellW, h: barH,
      rectRadius: 0.05,
      fill: { color: isActive ? COLORS.barActive : COLORS.barInactive },
      line: { width: 0 },
    });
    slide.addText(ch, {
      x, y: barY, w: cellW, h: barH,
      fontSize: 9,
      fontFace: FONT,
      color: isActive ? COLORS.barActiveText : COLORS.barText,
      align: "center",
      valign: "middle",
      bold: isActive,
    });
  });
}

// ── Slide builders ──

// 1. Cover
function slideCover() {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText("AAI Gateway", {
    x: 1, y: 1.8, w: 11.33, h: 1.2,
    fontSize: 48, fontFace: FONT, color: COLORS.black,
    bold: true, align: "center",
  });
  slide.addText("One MCP to Rule Them All", {
    x: 1, y: 3.0, w: 11.33, h: 0.7,
    fontSize: 28, fontFace: FONT, color: COLORS.blue,
    align: "center",
  });
  slide.addText("安装一次，所有 AI Agent 共享\n无需重启  ·  无需重复配置  ·  无上下文爆炸", {
    x: 2, y: 4.0, w: 9.33, h: 1.0,
    fontSize: 16, fontFace: FONT, color: COLORS.gray,
    align: "center", lineSpacingMultiple: 1.5,
  });

  addProgressBar(slide, 0);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// 2. Pain points
function slidePainPoints() {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText("MCP 生态的四大痛点", {
    x: 0.8, y: 0.5, w: 11, h: 0.8,
    fontSize: 36, fontFace: FONT, color: COLORS.black, bold: true,
  });

  const painPoints = [
    { icon: "💥", title: "上下文爆炸", desc: "10 个 MCP × 5 个工具 = 50 个完整 Schema\n数千 tokens 在模型思考前就被浪费" },
    { icon: "🔁", title: "重复配置", desc: "Claude Code、Codex、OpenCode\n同一个 MCP 配置三遍，手动保持同步" },
    { icon: "🔄", title: "必须重启", desc: "新增一个 MCP？\n重启 Agent，每一次" },
    { icon: "🔍", title: "发现困难", desc: "搜 GitHub、读 README、复制 JSON、调试连接\n这些都做完才能试用一个工具" },
  ];

  const cardW = 5.6;
  const cardH = 1.8;
  const startX = 0.8;
  const startY = 1.7;
  const gapX = 0.53;
  const gapY = 0.3;

  painPoints.forEach((pp, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    // Card background
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cardW, h: cardH,
      rectRadius: 0.1,
      fill: { color: COLORS.bgGray },
      line: { width: 0 },
    });
    // Title
    slide.addText(`${pp.title}`, {
      x: x + 0.3, y: y + 0.2, w: cardW - 0.6, h: 0.5,
      fontSize: 20, fontFace: FONT, color: COLORS.black, bold: true,
    });
    // Description
    slide.addText(pp.desc, {
      x: x + 0.3, y: y + 0.7, w: cardW - 0.6, h: 0.9,
      fontSize: 14, fontFace: FONT, color: COLORS.gray,
      lineSpacingMultiple: 1.4, valign: "top",
    });
  });

  addProgressBar(slide, 1);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// 3. Token waste
function slideTokenWaste() {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText("MCP 的 Token 浪费", {
    x: 0.8, y: 0.5, w: 11, h: 0.8,
    fontSize: 36, fontFace: FONT, color: COLORS.black, bold: true,
  });
  slide.addText("每轮对话都会重复发送所有工具的完整 Schema", {
    x: 0.8, y: 1.2, w: 11, h: 0.5,
    fontSize: 16, fontFace: FONT, color: COLORS.gray,
  });

  // Info card
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.5, y: 2.0, w: 10.33, h: 1.4,
    rectRadius: 0.1,
    fill: { color: COLORS.bgGray },
    line: { width: 0 },
  });
  slide.addText("1 个工具 = ~120 tokens Schema", {
    x: 2.0, y: 2.15, w: 9, h: 0.5,
    fontSize: 22, fontFace: FONT, color: COLORS.black, bold: true,
  });
  slide.addText("50 个工具 × 15 轮对话 = 90,000 浪费的 tokens", {
    x: 2.0, y: 2.7, w: 9, h: 0.5,
    fontSize: 16, fontFace: FONT, color: COLORS.gray,
  });

  // Token bar visualization
  // Small bar (1 tool)
  slide.addText("1个工具", {
    x: 1.5, y: 3.8, w: 1.5, h: 0.4,
    fontSize: 14, fontFace: FONT, color: COLORS.black,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 3.2, y: 3.8, w: 0.8, h: 0.4,
    rectRadius: 0.08,
    fill: { color: COLORS.blue },
    line: { width: 0 },
  });
  slide.addText("120 tokens", {
    x: 4.2, y: 3.8, w: 2, h: 0.4,
    fontSize: 12, fontFace: FONT, color: COLORS.gray,
  });

  // Large bar (50 tools)
  slide.addText("50个工具", {
    x: 1.5, y: 4.4, w: 1.5, h: 0.4,
    fontSize: 14, fontFace: FONT, color: COLORS.black,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 3.2, y: 4.4, w: 7.5, h: 0.4,
    rectRadius: 0.08,
    fill: { color: COLORS.lightGray },
    line: { width: 0 },
  });
  slide.addText("6,000 tokens / 轮", {
    x: 3.4, y: 4.4, w: 3, h: 0.4,
    fontSize: 12, fontFace: FONT, color: COLORS.gray,
  });

  // Red highlight text
  slide.addText("问题是：大部分工具这一轮根本用不上，但 token 已经花出去了", {
    x: 1.5, y: 5.2, w: 10.33, h: 0.6,
    fontSize: 18, fontFace: FONT, color: COLORS.red,
    bold: true, align: "center",
  });

  addProgressBar(slide, 2);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// 4. Solution overview
function slideSolution() {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText("AAI Gateway — 一个连接替代数十个", {
    x: 0.8, y: 0.5, w: 11.5, h: 0.8,
    fontSize: 32, fontFace: FONT, color: COLORS.black, bold: true,
  });

  // Comparison table
  const tableRows = [
    [
      { text: "", options: { fill: COLORS.white } },
      { text: "没有 AAI Gateway", options: { fill: COLORS.bgGray, bold: true, fontSize: 14, color: COLORS.gray } },
      { text: "有 AAI Gateway", options: { fill: "EBF5FF", bold: true, fontSize: 14, color: COLORS.blue } },
    ],
    [
      { text: "上下文成本", options: { bold: true } },
      { text: "50 个完整 Schema 注入每轮 prompt" },
      { text: "10 条摘要，按需加载详情" },
    ],
    [
      { text: "配置", options: { bold: true } },
      { text: "每个 Agent 各配一遍" },
      { text: "导入一次，所有 Agent 共享" },
    ],
    [
      { text: "新工具", options: { bold: true } },
      { text: "安装后需重启 Agent" },
      { text: "热加载，立即可用" },
    ],
    [
      { text: "发现工具", options: { bold: true } },
      { text: "手动搜索 + 复制配置 + 调试" },
      { text: "自然语言搜索，秒级安装" },
    ],
  ];

  slide.addTable(tableRows, {
    x: 1.0, y: 1.6, w: 11.33,
    colW: [2.2, 4.5, 4.5],
    rowH: [0.6, 0.7, 0.7, 0.7, 0.7],
    fontSize: 13,
    fontFace: FONT,
    color: COLORS.black,
    border: { type: "solid", pt: 0.5, color: COLORS.lightGray },
    valign: "middle",
    align: "center",
  });

  // Context savings highlight
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 2.5, y: 5.3, w: 8.33, h: 0.7,
    rectRadius: 0.1,
    fill: { color: "EBF5FF" },
    line: { width: 0 },
  });
  slide.addText("上下文节省 90%+", {
    x: 2.5, y: 5.3, w: 8.33, h: 0.7,
    fontSize: 22, fontFace: FONT, color: COLORS.blue,
    bold: true, align: "center", valign: "middle",
  });

  addProgressBar(slide, 3);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// 5. Two-stage disclosure
function slideTwoStage() {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText("Two-Stage Disclosure", {
    x: 0.8, y: 0.5, w: 11, h: 0.8,
    fontSize: 36, fontFace: FONT, color: COLORS.black, bold: true,
  });
  slide.addText("两阶段渐进式披露 — 核心创新", {
    x: 0.8, y: 1.15, w: 11, h: 0.5,
    fontSize: 16, fontFace: FONT, color: COLORS.gray,
  });

  // Stage 1 box
  const s1x = 0.8, s1y = 1.9, s1w = 5.5, s1h = 4.0;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: s1x, y: s1y, w: s1w, h: s1h,
    rectRadius: 0.1,
    fill: { color: COLORS.bgGray },
    line: { width: 0 },
  });
  slide.addText("阶段 1 — Agent 看到的工具列表", {
    x: s1x + 0.3, y: s1y + 0.15, w: s1w - 0.6, h: 0.5,
    fontSize: 16, fontFace: FONT, color: COLORS.blue, bold: true,
  });
  // Real app examples as guide entries
  const stage1Entries = [
    { name: "guide:claude", summary: "AI assistant for code editing and development" },
    { name: "guide:brave-search", summary: "Web search, news, images, videos via Brave" },
    { name: "guide:slides", summary: "Create and edit presentation slide decks" },
  ];
  let entryY = s1y + 0.75;
  stage1Entries.forEach((entry) => {
    // Entry row background
    slide.addShape(pptx.ShapeType.roundRect, {
      x: s1x + 0.25, y: entryY, w: s1w - 0.5, h: 0.55,
      rectRadius: 0.06,
      fill: { color: COLORS.white },
      line: { width: 0 },
    });
    slide.addText(entry.name, {
      x: s1x + 0.4, y: entryY + 0.02, w: 2.8, h: 0.5,
      fontSize: 11, fontFace: "Courier New", color: COLORS.blue,
      bold: true, valign: "middle",
    });
    slide.addText(`"${entry.summary}"`, {
      x: s1x + 0.4, y: entryY + 0.28, w: s1w - 0.9, h: 0.25,
      fontSize: 9, fontFace: FONT, color: COLORS.gray,
      valign: "top",
    });
    entryY += 0.65;
  });
  // Note
  slide.addText("每个应用仅一行摘要，无参数 Schema\n~50 字符 / 应用", {
    x: s1x + 0.3, y: entryY + 0.15, w: s1w - 0.6, h: 0.7,
    fontSize: 11, fontFace: FONT, color: COLORS.gray,
    lineSpacingMultiple: 1.4, valign: "top",
  });

  // Arrow
  slide.addText("→", {
    x: 6.3, y: 3.4, w: 0.7, h: 0.8,
    fontSize: 36, fontFace: FONT, color: COLORS.blue,
    align: "center", valign: "middle",
  });

  // Stage 2 box
  const s2x = 7.0, s2y = 1.9, s2w = 5.53, s2h = 4.0;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: s2x, y: s2y, w: s2w, h: s2h,
    rectRadius: 0.1,
    fill: { color: "EBF5FF" },
    line: { width: 0 },
  });
  slide.addText("阶段 2 — 调用 guide:brave-search", {
    x: s2x + 0.3, y: s2y + 0.15, w: s2w - 0.6, h: 0.5,
    fontSize: 16, fontFace: FONT, color: COLORS.blue, bold: true,
  });
  // Show brave-search's real tools
  slide.addText("返回完整工具列表 + 参数 Schema：", {
    x: s2x + 0.3, y: s2y + 0.65, w: s2w - 0.6, h: 0.35,
    fontSize: 12, fontFace: FONT, color: COLORS.black,
  });
  const braveTools = [
    { name: "brave_web_search", desc: "网页搜索（query, country, count...）" },
    { name: "brave_local_search", desc: "本地商户搜索" },
    { name: "brave_video_search", desc: "视频搜索" },
    { name: "brave_image_search", desc: "图片搜索" },
    { name: "brave_news_search", desc: "新闻搜索" },
    { name: "brave_summarizer", desc: "AI 摘要生成" },
  ];
  let toolY = s2y + 1.0;
  braveTools.forEach((tool) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: s2x + 0.25, y: toolY, w: s2w - 0.5, h: 0.38,
      rectRadius: 0.06,
      fill: { color: COLORS.white },
      line: { width: 0 },
    });
    slide.addText(tool.name, {
      x: s2x + 0.4, y: toolY, w: 2.6, h: 0.38,
      fontSize: 10, fontFace: "Courier New", color: COLORS.black,
      bold: true, valign: "middle",
    });
    slide.addText(tool.desc, {
      x: s2x + 3.0, y: toolY, w: 2.2, h: 0.38,
      fontSize: 9, fontFace: FONT, color: COLORS.gray,
      valign: "middle",
    });
    toolY += 0.42;
  });
  // Execution note
  slide.addText("→ 通过 aai:exec { app: \"brave-search\", tool, args } 执行", {
    x: s2x + 0.3, y: toolY + 0.1, w: s2w - 0.6, h: 0.35,
    fontSize: 11, fontFace: FONT, color: COLORS.blue,
    bold: true,
  });

  // Bottom stat
  slide.addText("传统：6 个工具 Schema 每轮全量注入  →  AAI Gateway：仅 1 行摘要，按需展开", {
    x: 1.0, y: 6.15, w: 11.33, h: 0.4,
    fontSize: 14, fontFace: FONT, color: COLORS.blue,
    bold: true, align: "center",
  });

  addProgressBar(slide, 4);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// 6. Architecture
function slideArchitecture() {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText("架构总览", {
    x: 0.8, y: 0.4, w: 11, h: 0.7,
    fontSize: 36, fontFace: FONT, color: COLORS.black, bold: true,
  });

  // ── Top: AI Agents row ──
  const agents = [
    { label: "Claude Code" },
    { label: "Codex" },
    { label: "OpenCode" },
    { label: "..." },
  ];
  const agentW = 2.2, agentGap = 0.25;
  const agentTotalW = agents.length * agentW + (agents.length - 1) * agentGap;
  const agentStartX = (SLIDE_W - agentTotalW) / 2;
  const agentY = 1.15;

  agents.forEach((a, i) => {
    const ax = agentStartX + i * (agentW + agentGap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: ax, y: agentY, w: agentW, h: 0.5,
      rectRadius: 0.08,
      fill: { color: COLORS.bgGray },
      line: { width: 0.5, color: COLORS.lightGray },
    });
    slide.addText(a.label, {
      x: ax, y: agentY, w: agentW, h: 0.5,
      fontSize: 13, fontFace: FONT, color: COLORS.black,
      align: "center", valign: "middle", bold: true,
    });
  });

  // ── Arrow: single MCP connection ──
  slide.addText("▼  Single MCP Connection (stdio)", {
    x: 3.5, y: 1.7, w: 6.33, h: 0.3,
    fontSize: 11, fontFace: FONT, color: COLORS.gray, align: "center",
  });

  // ── AAI Gateway outer box ──
  const gwX = 0.8, gwY = 2.05, gwW = 11.73, gwH = 3.2;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: gwX, y: gwY, w: gwW, h: gwH,
    rectRadius: 0.15,
    fill: { color: COLORS.white },
    line: { width: 2, color: COLORS.blue },
  });
  slide.addText("AAI Gateway", {
    x: gwX, y: gwY + 0.05, w: gwW, h: 0.4,
    fontSize: 16, fontFace: FONT, color: COLORS.blue,
    bold: true, align: "center",
  });

  // ── Row 1: MCP Server (thin protocol) ──
  const r1Y = gwY + 0.42;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: gwX + 0.3, y: r1Y, w: gwW - 0.6, h: 0.38,
    rectRadius: 0.06,
    fill: { color: COLORS.bgGray },
    line: { width: 0 },
  });
  slide.addText("MCP Server — 薄协议层，仅处理 MCP 请求/响应", {
    x: gwX + 0.3, y: r1Y, w: gwW - 0.6, h: 0.38,
    fontSize: 11, fontFace: FONT, color: COLORS.black,
    align: "center", valign: "middle",
  });

  // ── Row 2: Core Gateway (main business logic) — wider with feature badges ──
  const r2Y = r1Y + 0.46;
  const r2H = 1.1;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: gwX + 0.3, y: r2Y, w: gwW - 0.6, h: r2H,
    rectRadius: 0.08,
    fill: { color: "EBF5FF" },
    line: { width: 0.5, color: "B3D4FC" },
  });
  slide.addText("Core Gateway — 核心业务逻辑", {
    x: gwX + 0.3, y: r2Y + 0.02, w: gwW - 0.6, h: 0.35,
    fontSize: 13, fontFace: FONT, color: COLORS.blue,
    bold: true, align: "center", valign: "middle",
  });

  // Feature badges inside Core Gateway
  const badges = [
    { label: "渐进式披露\n省 90%+ 上下文", highlight: true },
    { label: "配置一次\n所有 Agent 共享", highlight: false },
    { label: "热加载\n无需重启", highlight: false },
    { label: "自然语言\n搜索安装", highlight: false },
    { label: "Per-Agent\n可见性控制", highlight: false },
  ];
  const badgeW = 1.95, badgeGap = 0.18;
  const badgeTotalW = badges.length * badgeW + (badges.length - 1) * badgeGap;
  const badgeStartX = gwX + (gwW - badgeTotalW) / 2;
  const badgeY = r2Y + 0.35;
  const badgeH = 0.65;

  badges.forEach((b, i) => {
    const bx = badgeStartX + i * (badgeW + badgeGap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: bx, y: badgeY, w: badgeW, h: badgeH,
      rectRadius: 0.06,
      fill: { color: b.highlight ? COLORS.blue : COLORS.white },
      line: { width: 0.5, color: b.highlight ? COLORS.blue : "B3D4FC" },
    });
    slide.addText(b.label, {
      x: bx, y: badgeY, w: badgeW, h: badgeH,
      fontSize: 10, fontFace: FONT,
      color: b.highlight ? COLORS.white : COLORS.black,
      bold: b.highlight,
      align: "center", valign: "middle",
      lineSpacingMultiple: 1.3,
    });
  });

  // ── Row 3: Execution Coordinator + Storage side by side ──
  const r3Y = r2Y + r2H + 0.1;
  const r3H = 0.38;
  const execW = 7.0;
  const storW = gwW - 0.6 - execW - 0.2;

  // Execution Coordinator
  slide.addShape(pptx.ShapeType.roundRect, {
    x: gwX + 0.3, y: r3Y, w: execW, h: r3H,
    rectRadius: 0.06,
    fill: { color: COLORS.bgGray },
    line: { width: 0 },
  });
  slide.addText("Execution Coordinator — 路由到 MCP / Skill / ACP 执行器", {
    x: gwX + 0.3, y: r3Y, w: execW, h: r3H,
    fontSize: 11, fontFace: FONT, color: COLORS.black,
    align: "center", valign: "middle",
  });

  // Storage + Seed
  slide.addShape(pptx.ShapeType.roundRect, {
    x: gwX + 0.3 + execW + 0.2, y: r3Y, w: storW, h: r3H,
    rectRadius: 0.06,
    fill: { color: COLORS.bgGray },
    line: { width: 0 },
  });
  slide.addText("Storage + Seed", {
    x: gwX + 0.3 + execW + 0.2, y: r3Y, w: storW, h: r3H,
    fontSize: 11, fontFace: FONT, color: COLORS.black,
    align: "center", valign: "middle",
  });

  // ── Row 4: small arrow ──
  slide.addText("▼", {
    x: 5.5, y: gwY + gwH + 0.02, w: 2.33, h: 0.3,
    fontSize: 12, fontFace: FONT, color: COLORS.gray, align: "center",
  });

  // ── Bottom: Three backends ──
  const backends = [
    { label: "MCP Servers", sub: "stdio / HTTP / SSE" },
    { label: "Skills", sub: "SKILL.md 文件" },
    { label: "ACP Agents", sub: "Claude Code / Codex / ..." },
  ];
  const bw = 3.2, bgap = 0.4;
  const bTotalW = backends.length * bw + (backends.length - 1) * bgap;
  const bStartX = (SLIDE_W - bTotalW) / 2;
  const bY = gwY + gwH + 0.32;

  backends.forEach((b, i) => {
    const bx = bStartX + i * (bw + bgap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: bx, y: bY, w: bw, h: 0.7,
      rectRadius: 0.1,
      fill: { color: COLORS.bgGray },
      line: { width: 1, color: COLORS.lightGray },
    });
    slide.addText(b.label, {
      x: bx, y: bY + 0.02, w: bw, h: 0.38,
      fontSize: 13, fontFace: FONT, color: COLORS.black,
      align: "center", valign: "middle", bold: true,
    });
    slide.addText(b.sub, {
      x: bx, y: bY + 0.37, w: bw, h: 0.28,
      fontSize: 9, fontFace: FONT, color: COLORS.gray,
      align: "center", valign: "top",
    });
  });

  addProgressBar(slide, 5);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// 7-10. Demo placeholder slides
function slideDemoPlaceholder(index, title, subtitle) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText(title, {
    x: 1, y: 2.5, w: 11.33, h: 1.0,
    fontSize: 40, fontFace: FONT, color: COLORS.black,
    bold: true, align: "center",
  });
  slide.addText(subtitle, {
    x: 2, y: 3.5, w: 9.33, h: 0.6,
    fontSize: 18, fontFace: FONT, color: COLORS.gray,
    align: "center",
  });

  // Placeholder hint (small, will be covered by video)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 3.5, y: 4.5, w: 6.33, h: 0.5,
    rectRadius: 0.08,
    fill: { color: COLORS.bgGray },
    line: { width: 0 },
  });
  slide.addText("[ 演示视频区域 ]", {
    x: 3.5, y: 4.5, w: 6.33, h: 0.5,
    fontSize: 14, fontFace: FONT, color: COLORS.lightGray,
    align: "center", valign: "middle",
  });

  addProgressBar(slide, index);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// 11. Ending
function slideEnding() {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  slide.addText("Thank You", {
    x: 1, y: 2.0, w: 11.33, h: 1.0,
    fontSize: 48, fontFace: FONT, color: COLORS.black,
    bold: true, align: "center",
  });
  slide.addText("AAI Gateway — One MCP to Rule Them All", {
    x: 2, y: 3.2, w: 9.33, h: 0.6,
    fontSize: 20, fontFace: FONT, color: COLORS.blue,
    align: "center",
  });

  const links = [
    "npm install aai-gateway",
    "github.com/anthropics/aai-gateway",
  ];
  slide.addText(links.map(t => ({ text: t, options: { breakLine: true } })), {
    x: 3, y: 4.2, w: 7.33, h: 1.0,
    fontSize: 16, fontFace: FONT, color: COLORS.gray,
    align: "center", lineSpacingMultiple: 1.8,
  });

  addProgressBar(slide, 10);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// ── Build deck ──
slideCover();
slidePainPoints();
slideTokenWaste();
slideSolution();
slideTwoStage();
slideArchitecture();
slideDemoPlaceholder(6, "安装 AAI Gateway", "一行命令，接入所有 AI Agent");
slideDemoPlaceholder(7, "安装 MCP 工具", "自然语言搜索，秒级导入");
slideDemoPlaceholder(8, "安装技能", "导入本地或远程 Skill 包");
slideDemoPlaceholder(9, "控制其他 Agent", "用一个 Agent 编排另一个 Agent");
slideEnding();

const outPath = `${__dirname}/aai-gateway-intro.pptx`;
pptx.writeFile({ fileName: outPath }).then(() => {
  console.log(`Deck saved to ${outPath}`);
});
