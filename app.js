const API_ORIGIN = "https://f1tv.formula1.com";
const API = {
  menu: "/2.0/R/ENG/WEB_DASH/ALL/MENU/PRO/2",
  home: "/2.0/R/ENG/WEB_DASH/ALL/PAGE/395/PRO/2",
  video: (id) => `/4.0/R/ENG/WEB_DASH/ALL/CONTENT/VIDEO/${encodeURIComponent(id)}/PRO/2`,
};

const state = {
  menu: [],
  pageTitle: "Home",
  selectedItem: null,
  homeData: null,
  heroContainer: null,
  heroIndex: 0,
  session: null,
  dashPlayer: null,
  pairingTimer: null,
  playerTimer: null,
  timelineTimer: null,
  playerLive: false,
};

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function apiRequest(path) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`F1 TV returned ${response.status}`);
  const data = await response.json();
  if (data.resultCode && data.resultCode !== "OK") throw new Error(data.message || "F1 TV request failed");
  return data.resultObj || data;
}

function getMenuEntries(menuData) {
  return (menuData.containers || [])
    .map((item) => ({
      title: item.metadata?.label || item.translations?.[0]?.label || "",
      uri: item.actions?.[0]?.uri || "",
      href: item.actions?.[0]?.href || "",
    }))
    .filter((item) => item.title && item.uri && item.title !== "Search");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("visible"), 2500);
}

function imageUrl(path, width, height) {
  if (!path) return "";
  const safePath = String(path).replace(/^\/+/, "");
  return `${API_ORIGIN}/image-resizer/image/${safePath}?w=${width}&h=${height}&q=HI&o=L`;
}

function contentList(container) {
  if (!container || typeof container !== "object") return [];
  const result = container.retrieveItems?.resultObj || {};
  const items = result.containers || result.items || [];
  return Array.isArray(items) ? items.filter((item) => item?.metadata) : [];
}

function contentHref(item) {
  return item.actions?.find((action) => action.key === "onClick")?.href || "";
}

function contentImage(item, width = 490, height = 276) {
  const metadata = item.metadata || {};
  const variant = item.platformVariants?.[0] || {};
  return imageUrl(metadata.pictureUrl || variant.pictureUrl, width, height);
}

function contentSubtitle(item) {
  const metadata = item.metadata || {};
  return metadata.shortDescription || metadata.titleBrief || metadata.uiDuration || metadata.contentSubtype || "";
}

function isVideo(item) {
  return item.metadata?.contentType === "VIDEO" || item.metadata?.objectType === "VIDEO";
}

function makeNav() {
  const nav = document.getElementById("primary-nav");
  nav.replaceChildren();
  state.menu.forEach((entry, index) => {
    const button = element("button", `nav-button focusable${index === 0 ? " active" : ""}`, entry.title);
    button.type = "button";
    button.dataset.uri = entry.uri;
    button.dataset.title = entry.title;
    button.addEventListener("click", () => loadPage(entry.uri, entry.title, button));
    nav.append(button);
  });
}

function setActiveNav(activeButton) {
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button === activeButton));
}

function setView(name) {
  const home = document.getElementById("home-view");
  const detail = document.getElementById("detail-view");
  const player = document.getElementById("player-view");
  const error = document.getElementById("error-view");
  home.hidden = name !== "home";
  detail.hidden = name !== "detail";
  player.hidden = name !== "player";
  error.hidden = name !== "error";
  document.getElementById("main-content").scrollTop = 0;
}

