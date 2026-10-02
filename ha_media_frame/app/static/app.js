(function () {
  "use strict";

  const slots = Array.from(document.querySelectorAll(".media-slot"));
  const preloadBin = document.getElementById("preload-bin");
  const emptyState = document.getElementById("empty-state");
  const status = document.getElementById("status");
  const clockPanel = document.getElementById("clock-panel");
  const weatherPanel = document.getElementById("weather-panel");
  const forecastList = document.getElementById("forecast-list");
  const HISTORY_KEY = "haMediaFrameHistoryV1";
  const HISTORY_LIMIT = 20;
  const PLAYLIST_ORDER_KEY = "haMediaFramePlaylistOrderV1";
  let playlistOrder = null;
  const requestedFit = new URLSearchParams(window.location.search).get("fit");
  const fitOverride = requestedFit === "contain" || requestedFit === "cover" ? requestedFit : "";

  const state = {
    config: null,
    playlist: [],
    cursor: -1,
    currentItem: null,
    activeSlot: 0,
    timer: 0,
    generation: 0,
    controlsTimer: 0,
    playlistSignature: "",
    preload: null,
    preloadToken: 0,
    advancing: false,
    history: [],
    historyIndex: -1,
    navigationToken: 0,
  };

  async function getJson(url, options) {
    const response = await fetch(url, Object.assign({ cache: "no-store" }, options || {}));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function setStatus(message, autoHide) {
    status.textContent = message || "";
    status.hidden = !message;
    if (message && autoHide) window.setTimeout(() => {
      if (status.textContent === message) status.hidden = true;
    }, autoHide);
  }

  function shuffle(items) {
    const byUrl = new Map(items.map((item) => [item.url, item]));
    if (playlistOrder === null) {
      try {
        const saved = JSON.parse(window.localStorage.getItem(PLAYLIST_ORDER_KEY));
        playlistOrder = Array.isArray(saved) && saved.every((url) => typeof url === "string")
          ? saved
          : [];
      } catch {
        playlistOrder = [];
      }
    }

    const known = new Set(playlistOrder);
    const hasNewFiles = items.some((item) => !known.has(item.url));
    if (playlistOrder.length && !hasNewFiles) {
      // File metadata changes keep the established order; removed files are omitted.
      playlistOrder = playlistOrder.filter((url) => byUrl.has(url));
    } else {
      // Newest three, oldest three, then move inward three at a time.
      const sorted = items.slice().sort((a, b) => {
        const difference = Number(b.modified) - Number(a.modified);
        if (difference) return difference;
        const left = a.url.toLowerCase();
        const right = b.url.toLowerCase();
        return left < right ? -1 : left > right ? 1 : a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
      });
      playlistOrder = [];
      let newest = 0;
      let oldest = sorted.length - 1;
      while (newest <= oldest) {
        for (let count = 0; count < 3 && newest <= oldest; count += 1) {
          playlistOrder.push(sorted[newest++].url);
        }
        for (let count = 0; count < 3 && newest <= oldest; count += 1) {
          playlistOrder.push(sorted[oldest--].url);
        }
      }
    }

    try {
      window.localStorage.setItem(PLAYLIST_ORDER_KEY, JSON.stringify(playlistOrder));
    } catch {
      // Keep the order in memory if browser storage is unavailable.
    }
    return playlistOrder.map((url) => byUrl.get(url));
  }

  function updateClock() {
    const now = new Date();
    const timeParts = new Intl.DateTimeFormat(undefined, {
      hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(now);
    const hour = timeParts.find((part) => part.type === "hour")?.value || "";
    const minute = timeParts.find((part) => part.type === "minute")?.value || "";
    const period = timeParts.find((part) => part.type === "dayPeriod")?.value || "";
    document.getElementById("clock-time").textContent = `${hour}:${minute}`;
    document.getElementById("clock-period").textContent = period;
    document.getElementById("clock-weekday").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now) + ",";
    document.getElementById("clock-date").textContent = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(now);
  }

  function conditionIcon(condition) {
    const value = String(condition || "").toLowerCase();
    if (value.includes("lightning")) return "ϟ";
    if (value.includes("snow") || value.includes("hail")) return "❄︎";
    if (value.includes("rain") || value.includes("pour")) return "☂︎";
    if (value.includes("fog")) return "≋";
    if (value.includes("cloud")) return "☁︎";
    if (value.includes("wind")) return "≋";
    if (value.includes("sun") || value.includes("clear")) return "☀︎";
    return "◌";
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : "–";
  }

  function bearing(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value || "";
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return directions[Math.round(numeric / 45) % 8];
  }

  function renderWeather(payload) {
    const weather = payload && payload.weather;
    if (!weather || !weather.enabled || !weather.current) {
      weatherPanel.hidden = true;
      return;
    }
    const current = weather.current;
    const unit = current.temperature_unit || "°";
    document.getElementById("weather-temperature").textContent = `${number(current.temperature)}${unit}`;
    document.getElementById("weather-icon").textContent = conditionIcon(current.condition);

    const details = [];
    if (current.wind_speed !== null && current.wind_speed !== undefined) {
      details.push(`${number(current.wind_speed)} ${current.wind_speed_unit || ""} ${bearing(current.wind_bearing)}`.trim());
    }
    if (current.humidity !== null && current.humidity !== undefined) details.push(`${number(current.humidity)}% RH`);
    document.getElementById("weather-detail").textContent = details.join("  ·  ");

    forecastList.replaceChildren();
    (weather.forecast || []).slice(0, 4).forEach((day, index) => {
      const row = document.createElement("div");
      row.className = "forecast-row";
      const date = day.datetime ? new Date(day.datetime) : new Date(Date.now() + index * 86400000);
      const label = index === 0 ? "TODAY" : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).toUpperCase();
      const rain = day.precipitation_probability === null || day.precipitation_probability === undefined
        ? ""
        : `${number(day.precipitation_probability)}%`;
      row.innerHTML = `<span>${label}</span><span class="condition">${conditionIcon(day.condition)}</span><span class="rain">${rain}</span><span class="temperatures">${number(day.temperature)}<br>${number(day.templow)}</span>`;
      forecastList.appendChild(row);
    });
    weatherPanel.hidden = false;
  }

  async function refreshWeather() {
    if (!state.config || !state.config.show_weather || !state.config.weather_entity) {
      weatherPanel.hidden = true;
      return;
    }
    try {
      renderWeather(await getJson("/api/weather"));
    } catch {
      weatherPanel.hidden = true;
    }
  }

  function forceMute(video) {
    video.defaultMuted = true;
    video.muted = true;
    video.volume = 0;
  }

  function mediaFit() {
    if (fitOverride) return fitOverride;
    return state.config && state.config.fit === "cover" ? "cover" : "contain";
  }

  function applyFitToNode(node) {
    if (!node || (node.tagName !== "IMG" && node.tagName !== "VIDEO")) return;
    const fit = mediaFit();
    const mediaWidth = node.tagName === "IMG" ? node.naturalWidth : node.videoWidth;
    const mediaHeight = node.tagName === "IMG" ? node.naturalHeight : node.videoHeight;
    const slot = node.closest(".media-slot");
    const slotRect = slot ? slot.getBoundingClientRect() : null;
    const stageWidth = Math.max(1, slotRect && slotRect.width
      ? slotRect.width
      : document.documentElement.clientWidth || window.innerWidth);
    const stageHeight = Math.max(1, slotRect && slotRect.height
      ? slotRect.height
      : document.documentElement.clientHeight || window.innerHeight);

    node.style.objectFit = fit;
    node.style.objectPosition = "center center";
    node.style.position = "absolute";
    node.style.left = "50%";
    node.style.top = "50%";
    node.style.transform = "translate(-50%, -50%)";
    node.style.maxWidth = "none";
    node.style.maxHeight = "none";
    node.style.margin = "0";

    if (mediaWidth > 0 && mediaHeight > 0) {
      // Calculate the rendered rectangle ourselves. This avoids object-fit bugs
      // and overrides in Android WebViews while preserving every source pixel.
      const scale = fit === "cover"
        ? Math.max(stageWidth / mediaWidth, stageHeight / mediaHeight)
        : Math.min(stageWidth / mediaWidth, stageHeight / mediaHeight);
      node.style.width = `${mediaWidth * scale}px`;
      node.style.height = `${mediaHeight * scale}px`;
    } else {
      // Metadata should already be available after preload, but retain a safe
      // standards-based fallback for a slow or unusual decoder.
      node.style.width = "100%";
      node.style.height = "100%";
    }
  }

  function applyDisplayConfig() {
    const fit = mediaFit();
    document.documentElement.style.setProperty("--fade", `${state.config.transition_seconds}s`);
    slots.forEach((slot) => {
      slot.classList.toggle("fit-contain", fit === "contain");
      slot.classList.toggle("fit-cover", fit === "cover");
      Array.from(slot.children).forEach(applyFitToNode);
    });
    clockPanel.hidden = !state.config.show_clock;
  }

  async function refreshConfig() {
    try {
      const previous = state.config;
      state.config = (await getJson("/api/config")).settings;
      applyDisplayConfig();
      if (!previous
          || previous.show_weather !== state.config.show_weather
          || previous.weather_entity !== state.config.weather_entity) {
        refreshWeather();
      }
    } catch {
      // Keep the current playback and settings during a temporary API failure.
    }
  }

  function stopMediaNode(node) {
    if (!node) return;
    if (node.tagName === "VIDEO") {
      node.pause();
      node.removeAttribute("src");
      node.load();
    } else if (node.tagName === "IMG") {
      node.removeAttribute("src");
    }
    node.remove();
  }

  function stopOldSlot(slotIndex) {
    Array.from(slots[slotIndex].children).forEach(stopMediaNode);
    slots[slotIndex].replaceChildren();
  }

  function discardPreload() {
    const preload = state.preload;
    state.preload = null;
    state.preloadToken += 1;
    if (!preload) return;
    preload.cancelled = true;
    window.clearTimeout(preload.timeout);
    if (!preload.settled) {
      preload.settled = true;
      preload.reject(new Error("Preload cancelled"));
    }
    stopMediaNode(preload.node);
    preloadBin.replaceChildren();
  }

  function createPreload(item, index) {
    const token = ++state.preloadToken;
    let resolveReady;
    let rejectReady;
    const preload = {
      item,
      index,
      token,
      node: null,
      timeout: 0,
      cancelled: false,
      settled: false,
      status: "loading",
      resolve: null,
      reject: null,
      ready: new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      }),
    };
    preload.resolve = resolveReady;
    preload.reject = rejectReady;

    const fail = (message) => {
      if (preload.settled || preload.cancelled || token !== state.preloadToken) return;
      preload.settled = true;
      preload.status = "failed";
      window.clearTimeout(preload.timeout);
      rejectReady(new Error(message));
    };

    const ready = async () => {
      if (preload.settled || preload.cancelled || token !== state.preloadToken) return;
      window.clearTimeout(preload.timeout);
      if (preload.node.tagName === "IMG" && typeof preload.node.decode === "function") {
        try {
          await preload.node.decode();
        } catch {
          // A completed load is still usable when an older WebView rejects decode().
        }
      }
      if (preload.settled || preload.cancelled || token !== state.preloadToken) return;
      preload.settled = true;
      preload.status = "ready";
      resolveReady(preload);
    };

    if (item.type === "video") {
      const video = document.createElement("video");
      video.autoplay = false;
      video.playsInline = true;
      video.preload = "auto";
      video.controls = false;
      video.disablePictureInPicture = true;
      video.setAttribute("preload", "auto");
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-hidden", "true");
      forceMute(video);
      video.addEventListener("volumechange", () => forceMute(video));
      video.addEventListener("play", () => forceMute(video));
      video.addEventListener("canplay", ready, { once: true });
      video.addEventListener("error", () => fail("Video could not be buffered"), { once: true });
      preload.node = video;
      preloadBin.replaceChildren(video);
      video.src = `${item.url}?v=${item.modified}`;
      video.load();
    } else {
      const image = new Image();
      image.alt = "";
      image.decoding = "async";
      image.fetchPriority = "high";
      image.draggable = false;
      image.setAttribute("aria-hidden", "true");
      image.addEventListener("load", ready, { once: true });
      image.addEventListener("error", () => fail("Image could not be loaded"), { once: true });
      preload.node = image;
      preloadBin.replaceChildren(image);
      image.src = `${item.url}?v=${item.modified}`;
    }

    preload.timeout = window.setTimeout(() => fail("Media preload timed out"), 90000);
    preload.ready.catch(() => {});
    return preload;
  }

  function saveHistory() {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify({
        items: state.history.map((item) => item.url),
        index: state.historyIndex,
      }));
    } catch {
      // Playback continues if WebView storage is unavailable or full.
    }
  }

  function loadHistory() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(HISTORY_KEY));
      if (!saved || !Array.isArray(saved.items)) return null;
      const offset = Math.max(0, saved.items.length - HISTORY_LIMIT);
      const items = saved.items.slice(offset).filter((url) => typeof url === "string" && url.length < 2048);
      const index = Number.isInteger(saved.index) ? saved.index - offset : items.length - 1;
      return { items, index };
    } catch {
      return null;
    }
  }

  function reconcileHistory(urls, selectedIndex) {
    const byUrl = new Map(state.playlist.map((item) => [item.url, item]));
    const history = [];
    let historyIndex = -1;
    urls.slice(-HISTORY_LIMIT).forEach((url, index) => {
      const item = byUrl.get(url);
      if (!item) return;
      history.push(item);
      if (index <= selectedIndex) historyIndex = history.length - 1;
    });
    state.history = history;
    state.historyIndex = history.length ? Math.max(0, historyIndex) : -1;
  }

  function nextPlaylistIndex() {
    if (!state.playlist.length) return -1;
    return (state.cursor + 1 + state.playlist.length) % state.playlist.length;
  }

  function nextDisplay() {
    if (state.historyIndex < state.history.length - 1) {
      const historyIndex = state.historyIndex + 1;
      const item = state.history[historyIndex];
      return { item, index: state.playlist.findIndex((entry) => entry.url === item.url), historyIndex };
    }
    const index = nextPlaylistIndex();
    return index < 0 ? null : { item: state.playlist[index], index, historyIndex: null };
  }

  function startPreloadingNext() {
    if (!state.playlist.length) return null;
    discardPreload();
    const next = nextDisplay();
    if (!next) return null;
    state.preload = createPreload(next.item, next.index);
    state.preload.historyIndex = next.historyIndex;
    return state.preload;
  }

  function scheduleNext(milliseconds, generation) {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      if (generation === state.generation) advanceToPreloaded();
    }, milliseconds);
  }

  function beginPlayback(node, item, generation) {
    if (item.type === "image") {
      scheduleNext(Number(state.config.photo_seconds) * 1000, generation);
      return;
    }

    const configuredRepeats = Number(state.config.video_repeats);
    const repeatTarget = Number.isFinite(configuredRepeats)
      ? Math.min(100, Math.max(1, Math.floor(configuredRepeats)))
      : 3;
    const configuredDuration = Number(state.config.video_seconds);
    const playLimitMs = Number.isFinite(configuredDuration) && configuredDuration > 0
      ? configuredDuration * 1000
      : 0;
    let iteration = 0;
    let completedPlays = 0;
    let playbackFailed = false;

    const failPlayback = (error) => {
      if (generation !== state.generation) return;
      if (playbackFailed) return;
      playbackFailed = true;
      window.clearTimeout(state.timer);
      node.onended = null;
      if (error && error.name === "NotAllowedError") {
        setStatus("Video autoplay was blocked. Enable Autoplay in Fully Kiosk Web Content Settings.", 8000);
      } else if (node.error && (node.error.code === 3 || node.error.code === 4)) {
        setStatus(`Unsupported video codec or container: ${item.name}`, 8000);
      } else {
        setStatus(`Skipped unsupported or unavailable file: ${item.name}`, 5000);
      }
      scheduleNext(1200, generation);
    };

    const startIteration = () => {
      if (generation !== state.generation || playbackFailed) return;
      iteration += 1;
      const currentIteration = iteration;
      let iterationFinished = false;
      window.clearTimeout(state.timer);
      forceMute(node);
      node.autoplay = true;
      node.setAttribute("autoplay", "");
      node.pause();
      try {
        node.currentTime = 0;
      } catch {
        // Some Android WebViews do not allow seeking until playback begins.
      }

      const finishIteration = () => {
        if (generation !== state.generation
            || playbackFailed
            || iterationFinished
            || currentIteration !== iteration) return;
        iterationFinished = true;
        window.clearTimeout(state.timer);
        completedPlays += 1;
        if (completedPlays >= repeatTarget) {
          node.onended = null;
          node.pause();
          advanceToPreloaded();
          return;
        }
        startIteration();
      };

      node.onended = finishIteration;
      const playback = node.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(failPlayback);
      }
      if (playLimitMs > 0) {
        state.timer = window.setTimeout(finishIteration, playLimitMs);
      }
    };

    node.onerror = failPlayback;
    startIteration();
  }

  function activatePrepared(preload) {
    const targetIndex = state.activeSlot === 0 ? 1 : 0;
    const previousIndex = state.activeSlot;
    const node = preload.node;
    const item = preload.item;
    stopOldSlot(targetIndex);
    node.removeAttribute("aria-hidden");
    slots[targetIndex].replaceChildren(node);
    applyFitToNode(node);

    state.cursor = preload.index;
    state.currentItem = item;
    if (preload.historyIndex !== null && preload.historyIndex !== undefined) {
      state.historyIndex = preload.historyIndex;
    } else {
      // Only media that reached the screen enters history.
      if (state.historyIndex < state.history.length - 1) state.history.length = state.historyIndex + 1;
      state.history.push(item);
      if (state.history.length > HISTORY_LIMIT) state.history.shift();
      state.historyIndex = state.history.length - 1;
    }
    saveHistory();
    state.activeSlot = targetIndex;
    state.generation += 1;
    const generation = state.generation;
    state.advancing = false;

    // Start fetching and decoding the following item before this transition begins.
    startPreloadingNext();
    requestAnimationFrame(() => {
      if (generation !== state.generation) return;
      slots[targetIndex].classList.add("active");
      slots[previousIndex].classList.remove("active");
      beginPlayback(node, item, generation);
      const cleanupDelay = Math.max(150, Number(state.config.transition_seconds || 0) * 1000 + 100);
      window.setTimeout(() => {
        if (state.activeSlot !== previousIndex) stopOldSlot(previousIndex);
      }, cleanupDelay);
    });
  }

  async function advanceToPreloaded() {
    if (state.advancing || !state.playlist.length) return;
    window.clearTimeout(state.timer);
    state.advancing = true;
    const preload = state.preload || startPreloadingNext();
    const navigationToken = state.navigationToken;
    if (!preload) {
      state.advancing = false;
      return;
    }

    try {
      await preload.ready;
    } catch {
      if (navigationToken !== state.navigationToken) return;
      if (state.preload !== preload || preload.cancelled) {
        state.advancing = false;
        return;
      }
      state.preload = null;
      if (preload.historyIndex === null) state.cursor = preload.index;
      else {
        state.history.splice(preload.historyIndex, 1);
        if (!state.currentItem) state.historyIndex = Math.max(-1, preload.historyIndex - 2);
        saveHistory();
      }
      stopMediaNode(preload.node);
      preloadBin.replaceChildren();
      setStatus(`Skipped unsupported or unavailable file: ${preload.item.name}`, 5000);
      state.advancing = false;
      startPreloadingNext();
      state.timer = window.setTimeout(advanceToPreloaded, 1200);
      return;
    }

    if (navigationToken !== state.navigationToken || state.preload !== preload || preload.cancelled) {
      state.advancing = false;
      return;
    }
    state.preload = null;
    activatePrepared(preload);
  }

  async function showPrevious() {
    if (state.historyIndex <= 0 || !state.playlist.length) return;
    window.clearTimeout(state.timer);
    const navigationToken = ++state.navigationToken;
    state.advancing = true;
    discardPreload();
    const historyIndex = state.historyIndex - 1;
    const item = state.history[historyIndex];
    const index = state.playlist.findIndex((entry) => entry.url === item.url);
    const preload = createPreload(item, index);
    preload.historyIndex = historyIndex;
    state.preload = preload;
    try {
      await preload.ready;
    } catch {
      if (navigationToken !== state.navigationToken) return;
      state.preload = null;
      stopMediaNode(preload.node);
      preloadBin.replaceChildren();
      state.advancing = false;
      setStatus(`Previous file is unavailable: ${item.name}`, 5000);
      startPreloadingNext();
      scheduleNext(Number(state.config.photo_seconds) * 1000, state.generation);
      return;
    }
    if (navigationToken !== state.navigationToken || state.preload !== preload) return;
    state.preload = null;
    activatePrepared(preload);
  }

  async function refreshPlaylist(initial) {
    try {
      const result = await getJson("/api/media");
      if (result.error) setStatus(result.error);
      const items = Array.isArray(result.items) ? result.items : [];
      if (!items.length) {
        state.navigationToken += 1;
        state.advancing = false;
        discardPreload();
        window.clearTimeout(state.timer);
        state.playlist = [];
        state.playlistSignature = "";
        emptyState.hidden = false;
        return;
      }
      const signature = items.map((item) => `${item.url}:${item.modified}:${item.size}`).join("|");
      if (!initial && signature === state.playlistSignature) return;

      const currentUrl = state.currentItem && state.currentItem.url;
      emptyState.hidden = true;
      state.playlistSignature = signature;
      state.playlist = state.config.shuffle ? shuffle(items) : items;
      state.cursor = currentUrl
        ? state.playlist.findIndex((item) => item.url === currentUrl)
        : -1;
      const saved = initial ? loadHistory() : null;
      if (saved) reconcileHistory(saved.items, saved.index);
      else if (state.history.length) {
        reconcileHistory(state.history.map((item) => item.url), state.historyIndex);
        saveHistory();
      }
      state.navigationToken += 1;
      state.advancing = false;
      discardPreload();
      if (initial && state.historyIndex >= 0) {
        const item = state.history[state.historyIndex];
        state.preload = createPreload(item, state.playlist.findIndex((entry) => entry.url === item.url));
        state.preload.historyIndex = state.historyIndex;
      } else {
        startPreloadingNext();
      }
      if (initial || !state.currentItem) advanceToPreloaded();
    } catch (error) {
      setStatus(error.message || "Unable to load the media list");
      emptyState.hidden = false;
    }
  }

  function showControls() {
    document.body.classList.remove("idle");
    document.body.classList.add("controls-visible");
    window.clearTimeout(state.controlsTimer);
    state.controlsTimer = window.setTimeout(() => {
      document.body.classList.remove("controls-visible");
      document.body.classList.add("idle");
    }, 3500);
  }

  async function start() {
    updateClock();
    window.setInterval(updateClock, 1000);
    try {
      state.config = (await getJson("/api/config")).settings;
    } catch (error) {
      setStatus(error.message || "Unable to load settings");
      return;
    }
    applyDisplayConfig();
    await Promise.all([refreshPlaylist(true), refreshWeather()]);
    window.setInterval(refreshConfig, 3000);
    window.setInterval(() => refreshPlaylist(false), Number(state.config.scan_seconds) * 1000);
    window.setInterval(refreshWeather, 10 * 60 * 1000);
    document.body.classList.add("idle");
  }

  ["pointermove", "pointerdown", "touchstart", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, showControls, { passive: true });
  });
  let swipeStart = null;
  const mediaStage = document.getElementById("media-stage");
  mediaStage.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) { swipeStart = null; return; }
    swipeStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  mediaStage.addEventListener("touchend", (event) => {
    if (!swipeStart || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - swipeStart.x;
    const dy = event.changedTouches[0].clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0) showPrevious();
    else advanceToPreloaded();
  }, { passive: true });
  mediaStage.addEventListener("touchcancel", () => { swipeStart = null; });
  const resizeMedia = () => {
    if (state.config) window.requestAnimationFrame(applyDisplayConfig);
  };
  window.addEventListener("resize", resizeMedia, { passive: true });
  window.addEventListener("orientationchange", resizeMedia, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeMedia, { passive: true });
  document.addEventListener("visibilitychange", () => {
    const video = slots[state.activeSlot].querySelector("video");
    if (!video) return;
    forceMute(video);
    if (document.hidden) video.pause();
    else video.play().catch(() => {});
  });

  start();
}());
