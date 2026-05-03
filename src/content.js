(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STORAGE_KEY = "ccoFullCoordinatesEnabled";
  const BOARD_ACTIVE_CLASS = "cco-board-has-full-coordinates";
  const OVERLAY_CLASS = "cco-full-coordinate-overlay";
  const SETTINGS_ROW_CLASS = "cco-settings-toggle-row";
  const SWITCH_REFERENCE_LABELS = [
    "enable special themes",
    "highlight moves",
    "play sounds",
    "show legal moves",
    "showcase opponent theme",
  ];
  const BOARD_SELECTORS = [
    ".board-layout-chessboard > #board",
    ".board-layout-chessboard > #board-secondary",
    ".board-layout-chessboard > .board",
    ".board-layout-chessboard > wc-chess-board",
    "wc-chess-board.board",
    "#board.board",
  ].join(",");
  const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const trackedBoards = new Map();
  const trackedSettingsRows = new Set();
  let fullCoordinatesEnabled = readStoredEnabled();

  class BoardOverlay {
    constructor(board) {
      this.board = board;
      this.host = board.parentElement;
      this.flipped = null;
      this.colorSignature = "";
      this.updateQueued = false;
      this.shadowRoot = null;
      this.shadowObserver = null;
      this.hiddenNativeCoordinates = new WeakMap();

      this.overlay = document.createElement("div");
      this.overlay.className = OVERLAY_CLASS;
      this.overlay.setAttribute("aria-hidden", "true");
      this.overlay.style.position = "absolute";
      this.overlay.style.inset = "0";
      this.overlay.style.width = "100%";
      this.overlay.style.height = "100%";
      this.overlay.style.overflow = "hidden";
      this.overlay.style.pointerEvents = "none";
      this.overlay.style.userSelect = "none";

      this.svg = document.createElementNS(SVG_NS, "svg");
      this.svg.setAttribute("viewBox", "0 0 100 100");
      this.svg.setAttribute("aria-hidden", "true");
      this.svg.setAttribute("focusable", "false");
      this.svg.style.display = "block";
      this.svg.style.width = "100%";
      this.svg.style.height = "100%";
      this.svg.style.pointerEvents = "none";
      this.overlay.append(this.svg);

      this.board.classList.add(BOARD_ACTIVE_CLASS);
      this.mountOverlay();

      this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
      this.resizeObserver.observe(this.board);
      this.resizeObserver.observe(this.host);

      this.boardObserver = new MutationObserver(() => this.scheduleUpdate());
      this.boardObserver.observe(this.board, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });

      this.hostObserver = new MutationObserver(() => this.scheduleUpdate());
      this.hostObserver.observe(this.host, {
        attributes: true,
        childList: true,
      });

      this.handleViewportChange = () => this.scheduleUpdate();
      window.addEventListener("resize", this.handleViewportChange, true);
      window.addEventListener(
        "orientationchange",
        this.handleViewportChange,
        true,
      );

      this.observeShadowRoot();
      this.update();
    }

    disconnect() {
      this.resizeObserver.disconnect();
      this.boardObserver.disconnect();
      this.hostObserver.disconnect();
      this.shadowObserver?.disconnect();
      window.removeEventListener("resize", this.handleViewportChange, true);
      window.removeEventListener(
        "orientationchange",
        this.handleViewportChange,
        true,
      );
      this.restoreNativeCoordinates();
      this.overlay.remove();
      this.board.classList.remove(BOARD_ACTIVE_CLASS);
    }

    scheduleUpdate() {
      if (this.updateQueued) {
        return;
      }

      this.updateQueued = true;
      queueMicrotask(() => {
        this.updateQueued = false;
        this.update();
      });
    }

    update() {
      if (!document.documentElement.contains(this.board)) {
        this.disconnect();
        trackedBoards.delete(this.board);
        return;
      }

      this.observeShadowRoot();
      this.mountOverlay();
      this.hideNativeCoordinates();

      const nextFlipped = isBoardFlipped(this.board);
      const nextColorSignature = getColorSignature(this.board);

      if (
        nextFlipped !== this.flipped ||
        nextColorSignature !== this.colorSignature ||
        this.svg.childElementCount !== 64
      ) {
        this.flipped = nextFlipped;
        this.colorSignature = nextColorSignature;
        this.renderLabels(nextFlipped);
      }
    }

    observeShadowRoot() {
      if (!this.board.shadowRoot || this.board.shadowRoot === this.shadowRoot) {
        return;
      }

      this.shadowObserver?.disconnect();
      this.shadowRoot = this.board.shadowRoot;
      this.shadowObserver = new MutationObserver(() => this.scheduleUpdate());
      this.shadowObserver.observe(this.shadowRoot, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    mountOverlay() {
      if (this.overlay.parentNode === this.board && this.board.firstChild === this.overlay) {
        return;
      }

      this.board.prepend(this.overlay);
    }

    hideNativeCoordinates() {
      findNativeCoordinateElements(this.board).forEach((coordinates) => {
        if (!this.hiddenNativeCoordinates.has(coordinates)) {
          this.hiddenNativeCoordinates.set(
            coordinates,
            coordinates.style.getPropertyValue("display"),
          );
        }

        coordinates.style.setProperty("display", "none", "important");
      });
    }

    restoreNativeCoordinates() {
      findNativeCoordinateElements(this.board).forEach((coordinates) => {
        if (!this.hiddenNativeCoordinates.has(coordinates)) {
          return;
        }

        coordinates.style.setProperty(
          "display",
          this.hiddenNativeCoordinates.get(coordinates),
        );
      });
    }

    renderLabels(flipped) {
      const colors = getCoordinateColors(this.board);
      const fragment = document.createDocumentFragment();

      this.svg.replaceChildren();

      for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) {
          const file = flipped ? FILES[7 - col] : FILES[col];
          const rank = flipped ? row + 1 : 8 - row;
          const text = document.createElementNS(SVG_NS, "text");
          const color =
            (row + col) % 2 === 0
              ? colors.lightSquareText
              : colors.darkSquareText;

          text.textContent = `${file}${rank}`;
          text.setAttribute("x", String(col * 12.5 + 0.75));
          text.setAttribute("y", String(row * 12.5 + 3.5));
          text.setAttribute("fill", color);
          fragment.append(text);
        }
      }

      this.svg.append(fragment);
    }
  }

  function scanForBoards() {
    scanForSettingsToggle();

    if (!fullCoordinatesEnabled) {
      trackedBoards.forEach((overlay, board) => {
        overlay.disconnect();
        trackedBoards.delete(board);
      });
      return;
    }

    document.querySelectorAll(BOARD_SELECTORS).forEach((board) => {
      if (isUsableBoard(board) && !trackedBoards.has(board)) {
        trackedBoards.set(board, new BoardOverlay(board));
      }
    });

    trackedBoards.forEach((overlay, board) => {
      if (!document.documentElement.contains(board)) {
        overlay.disconnect();
        trackedBoards.delete(board);
      }
    });
  }

  function scanForSettingsToggle() {
    if (!document.body) {
      return;
    }

    findCoordinatesSettingRows().forEach((coordinatesRow) => {
      const container = coordinatesRow.parentElement;
      if (
        !container ||
        container.querySelector(`:scope > .${SETTINGS_ROW_CLASS}`)
      ) {
        return;
      }

      const settingsRow = createSettingsToggleRow(coordinatesRow);
      coordinatesRow.after(settingsRow);
      trackedSettingsRows.add(settingsRow);
    });

    trackedSettingsRows.forEach((row) => {
      if (!document.documentElement.contains(row)) {
        trackedSettingsRows.delete(row);
      }
    });

    syncSettingsToggles();
  }

  function findCoordinatesSettingRows() {
    const rows = new Set();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return isCoordinatesSettingLabel(node.nodeValue)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );

    let textNode = walker.nextNode();
    while (textNode) {
      const row = findSettingsRowFromLabel(textNode.parentElement);
      if (row) {
        rows.add(row);
      }

      textNode = walker.nextNode();
    }

    return rows;
  }

  function isCoordinatesSettingLabel(value) {
    const text = normalizeText(value).toLowerCase();
    return text === "coordinates" || text === "show board coordinates";
  }

  function findSettingsRowFromLabel(labelElement) {
    let current = labelElement;

    for (let depth = 0; current && depth < 6; depth += 1) {
      if (
        current.classList?.contains(SETTINGS_ROW_CLASS) ||
        !isVisibleElement(current)
      ) {
        current = current.parentElement;
        continue;
      }

      const text = normalizeText(current.textContent);
      const lowerText = text.toLowerCase();
      const hasSettingControl = current.querySelector(
        'button, select, [role="button"], [aria-haspopup], [class*="select"], [class*="dropdown"]',
      );

      if (
        hasCoordinatesSettingLabel(lowerText) &&
        hasSettingControl &&
        text.length < 140 &&
        isInsideBoardSettingsDialog(current)
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function hasCoordinatesSettingLabel(lowerText) {
    return (
      lowerText.includes("show board coordinates") ||
      lowerText.includes("coordinates")
    );
  }

  function isInsideBoardSettingsDialog(element) {
    let current = element.parentElement;

    for (let depth = 0; current && depth < 10; depth += 1) {
      const text = normalizeText(current.textContent).toLowerCase();

      if (
        text.includes("board") &&
        (text.includes("show board coordinates") ||
          text.includes("coordinates")) &&
        (text.includes("pieces") ||
          text.includes("piece notation") ||
          text.includes("settings"))
      ) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function createSettingsToggleRow(referenceRow) {
    const templateRow = findSwitchTemplateRow(referenceRow) || referenceRow;
    const row = templateRow.cloneNode(true);
    row.classList.add(SETTINGS_ROW_CLASS);
    clearClonedAttributes(row);
    replaceSettingLabel(row);

    const toggle = createSettingsSwitch(referenceRow);
    replaceSettingControl(row, toggle);

    syncSettingsToggleRow(row);
    return row;
  }

  function findSwitchTemplateRow(referenceRow) {
    const container = referenceRow.parentElement;
    if (!container) {
      return null;
    }

    const siblings = Array.from(container.children).filter(
      (element) =>
        element !== referenceRow &&
        element instanceof Element &&
        !element.classList.contains(SETTINGS_ROW_CLASS) &&
        isVisibleElement(element),
    );

    for (const label of SWITCH_REFERENCE_LABELS) {
      const row = siblings.find((element) =>
        normalizeText(element.textContent).toLowerCase().includes(label),
      );

      if (row) {
        return row;
      }
    }

    return null;
  }

  function clearClonedAttributes(row) {
    clearElementIds(row);
  }

  function clearElementIds(element) {
    element.removeAttribute("id");
    element.querySelectorAll("[id]").forEach((child) => {
      child.removeAttribute("id");
    });
  }

  function replaceSettingLabel(row) {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isTemplateSettingLabel(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const textNode = walker.nextNode();

    if (textNode) {
      textNode.nodeValue = "Full Coordinates";
      textNode.parentElement?.classList.add("cco-settings-toggle-label");
      return;
    }

    const label = document.createElement("div");
    label.className = "cco-settings-toggle-label";
    label.textContent = "Full Coordinates";
    row.prepend(label);
  }

  function isTemplateSettingLabel(value) {
    const text = normalizeText(value).toLowerCase();
    return (
      isCoordinatesSettingLabel(value) ||
      SWITCH_REFERENCE_LABELS.includes(text)
    );
  }

  function replaceSettingControl(row, toggle) {
    const directControlContainer = Array.from(row.children).findLast((child) => {
      const text = normalizeText(child.textContent).toLowerCase();
      return !text.includes("full coordinates") && hasControlCandidate(child);
    });

    if (directControlContainer) {
      const nestedControl = findNestedSettingControl(directControlContainer);
      if (nestedControl) {
        nestedControl.replaceWith(toggle);
        return;
      }

      directControlContainer.replaceWith(toggle);
      return;
    }

    const existingControl = findSettingControl(row);
    if (existingControl) {
      existingControl.replaceWith(toggle);
      return;
    }

    row.append(toggle);
  }

  function findNestedSettingControl(container) {
    const controls = Array.from(
      container.querySelectorAll(controlCandidateSelector()),
    ).filter(
      (element) =>
        !element.closest(".cco-settings-toggle-label") &&
        !element.closest(`.${SETTINGS_ROW_CLASS} .cco-settings-switch`),
    );

    if (controls.length === 0) {
      return null;
    }

    return findTopLevelControl(controls).at(-1) || controls.at(-1);
  }

  function findSettingControl(row) {
    const controls = Array.from(
      row.querySelectorAll(controlCandidateSelector()),
    ).filter(
      (element) =>
        !element.closest(".cco-settings-toggle-label") &&
        !element.closest(`.${SETTINGS_ROW_CLASS} .cco-settings-switch`),
    );

    return findTopLevelControl(controls).at(-1) || controls[0] || null;
  }

  function findTopLevelControl(controls) {
    return controls.filter((element) => {
      const parentControl = element.parentElement?.closest(
        controlCandidateSelector(),
      );
      return !parentControl || !controls.includes(parentControl);
    });
  }

  function hasControlCandidate(element) {
    return (
      element.matches(controlCandidateSelector()) ||
      Boolean(element.querySelector(controlCandidateSelector()))
    );
  }

  function controlCandidateSelector() {
    return 'button, select, input, [role="button"], [role="switch"], [aria-haspopup], [class*="select"], [class*="dropdown"]';
  }

  function createSettingsSwitch(referenceRow) {
    const nativeSnapshots = findNativeSwitchSnapshots(referenceRow);
    if (nativeSnapshots) {
      const toggle = nativeSnapshots[
        fullCoordinatesEnabled ? "on" : "off"
      ].cloneNode(true);
      prepareNativeSettingsSwitch(toggle, nativeSnapshots);
      return toggle;
    }

    return createFallbackSettingsSwitch();
  }

  function findNativeSwitchSnapshots(referenceRow) {
    const container = referenceRow.parentElement;
    if (!container) {
      return null;
    }

    const snapshots = {
      off: null,
      on: null,
    };

    Array.from(container.children).forEach((row) => {
      if (
        row === referenceRow ||
        !(row instanceof Element) ||
        row.classList.contains(SETTINGS_ROW_CLASS)
      ) {
        return;
      }

      const switchControl = findNativeSwitchControl(row);
      if (!switchControl) {
        return;
      }

      const labelText = normalizeText(row.textContent).toLowerCase();
      const switchState = readNativeSwitchState(switchControl);

      if (switchState === true && !snapshots.on) {
        snapshots.on = switchControl.cloneNode(true);
      }

      if (switchState === false && !snapshots.off) {
        snapshots.off = switchControl.cloneNode(true);
      }

      if (labelText.includes("enable special themes") && !snapshots.on) {
        snapshots.on = switchControl.cloneNode(true);
      }

      if (labelText.includes("showcase opponent theme") && !snapshots.off) {
        snapshots.off = switchControl.cloneNode(true);
      }
    });

    return snapshots.on && snapshots.off ? snapshots : null;
  }

  function findNativeSwitchControl(row) {
    const controls = Array.from(
      row.querySelectorAll(
        'button[role="switch"], [role="switch"], input[type="checkbox"], button[aria-checked], button',
      ),
    );
    const likelySwitch = controls.findLast(isLikelyNativeSwitchControl);

    return likelySwitch || null;
  }

  function isLikelyNativeSwitchControl(element) {
    if (!isVisibleElement(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.width >= 20 &&
      rect.width <= 140 &&
      rect.height >= 15 &&
      rect.height <= 80 &&
      normalizeText(element.textContent).length < 24
    );
  }

  function readNativeSwitchState(control) {
    const ariaChecked = control.getAttribute("aria-checked");
    if (ariaChecked === "true") {
      return true;
    }
    if (ariaChecked === "false") {
      return false;
    }

    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      return control.checked;
    }

    const nodes = [control, ...control.querySelectorAll("*")];
    let sawInactiveTrack = false;

    for (const node of nodes) {
      if (!(node instanceof Element) || !isVisibleElement(node)) {
        continue;
      }

      const color = parseRgbColor(getComputedStyle(node).backgroundColor);
      if (!color || color.alpha < 0.1) {
        continue;
      }

      if (color.green > color.red + 20 && color.green > color.blue + 20) {
        return true;
      }

      if (color.red < 190 && color.green < 190 && color.blue < 190) {
        sawInactiveTrack = true;
      }
    }

    return sawInactiveTrack ? false : null;
  }

  function parseRgbColor(value) {
    const match = String(value).match(
      /rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?\)/,
    );
    if (!match) {
      return null;
    }

    return {
      alpha: match[4] === undefined ? 1 : Number(match[4]),
      blue: Number(match[3]),
      green: Number(match[2]),
      red: Number(match[1]),
    };
  }

  function prepareNativeSettingsSwitch(toggle, snapshots) {
    clearElementIds(toggle);
    toggle.ccoSwitchSnapshots = snapshots;
    toggle.classList.add("cco-settings-switch", "cco-settings-switch-native");
    toggle.setAttribute("role", "switch");

    if (toggle instanceof HTMLButtonElement) {
      toggle.type = "button";
    } else {
      toggle.setAttribute("tabindex", "0");
    }

    toggle.addEventListener("click", handleSettingsSwitchClick, true);
    toggle.addEventListener("keydown", handleSettingsSwitchKeydown, true);
  }

  function createFallbackSettingsSwitch() {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cco-settings-switch cco-settings-switch-fallback";
    toggle.setAttribute("role", "switch");
    toggle.append(document.createElement("span"));
    toggle.addEventListener("click", handleSettingsSwitchClick, true);
    toggle.addEventListener("keydown", handleSettingsSwitchKeydown, true);
    return toggle;
  }

  function handleSettingsSwitchClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setFullCoordinatesEnabled(!fullCoordinatesEnabled);
  }

  function handleSettingsSwitchKeydown(event) {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    setFullCoordinatesEnabled(!fullCoordinatesEnabled);
  }

  function syncSettingsToggles() {
    trackedSettingsRows.forEach(syncSettingsToggleRow);
  }

  function syncSettingsToggleRow(row) {
    const toggle = row.querySelector(".cco-settings-switch");
    if (!toggle) {
      return;
    }

    row.classList.toggle(
      "cco-settings-toggle-row-enabled",
      fullCoordinatesEnabled,
    );
    const isNativeSwitch = applyNativeSwitchState(
      toggle,
      fullCoordinatesEnabled,
    );
    toggle.classList.toggle(
      "cco-settings-switch-enabled",
      !isNativeSwitch && fullCoordinatesEnabled,
    );
    toggle.setAttribute("aria-checked", String(fullCoordinatesEnabled));
    toggle.setAttribute(
      "aria-label",
      fullCoordinatesEnabled
        ? "Turn off full board coordinates"
        : "Turn on full board coordinates",
    );
  }

  function applyNativeSwitchState(toggle, enabled) {
    if (!toggle.ccoSwitchSnapshots) {
      return false;
    }

    const snapshot = toggle.ccoSwitchSnapshots[enabled ? "on" : "off"];
    if (!(snapshot instanceof Element)) {
      return false;
    }

    copyElementState(toggle, snapshot, true);
    toggle.classList.add("cco-settings-switch", "cco-settings-switch-native");
    toggle.setAttribute("role", "switch");

    if (toggle instanceof HTMLButtonElement) {
      toggle.type = "button";
    } else {
      toggle.setAttribute("tabindex", "0");
    }

    return true;
  }

  function copyElementState(target, source, isRoot = false) {
    const preservedAttributes = new Set(
      isRoot ? ["aria-label", "aria-checked"] : [],
    );

    Array.from(target.attributes).forEach((attribute) => {
      if (!preservedAttributes.has(attribute.name)) {
        target.removeAttribute(attribute.name);
      }
    });

    Array.from(source.attributes).forEach((attribute) => {
      if (attribute.name !== "id" && !preservedAttributes.has(attribute.name)) {
        target.setAttribute(attribute.name, attribute.value);
      }
    });

    const targetChildren = Array.from(target.children);
    const sourceChildren = Array.from(source.children);

    if (targetChildren.length !== sourceChildren.length) {
      target.replaceChildren(
        ...sourceChildren.map((child) => child.cloneNode(true)),
      );
      clearElementIds(target);
      return;
    }

    sourceChildren.forEach((sourceChild, index) => {
      copyElementState(targetChildren[index], sourceChild);
    });
  }

  function setFullCoordinatesEnabled(enabled) {
    fullCoordinatesEnabled = enabled;
    writeStoredEnabled(enabled);
    syncSettingsToggles();

    if (!enabled) {
      trackedBoards.forEach((overlay, board) => {
        overlay.disconnect();
        trackedBoards.delete(board);
      });
      return;
    }

    scanForBoards();
  }

  function readStoredEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "false";
    } catch (error) {
      return true;
    }
  }

  function writeStoredEnabled(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch (error) {
      // Ignore storage failures; the in-memory toggle still works.
    }
  }

  function isUsableBoard(board) {
    return (
      board instanceof Element &&
      board.parentElement instanceof Element &&
      !board.classList.contains(OVERLAY_CLASS) &&
      board.closest(".board-layout-chessboard")
    );
  }

  function isBoardFlipped(board) {
    const nativeOrientation = readNativeCoordinateOrientation(board);
    if (nativeOrientation !== null) {
      return nativeOrientation;
    }

    const explicitOrientation = readExplicitOrientation(board);
    if (explicitOrientation !== null) {
      return explicitOrientation;
    }

    return hasRotatedTransform(board);
  }

  function readNativeCoordinateOrientation(board) {
    const coordinates = findNativeCoordinates(board);
    if (!coordinates) {
      return null;
    }

    const labels = Array.from(coordinates.querySelectorAll("text"), (text) =>
      text.textContent.trim().toLowerCase(),
    );
    const ranks = labels.filter((label) => /^[1-8]$/.test(label));
    const files = labels.filter((label) => /^[a-h]$/.test(label));

    if (ranks[0] === "1" || files[0] === "h") {
      return true;
    }

    if (ranks[0] === "8" || files[0] === "a") {
      return false;
    }

    return null;
  }

  function findNativeCoordinates(board) {
    return findNativeCoordinateElements(board)[0] || null;
  }

  function findNativeCoordinateElements(board) {
    const coordinates = Array.from(board.querySelectorAll("svg.coordinates"));
    if (board.shadowRoot) {
      coordinates.push(...board.shadowRoot.querySelectorAll("svg.coordinates"));
    }

    return coordinates;
  }

  function getColorSignature(board) {
    const colors = getCoordinateColors(board);
    return `${colors.lightSquareText}|${colors.darkSquareText}`;
  }

  function getCoordinateColors(board) {
    const styles = getComputedStyle(board);

    return {
      lightSquareText: readCssColor(
        styles,
        "--theme-board-style-coordinate-color-dark",
        "--fallback-theme-board-style-coordinate-color-dark",
        "#739552",
      ),
      darkSquareText: readCssColor(
        styles,
        "--theme-board-style-coordinate-color-light",
        "--fallback-theme-board-style-coordinate-color-light",
        "#ebecd0",
      ),
    };
  }

  function readCssColor(styles, themeName, fallbackName, fallbackColor) {
    return (
      styles.getPropertyValue(themeName).trim() ||
      styles.getPropertyValue(fallbackName).trim() ||
      fallbackColor
    );
  }

  function readExplicitOrientation(board) {
    const candidates = [
      board,
      board.parentElement,
      board.closest(".board-layout-main"),
      document.body,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const value = readOrientationValue(candidate);
      if (value !== null) {
        return value;
      }
    }

    return null;
  }

  function readOrientationValue(element) {
    const attributeNames = [
      "orientation",
      "data-orientation",
      "data-perspective",
      "data-board-orientation",
      "data-board-flipped",
      "data-flipped",
      "data-player-color",
      "data-color",
    ];

    for (const attributeName of attributeNames) {
      const value = element.getAttribute(attributeName);
      if (!value) {
        continue;
      }

      const normalized = value.trim().toLowerCase();
      if (["black", "flipped", "true"].includes(normalized)) {
        return true;
      }
      if (["white", "normal", "false"].includes(normalized)) {
        return false;
      }
    }

    const className = String(element.className || "").toLowerCase();
    if (
      /(^|[\s_-])(flipped|board-flipped|flipped-board|orientation-black|black-perspective|playing-black|player-black|as-black)([\s_-]|$)/.test(
        className,
      )
    ) {
      return true;
    }

    if (
      /(^|[\s_-])(orientation-white|white-perspective|playing-white|player-white|as-white)([\s_-]|$)/.test(
        className,
      )
    ) {
      return false;
    }

    return null;
  }

  function hasRotatedTransform(board) {
    const transform = getComputedStyle(board).transform;
    if (!transform || transform === "none") {
      return false;
    }

    const values = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
    if (!values) {
      return false;
    }

    const parts = values[1].split(",").map((part) => Number(part.trim()));
    if (parts.length === 6) {
      return parts[0] < -0.9 && parts[3] < -0.9;
    }

    if (parts.length === 16) {
      return parts[0] < -0.9 && parts[5] < -0.9;
    }

    return false;
  }

  const pageObserver = new MutationObserver(() => scanForBoards());
  let hasStarted = false;

  function start() {
    if (hasStarted || !document.documentElement) {
      return;
    }

    hasStarted = true;
    pageObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "aria-hidden",
        "aria-selected",
        "class",
        "hidden",
        "style",
      ],
      childList: true,
      subtree: true,
    });
    scanForBoards();
  }

  start();
  document.addEventListener("DOMContentLoaded", start, { once: true });
})();