function buildHero(container, selectedIndex = 0, focusSlide = false) {
  const host = document.getElementById("hero");
  host.replaceChildren();
  const pageLabel = document.getElementById("page-label");
  const isHomePage = state.pageTitle === "Home";
  pageLabel.hidden = isHomePage;
  pageLabel.textContent = isHomePage ? "" : state.pageTitle;
  if (!container) {
    state.heroContainer = null;
    state.heroIndex = 0;
    host.hidden = true;
    return;
  }
  const items = contentList(container);
  state.heroContainer = container;
  state.heroIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));
  const item = items[state.heroIndex];
  if (!item) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const metadata = item.metadata;
  const eventInfo = metadata.emfAttributes || {};
  const image = contentImage(item, 1700, 900);
  host.style.backgroundImage = image ? `linear-gradient(90deg, rgba(5,6,9,.96) 0%, rgba(5,6,9,.79) 37%, rgba(5,6,9,.15) 100%), linear-gradient(0deg, #090a0e 0%, transparent 45%), url("${image}")` : "";

  const copy = element("div", "hero-copy");
  const badge = element("p", `hero-badge${metadata.contentSubtype === "LIVE" ? " is-live" : ""}`,
    metadata.contentSubtype === "LIVE" ? "LIVE SESSION" : "FEATURED");
  copy.append(badge);
  copy.append(element("p", "hero-grand-prix", eventInfo.Meeting_Name || eventInfo.Global_Meeting_Name || "F1 TV"));
  copy.append(element("h1", "hero-title", metadata.titleBrief || metadata.title || "Watch F1 TV"));
  const description = metadata.longDescription || metadata.shortDescription || "Watch every moment with F1 TV.";
  copy.append(element("p", "hero-description", description));

  const actions = element("div", "hero-actions");
  const play = element("button", "button button-primary focusable");
  play.type = "button";
  play.append(element("span", "play-icon", "▶"), element("span", "", "Watch now"));
  play.addEventListener("click", () => openContent(item));
  actions.append(play);

  const details = element("button", "button button-glass focusable", "More info");
  details.type = "button";
  details.addEventListener("click", () => openContent(item));
  actions.append(details);
  copy.append(actions);

  const indicators = element("div", "hero-indicators");
  items.slice(0, 4).forEach((_, index) => {
    const indicator = element("button", `hero-indicator focusable${index === state.heroIndex ? " active" : ""}`);
    indicator.type = "button";
    indicator.setAttribute("aria-label", `Featured item ${index + 1} of ${Math.min(items.length, 4)}`);
    indicator.setAttribute("aria-current", index === state.heroIndex ? "true" : "false");
    indicator.dataset.slide = String(index);
    indicator.addEventListener("click", () => buildHero(container, index, true));
    indicators.append(indicator);
  });
  copy.append(indicators);
  host.append(copy);
  if (focusSlide) host.querySelector(`[data-slide="${state.heroIndex}"]`)?.focus();
}

function buildCard(item) {
  const metadata = item.metadata;
  const variant = item.platformVariants?.[0] || {};
  const card = element("button", "content-card focusable");
  card.type = "button";
  card.setAttribute("aria-label", `${metadata.title || "F1 TV content"}${contentSubtitle(item) ? `, ${contentSubtitle(item)}` : ""}`);
  card.dataset.contentId = String(metadata.contentId || item.id || "");
  card.style.setProperty("--card-image", contentImage(item, 540, 304) ? `url("${contentImage(item, 540, 304)}")` : "none");

  const image = element("span", "content-card-image");
  if (metadata.contentSubtype === "LIVE") image.append(element("span", "live-label", "LIVE"));
  const duration = metadata.uiDuration || "";
  if (duration) image.append(element("span", "duration-label", duration));
  card.append(image);

  const text = element("span", "content-card-copy");
  const series = metadata.uiSeries || variant.technicalPackages?.[0]?.packageName?.replaceAll("_", " ") || "";
  if (series) text.append(element("span", "content-series", series));
  text.append(element("strong", "content-title", metadata.titleBrief || metadata.title || "Untitled"));
  const subtitle = contentSubtitle(item);
  if (subtitle && subtitle !== metadata.titleBrief) text.append(element("small", "content-subtitle", subtitle));
  card.append(text);
  card.addEventListener("click", () => openContent(item));
  return card;
}

function renderRail(container) {
  const items = contentList(container);
  if (!items.length || ["super_hero", "colour_start", "colour_end", "interactive_schedule", "explore_more"].includes(container.layout)) return null;

  const section = element("section", "content-section");
  const header = element("div", "section-header");
  const title = element("h2", "section-title", container.title || container.metadata?.label || "More F1 TV");
  header.append(title);
  const more = container.actions?.find((action) => action.key === "onTitleClick");
  if (more?.uri) {
    const viewAll = element("button", "view-all focusable", "View all  ›");
    viewAll.type = "button";
    viewAll.addEventListener("click", () => loadPage(more.uri, container.title || "More F1 TV"));
    header.append(viewAll);
  }
  section.append(header);

  const rail = element("div", "content-rail");
  items.slice(0, 14).forEach((item) => rail.append(buildCard(item)));
  section.append(rail);
  return section;
}

