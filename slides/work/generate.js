const pptxgen = require("pptxgenjs");

// ─── Color Palette: Midnight Executive + Teal accent ───────────────────────
const C = {
  darkBg:    "0F172A",
  darkBg2:   "1E293B",
  teal:      "0D9488",
  tealLight: "14B8A6",
  mint:      "02C39A",
  white:     "FFFFFF",
  offWhite:  "F8FAFC",
  slate:     "94A3B8",
  slateDark: "64748B",
  cardBg:    "1E293B",
  cardLight: "F1F5F9",
  border:    "334155",
};

function makeShadow(opacity = 0.12) {
  return { type: "outer", color: "000000", blur: 8, offset: 3, angle: 135, opacity };
}

// ─── Presentation Setup ────────────────────────────────────────────────────────
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";   // 10" x 5.625"
pres.title  = "AAI Gateway — One MCP to Rule Them All";
pres.author  = "AAI Gateway";

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  // Top teal accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.teal }, line: { color: C.teal }
  });

  // Bottom gradient-like bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.545, w: 10, h: 0.08, fill: { color: C.teal }, line: { color: C.teal }
  });

  // Large "AAI" wordmark glow circle (decorative)
  slide.addShape(pres.shapes.OVAL, {
    x: 6.8, y: 0.5, w: 3.5, h: 3.5,
    fill: { color: C.teal, transparency: 88 },
    line: { color: C.teal, width: 1, transparency: 60 }
  });

  // Main title
  slide.addText("AAI Gateway", {
    x: 0.6, y: 1.4, w: 9, h: 1.2,
    fontSize: 56, bold: true, color: C.white,
    fontFace: "Trebuchet MS", margin: 0
  });

  // Tagline
  slide.addText("One MCP to Rule Them All", {
    x: 0.6, y: 2.6, w: 7, h: 0.6,
    fontSize: 28, color: C.teal, fontFace: "Trebuchet MS", margin: 0
  });

  // Subtitle / description
  slide.addText(
    "Install MCP servers and skills once, share across all your AI agents.\n" +
    "No restart. No context explosion. Just ask.",
    {
      x: 0.6, y: 3.5, w: 7, h: 1.0,
      fontSize: 15, color: C.slate, fontFace: "Calibri",
      lineSpacing: 22, margin: 0
    }
  );

  // npm badge
  slide.addText("npm: aai-gateway", {
    x: 0.6, y: 4.8, w: 3, h: 0.4,
    fontSize: 12, color: C.slateDark, fontFace: "Consolas", margin: 0
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — The Problem
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  // Header
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.teal }
  });
  slide.addText("The Problem", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 36, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("What happens without AAI Gateway", {
    x: 0.5, y: 0.95, w: 9, h: 0.4,
    fontSize: 14, color: C.slate, fontFace: "Calibri", margin: 0
  });

  // Pain point cards
  const problems = [
    {
      title: "Context Explosion",
      desc: "10 MCP servers × 5 tools each = 50 full tool schemas injected into every prompt, burning thousands of tokens before the model even starts thinking."
    },
    {
      title: "Duplicate Config",
      desc: "Claude Code, Codex, OpenCode — configure the same MCP server three times, keep them in sync manually."
    },
    {
      title: "Restart Required",
      desc: "Add a new MCP? Restart your agent. Every. Single. Time."
    },
    {
      title: "Finding Tools is Hard",
      desc: "Search GitHub, read READMEs, copy JSON configs, debug connection errors — all before you can even try a tool."
    }
  ];

  const cardW = 4.3, cardH = 1.7, startX = 0.5, startY = 1.55, gapX = 0.4, gapY = 0.3;
  problems.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    // Card bg
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.cardBg }, line: { color: C.border, width: 0.5 },
      shadow: makeShadow(0.08)
    });
    // Left accent
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.08, h: cardH,
      fill: { color: "EF4444" }, line: { color: "EF4444" }
    });
    // Title
    slide.addText(p.title, {
      x: x + 0.25, y: y + 0.15, w: cardW - 0.4, h: 0.4,
      fontSize: 16, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
    });
    // Desc
    slide.addText(p.desc, {
      x: x + 0.25, y: y + 0.55, w: cardW - 0.4, h: cardH - 0.7,
      fontSize: 11, color: C.slate, fontFace: "Calibri",
      lineSpacing: 15, valign: "top", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 3 — The Solution
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.offWhite };

  // Top accent
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.teal }
  });

  slide.addText("The Solution", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 36, bold: true, color: C.darkBg, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("AAI Gateway sits between your AI agents and all your tools", {
    x: 0.5, y: 0.95, w: 9, h: 0.4,
    fontSize: 14, color: C.slateDark, fontFace: "Calibri", margin: 0
  });

  // Central statement
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.55, w: 9, h: 1.3,
    fill: { color: C.darkBg }, shadow: makeShadow(0.1)
  });
  slide.addText("One MCP connection replaces dozens.", {
    x: 0.7, y: 1.7, w: 8.6, h: 0.5,
    fontSize: 24, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("Summaries first, details on demand — context savings of 90%+", {
    x: 0.7, y: 2.25, w: 8.6, h: 0.4,
    fontSize: 14, color: C.mint, fontFace: "Calibri", margin: 0
  });

  // Feature icons row
  const features = [
    { title: "Progressive Disclosure", desc: "Short summaries in prompt\nFull schemas on demand" },
    { title: "Hot-Reload", desc: "New tools available\nwithout restart" },
    { title: "Universal Import", desc: "MCP servers, skills,\nACP agents" },
    { title: "One Config", desc: "All agents share\nthe same tools" },
  ];

  const featW = 2.1, featH = 2.1, featY = 3.1;
  features.forEach((f, i) => {
    const x = 0.5 + i * (featW + 0.27);

    // Circle icon placeholder
    slide.addShape(pres.shapes.OVAL, {
      x: x + featW/2 - 0.3, y: featY, w: 0.6, h: 0.6,
      fill: { color: C.teal }, line: { color: C.teal }
    });
    // Icon number
    slide.addText(String(i + 1), {
      x: x + featW/2 - 0.3, y: featY + 0.08, w: 0.6, h: 0.5,
      fontSize: 20, bold: true, color: C.white, align: "center", fontFace: "Trebuchet MS", margin: 0
    });
    // Title
    slide.addText(f.title, {
      x, y: featY + 0.75, w: featW, h: 0.5,
      fontSize: 13, bold: true, color: C.darkBg, align: "center", fontFace: "Trebuchet MS", margin: 0
    });
    // Desc
    slide.addText(f.desc, {
      x, y: featY + 1.2, w: featW, h: 0.8,
      fontSize: 11, color: C.slateDark, align: "center", fontFace: "Calibri",
      lineSpacing: 15, margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Before vs After Comparison
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.teal }
  });
  slide.addText("Without vs With AAI Gateway", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 36, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });

  // Table header
  const colX = [0.5, 3.8, 7.1];
  const headers = ["", "Without AAI Gateway", "With AAI Gateway"];
  const headerW = [2.8, 3.0, 2.8];

  headers.forEach((h, i) => {
    const isHeader = i > 0;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: colX[i], y: 1.15, w: headerW[i], h: 0.55,
      fill: { color: isHeader ? (i === 1 ? "7F1D1D" : C.teal) : C.darkBg2 },
      line: { color: C.border, width: 0.5 }
    });
    slide.addText(h, {
      x: colX[i], y: 1.2, w: headerW[i], h: 0.45,
      fontSize: 14, bold: true, color: C.white, align: "center", fontFace: "Trebuchet MS", margin: 0
    });
  });

  const rows = [
    ["Context Cost", "50 tool schemas in every prompt", "~10 short summaries (~200 chars)"],
    ["Config", "Configure each MCP per agent", "Import once, all agents share"],
    ["New Tools", "Restart agent after install", "Hot-reload, available immediately"],
    ["Finding Tools", "Manual search + copy config", `Natural language search → installed in seconds`],
  ];

  rows.forEach((row, ri) => {
    const rowY = 1.75 + ri * 0.88;
    const rowH = 0.8;
    row.forEach((cell, ci) => {
      const isLeft = ci === 0;
      slide.addShape(pres.shapes.RECTANGLE, {
        x: colX[ci], y: rowY, w: headerW[ci], h: rowH,
        fill: { color: isLeft ? C.darkBg2 : (ri % 2 === 0 ? "1E293B" : "263548") },
        line: { color: C.border, width: 0.5 }
      });
      slide.addText(cell, {
        x: colX[ci] + 0.12, y: rowY + 0.08, w: headerW[ci] - 0.24, h: rowH - 0.16,
        fontSize: ci === 0 ? 12 : 11,
        bold: ci === 0,
        color: ci === 1 ? "FCA5A5" : ci === 2 ? C.mint : C.slate,
        fontFace: "Calibri", valign: "middle", margin: 0,
        lineSpacing: 14
      });
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Two-Stage Disclosure (Core Innovation)
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.offWhite };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.teal }
  });
  slide.addText("Core Innovation: Two-Stage Disclosure", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 32, bold: true, color: C.darkBg, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("Instead of dumping all tool schemas, AAI Gateway uses progressive disclosure", {
    x: 0.5, y: 0.95, w: 9, h: 0.4,
    fontSize: 13, color: C.slateDark, fontFace: "Calibri", margin: 0
  });

  // Stage 1 box
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.5, w: 4.3, h: 2.4,
    fill: { color: C.darkBg }, shadow: makeShadow(0.1)
  });
  slide.addText("STAGE 1", {
    x: 0.5, y: 1.58, w: 4.3, h: 0.35,
    fontSize: 11, bold: true, color: C.mint, align: "center", fontFace: "Consolas", margin: 0
  });
  slide.addText("What the agent sees", {
    x: 0.5, y: 1.88, w: 4.3, h: 0.3,
    fontSize: 12, color: C.slate, align: "center", fontFace: "Calibri", margin: 0
  });
  const stage1Items = [
    'guide:filesystem   "Read/write local files"',
    'guide:github       "Manage GitHub repos"',
    'guide:slack        "Send Slack messages"',
    '... (one line per app, no schemas)',
  ];
  slide.addText(stage1Items.map((t, i) => ({
    text: t,
    options: { breakLine: i < stage1Items.length - 1, fontFace: "Consolas", fontSize: 10, color: C.slate, paraSpaceAfter: 6 }
  })), {
    x: 0.7, y: 2.25, w: 3.9, h: 1.5, margin: 0
  });

  // Arrow
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 4.85, y: 2.6, w: 0.3, h: 0.08, fill: { color: C.teal }
  });
  slide.addText("→", {
    x: 4.7, y: 2.35, w: 0.6, h: 0.5,
    fontSize: 24, bold: true, color: C.teal, align: "center", margin: 0
  });

  // Stage 2 box
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 5.2, y: 1.5, w: 4.3, h: 2.4,
    fill: { color: C.darkBg }, shadow: makeShadow(0.1)
  });
  slide.addText("STAGE 2", {
    x: 5.2, y: 1.58, w: 4.3, h: 0.35,
    fontSize: 11, bold: true, color: C.mint, align: "center", fontFace: "Consolas", margin: 0
  });
  slide.addText("Agent decides to use a tool", {
    x: 5.2, y: 1.88, w: 4.3, h: 0.3,
    fontSize: 12, color: C.slate, align: "center", fontFace: "Calibri", margin: 0
  });
  const stage2Items = [
    "→ Calls guide:filesystem",
    "← Gets full tool list + schemas",
    "→ Executes via aai:exec",
  ];
  slide.addText(stage2Items.map((t, i) => ({
    text: t,
    options: { breakLine: i < stage2Items.length - 1, fontFace: "Consolas", fontSize: 10, color: C.slate, paraSpaceAfter: 6 }
  })), {
    x: 5.4, y: 2.25, w: 3.9, h: 1.5, margin: 0
  });

  // Math callout
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.1, w: 9, h: 1.1,
    fill: { color: C.teal, transparency: 10 },
    line: { color: C.teal, width: 1 }
  });
  slide.addText("The Math:", {
    x: 0.7, y: 4.2, w: 2, h: 0.4,
    fontSize: 13, bold: true, color: C.teal, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText(
    "10 MCP servers × 5 tools = 50 full schemas traditionally. With AAI Gateway = 10 short summaries + details only when needed.",
    {
      x: 0.7, y: 4.6, w: 8.6, h: 0.5,
      fontSize: 12, color: C.darkBg, fontFace: "Calibri", margin: 0
    }
  );
  slide.addText("Context savings: 90%+", {
    x: 7.5, y: 4.2, w: 1.8, h: 0.4,
    fontSize: 13, bold: true, color: C.teal, align: "right", fontFace: "Trebuchet MS", margin: 0
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 6 — Key Features
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.teal }
  });
  slide.addText("Key Features", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 36, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });

  const features = [
    {
      title: "Natural Language Search",
      desc: 'Describe what you need: "Find me an MCP for database queries" → search → select → imported → ready in seconds.',
      accent: C.teal
    },
    {
      title: "Import Any MCP Server",
      desc: 'stdio, Streamable HTTP, or SSE. Paste any standard MCP config and ask your agent to import it through AAI Gateway.',
      accent: C.tealLight
    },
    {
      title: "Skills Support",
      desc: "Import local or remote skill packages. Future: automatic skill updates from remote sources — no more outdated skills.",
      accent: C.mint
    },
    {
      title: "Agent Interoperability (ACP)",
      desc: "Built-in support for Claude Code, Codex, OpenCode. Use one agent to orchestrate another — even from your phone.",
      accent: "A78BFA"
    },
  ];

  const cardW = 4.3, cardH = 1.75, startX = 0.5, startY = 1.15, gapX = 0.4, gapY = 0.25;
  features.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.cardBg }, line: { color: C.border, width: 0.5 },
      shadow: makeShadow(0.08)
    });
    // Top accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: 0.07,
      fill: { color: f.accent }, line: { color: f.accent }
    });
    // Number badge
    slide.addShape(pres.shapes.OVAL, {
      x: x + 0.2, y: y + 0.22, w: 0.4, h: 0.4,
      fill: { color: f.accent }, line: { color: f.accent }
    });
    slide.addText(String(i + 1), {
      x: x + 0.2, y: y + 0.28, w: 0.4, h: 0.3,
      fontSize: 14, bold: true, color: C.white, align: "center", fontFace: "Trebuchet MS", margin: 0
    });
    // Title
    slide.addText(f.title, {
      x: x + 0.72, y: y + 0.22, w: cardW - 0.9, h: 0.4,
      fontSize: 15, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
    });
    // Desc
    slide.addText(f.desc, {
      x: x + 0.2, y: y + 0.72, w: cardW - 0.4, h: cardH - 0.9,
      fontSize: 11, color: C.slate, fontFace: "Calibri",
      lineSpacing: 15, valign: "top", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 7 — Built-in Tools
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.offWhite };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.teal }
  });
  slide.addText("Built-in Tools", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 36, bold: true, color: C.darkBg, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("Everything AAI Gateway provides out of the box", {
    x: 0.5, y: 0.95, w: 9, h: 0.4,
    fontSize: 13, color: C.slateDark, fontFace: "Calibri", margin: 0
  });

  const tools = [
    { name: "listAllAaiApps", desc: "List all apps managed by AAI Gateway" },
    { name: "enableApp",      desc: "Enable an app for the current agent" },
    { name: "disableApp",     desc: "Disable an app for the current agent" },
    { name: "removeApp",     desc: "Remove an app from the system" },
    { name: "aai:exec",      desc: "Execute a tool from a managed app" },
    { name: "mcp:import",    desc: "Import an MCP server" },
    { name: "skill:import",  desc: "Import a skill package" },
    { name: "skill:create",  desc: "Create a new skill" },
    { name: "search:discover", desc: "Search for new tools with natural language" },
  ];

  const toolW = 2.9, toolH = 0.95, startX = 0.5, startY = 1.45, gapX = 0.25, gapY = 0.2;
  tools.forEach((t, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = startX + col * (toolW + gapX);
    const y = startY + row * (toolH + gapY);

    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: toolW, h: toolH,
      fill: { color: C.white }, line: { color: "CBD5E1", width: 0.5 },
      shadow: makeShadow(0.06)
    });
    // Left teal bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.07, h: toolH,
      fill: { color: C.teal }, line: { color: C.teal }
    });
    // Tool name (code font)
    slide.addText(t.name, {
      x: x + 0.2, y: y + 0.1, w: toolW - 0.3, h: 0.38,
      fontSize: 12, bold: true, color: C.darkBg, fontFace: "Consolas", margin: 0
    });
    // Description
    slide.addText(t.desc, {
      x: x + 0.2, y: y + 0.48, w: toolW - 0.3, h: 0.4,
      fontSize: 10, color: C.slateDark, fontFace: "Calibri", margin: 0
    });
  });

  // Plus guide:<app-id> note
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.0, w: 9, h: 0.4,
    fill: { color: C.teal, transparency: 90 },
    line: { color: C.teal, width: 0.5 }
  });
  slide.addText("Plus a  guide:<app-id>  tool for each imported app — returns full operation guide when called", {
    x: 0.7, y: 5.05, w: 8.6, h: 0.3,
    fontSize: 11, color: C.darkBg, fontFace: "Calibri", margin: 0
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 8 — Architecture
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.teal }
  });
  slide.addText("Architecture", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 36, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("How AAI Gateway connects agents to tools", {
    x: 0.5, y: 0.88, w: 9, h: 0.35,
    fontSize: 13, color: C.slate, fontFace: "Calibri", margin: 0
  });

  // Layer boxes
  const layers = [
    {
      label: "AI Agents",
      items: ["Claude Code", "Codex", "OpenCode", "..."],
      color: C.teal, y: 1.35, h: 1.1
    },
    {
      label: "MCP Server",
      items: ["Protocol layer — MCP requests/responses"],
      color: C.slateDark, y: 2.55, h: 0.7
    },
    {
      label: "Core Gateway",
      items: ["Progressive Disclosure", "Per-Agent Visibility", "Import — MCP, Skills, Search"],
      color: "1E3A5F", y: 3.35, h: 0.9
    },
    {
      label: "Executors",
      items: ["MCP Servers", "Skills", "ACP Agents"],
      color: "0F2D40", y: 4.35, h: 0.7
    },
    {
      label: "Storage",
      items: ["~/.local/share/aai-gateway/apps/<appId>/"],
      color: "0A1628", y: 5.15, h: 0.4
    },
  ];

  const layerW = 6.5, layerX = 0.5;

  layers.forEach((layer, i) => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: layerX, y: layer.y, w: layerW, h: layer.h,
      fill: { color: layer.color }, line: { color: C.border, width: 0.5 }
    });
    slide.addText(layer.label, {
      x: layerX + 0.15, y: layer.y + 0.05, w: layerW - 0.3, h: 0.3,
      fontSize: 12, bold: true, color: i === 0 ? C.darkBg : C.white, fontFace: "Trebuchet MS", margin: 0
    });
    slide.addText(layer.items.join("  ·  "), {
      x: layerX + 0.15, y: layer.y + 0.32, w: layerW - 0.3, h: layer.h - 0.4,
      fontSize: 10, color: C.slate, fontFace: "Calibri", margin: 0, valign: "top"
    });
  });

  // Right side: arrow connectors
  const rightX = 7.2;
  const arrowItems = [
    { label: "Single MCP\nConnection", sub: "(stdio)" },
    { label: "Progressive\nDisclosure", sub: "Summaries → on-demand" },
    { label: "Route to\nExecutor", sub: "" },
    { label: "Storage &\nSeed", sub: "Pre-built ACP descriptors" },
  ];
  const rightLabels = ["AI Agents", "MCP Server", "Core Gateway", "Executors"];
  rightLabels.forEach((rl, i) => {
    const ay = layers[i].y + layers[i].h / 2 - 0.25;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX, y: ay, w: 2.3, h: 0.5,
      fill: { color: C.cardBg }, line: { color: C.teal, width: 0.5 }
    });
    slide.addText(rightX < 7.5 ? "" : "", {
      x: rightX, y: ay, w: 2.3, h: 0.25,
      fontSize: 9, bold: true, color: C.teal, align: "center", fontFace: "Trebuchet MS", margin: 0
    });
    slide.addText(arrowItems[i].label, {
      x: rightX, y: ay + 0.05, w: 2.3, h: 0.35,
      fontSize: 10, bold: false, color: C.white, align: "center", fontFace: "Calibri", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 9 — Quick Start
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.offWhite };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.teal }
  });
  slide.addText("Quick Start — 30 Seconds", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 36, bold: true, color: C.darkBg, fontFace: "Trebuchet MS", margin: 0
  });

  // Step 1: Add to agent
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.1, w: 4.3, h: 2.6,
    fill: { color: C.white }, line: { color: "CBD5E1", width: 0.5 },
    shadow: makeShadow(0.08)
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 0.7, y: 1.25, w: 0.45, h: 0.45,
    fill: { color: C.teal }, line: { color: C.teal }
  });
  slide.addText("1", {
    x: 0.7, y: 1.32, w: 0.45, h: 0.35,
    fontSize: 18, bold: true, color: C.white, align: "center", fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("Add AAI Gateway to your agent", {
    x: 1.25, y: 1.28, w: 3.4, h: 0.4,
    fontSize: 15, bold: true, color: C.darkBg, fontFace: "Trebuchet MS", margin: 0
  });

  const step1Code = [
    { text: "# Claude Code", options: { bold: true, color: C.teal, fontFace: "Consolas", fontSize: 10, breakLine: true } },
    { text: 'claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway', options: { color: "374151", fontFace: "Consolas", fontSize: 9, breakLine: true } },
    { text: "\n# Codex", options: { bold: true, color: C.teal, fontFace: "Consolas", fontSize: 10, breakLine: true } },
    { text: 'codex mcp add aai-gateway -- npx -y aai-gateway', options: { color: "374151", fontFace: "Consolas", fontSize: 9, breakLine: true } },
    { text: "\n# OpenCode", options: { bold: true, color: C.teal, fontFace: "Consolas", fontSize: 10, breakLine: true } },
    { text: '# Add to ~/.config/opencode/opencode.json', options: { color: "374151", fontFace: "Consolas", fontSize: 9 } },
  ];
  slide.addText(step1Code, {
    x: 0.7, y: 1.8, w: 3.9, h: 1.8, margin: 0
  });

  // Step 2: Start using
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 5.2, y: 1.1, w: 4.3, h: 2.6,
    fill: { color: C.white }, line: { color: "CBD5E1", width: 0.5 },
    shadow: makeShadow(0.08)
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 5.4, y: 1.25, w: 0.45, h: 0.45,
    fill: { color: C.teal }, line: { color: C.teal }
  });
  slide.addText("2", {
    x: 5.4, y: 1.32, w: 0.45, h: 0.35,
    fontSize: 18, bold: true, color: C.white, align: "center", fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("Start using it — just ask!", {
    x: 5.95, y: 1.28, w: 3.4, h: 0.4,
    fontSize: 15, bold: true, color: C.darkBg, fontFace: "Trebuchet MS", margin: 0
  });
  const step2Items = [
    { text: '"Help me search for a filesystem MCP and install it"', options: { italic: true, color: C.slateDark, fontFace: "Calibri", fontSize: 10, breakLine: true } },
    { text: "\n", options: { fontSize: 6, breakLine: true } },
    { text: '"Import this MCP: npx -y @anthropic-ai/mcp-server-fetch"', options: { italic: true, color: C.slateDark, fontFace: "Calibri", fontSize: 10, breakLine: true } },
    { text: "\n", options: { fontSize: 6, breakLine: true } },
    { text: '"What tools do I have installed?"', options: { italic: true, color: C.slateDark, fontFace: "Calibri", fontSize: 10, breakLine: true } },
  ];
  slide.addText(step2Items, {
    x: 5.4, y: 1.8, w: 3.9, h: 1.8, margin: 0
  });

  // Bottom callout
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 3.9, w: 9, h: 1.3,
    fill: { color: C.darkBg }, shadow: makeShadow(0.1)
  });
  slide.addText("That's it. No config files to edit, no agent restarts needed.", {
    x: 0.7, y: 4.1, w: 8.6, h: 0.45,
    fontSize: 18, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("AAI Gateway handles discovery, import, and execution — your agents just ask.", {
    x: 0.7, y: 4.6, w: 8.6, h: 0.4,
    fontSize: 13, color: C.slate, fontFace: "Calibri", margin: 0
  });
  slide.addText("npm: aai-gateway", {
    x: 0.7, y: 5.0, w: 3, h: 0.3,
    fontSize: 11, color: C.teal, fontFace: "Consolas", margin: 0
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 10 — Use Cases
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.teal }
  });
  slide.addText("Use Cases", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 36, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });

  const useCases = [
    {
      quote: '"I have 15 MCPs and my context is exploding"',
      solution: "AAI Gateway's two-stage disclosure cuts context by 90%+. Your agent sees short summaries, not 15 full tool schemas."
    },
    {
      quote: '"I use Claude Code AND OpenCode"',
      solution: "Import once through AAI Gateway. Both agents see the same tools immediately. Add Codex tomorrow — zero extra config."
    },
    {
      quote: '"I want to write code while drinking tea"',
      solution: "Set up ACP agents. Use any agent (even on your phone) to instruct Claude Code or Codex to write, test, and commit code."
    },
    {
      quote: '"I don\'t know which MCP to use"',
      solution: 'Just describe what you need: "I need something to query PostgreSQL" — AAI Gateway searches and handles the install.'
    },
  ];

  const ucW = 4.3, ucH = 1.65, startX = 0.5, startY = 1.1, gapX = 0.4, gapY = 0.25;
  useCases.forEach((uc, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = startX + col * (ucW + gapX);
    const y = startY + row * (ucH + gapY);

    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: ucW, h: ucH,
      fill: { color: C.cardBg }, line: { color: C.border, width: 0.5 },
      shadow: makeShadow(0.08)
    });
    // Quote
    slide.addText(uc.quote, {
      x: x + 0.2, y: y + 0.15, w: ucW - 0.4, h: 0.55,
      fontSize: 12, italic: true, color: C.mint, fontFace: "Calibri", margin: 0
    });
    // Solution
    slide.addText(uc.solution, {
      x: x + 0.2, y: y + 0.7, w: ucW - 0.4, h: ucH - 0.85,
      fontSize: 11, color: C.slate, fontFace: "Calibri",
      lineSpacing: 15, valign: "top", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// SLIDE 11 — Closing / Call to Action
// ════════════════════════════════════════════════════════════════════════════════
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  // Large teal accent circle
  slide.addShape(pres.shapes.OVAL, {
    x: 6.5, y: -0.5, w: 5, h: 5,
    fill: { color: C.teal, transparency: 90 },
    line: { color: C.teal, width: 1, transparency: 50 }
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 7.5, y: 3.5, w: 3, h: 3,
    fill: { color: C.mint, transparency: 92 },
    line: { color: C.mint, width: 0.5, transparency: 60 }
  });

  // Top accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.teal }
  });

  slide.addText("Start using AAI Gateway today.", {
    x: 0.6, y: 1.5, w: 8, h: 0.9,
    fontSize: 38, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
  });
  slide.addText("One install. Every agent. All your tools.", {
    x: 0.6, y: 2.45, w: 7, h: 0.5,
    fontSize: 18, color: C.teal, fontFace: "Trebuchet MS", margin: 0
  });

  // Three action items
  const actions = [
    { label: "npm install", code: "npm install -g aai-gateway" },
    { label: "GitHub", code: "github.com/gybob/aai-gateway" },
    { label: "Docs", code: "AAI Gateway README" },
  ];
  actions.forEach((a, i) => {
    const ax = 0.6 + i * 3.1;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: ax, y: 3.3, w: 2.8, h: 1.0,
      fill: { color: C.cardBg }, line: { color: C.border, width: 0.5 }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: ax, y: 3.3, w: 2.8, h: 0.07,
      fill: { color: C.teal }, line: { color: C.teal }
    });
    slide.addText(a.label, {
      x: ax + 0.15, y: 3.42, w: 2.5, h: 0.35,
      fontSize: 12, bold: true, color: C.white, fontFace: "Trebuchet MS", margin: 0
    });
    slide.addText(a.code, {
      x: ax + 0.15, y: 3.78, w: 2.5, h: 0.4,
      fontSize: 10, color: C.slate, fontFace: "Consolas", margin: 0
    });
  });

  slide.addText("AAI Gateway v1.1.6  ·  Apache-2.0 License", {
    x: 0.6, y: 4.9, w: 6, h: 0.3,
    fontSize: 11, color: C.slateDark, fontFace: "Calibri", margin: 0
  });
}

// ─── Write file ───────────────────────────────────────────────────────────────
pres.writeFile({ fileName: "/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/slides/aai-gateway-intro.pptx" })
  .then(() => console.log("✅  aai-gateway-intro.pptx written successfully"))
  .catch(err => { console.error("❌  Error:", err); process.exit(1); });
