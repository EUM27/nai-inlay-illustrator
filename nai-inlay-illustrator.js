// Marinara external extension: installs a custom inlay image-plan agent.
// The agent only plans paragraph image slots. Marinara's existing server-side
// image generation connection creates and stores the actual inlay images.

(() => {
  const AGENT_TYPE = "nai-inlay-illustrator";
  const AGENT_NAME = "NAI-Style Inlay Illustrator";
  const INSTALLER_VERSION = "2026-06-16-custom-agent-v5";
  const STYLE_ID = "nai-inlay-illustrator-inlay-width-style";
  const IMAGE_RANGES = new Set(["1-3", "2-5", "3-10"]);
  const DEFAULT_IMAGE_RANGE = "1-3";
  const DEFAULT_MAX_TOKENS = 4096;
  const DEFAULT_RUN_INTERVAL = 5;
  const MIN_IMAGE_DIMENSION = 256;
  const MAX_IMAGE_DIMENSION = 2048;
  const DEFAULT_IMAGE_WIDTH = 832;
  const DEFAULT_IMAGE_HEIGHT = 1216;
  const CSRF_HEADER = "x-marinara-csrf";
  const CSRF_HEADER_VALUE = "1";
  const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  const LEGACY_DEFAULT_POSITIVE_PROMPT = [
    "1.2::best quality::",
    "1.2::amazing quality::",
    "1.1::very aesthetic::",
    "2.0::best illustration::",
    "2.0::highly detailed illustration::",
    "ultra-detailed",
    "intricate details",
  ].join(", ");

  const LEGACY_DEFAULT_NEGATIVE_PROMPT = [
    "lowres",
    "bad anatomy",
    "bad hands",
    "text",
    "error",
    "missing fingers",
    "extra digit",
    "fewer digits",
    "cropped",
    "worst quality",
    "low quality",
    "normal quality",
    "jpeg artifacts",
    "signature",
    "watermark",
    "username",
    "blurry",
  ].join(", ");
  const DEFAULT_POSITIVE_PROMPT = "";
  const DEFAULT_NEGATIVE_PROMPT = "";
  const INLAY_IMAGE_SELECTOR = [
    ".mari-message-content img.mari-inlay-image",
    '.mari-message-content img[alt^="inlay-"]',
    '.mari-message-content img[alt*="inlay image"]',
    '.mari-message-content img[src*="/api/gallery/file/"][alt*="slot-"]',
  ].join(", ");

  const INLAY_IMAGE_CSS = `
${INLAY_IMAGE_SELECTOR} {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  margin: 0 !important;
  object-fit: contain !important;
}
`.trim();

  const PROMPT_TEMPLATE = `You are an inlay illustration planner for Marinara Engine.
Return strict JSON only. Do not write markdown.
Use the latest assistant response as the story source.
Choose chronological visual beats. Do not group by topic.
Respect the requested image count range from <nai_inlay_contract>.
Do not invent facts not present in the chat, character/persona appearance data, lorebook context, or the assistant response.

Return this JSON shape:
{
  "shouldGenerate": true,
  "reason": "short reason",
  "images": [
    {
      "slot": 1,
      "name": "short title",
      "scene": "visible action, mood, props, and story beat",
      "place": "visible location/environment",
      "angle": "shot size, camera angle, focus, perspective",
      "positivePrompt": "scene-level image tags only",
      "negativePrompt": "scene-level negative tags only",
      "characters": [
        {
          "name": "visible character name",
          "char": "positive tags for this character's appearance, outfit, pose, expression, and action",
          "neg": "negative tags for this character only"
        }
      ],
      "reason": "why this image belongs after this paragraph"
    }
  ]
}

Rules:
1. slot is the paragraph number in <assistant_response> after which the image should appear.
2. Every image must be self-contained.
3. Keep scene/place/angle, each character char, positivePrompt, and negativePrompt separate.
4. Do not put negative tags in char or positivePrompt.
5. Do not mix unrelated character descriptions.
6. If a character is not visible in a slot, do not include them.
7. Prefer concrete appearance data from <inlay_character_visuals>. Use description only when appearance is missing.
8. Use concise English image prompt tags.`;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function parseSettings(value) {
    if (!value) return {};
    if (isRecord(value)) return value;
    if (typeof value !== "string") return {};
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function normalizeRange(value) {
    return typeof value === "string" && IMAGE_RANGES.has(value) ? value : DEFAULT_IMAGE_RANGE;
  }

  function positiveIntOr(value, fallback, max) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(max, Math.trunc(parsed));
  }

  function optionalPromptOr(value, fallback, legacyDefault) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text === legacyDefault) return fallback;
    return text;
  }

  function imageDimensionOr(value, fallback) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.max(MIN_IMAGE_DIMENSION, Math.min(MAX_IMAGE_DIMENSION, Math.trunc(parsed)));
  }

  function withApiHeaders(options) {
    const init = options || {};
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    if (typeof init.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (UNSAFE_METHODS.has(method)) {
      headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
    }
    return { ...init, headers };
  }

  async function api(path, options) {
    const data = await marinara.apiFetch(path, withApiHeaders(options));
    if (isRecord(data) && typeof data.error === "string") {
      throw new Error(data.error);
    }
    return data;
  }

  function setImportantStyle(element, styles) {
    if (!element?.style) return;
    for (const [name, value] of Object.entries(styles)) {
      element.style.setProperty(name, value, "important");
    }
  }

  function collectInlayImages(root) {
    if (typeof document === "undefined") return [];
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const images = [];
    if (scope.nodeType === 1 && typeof scope.matches === "function" && scope.matches(INLAY_IMAGE_SELECTOR)) {
      images.push(scope);
    }
    images.push(...scope.querySelectorAll(INLAY_IMAGE_SELECTOR));
    return images;
  }

  function applyInlayImageSizing(root) {
    for (const image of collectInlayImages(root)) {
      setImportantStyle(image, {
        display: "block",
        width: "100%",
        "max-width": "100%",
        height: "auto",
        margin: "0",
        "object-fit": "contain",
      });

      const button = image.closest("button");
      setImportantStyle(button, {
        display: "block",
        width: "100%",
        "max-width": "100%",
        "text-align": "left",
      });
      if (button?.parentElement && !button.parentElement.classList.contains("mari-message-content")) {
        setImportantStyle(button.parentElement, {
          display: "block",
          width: "100%",
          "max-width": "100%",
        });
      }

      setImportantStyle(image.closest(".mari-message-content"), { width: "100%" });
      setImportantStyle(image.closest(".mari-message-bubble"), { width: "100%" });
    }
  }

  function installInlayImageStyles() {
    if (typeof document === "undefined" || !document.head) return;
    const existing = document.getElementById(STYLE_ID);
    const style = existing ?? document.createElement("style");
    if (!existing) style.id = STYLE_ID;
    style.textContent = INLAY_IMAGE_CSS;
    if (!existing) document.head.appendChild(style);
    let frame = 0;
    const scheduleApply = (root) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        applyInlayImageSizing(root);
      });
    };
    scheduleApply(document);

    const observer =
      typeof MutationObserver === "function" && document.body
        ? new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (
                  (typeof node.matches === "function" && node.matches(INLAY_IMAGE_SELECTOR)) ||
                  (typeof node.querySelector === "function" && node.querySelector(INLAY_IMAGE_SELECTOR))
                ) {
                  scheduleApply(node);
                  return;
                }
              }
            }
          })
        : null;
    observer?.observe(document.body, { childList: true, subtree: true });
    if (typeof marinara?.onCleanup === "function") {
      marinara.onCleanup(() => {
        if (frame) cancelAnimationFrame(frame);
        observer?.disconnect();
        if (!existing) style.remove();
      });
    }
  }

  async function resolveImageConnectionId(existingSettings) {
    if (typeof existingSettings.imageConnectionId === "string" && existingSettings.imageConnectionId.trim()) {
      return existingSettings.imageConnectionId.trim();
    }

    const connections = await api("/connections").catch(() => []);
    if (!Array.isArray(connections)) return "";
    const imageConnections = connections.filter((connection) => isRecord(connection) && connection.provider === "image_generation");
    const preferred =
      imageConnections.find((connection) => connection.defaultForAgents === true || connection.defaultForAgents === "true") ??
      imageConnections[0];
    return typeof preferred?.id === "string" ? preferred.id : "";
  }

  function buildSettings(existingSettings, imageConnectionId) {
    const shouldMigrateAggressiveDefaults = existingSettings.installerVersion !== INSTALLER_VERSION;
    const next = {
      resultType: "inlay_image_plan",
      contextSize: positiveIntOr(existingSettings.contextSize, 8, 200),
      maxTokens: positiveIntOr(existingSettings.maxTokens, DEFAULT_MAX_TOKENS, 32768),
      runInterval: positiveIntOr(existingSettings.runInterval, DEFAULT_RUN_INTERVAL, 100),
      imageRange: normalizeRange(existingSettings.imageRange),
      imageWidth: imageDimensionOr(existingSettings.imageWidth, DEFAULT_IMAGE_WIDTH),
      imageHeight: imageDimensionOr(existingSettings.imageHeight, DEFAULT_IMAGE_HEIGHT),
      ...existingSettings,
      installerVersion: INSTALLER_VERSION,
    };

    next.resultType = "inlay_image_plan";
    next.imageRange = normalizeRange(next.imageRange);
    next.contextSize = positiveIntOr(next.contextSize, 8, 200);
    next.maxTokens = positiveIntOr(next.maxTokens, DEFAULT_MAX_TOKENS, 32768);
    next.runInterval = positiveIntOr(next.runInterval, DEFAULT_RUN_INTERVAL, 100);
    if (shouldMigrateAggressiveDefaults) {
      if (next.maxTokens > DEFAULT_MAX_TOKENS) next.maxTokens = DEFAULT_MAX_TOKENS;
      if (next.runInterval < DEFAULT_RUN_INTERVAL) next.runInterval = DEFAULT_RUN_INTERVAL;
      next.imageRange = DEFAULT_IMAGE_RANGE;
    }
    next.imageWidth = imageDimensionOr(next.imageWidth, DEFAULT_IMAGE_WIDTH);
    next.imageHeight = imageDimensionOr(next.imageHeight, DEFAULT_IMAGE_HEIGHT);
    next.imagePositivePrompt = optionalPromptOr(
      next.imagePositivePrompt,
      DEFAULT_POSITIVE_PROMPT,
      LEGACY_DEFAULT_POSITIVE_PROMPT,
    );
    next.imageNegativePrompt = optionalPromptOr(
      next.imageNegativePrompt,
      DEFAULT_NEGATIVE_PROMPT,
      LEGACY_DEFAULT_NEGATIVE_PROMPT,
    );
    if (!next.imagePositivePrompt) delete next.imagePositivePrompt;
    if (!next.imageNegativePrompt) delete next.imageNegativePrompt;

    if (imageConnectionId) {
      next.imageConnectionId = imageConnectionId;
    }

    return next;
  }

  async function installAgent() {
    const agents = await api("/agents");
    const existing = Array.isArray(agents)
      ? agents.find((agent) => isRecord(agent) && (agent.type === AGENT_TYPE || agent.name === AGENT_NAME))
      : null;
    const existingSettings = parseSettings(existing?.settings);

    if (
      existing &&
      existingSettings.installerVersion === INSTALLER_VERSION &&
      existingSettings.resultType === "inlay_image_plan"
    ) {
      return;
    }

    const imageConnectionId = await resolveImageConnectionId(existingSettings);
    const settings = buildSettings(existingSettings, imageConnectionId);
    const payload = {
      type: AGENT_TYPE,
      name: AGENT_NAME,
      description:
        "Plans chronological inline illustration slots after assistant responses. The server uses Marinara image generation connections for the actual images.",
      phase: "post_processing",
      connectionId: typeof existing?.connectionId === "string" ? existing.connectionId : null,
      resultType: "inlay_image_plan",
      promptTemplate: PROMPT_TEMPLATE,
      settings,
    };

    if (existing && typeof existing.id === "string") {
      await api(`/agents/${encodeURIComponent(existing.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/agents", {
        method: "POST",
        body: JSON.stringify({ ...payload, enabled: true }),
      });
    }
  }

  installInlayImageStyles();

  void installAgent().catch((error) => {
    console.warn("[NAI-Style Inlay Illustrator] Failed to install custom agent:", error);
  });
})();