function renderPage(pageData, title) {
  const containers = pageData.containers || [];
  state.pageTitle = title;
  const heroContainer = containers.find((container) => container.layout === "super_hero");
  buildHero(heroContainer);

  const rails = document.getElementById("content-rails");
  rails.replaceChildren();
  containers.forEach((container) => {
    const rail = renderRail(container);
    if (rail) rails.append(rail);
  });
  document.title = `${title} · F1 TV`;
}

async function loadPage(uri, title, activeButton) {
  const host = document.getElementById("content-rails");
  host.setAttribute("aria-busy", "true");
  if (activeButton) setActiveNav(activeButton);
  if (uri === API.home) state.homeData = null;
  try {
    const pageData = await apiRequest(uri);
    if (uri === API.home) state.homeData = pageData;
    renderPage(pageData, title);
    setView("home");
    host.removeAttribute("aria-busy");
    if (!activeButton) {
      const navButton = [...document.querySelectorAll(".nav-button")].find((button) => button.dataset.uri === uri);
      if (navButton) setActiveNav(navButton);
    }
  } catch (error) {
    host.removeAttribute("aria-busy");
    showToast(error.message || "Could not load this F1 TV section.");
  }
}

async function loadHome() {
  setView("home");
  document.getElementById("content-rails").setAttribute("aria-busy", "true");
  try {
    const menuData = await apiRequest(API.menu);
    state.menu = getMenuEntries(menuData);
    makeNav();
    const homeEntry = state.menu.find((entry) => entry.title === "Home");
    const homeUri = homeEntry?.uri || API.home;
    const pageData = await apiRequest(homeUri);
    API.home = homeUri;
    state.homeData = pageData;
    renderPage(pageData, "Home");
    document.getElementById("content-rails").removeAttribute("aria-busy");
    const homeButton = [...document.querySelectorAll(".nav-button")].find((button) => button.dataset.uri === API.home);
    if (homeButton) setActiveNav(homeButton);
    const firstAction = document.querySelector(".hero-actions .focusable") || homeButton;
    firstAction?.focus();
  } catch (_error) {
    setView("error");
  }
}

function showDetail(item, fullMetadata) {
  const metadata = fullMetadata || item.metadata || {};
  const eventInfo = metadata.emfAttributes || {};
  const title = metadata.titleBrief || metadata.title || "F1 TV";
  const image = imageUrl(metadata.pictureUrl || item.platformVariants?.[0]?.pictureUrl, 1700, 900);

  state.selectedItem = item;
  const detail = document.getElementById("detail-view");
  const backdrop = document.getElementById("detail-backdrop");
  backdrop.style.backgroundImage = image ? `linear-gradient(90deg, #090a0e 0%, rgba(9,10,14,.82) 40%, rgba(9,10,14,.2) 100%), linear-gradient(0deg, #090a0e 0%, transparent 60%), url("${image}")` : "";
  document.getElementById("detail-eyebrow").textContent = [eventInfo.Meeting_Name || eventInfo.Global_Meeting_Name, metadata.contentSubtype, (metadata.genres || []).join(" · ")].filter(Boolean).join("  ·  ");
  document.getElementById("detail-title").textContent = title;
  document.getElementById("detail-meta").textContent = [metadata.uiSeries, metadata.uiDuration, metadata.year].filter(Boolean).join("  ·  ");
  document.getElementById("detail-description").textContent = metadata.longDescription || metadata.shortDescription || eventInfo.Global_Title || "Watch on F1 TV.";
  document.getElementById("detail-note").textContent = metadata.locked ? "This content needs an eligible F1 TV subscription." : "Included with your F1 TV subscription.";
  document.getElementById("play-button").textContent = metadata.locked ? "View subscription options" : "Play";
  setView("detail");
  document.getElementById("back-button").focus();
}

