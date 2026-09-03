(() => {
  if (globalThis.__uideltaCompareEngine) return;

  const MAX_NODES = 5000;

  function finite(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeText(value) {
    return text(value).toLowerCase().replace(/\s+/g, " ").slice(0, 240);
  }

  function numberText(value, fallback = "") {
    const number = finite(value);
    return number === null ? text(value) || fallback : `${Math.round(number * 100) / 100}px`;
  }

  function colorFrom(input, opacity = 1) {
    if (!input) return "";
    if (typeof input === "string") return input;
    const red = finite(input.r);
    const green = finite(input.g);
    const blue = finite(input.b);
    if ([red, green, blue].some((value) => value === null)) return "";
    const alpha = finite(input.a, finite(opacity, 1));
    return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${Math.round(alpha * 100) / 100})`;
  }

  function firstPaint(paints) {
    if (!Array.isArray(paints)) return null;
    return paints.find((paint) => paint && paint.visible !== false && paint.type === "SOLID") || paints.find((paint) => paint && paint.visible !== false) || null;
  }

  function boxValues(node) {
    const top = finite(node?.paddingTop, finite(node?.padding?.top, 0));
    const right = finite(node?.paddingRight, finite(node?.padding?.right, top));
    const bottom = finite(node?.paddingBottom, finite(node?.padding?.bottom, top));
    const left = finite(node?.paddingLeft, finite(node?.padding?.left, right));
    return { top, right, bottom, left, css: `${numberText(top, "0px")} ${numberText(right, "0px")} ${numberText(bottom, "0px")} ${numberText(left, "0px")}` };
  }

  function normalizeNode(raw, parentId = "", parentPath = []) {
    if (!raw || typeof raw !== "object") return null;
    const bounds = raw.absoluteBoundingBox || raw.boundingBox || {};
    const size = raw.size || {};
    const width = finite(bounds.width, finite(size.x, finite(raw.width, null)));
    const height = finite(bounds.height, finite(size.y, finite(raw.height, null)));
    const paint = firstPaint(raw.fills);
    const style = raw.style || {};
    const backgroundColor = colorFrom(paint?.color, paint?.opacity);
    const nodeId = text(raw.id) || `node-${parentPath.length}-${text(raw.name) || "unnamed"}`;
    const name = text(raw.name) || text(raw.characters) || nodeId;
    const type = text(raw.type).toUpperCase() || "FRAME";
    const childrenPath = [...parentPath, name].slice(-8);
    const normalized = {
      id: nodeId,
      name,
      type,
      tag: type === "TEXT" ? "span" : ["COMPONENT", "INSTANCE", "FRAME", "GROUP", "SECTION", "RECTANGLE"].includes(type) ? "div" : "div",
      role: type === "TEXT" ? "text" : "",
      text: text(raw.characters) || (type === "TEXT" ? name : ""),
      path: childrenPath,
      parentId,
      bounds: { x: finite(bounds.x, finite(raw.x, 0)), y: finite(bounds.y, finite(raw.y, 0)), width, height },
      layout: {
        mode: text(raw.layoutMode).toLowerCase(),
        padding: boxValues(raw),
        itemSpacing: finite(raw.itemSpacing),
        justifyContent: text(raw.primaryAxisAlignItems).toLowerCase(),
        alignItems: text(raw.counterAxisAlignItems).toLowerCase()
      },
      typography: type === "TEXT" || style.fontSize || style.fontFamily ? {
        fontFamily: text(style.fontFamily) || text(style.fontPostScriptName),
        fontSize: numberText(style.fontSize),
        fontWeight: finite(style.fontWeight, text(style.fontWeight) || ""),
        lineHeight: style.lineHeightPx === "AUTO" ? "normal" : numberText(style.lineHeightPx, text(style.lineHeightUnit) === "INTRINSIC_%" ? numberText(style.lineHeightPercent) : ""),
        letterSpacing: numberText(style.letterSpacing),
        textAlign: text(style.textAlignHorizontal).toLowerCase(),
        color: colorFrom(firstPaint(style.fills)?.color, firstPaint(style.fills)?.opacity) || backgroundColor
      } : null,
      appearance: {
        backgroundColor,
        borderColor: colorFrom(firstPaint(raw.strokes)?.color, firstPaint(raw.strokes)?.opacity),
        borderRadius: numberText(raw.cornerRadius, "0px"),
        boxShadow: Array.isArray(raw.effects) ? raw.effects.filter((effect) => effect?.visible !== false && effect?.type === "DROP_SHADOW").map((effect) => {
          const offsetX = finite(effect.offset?.x, 0);
          const offsetY = finite(effect.offset?.y, 0);
          const blur = finite(effect.radius, 0);
          return `${numberText(offsetX, "0px")} ${numberText(offsetY, "0px")} ${numberText(blur, "0px")} ${colorFrom(effect.color) || "rgba(0,0,0,.18)"}`;
        }).join(", ") || "none" : "none",
        opacity: finite(raw.opacity, 1)
      }
    };
    return { normalized, childrenPath };
  }

  function normalizeDesignSnapshot(input, binding = {}) {
    const source = input?.document && typeof input.document === "object" ? input.document : input;
    if (source?.schemaVersion === 2 && Array.isArray(source.nodes) && source.nodes.every((node) => node && node.bounds && node.layout)) {
      return {
        ...structuredClone(source),
        schemaVersion: 2,
        source: text(input?.source) || source.source || "figma-json",
        fileKey: text(binding.fileKey) || text(source.fileKey),
        frameId: text(binding.nodeId) || text(source.frameId),
        frameName: text(binding.frameName) || text(source.frameName),
        importedAt: new Date().toISOString(),
        nodes: source.nodes.slice(0, MAX_NODES)
      };
    }
    const nodes = [];
    const visit = (raw, parentId = "", parentPath = []) => {
      if (!raw || typeof raw !== "object" || nodes.length >= MAX_NODES) return;
      const result = normalizeNode(raw, parentId, parentPath);
      if (!result) return;
      nodes.push(result.normalized);
      if (Array.isArray(raw.children)) {
        for (const child of raw.children) visit(child, result.normalized.id, result.childrenPath);
      }
    };
    if (Array.isArray(source?.nodes)) {
      for (const node of source.nodes) visit(node, "", []);
    } else {
      visit(source, "", []);
    }
    return {
      schemaVersion: 2,
      source: text(input?.source) || "figma-json",
      fileKey: text(binding.fileKey) || text(input?.fileKey),
      frameId: text(binding.nodeId) || text(input?.frameId),
      frameName: text(binding.frameName) || text(input?.frameName) || text(source?.name),
      importedAt: new Date().toISOString(),
      nodes
    };
  }

  function parsePx(value) {
    const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function parseBox(value) {
    const numbers = String(value ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (!numbers.length) return null;
    if (numbers.length === 1) return { top: numbers[0], right: numbers[0], bottom: numbers[0], left: numbers[0] };
    if (numbers.length === 2) return { top: numbers[0], right: numbers[1], bottom: numbers[0], left: numbers[1] };
    if (numbers.length === 3) return { top: numbers[0], right: numbers[1], bottom: numbers[2], left: numbers[1] };
    return { top: numbers[0], right: numbers[1], bottom: numbers[2], left: numbers[3] };
  }

  function parseColor(value) {
    const input = String(value || "").trim().toLowerCase();
    const hex = input.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      const raw = hex[1].length <= 4 ? hex[1].split("").map((part) => part + part).join("") : hex[1];
      return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16), a: raw.length >= 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1 };
    }
    const rgb = input.match(/rgba?\(([^)]+)\)/);
    if (!rgb) return null;
    const values = rgb[1].split(/[ ,/]+/).filter(Boolean).map((part) => part.endsWith("%") ? Number(part.slice(0, -1)) * 2.55 : Number(part));
    return { r: values[0], g: values[1], b: values[2], a: Number.isFinite(values[3]) ? values[3] : 1 };
  }

  function colorDistance(first, second) {
    const a = parseColor(first);
    const b = parseColor(second);
    if (!a || !b) return null;
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2) / 441.67;
  }

  function similarity(first, second) {
    const a = normalizeText(first);
    const b = normalizeText(second);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.78;
    const aTokens = new Set(a.split(/\s+/));
    const bTokens = new Set(b.split(/\s+/));
    const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
    return overlap / Math.max(aTokens.size, bTokens.size, 1);
  }

  function numericSimilarity(actual, expected, tolerance = 8) {
    const a = parsePx(actual);
    const b = parsePx(expected);
    if (a === null || b === null) return 0;
    return Math.max(0, 1 - Math.abs(a - b) / Math.max(Math.abs(b), tolerance));
  }

  function webValues(webSnapshot) {
    return {
      width: numberText(webSnapshot?.dimensions?.width),
      height: numberText(webSnapshot?.dimensions?.height),
      padding: webSnapshot?.spacing?.padding || "",
      gap: webSnapshot?.spacing?.gap || "",
      fontFamily: webSnapshot?.typography?.fontFamily || "",
      fontSize: webSnapshot?.typography?.fontSize || "",
      fontWeight: webSnapshot?.typography?.fontWeight || "",
      lineHeight: webSnapshot?.typography?.lineHeight || "",
      letterSpacing: webSnapshot?.typography?.letterSpacing || "",
      textAlign: webSnapshot?.typography?.textAlign || "",
      color: webSnapshot?.typography?.color || "",
      backgroundColor: webSnapshot?.appearance?.backgroundColor || "",
      borderRadius: webSnapshot?.appearance?.borderRadius || "",
      boxShadow: webSnapshot?.appearance?.boxShadow || "",
      justifyContent: webSnapshot?.layout?.justifyContent || "",
      alignItems: webSnapshot?.layout?.alignItems || ""
    };
  }

  function designValues(node) {
    return {
      width: numberText(node?.bounds?.width),
      height: numberText(node?.bounds?.height),
      padding: node?.layout?.padding?.css || "",
      gap: numberText(node?.layout?.itemSpacing),
      fontFamily: node?.typography?.fontFamily || "",
      fontSize: node?.typography?.fontSize || "",
      fontWeight: node?.typography?.fontWeight === "" ? "" : numberText(node?.typography?.fontWeight),
      lineHeight: node?.typography?.lineHeight || "",
      letterSpacing: node?.typography?.letterSpacing || "",
      textAlign: node?.typography?.textAlign || "",
      color: node?.typography?.color || "",
      backgroundColor: node?.appearance?.backgroundColor || "",
      borderRadius: node?.appearance?.borderRadius || "",
      boxShadow: node?.appearance?.boxShadow || "",
      justifyContent: node?.layout?.justifyContent || "",
      alignItems: node?.layout?.alignItems || ""
    };
  }

  function findCandidates(anchor, webSnapshot, snapshot) {
    const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
    const web = webValues(webSnapshot);
    return nodes.map((node) => {
      const signals = {
        text: Math.max(similarity(anchor?.text, node.text), similarity(anchor?.accessibleName, node.name)),
        role: anchor?.role && node.role ? (anchor.role === node.role ? 1 : 0) : 0,
        tag: anchor?.tag && node.tag ? (anchor.tag === node.tag ? 1 : 0.4) : 0,
        size: (numericSimilarity(web.width, numberText(node.bounds?.width)) + numericSimilarity(web.height, numberText(node.bounds?.height))) / 2,
        typography: node.typography ? numericSimilarity(web.fontSize, node.typography.fontSize, 4) : 0,
        color: colorDistance(web.color, node.typography?.color) === null ? 0 : 1 - colorDistance(web.color, node.typography?.color),
        parent: anchor?.parentFingerprint && node.path?.length ? similarity(anchor.parentFingerprint, node.path[node.path.length - 2]) : 0
      };
      const score = signals.text * 0.28 + signals.role * 0.12 + signals.tag * 0.08 + signals.size * 0.24 + signals.typography * 0.1 + signals.color * 0.08 + signals.parent * 0.1;
      const confidence = score >= 0.78 ? "high" : score >= 0.56 ? "possible" : "none";
      return { node, score, confidence, signals };
    }).sort((first, second) => second.score - first.score).slice(0, 5);
  }

  function valuesEqual(path, expected, actual) {
    if (!expected || !actual) return true;
    if (path.includes("color")) {
      const distance = colorDistance(expected, actual);
      return distance === null ? expected === actual : distance < 0.025;
    }
    if (["width", "height", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "borderRadius", "gap"].some((key) => path.endsWith(key))) {
      const a = parsePx(actual);
      const b = parsePx(expected);
      return a !== null && b !== null ? Math.abs(a - b) < 0.5 : expected === actual;
    }
    if (path.endsWith("padding")) {
      const a = parseBox(actual);
      const b = parseBox(expected);
      return a && b && ["top", "right", "bottom", "left"].every((key) => Math.abs(a[key] - b[key]) < 0.5);
    }
    return String(expected).trim().toLowerCase() === String(actual).trim().toLowerCase();
  }

  function difference(path, expected, actual, confidence) {
    if (!expected || !actual || valuesEqual(path, expected, actual)) return null;
    const expectedNumber = parsePx(expected);
    const actualNumber = parsePx(actual);
    const delta = expectedNumber !== null && actualNumber !== null
      ? `${Math.round((actualNumber - expectedNumber) * 10) / 10}px`
      : path.includes("color") && colorDistance(expected, actual) !== null
        ? `${Math.round(colorDistance(expected, actual) * 100)}% 色差`
        : "不同";
    return { property: path, expected, actual, delta, unit: expectedNumber !== null ? "px" : path.includes("color") ? "color" : "value", confidence };
  }

  function diffSnapshots(webSnapshot, node, confidence = "high") {
    const expected = designValues(node);
    const actual = webValues(webSnapshot);
    const paths = [
      "dimensions.width", "dimensions.height", "spacing.padding", "spacing.gap",
      "typography.fontFamily", "typography.fontSize", "typography.fontWeight", "typography.lineHeight", "typography.letterSpacing", "typography.textAlign", "typography.color",
      "appearance.backgroundColor", "appearance.borderRadius", "appearance.boxShadow", "layout.justifyContent", "layout.alignItems"
    ];
    const mapped = {
      "dimensions.width": [expected.width, actual.width], "dimensions.height": [expected.height, actual.height], "spacing.padding": [expected.padding, actual.padding], "spacing.gap": [expected.gap, actual.gap],
      "typography.fontFamily": [expected.fontFamily, actual.fontFamily], "typography.fontSize": [expected.fontSize, actual.fontSize], "typography.fontWeight": [expected.fontWeight, actual.fontWeight], "typography.lineHeight": [expected.lineHeight, actual.lineHeight], "typography.letterSpacing": [expected.letterSpacing, actual.letterSpacing], "typography.textAlign": [expected.textAlign, actual.textAlign], "typography.color": [expected.color, actual.color],
      "appearance.backgroundColor": [expected.backgroundColor, actual.backgroundColor], "appearance.borderRadius": [expected.borderRadius, actual.borderRadius], "appearance.boxShadow": [expected.boxShadow, actual.boxShadow], "layout.justifyContent": [expected.justifyContent, actual.justifyContent], "layout.alignItems": [expected.alignItems, actual.alignItems]
    };
    return paths.map((path) => difference(path, mapped[path][0], mapped[path][1], confidence)).filter(Boolean);
  }

  function parseFigmaUrl(value) {
    const raw = text(value);
    if (!raw) return { url: "", fileKey: "", nodeId: "", frameName: "" };
    try {
      const url = new URL(raw);
      const pathParts = url.pathname.split("/").filter(Boolean);
      const fileIndex = pathParts.findIndex((part) => part === "file" || part === "design");
      const fileKey = fileIndex >= 0 ? text(pathParts[fileIndex + 1]) : "";
      const nodeId = text(url.searchParams.get("node-id")).replace(/-/g, ":");
      return { url: raw, fileKey, nodeId, frameName: decodeURIComponent(pathParts[pathParts.length - 1] || "") };
    } catch (_) {
      return { url: raw, fileKey: "", nodeId: "", frameName: "" };
    }
  }

  globalThis.__uideltaCompareEngine = { normalizeDesignSnapshot, findCandidates, diffSnapshots, parseFigmaUrl, webValues, designValues };
})();
