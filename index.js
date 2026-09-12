/**
 * Kirby ~ Soft & Wet (Fishing Side Game) - SillyTavern Extension
 * Author: Khanhhpk
 * Description: Play Kirby fishing minigame inside SillyTavern in a draggable, smart-aspect-ratio floating window.
 * Architecture directly adapted from SillyTavern-KittyToy.
 */

(function ($) {
  "use strict";

  const EXT_ID = "sillytavern-kirby-fishing";
  const SETTINGS_KEY = "st_kirby_settings";

  // Native Kirby ~ Soft & Wet aspect ratio: 3:2 (GBA native 240x160 -> 480x320, 600x400, 720x480, 960x640)
  const ASPECT_RATIO = 3 / 2; // 1.5
  const HEADER_HEIGHT = 38;
  const MIN_WIDTH = 360;
  const MIN_HEIGHT = Math.round(MIN_WIDTH / ASPECT_RATIO) + HEADER_HEIGHT; // 240 + 38 = 278px
  const HOLD_DURATION_MS = 1000;

  // Base URL auto-detection
  const SCRIPT_BASE_URL = (() => {
    if (document.currentScript && document.currentScript.src) {
      return document.currentScript.src.substring(0, document.currentScript.src.lastIndexOf("/"));
    }
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i].src || "";
      if (src.includes("sillytavern-kirby-fishing") || src.includes("ST%20game") || src.includes("kirby")) {
        return src.substring(0, src.lastIndexOf("/"));
      }
    }
    return "/scripts/extensions/third-party/sillytavern-kirby-fishing";
  })();

  // Default configuration: 660 x 440 (3:2) + 38px header = 660 x 478
  const defaultSettings = {
    isOpen: false,
    isSemiTransparent: false,
    isMuted: false,
    x: 120,
    y: 80,
    width: 660,
    height: Math.round(660 / ASPECT_RATIO) + HEADER_HEIGHT, // 440 + 38 = 478px
    fabX: null,
    fabY: null,
  };

  let settings = Object.assign({}, defaultSettings);

  // DOM Elements
  let windowEl = null;
  let headerEl = null;
  let iframeEl = null;
  let shieldEl = null;
  let fabEl = null;
  let resizerEl = null;
  let closeBtnEl = null;
  let closeFillEl = null;
  let hintBubbleEl = null;
  let toastEl = null;
  let muteBtnEl = null;

  // Window drag state
  let isDraggingWindow = false;
  let winDragStartX = 0, winDragStartY = 0;
  let winInitialX = 0, winInitialY = 0;

  // Window resize state
  let isResizingWindow = false;
  let winResizeStartX = 0, winResizeStartY = 0;
  let winInitialWidth = 0, winInitialHeight = 0;

  // FAB drag state
  let isDraggingFab = false;
  let fabStartX = 0, fabStartY = 0;
  let fabInitialX = 0, fabInitialY = 0;
  let fabHasMoved = false;

  // Close hold state
  let holdTimer = null;
  let isHoldingClose = false;
  let holdCompleted = false;

  /**
   * Load settings from localStorage
   */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        settings = Object.assign({}, defaultSettings, JSON.parse(raw));
        // Always enforce exact 3:2 aspect ratio for Kirby Fishing
        if (settings.width) {
          settings.height = Math.round(settings.width / ASPECT_RATIO) + HEADER_HEIGHT;
        }
      }
    } catch (e) {
      console.warn(`[${EXT_ID}] Failed to load settings:`, e);
    }
  }

  /**
   * Save settings to localStorage
   */
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn(`[${EXT_ID}] Failed to save settings:`, e);
    }
  }

  function getGameUrl() {
    return `${SCRIPT_BASE_URL}/game/index.html`;
  }

  function getIconUrl() {
    return `${SCRIPT_BASE_URL}/icon.png`;
  }

  function getIconPath(name) {
    return `${SCRIPT_BASE_URL}/icons/${name}`;
  }

  /**
   * Show toast notification
   */
  function showToast(message, duration = 3000, iconSrc = null) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "st-kirby-toast";
      document.body.appendChild(toastEl);
    }
    if (iconSrc) {
      toastEl.innerHTML = `<img src="${iconSrc}" class="st-kirby-toast-icon" alt="" /><span>${message}</span>`;
    } else {
      toastEl.innerHTML = `<span>${message}</span>`;
    }
    toastEl.classList.add("show");
    setTimeout(() => {
      if (toastEl) toastEl.classList.remove("show");
    }, duration);
  }

  /**
   * Create Floating Action Bubble (Bóng nổi tự do)
   */
  function createFloatingActionBubble() {
    if (document.getElementById("st-kirby-fab")) return;

    fabEl = document.createElement("div");
    fabEl.id = "st-kirby-fab";
    fabEl.className = "st-kirby-fab";
    fabEl.title = "Kirby Fishing (Kéo để di chuyển, click để mở/ẩn)";
    fabEl.innerHTML = `<img src="${getIconUrl()}" class="st-kirby-fab-img" alt="Kirby" />`;

    // Position FAB
    if (settings.fabX !== null && settings.fabY !== null) {
      const clampedX = Math.max(10, Math.min(window.innerWidth - 70, settings.fabX));
      const clampedY = Math.max(10, Math.min(window.innerHeight - 70, settings.fabY));
      fabEl.style.left = `${clampedX}px`;
      fabEl.style.top = `${clampedY}px`;
    } else {
      fabEl.style.left = `${Math.max(10, window.innerWidth - 80)}px`;
      fabEl.style.top = `${Math.max(10, window.innerHeight - 150)}px`;
    }

    document.body.appendChild(fabEl);

    // Bind pointer events
    fabEl.addEventListener("pointerdown", onFabPointerDown);
  }

  let fabRaf = null;
  let targetFabX = null;
  let targetFabY = null;

  function onFabPointerDown(e) {
    if (e.button !== 0) return;
    isDraggingFab = true;
    fabHasMoved = false;
    fabStartX = e.clientX;
    fabStartY = e.clientY;

    const rect = fabEl.getBoundingClientRect();
    fabInitialX = rect.left;
    fabInitialY = rect.top;

    fabEl.setPointerCapture(e.pointerId);

    window.addEventListener("pointermove", onFabPointerMove);
    window.addEventListener("pointerup", onFabPointerUp);
    window.addEventListener("pointercancel", onFabPointerUp);
    e.preventDefault();
  }

  function onFabPointerMove(e) {
    if (!isDraggingFab) return;
    const dx = e.clientX - fabStartX;
    const dy = e.clientY - fabStartY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      fabHasMoved = true;
    }

    if (fabHasMoved) {
      targetFabX = Math.max(10, Math.min(window.innerWidth - 68, fabInitialX + dx));
      targetFabY = Math.max(10, Math.min(window.innerHeight - 68, fabInitialY + dy));

      if (!fabRaf) {
        fabRaf = requestAnimationFrame(() => {
          fabRaf = null;
          if (fabEl && targetFabX !== null) {
            fabEl.style.left = `${targetFabX}px`;
            fabEl.style.top = `${targetFabY}px`;
          }
        });
      }
    }
  }

  function onFabPointerUp(e) {
    if (!isDraggingFab) return;
    isDraggingFab = false;

    if (fabRaf) {
      cancelAnimationFrame(fabRaf);
      fabRaf = null;
    }
    if (fabHasMoved && targetFabX !== null && fabEl) {
      fabEl.style.left = `${targetFabX}px`;
      fabEl.style.top = `${targetFabY}px`;
    }

    window.removeEventListener("pointermove", onFabPointerMove);
    window.removeEventListener("pointerup", onFabPointerUp);
    window.removeEventListener("pointercancel", onFabPointerUp);

    if (fabHasMoved) {
      const rect = fabEl.getBoundingClientRect();
      settings.fabX = rect.left;
      settings.fabY = rect.top;
      saveSettings();
    } else {
      toggleWindow();
    }
  }

  /**
   * Create Floating Game Window DOM
   */
  function createWindowDOM() {
    if (document.getElementById("st-kirby-window")) return;

    windowEl = document.createElement("div");
    windowEl.id = "st-kirby-window";
    windowEl.className = settings.isOpen ? "" : "st-kirby-hidden";

    if (settings.isSemiTransparent) {
      windowEl.classList.add("st-kirby-semi-transparent");
    }

    // Calculate smart 16:9 dimensions
    const posX = Math.max(10, Math.min(window.innerWidth - 420, settings.x));
    const posY = Math.max(10, Math.min(window.innerHeight - 300, settings.y));
    const winW = Math.max(MIN_WIDTH, Math.min(window.innerWidth - 20, settings.width));
    const contentH = Math.round(winW / ASPECT_RATIO);
    const winH = Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 20, contentH + HEADER_HEIGHT));

    windowEl.style.left = `${posX}px`;
    windowEl.style.top = `${posY}px`;
    windowEl.style.width = `${winW}px`;
    windowEl.style.height = `${winH}px`;

    // Header with KittyToy-style controls
    headerEl = document.createElement("div");
    headerEl.className = "st-kirby-header";
    headerEl.innerHTML = `
      <div class="st-kirby-title-group">
        <img src="${getIconUrl()}" class="st-kirby-header-icon" alt="Kirby" />
        <span>Kirby ~ Soft & Wet</span>
      </div>
      <div class="st-kirby-controls">
        <button class="st-kirby-btn st-kirby-btn-ghost ${settings.isSemiTransparent ? "active" : ""}" title="Chế độ Ghost (Mờ nhìn xuyên chat, rê chuột vào sẽ hiện rõ)">
          <img src="${getIconPath('icon_ghost.png')}" class="st-kirby-btn-img" alt="Ghost" />
        </button>
        <button class="st-kirby-btn st-kirby-btn-mute ${settings.isMuted ? "active" : ""}" title="${settings.isMuted ? 'Bật âm thanh' : 'Tắt âm thanh game'}">
          <img src="${getIconPath(settings.isMuted ? 'icon_sound_off.png' : 'icon_sound_on.png')}" class="st-kirby-btn-img" alt="Sound" />
        </button>
        <button class="st-kirby-btn st-kirby-btn-reload" title="Tải lại game (Reload)">
          <img src="${getIconPath('icon_reload.png')}" class="st-kirby-btn-img" alt="Reload" />
        </button>
        <button class="st-kirby-btn st-kirby-btn-min" title="Ẩn (game vẫn chạy ngầm)">
          <img src="${getIconPath('icon_min.png')}" class="st-kirby-btn-img" alt="Minimize" />
        </button>
        <div class="st-kirby-close-container">
          <button class="st-kirby-btn st-kirby-btn-close" title="Bấm giữ 1s để Lưu & Tắt hẳn game">
            <div class="st-kirby-hold-fill"></div>
            <span class="st-kirby-btn-label">
              <img src="${getIconPath('icon_close.png')}" class="st-kirby-btn-img" alt="Close" />
            </span>
          </button>
          <div class="st-kirby-hint-bubble">
            <img src="${getIconPath('icon_save.png')}" class="st-kirby-hint-icon" alt="" />
            <span>Giữ 1s để tắt hẳn!</span>
          </div>
        </div>
      </div>
    `;

    // Body (Strictly no scrollbars, 100% responsive fit)
    const bodyEl = document.createElement("div");
    bodyEl.className = "st-kirby-body";

    iframeEl = document.createElement("iframe");
    iframeEl.className = "st-kirby-iframe";
    iframeEl.setAttribute("allow", "autoplay; fullscreen");
    if (settings.isOpen) {
      iframeEl.src = getGameUrl();
    }

    shieldEl = document.createElement("div");
    shieldEl.className = "st-kirby-shield";

    resizerEl = document.createElement("div");
    resizerEl.className = "st-kirby-resizer";
    resizerEl.title = "Kéo góc để thay đổi kích thước chuẩn 3:2 (GBA) (Giữ Shift để kéo tự do)";

    bodyEl.appendChild(iframeEl);
    bodyEl.appendChild(shieldEl);
    bodyEl.appendChild(resizerEl);

    // Clicking anywhere in the game window ensures keyboard controls go to the canvas
    bodyEl.addEventListener("pointerdown", () => {
      try {
        if (iframeEl && iframeEl.contentWindow) {
          iframeEl.contentWindow.focus();
        }
      } catch (_e) {}
    });

    windowEl.appendChild(headerEl);
    windowEl.appendChild(bodyEl);

    document.body.appendChild(windowEl);

    // Bind window header dragging
    headerEl.addEventListener("pointerdown", onHeaderPointerDown);

    // Bind smart resizer
    resizerEl.addEventListener("pointerdown", onResizerPointerDown);

    // Bind controls
    const btnGhost = headerEl.querySelector(".st-kirby-btn-ghost");
    btnGhost.addEventListener("click", toggleGhostMode);

    muteBtnEl = headerEl.querySelector(".st-kirby-btn-mute");
    muteBtnEl.addEventListener("click", toggleMute);

    const btnReload = headerEl.querySelector(".st-kirby-btn-reload");
    btnReload.addEventListener("click", reloadGame);

    // Minimize Button (➖): ONLY HIDES, pauses audio so chat isn't disturbed
    const btnMin = headerEl.querySelector(".st-kirby-btn-min");
    btnMin.addEventListener("click", () => {
      hideWindow();
      showToast("Kirby Fishing đã được thu gọn (game vẫn đang chạy ngầm)", 3000, getIconUrl());
    });

    // Close Button (✖): Click does NOT close. Hold for 1s terminates!
    closeBtnEl = headerEl.querySelector(".st-kirby-btn-close");
    closeFillEl = headerEl.querySelector(".st-kirby-hold-fill");
    hintBubbleEl = headerEl.querySelector(".st-kirby-hint-bubble");

    closeBtnEl.addEventListener("pointerdown", onClosePointerDown);
    closeBtnEl.addEventListener("click", onCloseClick);
  }

  /**
   * Close Button Hold-to-Terminate Logic
   */
  function onClosePointerDown(e) {
    if (e.button !== 0) return;
    isHoldingClose = true;
    holdCompleted = false;

    closeBtnEl.classList.add("is-holding");

    // Start 1-second hold timer
    holdTimer = setTimeout(() => {
      if (isHoldingClose) {
        holdCompleted = true;
        terminateGame();
      }
    }, HOLD_DURATION_MS);

    window.addEventListener("pointerup", onClosePointerUp);
    window.addEventListener("pointercancel", onClosePointerUp);
  }

  function onClosePointerUp() {
    if (!isHoldingClose) return;
    isHoldingClose = false;
    clearTimeout(holdTimer);

    if (closeBtnEl) {
      closeBtnEl.classList.remove("is-holding");
    }

    window.removeEventListener("pointerup", onClosePointerUp);
    window.removeEventListener("pointercancel", onClosePointerUp);
  }

  function onCloseClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // If hold wasn't completed, do NOT close! Show warning shake + hint
    if (!holdCompleted) {
      closeBtnEl.classList.add("shake");
      if (hintBubbleEl) {
        hintBubbleEl.classList.add("visible");
      }

      setTimeout(() => {
        if (closeBtnEl) closeBtnEl.classList.remove("shake");
      }, 400);

      setTimeout(() => {
        if (hintBubbleEl) hintBubbleEl.classList.remove("visible");
      }, 2000);
    }
  }

  /**
   * Terminate Game: Frees memory and unloads iframe
   */
  function terminateGame() {
    try {
      if (iframeEl && iframeEl.contentWindow) {
        iframeEl.contentWindow.dispatchEvent(new Event("beforeunload"));
      }
    } catch (e) {
      console.warn("Could not dispatch beforeunload:", e);
    }

    // Unload iframe completely (frees WebAssembly runtime & memory)
    if (iframeEl) {
      iframeEl.src = "about:blank";
    }

    hideWindow();
    showToast("Đã tắt hẳn game Kirby Fishing. Bấm bóng nổi để chơi lại.", 3500, getIconPath("icon_save.png"));
  }

  /**
   * Header Drag Handlers
   */
  let winDragRaf = null;
  let targetWinX = null;
  let targetWinY = null;

  function onHeaderPointerDown(e) {
    if (e.target.closest(".st-kirby-controls")) return;
    if (e.button !== 0) return;

    isDraggingWindow = true;
    winDragStartX = e.clientX;
    winDragStartY = e.clientY;

    const rect = windowEl.getBoundingClientRect();
    winInitialX = rect.left;
    winInitialY = rect.top;

    shieldEl.classList.add("active");
    headerEl.setPointerCapture(e.pointerId);

    window.addEventListener("pointermove", onHeaderPointerMove);
    window.addEventListener("pointerup", onHeaderPointerUp);
    window.addEventListener("pointercancel", onHeaderPointerUp);
    e.preventDefault();
  }

  function onHeaderPointerMove(e) {
    if (!isDraggingWindow) return;
    const dx = e.clientX - winDragStartX;
    const dy = e.clientY - winDragStartY;

    targetWinX = Math.max(0, Math.min(window.innerWidth - 100, winInitialX + dx));
    targetWinY = Math.max(0, Math.min(window.innerHeight - 50, winInitialY + dy));

    if (!winDragRaf) {
      winDragRaf = requestAnimationFrame(() => {
        winDragRaf = null;
        if (windowEl && targetWinX !== null) {
          windowEl.style.left = `${targetWinX}px`;
          windowEl.style.top = `${targetWinY}px`;
        }
      });
    }
  }

  function onHeaderPointerUp() {
    if (!isDraggingWindow) return;
    isDraggingWindow = false;
    shieldEl.classList.remove("active");

    if (winDragRaf) {
      cancelAnimationFrame(winDragRaf);
      winDragRaf = null;
    }
    if (windowEl && targetWinX !== null) {
      windowEl.style.left = `${targetWinX}px`;
      windowEl.style.top = `${targetWinY}px`;
    }

    window.removeEventListener("pointermove", onHeaderPointerMove);
    window.removeEventListener("pointerup", onHeaderPointerUp);
    window.removeEventListener("pointercancel", onHeaderPointerUp);

    const rect = windowEl.getBoundingClientRect();
    settings.x = rect.left;
    settings.y = rect.top;
    saveSettings();
  }

  /**
   * Smart 16:9 Aspect-Ratio Resizer Handlers
   */
  let winResizeRaf = null;
  let targetWinW = null;
  let targetWinH = null;

  function onResizerPointerDown(e) {
    if (e.button !== 0) return;
    isResizingWindow = true;
    winResizeStartX = e.clientX;
    winResizeStartY = e.clientY;

    const rect = windowEl.getBoundingClientRect();
    winInitialWidth = rect.width;
    winInitialHeight = rect.height;

    shieldEl.classList.add("active");
    resizerEl.setPointerCapture(e.pointerId);

    window.addEventListener("pointermove", onResizerPointerMove);
    window.addEventListener("pointerup", onResizerPointerUp);
    window.addEventListener("pointercancel", onResizerPointerUp);
    e.preventDefault();
  }

  function onResizerPointerMove(e) {
    if (!isResizingWindow) return;
    const dw = e.clientX - winResizeStartX;

    // Calculate maximum available space on screen
    const rect = windowEl.getBoundingClientRect();
    const maxAllowedWidth = window.innerWidth - rect.left - 10;
    const maxAllowedHeight = window.innerHeight - rect.top - 10;

    let targetWidth = Math.max(MIN_WIDTH, Math.min(maxAllowedWidth, winInitialWidth + dw));

    if (!e.shiftKey) {
      // Smart 3:2 (GBA) Aspect Ratio Lock (Guarantees zero UI clipping and zero scrollbars!)
      let contentH = Math.round(targetWidth / ASPECT_RATIO);
      let totalH = contentH + HEADER_HEIGHT;

      // If height exceeds screen, fit to height instead
      if (totalH > maxAllowedHeight) {
        contentH = maxAllowedHeight - HEADER_HEIGHT;
        targetWidth = Math.round(contentH * ASPECT_RATIO);
        totalH = contentH + HEADER_HEIGHT;
      }

      targetWinW = targetWidth;
      targetWinH = totalH;
    } else {
      // Freeform resize if holding Shift
      const dh = e.clientY - winResizeStartY;
      let targetHeight = Math.max(MIN_HEIGHT, Math.min(maxAllowedHeight, winInitialHeight + dh));
      targetWinW = targetWidth;
      targetWinH = targetHeight;
    }

    if (!winResizeRaf) {
      winResizeRaf = requestAnimationFrame(() => {
        winResizeRaf = null;
        if (windowEl && targetWinW !== null && targetWinH !== null) {
          windowEl.style.width = `${targetWinW}px`;
          windowEl.style.height = `${targetWinH}px`;
        }
      });
    }
  }

  function onResizerPointerUp() {
    if (!isResizingWindow) return;
    isResizingWindow = false;
    shieldEl.classList.remove("active");

    if (winResizeRaf) {
      cancelAnimationFrame(winResizeRaf);
      winResizeRaf = null;
    }
    if (windowEl && targetWinW !== null && targetWinH !== null) {
      windowEl.style.width = `${targetWinW}px`;
      windowEl.style.height = `${targetWinH}px`;
    }

    window.removeEventListener("pointermove", onResizerPointerMove);
    window.removeEventListener("pointerup", onResizerPointerUp);
    window.removeEventListener("pointercancel", onResizerPointerUp);

    const rect = windowEl.getBoundingClientRect();
    settings.width = rect.width;
    settings.height = rect.height;
    saveSettings();

    // Trigger resize inside iframe so GameMaker immediately updates its canvas
    try {
      if (iframeEl && iframeEl.contentWindow) {
        iframeEl.contentWindow.dispatchEvent(new Event("resize"));
      }
    } catch (_e) {}
  }

  /**
   * Send mute command to the game iframe via postMessage
   * Falls back to direct __kirbySetMute call (same-origin)
   */
  function applyMuteState() {
    try {
      if (!iframeEl || !iframeEl.contentWindow) return;
      const win = iframeEl.contentWindow;

      // Primary: postMessage (works cross-context, queued after load)
      iframeEl.contentWindow.postMessage(
        { type: "kirby_mute", muted: settings.isMuted },
        "*"
      );

      // Fallback: direct call if bridge already initialized (same-origin)
      if (typeof win.__kirbySetMute === "function") {
        win.__kirbySetMute(settings.isMuted);
      }
    } catch (_e) {}
  }

  /**
   * Toggle sound on/off (dedicated mute button)
   */
  function toggleMute() {
    settings.isMuted = !settings.isMuted;
    saveSettings();
    applyMuteState();

    // Update button appearance
    if (muteBtnEl) {
      muteBtnEl.classList.toggle("active", settings.isMuted);
      muteBtnEl.title = settings.isMuted ? "Bật âm thanh" : "Tắt âm thanh game";
      const img = muteBtnEl.querySelector(".st-kirby-btn-img");
      if (img) img.src = getIconPath(settings.isMuted ? "icon_sound_off.png" : "icon_sound_on.png");
    }

    showToast(
      settings.isMuted ? "Đã tắt âm thanh game" : "Đã bật lại âm thanh game",
      2000,
      getIconPath(settings.isMuted ? "icon_sound_off.png" : "icon_sound_on.png")
    );
  }

  /**
   * Window Visibility Controls
   */
  function showWindow() {
    if (!iframeEl.src || iframeEl.src === "about:blank" || iframeEl.src.endsWith("about:blank")) {
      iframeEl.src = getGameUrl();
    }
    windowEl.classList.remove("st-kirby-hidden");
    settings.isOpen = true;
    saveSettings();

    // Re-apply mute state after iframe potentially reloaded
    setTimeout(() => applyMuteState(), 500);

    // Auto-focus canvas so keyboard controls work instantly
    setTimeout(() => {
      try {
        if (iframeEl && iframeEl.contentWindow) {
          iframeEl.contentWindow.focus();
          const canvas = iframeEl.contentDocument?.getElementById("canvas");
          if (canvas) canvas.focus();
        }
      } catch (_e) {}
    }, 150);
  }

  function hideWindow() {
    windowEl.classList.add("st-kirby-hidden");
    settings.isOpen = false;
    saveSettings();
    // Audio keeps running intentionally — user controls sound via the mute button
  }

  function toggleWindow() {
    if (windowEl.classList.contains("st-kirby-hidden")) {
      showWindow();
    } else {
      hideWindow();
    }
  }

  function toggleGhostMode() {
    settings.isSemiTransparent = !settings.isSemiTransparent;
    windowEl.classList.toggle("st-kirby-semi-transparent", settings.isSemiTransparent);
    const btn = headerEl.querySelector(".st-kirby-btn-ghost");
    if (btn) btn.classList.toggle("active", settings.isSemiTransparent);
    saveSettings();
  }

  function reloadGame() {
    if (iframeEl) {
      iframeEl.src = getGameUrl();
      showToast("Đang tải lại game Kirby Fishing...", 2500, getIconPath("icon_reload.png"));
    }
  }

  /**
   * Extension Initialization
   */
  function init() {
    console.log(`[${EXT_ID}] Initializing Kirby Fishing Extension (KittyToy-Style)...`);
    loadSettings();
    createWindowDOM();
    createFloatingActionBubble();

    // Listen for SillyTavern AI generation events
    try {
      if (window.eventSource && window.event_types) {
        window.eventSource.on(window.event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => {
          if (fabEl) fabEl.classList.add("ai-active");
        });
        window.eventSource.on(window.event_types.CHARACTER_MESSAGE_RENDERED, () => {
          if (fabEl) fabEl.classList.remove("ai-active");
        });
      }
    } catch (_e) {}

    console.log(`[${EXT_ID}] Kirby Fishing Extension loaded successfully.`);
  }

  // Support both SillyTavern jQuery and native DOM ready
  if ($ && typeof $(document).ready === "function") {
    $(document).ready(init);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})(window.jQuery);