async function openContent(item) {
  if (!isVideo(item)) {
    const action = item.actions?.find((entry) => entry.key === "onClick");
    if (action?.uri) {
      try {
        const data = await apiRequest(action.uri);
        if (data.containers) renderPage(data, item.metadata?.title || "F1 TV");
        setView("home");
        return;
      } catch (_error) {
        showToast("This collection is not available right now.");
        return;
      }
    }
  }

  showDetail(item);
  const id = item.metadata?.contentId || item.id;
  if (!id) return;
  try {
    const data = await apiRequest(API.video(id));
    const fullItem = data.containers?.flatMap((container) => container.retrieveItems?.resultObj?.containers || []).find((candidate) => String(candidate.id) === String(id));
    if (fullItem && state.selectedItem === item) showDetail(fullItem, fullItem.metadata);
  } catch (_error) {
    // The home feed already contains enough metadata to render the details view.
  }
}

function playSelected() {
  const item = state.selectedItem;
  if (!item) return;
  const metadata = item.metadata || {};
  if (metadata.locked) {
    showToast("This content is locked by the subscription entitlement.");
    return;
  }
  if (!state.session?.signedIn) {
    beginSignIn();
    return;
  }
  startPlayback(item).catch((error) => showToast(error.message || "F1 TV could not start playback."));
}

function setAccountLabel() {
  const label = document.getElementById("account-label");
  label.textContent = state.session?.signedIn ? "F1 TV · Signed in" : "Sign in";
}

function closeSignIn() {
  window.clearInterval(state.pairingTimer);
  state.pairingTimer = null;
  state.session?.cancelPairing();
  document.getElementById("sign-in-dialog").hidden = true;
}

async function beginSignIn() {
  const dialog = document.getElementById("sign-in-dialog");
  const status = document.getElementById("pairing-status");
  const code = document.getElementById("pairing-code");
  const canvas = document.getElementById("pairing-qr");
  dialog.hidden = false;
  status.textContent = "Starting secure sign-in…";
  code.hidden = true;
  canvas.hidden = true;
  document.getElementById("sign-in-cancel").focus();
  try {
    const pairing = await state.session.beginPairing();
    if (dialog.hidden) return;
    code.textContent = pairing.code;
    code.hidden = false;
    canvas.hidden = false;
    if (typeof window.qrcode === "function") {
      const qr = window.qrcode(0, "M");
      qr.addData(pairing.url);
      qr.make();
      const context = canvas.getContext("2d");
      const count = qr.getModuleCount();
      const cell = canvas.width / count;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#000";
      for (let row = 0; row < count; row += 1) {
        for (let column = 0; column < count; column += 1) {
          if (qr.isDark(row, column)) context.fillRect(Math.ceil(column * cell), Math.ceil(row * cell), Math.ceil(cell), Math.ceil(cell));
        }
      }
    } else {
      canvas.hidden = true;
      document.getElementById("sign-in-instructions").textContent = "Visit f1.com/pair on your phone and enter the TV code below.";
    }
    status.textContent = "Scan the QR code with your phone and approve this TV on F1.";
    state.pairingTimer = window.setInterval(async () => {
      try {
        const signedIn = await state.session.pollPairing();
        if (!signedIn || dialog.hidden) return;
        closeSignIn();
        setAccountLabel();
        showToast("F1 TV account linked to this TV.");
        if (state.selectedItem) startPlayback(state.selectedItem).catch((error) => showToast(error.message));
      } catch (error) {
        closeSignIn();
        showToast(error.message || "F1 TV sign-in failed.");
      }
    }, 1000);
  } catch (error) {
    status.textContent = error.message || "Could not start F1 TV sign-in.";
  }
}

async function startPlayback(item) {
  const video = document.getElementById("player-video");
  const status = document.getElementById("player-status-text");
  const title = item.metadata?.titleBrief || item.metadata?.title || "F1 TV";
  const contentId = item.metadata?.contentId || item.id;
  if (!contentId) throw new Error("F1 TV did not provide a content ID for this programme.");
  stopPlayback();
  document.getElementById("player-title").textContent = title;
  document.getElementById("player-error").hidden = true;
  state.playerLive = item.metadata?.contentSubtype === "LIVE" || item.metadata?.isLive === true;
  document.getElementById("player-live").hidden = !state.playerLive;
  document.getElementById("player-time").textContent = state.playerLive ? "LIVE" : "--:-- / --:--";
  status.textContent = "Requesting your F1 TV stream…";
  setView("player");
  try {
    const stream = await state.session.play(contentId);
    if (!window.dashjs?.MediaPlayer) throw new Error("The TV player engine did not load.");
    const player = window.dashjs.MediaPlayer().create();
    state.dashPlayer = player;
    player.updateSettings({ debug: { logLevel: 0 }, streaming: { abr: { limitBitrateByPortal: false } } });
    player.setProtectionData({
      "com.widevine.alpha": {
        serverURL: stream.licenseUrl,
        httpRequestHeaders: stream.headers,
        withCredentials: true,
        audioRobustness: "HW_SECURE_CRYPTO",
        videoRobustness: "HW_SECURE_DECODE",
      },
    });
    player.on(window.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      status.textContent = "Playing on F1 TV";
      video.play().catch(() => {});
      updateTimeline();
    });
    player.on(window.dashjs.MediaPlayer.events.PLAYBACK_ERROR, () => {
      showPlayerError("F1 TV could not play this stream on the TV. Check the connection, subscription, and Widevine playback support.");
    });
    video.onplaying = () => { status.textContent = "Playing on F1 TV"; };
    video.onwaiting = () => { status.textContent = "Buffering…"; };
    video.onplay = () => { document.getElementById("player-toggle").textContent = "Pause"; };
    video.onpause = () => { document.getElementById("player-toggle").textContent = "Play"; };
    video.ontimeupdate = updateTimeline;
    video.onprogress = updateTimeline;
    player.initialize(video, stream.manifest, true);
    document.getElementById("player-back").focus();
    window.clearInterval(state.timelineTimer);
    state.timelineTimer = window.setInterval(updateTimeline, 1000);
    state.playerTimer = window.setTimeout(() => document.querySelector(".player-chrome")?.classList.add("is-hidden"), 5000);
  } catch (error) {
    showPlayerError(error.message || "Could not start F1 TV playback.");
  }
}

function showPlayerError(message) {
  const panel = document.getElementById("player-error");
  panel.textContent = message;
  panel.hidden = false;
  document.getElementById("player-status-text").textContent = "Playback unavailable";
}

function stopPlayback() {
  window.clearTimeout(state.playerTimer);
  window.clearInterval(state.timelineTimer);
  state.playerTimer = null;
  state.timelineTimer = null;
  if (state.dashPlayer) {
    try { state.dashPlayer.reset(); } catch (_error) {}
    state.dashPlayer = null;
  }
  const video = document.getElementById("player-video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  state.playerLive = false;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function timelineRange(video) {
  if (video.seekable?.length) {
    return { start: video.seekable.start(0), end: video.seekable.end(video.seekable.length - 1) };
  }
  if (Number.isFinite(video.duration) && video.duration > 0) return { start: 0, end: video.duration };
  return null;
}

function updateTimeline() {
  const video = document.getElementById("player-video");
  const scrubber = document.getElementById("player-scrubber");
  const label = document.getElementById("player-time");
  const liveButton = document.getElementById("player-live");
  if (!video || !scrubber || !label) return;
  const range = timelineRange(video);
  if (!range || range.end <= range.start) {
    scrubber.disabled = true;
    label.textContent = state.playerLive ? "LIVE" : "--:-- / --:--";
    return;
  }
  scrubber.disabled = false;
  const fraction = Math.max(0, Math.min(1, (video.currentTime - range.start) / (range.end - range.start)));
  scrubber.value = String(Math.round(fraction * 1000));
  liveButton.hidden = !state.playerLive;
  if (state.playerLive) {
    const behind = Math.max(0, range.end - video.currentTime);
    label.textContent = behind > 5 ? `LIVE  −${formatTime(behind)}` : "LIVE";
  } else {
    label.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  }
}

function seekScrubber() {
  const video = document.getElementById("player-video");
  const range = timelineRange(video);
  if (!range) return;
  const fraction = Number(document.getElementById("player-scrubber").value) / 1000;
  video.currentTime = range.start + (range.end - range.start) * fraction;
  updateTimeline();
}

function goLive() {
  const video = document.getElementById("player-video");
  const range = timelineRange(video);
  if (!range) return;
  video.currentTime = Math.max(range.start, range.end - 1.5);
  updateTimeline();
}

function focusables() {
  return [...document.querySelectorAll(".focusable")].filter((node) => !node.disabled && !node.closest("[hidden]") && node.getClientRects().length > 0);
}

function moveFocus(event) {
  const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
  if (!direction) return;
  const items = focusables();
  const current = document.activeElement;
  if (!items.includes(current)) return;
  const currentRect = current.getBoundingClientRect();
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;
  const [dx, dy] = direction;
  let best = null;
  let bestScore = Infinity;
  items.forEach((item) => {
    if (item === current) return;
    const rect = item.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = (x - cx) * dx + (y - cy) * dy;
    if (primary <= 0) return;
    const cross = Math.abs((x - cx) * dy - (y - cy) * dx);
    const score = primary + cross * 2.2;
    if (score < bestScore) { best = item; bestScore = score; }
  });
  if (best) {
    event.preventDefault();
    best.focus();
    best.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function onRemoteKey(event) {
  if (document.getElementById("sign-in-dialog") && !document.getElementById("sign-in-dialog").hidden) {
    if (event.key === "Escape" || event.key === "Backspace" || event.keyCode === 461) {
      event.preventDefault();
      closeSignIn();
    }
    return;
  }
  if (!document.getElementById("player-view").hidden) {
    const chrome = document.querySelector(".player-chrome");
    if (event.key === "Escape" || event.key === "Backspace" || event.keyCode === 461) {
      event.preventDefault();
      stopPlayback();
      setView("detail");
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) moveFocus(event);
    if (chrome) chrome.classList.remove("is-hidden");
    window.clearTimeout(state.playerTimer);
    state.playerTimer = window.setTimeout(() => chrome?.classList.add("is-hidden"), 5000);
    return;
  }
  if (event.key === "Escape" || event.key === "Backspace" || event.keyCode === 461) {
    if (!document.getElementById("detail-view").hidden) {
      event.preventDefault();
      setView("home");
      document.getElementById("play-button").blur();
      return;
    }
    if (state.pageTitle !== "Home" && state.homeData) {
      event.preventDefault();
      renderPage(state.homeData, "Home");
      state.pageTitle = "Home";
      const homeButton = [...document.querySelectorAll(".nav-button")].find((button) => button.dataset.uri === API.home);
      if (homeButton) setActiveNav(homeButton);
    }
    return;
  }
  moveFocus(event);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("back-button").addEventListener("click", () => setView("home"));
  document.getElementById("play-button").addEventListener("click", playSelected);
  document.getElementById("player-back").addEventListener("click", () => { stopPlayback(); setView("detail"); });
  document.getElementById("player-toggle").addEventListener("click", () => {
    const video = document.getElementById("player-video");
    if (video.paused) video.play(); else video.pause();
    document.getElementById("player-toggle").textContent = video.paused ? "Play" : "Pause";
  });
  document.getElementById("player-mute").addEventListener("click", () => {
    const video = document.getElementById("player-video");
    video.muted = !video.muted;
    document.getElementById("player-mute").textContent = video.muted ? "Unmute" : "Mute";
  });
  document.getElementById("player-live").addEventListener("click", goLive);
  document.getElementById("player-scrubber").addEventListener("change", seekScrubber);
  document.getElementById("sign-in-cancel").addEventListener("click", closeSignIn);
  document.getElementById("account-button").addEventListener("click", () => {
    if (state.session?.signedIn) {
      state.session.signOut().then(() => { setAccountLabel(); showToast("Signed out of F1 TV on this TV."); }).catch((error) => showToast(error.message));
    } else if (!state.session?.signedIn) beginSignIn();
  });
  document.getElementById("retry-button").addEventListener("click", loadHome);
  document.addEventListener("keydown", onRemoteKey);
  state.session = new window.F1Session();
  state.session.restore().then(setAccountLabel).catch(() => setAccountLabel());
  loadHome();
});
