// The webOS 4.x browser on some rooted LG TVs is based on Chromium 53 and
// predates Element.append() and Element.replaceChildren(). Keep the UI's DOM
// updates working there without changing behavior on newer engines.
(function installLegacyDomCompatibility() {
  if (typeof Element === "undefined") return;
  if (!Element.prototype.append) {
    Element.prototype.append = function append() {
      for (var index = 0; index < arguments.length; index += 1) {
        var child = arguments[index];
        this.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    };
  }
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function replaceChildren() {
      while (this.firstChild) this.removeChild(this.firstChild);
      Element.prototype.append.apply(this, arguments);
    };
  }
})();

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
  heroTimer: null,
  heroFocused: false,
  heroHovered: false,
  session: null,
  dashPlayer: null,
  pairingTimer: null,
  playerTimer: null,
  timelineTimer: null,
  playerLive: false,
  searchQuery: "",
  selectedChannelId: "",
  audioTracks: [],
  textTracks: [],
  subtitleChoiceMade: false,
  currentView: "home",
  playerPanel: null,
  playerOverlay: false,
  signInReturnFocus: null,
  signOutReturnFocus: null,
  pendingSeekValue: null,
  pageLoadSequence: 0,
  // 4K (hls.js) playback; see the "4K playback" section.
  hlsPlayer: null,
  hlsLoading: null,
  lastEngine: "dash",
  playbackSeq: 0,
  uhdTv: null,
  uhdTvCheck: null,
  uhdCheck: null,
  webosReleaseCheck: null,
  // In-app updates; see the "App updates" section.
  update: null,
  updateReturnFocus: null,
  pendingUpdateDialog: false,
  uhdMaxHeight: 0,
  updateCheckSeq: 0,
  subtitleManual: false,
  updateInstalling: false,
  lastDashHeights: [],
};

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function apiRequest(path, headers = {}) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("Unexpected F1 TV API path.");
  }
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) {
    throw new Error("Unexpected F1 TV API path.");
  }
  const response = await fetch(url.href, {
    credentials: "omit",
    headers: { accept: "application/json", ...headers },
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
  const encodedPath = safePath.split("/").map((segment) => {
    try {
      return encodeURIComponent(decodeURIComponent(segment));
    } catch (_error) {
      return encodeURIComponent(segment);
    }
  }).join("/");
  return `${API_ORIGIN}/image-resizer/image/${encodedPath}?w=${width}&h=${height}&q=HI&o=L`;
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
  const menuEntries = state.menu.filter((entry) => !["shows", "documentaries", "my list"].includes(entry.title.trim().toLocaleLowerCase()));
  menuEntries.forEach((entry, index) => {
    const button = element("button", `nav-button focusable${index === 0 ? " active" : ""}`, entry.title);
    button.type = "button";
    button.dataset.uri = entry.uri;
    button.dataset.title = entry.title;
    button.addEventListener("click", () => loadPage(entry.uri, entry.title, button));
    nav.append(button);
  });
  const search = element("button", "nav-button focusable", "Search");
  search.type = "button";
  search.addEventListener("click", openSearch);
  nav.append(search);
}

function setActiveNav(activeButton) {
  document.querySelectorAll(".nav-button").forEach((button) => {
    const active = button === activeButton;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function setView(name, { pushHistory = true } = {}) {
  const changed = state.currentView !== name;
  if (pushHistory && changed) {
    window.history.pushState({ f1tv: true, screen: name, panel: null }, "", window.location.href);
  }
  state.currentView = name;
  scheduleHeroAutoAdvance();
  if (name !== "player" && state.pendingUpdateDialog) {
    state.pendingUpdateDialog = false;
    window.setTimeout(openUpdateDialog, 0);
  }
  if (changed) {
    state.playerPanel = null;
    state.playerOverlay = false;
    document.getElementById("player-sources-panel").hidden = true;
    document.getElementById("player-language-panel").hidden = true;
  }
  const home = document.getElementById("home-view");
  const detail = document.getElementById("detail-view");
  const search = document.getElementById("search-view");
  const player = document.getElementById("player-view");
  const error = document.getElementById("error-view");
  home.hidden = name !== "home";
  detail.hidden = name !== "detail";
  search.hidden = name !== "search";
  player.hidden = name !== "player";
  error.hidden = name !== "error";
  document.getElementById("main-content").scrollTop = 0;
  const active = document.activeElement;
  if (!active || active === document.body || active.closest("[hidden]")) focusDefault(name);
}

function focusDefault(name) {
  const targetByView = {
    home: () => document.querySelector(".hero-actions .focusable")
      || document.querySelector(".content-rail .focusable")
      || document.querySelector(".nav-button"),
    search: () => document.getElementById("search-input"),
    detail: () => document.getElementById("play-button") || document.getElementById("back-button"),
    player: () => document.getElementById("player-back"),
    error: () => document.getElementById("retry-button"),
  };
  const target = targetByView[name]?.();
  if (target && !target.closest("[hidden]") && target.getClientRects().length) target.focus();
}

function buildHero(container, selectedIndex = 0, focusSlide = false) {
  const host = document.getElementById("hero");
  const previousBackdrop = host.querySelector(".hero-backdrop.is-current");
  window.clearTimeout(state.heroTimer);
  host.replaceChildren();
  if (previousBackdrop) {
    previousBackdrop.classList.remove("is-current");
    previousBackdrop.classList.add("is-exiting");
    host.append(previousBackdrop);
    window.setTimeout(() => previousBackdrop.remove(), 110);
  }
  const pageLabel = document.getElementById("page-label");
  const isHomePage = state.pageTitle === "Home";
  pageLabel.hidden = isHomePage;
  pageLabel.textContent = isHomePage ? "" : state.pageTitle;
  if (!container) {
    state.heroContainer = null;
    state.heroIndex = 0;
    host.hidden = true;
    scheduleHeroAutoAdvance();
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
  host.setAttribute("role", "region");
  host.setAttribute("aria-roledescription", "carousel");
  host.setAttribute("aria-label", "Featured F1 TV content");
  if (!host.dataset.carouselEvents) {
    host.dataset.carouselEvents = "true";
    host.addEventListener("focusin", () => {
      state.heroFocused = true;
      scheduleHeroAutoAdvance();
    });
    host.addEventListener("focusout", () => window.setTimeout(() => {
      state.heroFocused = host.contains(document.activeElement);
      scheduleHeroAutoAdvance();
    }, 0));
    host.addEventListener("mouseenter", () => {
      state.heroHovered = true;
      scheduleHeroAutoAdvance();
    });
    host.addEventListener("mouseleave", () => {
      state.heroHovered = false;
      scheduleHeroAutoAdvance();
    });
    document.addEventListener("visibilitychange", scheduleHeroAutoAdvance);
  }
  const image = contentImage(item, 1920, 1080);
  const backdrop = element("div", "hero-backdrop is-current");
  if (image) backdrop.style.backgroundImage = `url("${image}")`;
  backdrop.setAttribute("aria-hidden", "true");
  host.append(backdrop);

  const copy = element("div", "hero-copy");
  copy.setAttribute("aria-live", "polite");
  const meetingName = eventInfo.Meeting_Name || eventInfo.Global_Meeting_Name;
  const badgeText = [metadata.contentSubtype === "LIVE" ? "LIVE SESSION" : "FEATURED", meetingName]
    .filter(Boolean).join(" · ");
  const badge = element("p", `hero-badge${metadata.contentSubtype === "LIVE" ? " is-live" : ""}`, badgeText);
  copy.append(badge);
  copy.append(element("h1", "hero-title", metadata.titleBrief || metadata.title || "Watch F1 TV"));
  const description = metadata.longDescription || metadata.shortDescription || "Watch every moment with F1 TV.";
  copy.append(element("p", "hero-description", description));

  const actions = element("div", "hero-actions");
  const play = element("button", "button button-primary focusable");
  play.type = "button";
  play.dataset.heroAction = "watch";
  play.append(element("span", "play-icon", "▶"), element("span", "", "Watch now"));
  play.addEventListener("click", () => openContent(item));
  actions.append(play);

  copy.append(actions);

  const indicators = element("div", "hero-indicators");
  indicators.setAttribute("role", "group");
  indicators.setAttribute("aria-label", "Featured items");
  items.forEach((_, index) => {
    const indicator = element("button", `hero-indicator focusable${index === state.heroIndex ? " active" : ""}`);
    indicator.type = "button";
    indicator.setAttribute("aria-label", `Show featured item ${index + 1} of ${items.length}`);
    indicator.setAttribute("aria-current", index === state.heroIndex ? "true" : "false");
    indicator.dataset.slide = String(index);
    indicator.addEventListener("click", () => buildHero(container, index, true));
    indicators.append(indicator);
  });
  host.append(copy);
  host.append(indicators);
  if (focusSlide) host.querySelector(`[data-slide="${state.heroIndex}"]`)?.focus();
  scheduleHeroAutoAdvance();
}

function scheduleHeroAutoAdvance() {
  window.clearTimeout(state.heroTimer);
  const host = document.getElementById("hero");
  const items = contentList(state.heroContainer);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!host || host.hidden || state.currentView !== "home" || items.length < 2
      || state.heroFocused || state.heroHovered || document.hidden || reducedMotion) return;
  state.heroTimer = window.setTimeout(() => {
    buildHero(state.heroContainer, (state.heroIndex + 1) % items.length);
  }, 5000);
}

function advanceHeroFromControl(key, control) {
  const action = control?.dataset.heroAction;
  if (!action) return false;
  const items = contentList(state.heroContainer);
  if (items.length < 2) return false;
  const targetIndex = key === "ArrowRight"
    ? state.heroIndex + 1
    : key === "ArrowLeft"
      ? state.heroIndex - 1
      : -1;
  if (targetIndex < 0 || targetIndex >= items.length) return false;
  buildHero(state.heroContainer, targetIndex);
  document.querySelector(`[data-hero-action="${action}"]`)?.focus();
  return true;
}

function buildCard(item) {
  const metadata = item.metadata;
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
  document.title = `${title} · Race Weekend`;
}

async function loadPage(uri, title, activeButton) {
  const sequence = ++state.pageLoadSequence;
  const host = document.getElementById("content-rails");
  host.setAttribute("aria-busy", "true");
  if (activeButton) setActiveNav(activeButton);
  if (uri === API.home) state.homeData = null;
  try {
    const pageData = await apiRequest(uri);
    if (sequence !== state.pageLoadSequence) return;
    if (uri === API.home) state.homeData = pageData;
    renderPage(pageData, title);
    setView("home");
    host.removeAttribute("aria-busy");
    if (!activeButton) {
      const navButton = [...document.querySelectorAll(".nav-button")].find((button) => button.dataset.uri === uri);
      if (navButton) setActiveNav(navButton);
    }
  } catch (error) {
    if (sequence !== state.pageLoadSequence) return;
    host.removeAttribute("aria-busy");
    showToast(error.message || "Could not load this F1 TV section.");
  }
}

function openSearch() {
  state.pageLoadSequence++;
  document.getElementById("content-rails").removeAttribute("aria-busy");
  setView("search");
  const navButton = [...document.querySelectorAll(".nav-button")].find((button) => button.textContent === "Search");
  setActiveNav(navButton);
  document.getElementById("search-input").value = state.searchQuery;
  document.getElementById("search-input").focus();
}

function searchItems(data) {
  const items = [];
  const seen = new Set();
  function visit(value, depth = 0) {
    if (!value || depth > 6 || items.length >= 80) return;
    if (Array.isArray(value)) {
      value.slice(0, 120).forEach((child) => visit(child, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    if (value.metadata && isVideo(value)) {
      const id = String(value.metadata.contentId || value.id || "");
      if (id && !seen.has(id)) { seen.add(id); items.push(value); }
      return;
    }
    ["resultObj", "containers", "items", "retrieveItems"].forEach((key) => visit(value[key], depth + 1));
  }
  visit(data);
  return items;
}

async function submitSearch(event) {
  event.preventDefault();
  const query = document.getElementById("search-input").value.trim();
  const message = document.getElementById("search-message");
  const results = document.getElementById("search-results");
  if (!query) { message.textContent = "Enter a driver, race, show, or documentary."; return; }
  if (!state.session?.signedIn || !state.session.location) {
    message.textContent = "Sign in to search the F1 TV catalogue.";
    beginSignIn();
    return;
  }
  state.searchQuery = query;
  results.replaceChildren();
  message.textContent = "Searching F1 TV…";
  const location = state.session.location;
  const login = state.session.signedIn ? "R" : "A";
  const tail = `${encodeURIComponent(location.entitlement)}/${Number(location.groupId)}`;
  const params = new URLSearchParams();
  params.append("search", query);
  try {
    const data = await apiRequest(`/2.0/${login}/ENG/WEB_DASH/ALL/PAGE/5234/${tail}?${params}`, state.session.headers());
    const items = searchItems(data);
    items.forEach((item) => results.append(buildCard(item)));
    message.textContent = items.length ? `${items.length} results for “${query}”` : `No F1 TV results for “${query}”.`;
    (results.querySelector(".focusable") || document.getElementById("search-input")).focus();
  } catch (error) {
    message.textContent = error.message || "Search is unavailable right now.";
    document.getElementById("search-input").focus();
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
  const enteringDetail = state.currentView !== "detail";
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
  const streams = (metadata.additionalStreams || []).filter((stream) => /^\d{1,12}$/.test(String(stream.channelId || "")));
  const picker = document.getElementById("channel-picker");
  const options = document.getElementById("channel-options");
  options.replaceChildren();
  state.selectedChannelId = "";
  if (streams.length > 1) {
    const selected = streams.find((stream) => stream.default === true)
      || streams.find((stream) => /F1\s*LIVE/i.test(stream.title || stream.reportingName || ""))
      || streams.find((stream) => /INTERNATIONAL/i.test(stream.title || stream.reportingName || ""))
      || streams[0];
    state.selectedChannelId = String(selected.channelId);
    streams.forEach((stream) => {
      const id = String(stream.channelId);
      const label = String(stream.title || stream.reportingName || stream.type || "Feed").slice(0, 50);
      const button = element("button", `channel-option focusable${id === state.selectedChannelId ? " is-selected" : ""}`, label);
      button.type = "button";
      button.setAttribute("aria-pressed", id === state.selectedChannelId ? "true" : "false");
      button.addEventListener("click", () => {
        state.selectedChannelId = id;
        options.querySelectorAll(".channel-option").forEach((option) => {
          const active = option === button;
          option.classList.toggle("is-selected", active);
          option.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });
      options.append(button);
    });
    picker.hidden = false;
  } else {
    picker.hidden = true;
  }
  setView("detail");
  if (enteringDetail) document.getElementById("play-button").focus();
}

function playerOption(label, selected, onClick, disabled = false) {
  const button = element("button", `player-option focusable${selected ? " is-selected" : ""}`, label);
  button.type = "button";
  button.disabled = disabled;
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  button.addEventListener("click", onClick);
  return button;
}

function renderPlayerSources() {
  const host = document.getElementById("player-source-options");
  if (!host) return;
  host.replaceChildren();
  const streams = (state.selectedItem?.metadata?.additionalStreams || [])
    .filter((stream) => /^\d{1,12}$/.test(String(stream.channelId || "")));
  if (!streams.length) {
    host.append(element("p", "player-options-note", "No alternate video sources are available for this programme."));
    return;
  }
  const driverColors = { NOR: "#ff7900", VER: "#3476d1", BOR: "#ff321d", HAD: "#3476d1", GAS: "#079edb", ANT: "#21ddc0", ALO: "#209979", LEC: "#ef0038", STR: "#209979", ALB: "#1769d2", HER: "#aaaeb5", HUL: "#ff321d", LAW: "#648af2", OCO: "#d8dcdf", LIN: "#648af2" };
  streams.forEach((stream, index) => {
    if (index === 4) {
      const divider = element("div", "player-source-divider");
      divider.setAttribute("role", "separator");
      host.append(divider);
    }
    const id = String(stream.channelId);
    const label = String(stream.title || stream.reportingName || stream.type || "Feed").slice(0, 70);
    const primary = index < 4;
    const button = playerOption(label, id === state.selectedChannelId, () => {
      if (id === state.selectedChannelId) { closePlayerPanel(); return; }
      state.selectedChannelId = id;
      renderPlayerSources();
      document.querySelector("#player-source-options .player-option.is-selected")?.focus();
      document.getElementById("player-status-text").textContent = `Switching to ${label}…`;
      startPlayback(state.selectedItem).catch((error) => showPlayerError(error.message));
    });
    button.classList.toggle("player-feed-option", primary);
    const icon = element("span", primary ? `player-source-icon source-icon-${index}` : "player-driver-dot");
    if (primary) icon.textContent = ["◉", "◎", "♧", "▥"][index] || "•";
    else {
      const code = label.trim().split(/\s+/)[0].toUpperCase();
      icon.style.backgroundColor = driverColors[code] || ["#3476d1", "#ef0038", "#21ddc0", "#ff7900"][index % 4];
      icon.setAttribute("aria-hidden", "true");
    }
    const text = element("span", "player-option-label", label);
    button.replaceChildren(icon, text);
    host.append(button);
  });
}

// F1 streams tag tracks with bare language codes ("eng", "fra_subtitle"); turn
// the code into a readable name, leaving anything unrecognised as-is.
const LANGUAGE_NAMES = {
  en: "English", eng: "English",
  de: "German", deu: "German", ger: "German",
  fr: "French", fra: "French", fre: "French",
  nl: "Dutch", nld: "Dutch", dut: "Dutch",
  pt: "Portuguese", por: "Portuguese",
  es: "Spanish", spa: "Spanish",
  it: "Italian", ita: "Italian",
  ja: "Japanese", jpn: "Japanese",
  zh: "Chinese", zho: "Chinese", chi: "Chinese",
  pl: "Polish", pol: "Polish",
  hu: "Hungarian", hun: "Hungarian",
  ar: "Arabic", ara: "Arabic",
  fx: "No commentary (track sound)",
};

function languageName(code) {
  const base = String(code || "").split(/[-_]/)[0].toLowerCase();
  if (!base) return "";
  return LANGUAGE_NAMES[base] || String(code);
}

// A Label that is itself just a language code adds nothing next to the name.
function readableTrackLabel(label) {
  return /^[a-z]{2,3}(?:[_-][a-z0-9]+)*$/i.test(String(label || "")) ? "" : label;
}

function audioTrackLabel(track, index) {
  const label = Array.isArray(track.labels) ? track.labels.map((entry) => entry?.text || entry).filter(Boolean)[0] : "";
  const role = Array.isArray(track.roles) ? track.roles.map((entry) => entry?.value || entry).filter(Boolean)[0] : "";
  const language = languageName(track.lang || track.language);
  const detail = [readableTrackLabel(label), language, role].filter(Boolean).map((part) => String(part).trim()).filter((part, i, all) => all.indexOf(part) === i);
  return detail.length ? detail.join(" · ") : `Audio ${index + 1}`;
}

function renderPlayerAudio() {
  const host = document.getElementById("player-audio-options");
  if (!host) return;
  host.replaceChildren();
  if (state.hlsPlayer) {
    renderHlsAudio(host);
    return;
  }
  const player = state.dashPlayer;
  let current = null;
  try { current = player?.getCurrentTrackFor("audio") || null; } catch (_error) {}
  if (!state.audioTracks.length) {
    host.append(element("p", "player-options-note", player ? "No alternate audio tracks are provided for this feed." : "Audio tracks appear when playback starts."));
    return;
  }
  state.audioTracks.forEach((track, index) => {
    const selected = current ? (track.id === current.id && track.index === current.index) : index === 0;
    host.append(playerOption(audioTrackLabel(track, index), selected, () => {
      try {
        player.setCurrentTrack(track);
        rememberAudioLanguage(track.lang);
        window.setTimeout(() => {
          renderPlayerAudio();
          host.querySelector(".player-option.is-selected")?.focus();
        }, 150);
      } catch (_error) {
        showToast("Could not switch the audio track.");
      }
    }));
  });
}

const subtitleLanguageNames = {
  ar: "Arabic", ara: "Arabic", de: "German", deu: "German", ger: "German", en: "English", eng: "English",
  es: "Spanish", spa: "Spanish", fr: "French", fra: "French", fre: "French", it: "Italian", ita: "Italian",
  ja: "Japanese", jpn: "Japanese", nl: "Dutch", nld: "Dutch", dut: "Dutch", pt: "Portuguese", por: "Portuguese",
  ru: "Russian", rus: "Russian", zh: "Chinese", zho: "Chinese", chi: "Chinese", ko: "Korean", kor: "Korean",
  pl: "Polish", pol: "Polish", sv: "Swedish", swe: "Swedish", da: "Danish", dan: "Danish", no: "Norwegian", nor: "Norwegian"
};

function subtitleLanguageName(code) {
  const normalized = String(code || "").trim().toLowerCase().replace(/[_-].*$/, "");
  return subtitleLanguageNames[normalized] || "";
}

function subtitleTrackLabel(track, index) {
  const rawLabel = Array.isArray(track.labels) ? track.labels.map((entry) => entry?.text || entry).filter(Boolean)[0] : "";
  const label = String(rawLabel || "").trim();
  const labelCode = /^[a-z]{2,3}(?:[_-](?:subtitle|subtitles|cc|sdh))?$/i.test(label)
    ? label.split(/[_-]/)[0]
    : "";
  const language = subtitleLanguageName(labelCode) || subtitleLanguageName(track.lang || track.language) || String(track.lang || track.language || "").trim();
  const humanLabel = label && !labelCode ? label : "";
  const role = Array.isArray(track.roles) ? track.roles.map((entry) => entry?.value || entry).filter(Boolean)[0] : "";
  const detail = [humanLabel, language, role].filter(Boolean).map((part) => String(part).trim()).filter((part, i, all) => all.indexOf(part) === i);
  return detail.length ? detail.join(" · ") : `Subtitle ${index + 1}`;
}

function disableDefaultSubtitles(player) {
  try {
    player.enableText(false);
    player.setTextTrack(-1);
  } catch (_error) {}
}

function renderPlayerSubtitles() {
  const host = document.getElementById("player-subtitle-options");
  if (!host) return;
  host.replaceChildren();
  if (state.hlsPlayer) {
    renderHlsSubtitles(host);
    return;
  }
  const player = state.dashPlayer;
  if (!state.textTracks.length) {
    host.append(element("p", "player-options-note", player ? "No subtitles are available for this feed." : "Subtitle tracks appear when playback starts."));
    return;
  }
  let currentIndex = -1;
  let enabled = false;
  try {
    currentIndex = player?.getCurrentTextTrackIndex?.() ?? -1;
    enabled = player?.isTextEnabled?.() ?? false;
  } catch (_error) {}
  host.append(playerOption("Off", !enabled, () => {
    try {
      state.subtitleChoiceMade = true;
      state.subtitleManual = true;
      player.enableText(false);
      player.setTextTrack(-1);
      rememberSubtitlesOff();
      renderPlayerSubtitles();
      host.querySelector(".player-option.is-selected")?.focus();
    }
    catch (_error) { showToast("Could not turn subtitles off."); }
  }));
  state.textTracks.forEach((track, index) => {
    const trackIndex = index;
    const selected = enabled && currentIndex === trackIndex;
    host.append(playerOption(subtitleTrackLabel(track, index), selected, () => {
      try {
        state.subtitleChoiceMade = true;
        state.subtitleManual = true;
        player.enableText(true);
        player.setTextTrack(trackIndex);
        rememberSubtitleLanguage(track.lang);
        window.setTimeout(() => { renderPlayerSubtitles(); host.querySelector(".player-option.is-selected")?.focus(); }, 150);
      } catch (_error) { showToast("Could not switch the subtitle track."); }
    }));
  });
}

// One selectable rung per distinct height (the highest bitrate at that height),
// low to high. The stream decides which heights exist, so the menu adapts to it.
function videoQualityList(player) {
  let list = [];
  try { list = player?.getBitrateInfoListFor("video") || []; } catch (_error) {}
  const byHeight = new Map();
  for (const info of list) {
    if (!info || !info.height) continue;
    const best = byHeight.get(info.height);
    if (!best || info.bitrate > best.bitrate) byHeight.set(info.height, info);
  }
  return [...byHeight.values()].sort((a, b) => a.height - b.height);
}

function autoQualityEnabled(player) {
  try { return player.getSettings().streaming.abr.autoSwitchBitrate.video !== false; }
  catch (_error) { return true; }
}

function setAutoQuality(player, enabled) {
  // Keep the legacy cap only while adaptive; a manual pick needs it lifted or
  // dash.js clamps the selected rung back down to the capped bitrate.
  const legacy = document.documentElement.classList.contains("legacy-webos");
  player.updateSettings({
    streaming: {
      abr: {
        autoSwitchBitrate: { video: enabled },
        maxBitrate: { audio: -1, video: -1 },
      },
    },
  });
}

function renderPlayerQuality() {
  const host = document.getElementById("player-quality-options");
  if (!host) return;
  // Re-rendering replaces the buttons; keep remote focus inside the list.
  const hadFocus = host.contains(document.activeElement);
  host.replaceChildren();
  renderQualityOptions(host);
  if (hadFocus) {
    const target = host.querySelector(".player-option.is-selected") || host.querySelector(".player-option:not([disabled])");
    target?.focus();
  }
}

function renderQualityOptions(host) {
  if (state.hlsPlayer) {
    // 4K runs on hls.js with a single 2160p rendition. The HD choices return
    // to the dash.js player: "Auto" adaptive, or a fixed height.
    host.append(playerOption("Auto", false, () => leaveUhd()));
    const heights = state.lastDashHeights.length ? state.lastDashHeights : [360, 540, 720, 1080];
    heights.forEach((height) => host.append(playerOption(`${height}p`, false, () => leaveUhd(height))));
    renderUhdOption(host);
    return;
  }
  const player = state.dashPlayer;
  if (!player) {
    host.append(element("p", "player-options-note", "Quality options appear when playback starts."));
    return;
  }
  const list = videoQualityList(player);
  if (list.length) state.lastDashHeights = list.map((info) => info.height);
  if (!list.length) {
    host.append(element("p", "player-options-note", "This feed does not offer selectable video qualities."));
    renderUhdOption(host);
    return;
  }
  let current = -1;
  try { current = player.getQualityFor("video"); } catch (_error) {}
  const auto = autoQualityEnabled(player);
  const activeRung = list.find((info) => info.qualityIndex === current);
  const refocus = () => window.setTimeout(() => {
    renderPlayerQuality();
    host.querySelector(".player-option.is-selected")?.focus();
  }, 150);
  host.append(playerOption(auto && activeRung ? `Auto · ${activeRung.height}p` : "Auto", auto, () => {
    try { rememberHdQuality(0); setAutoQuality(player, true); refocus(); }
    catch (_error) { showToast("Could not change the video quality."); }
  }));
  list.forEach((info) => {
    const label = `${info.height}p · ${(info.bitrate / 1e6).toFixed(1)} Mbps`;
    host.append(playerOption(label, !auto && info.qualityIndex === current, () => {
      try {
        rememberHdQuality(info.height);
        setAutoQuality(player, false);
        player.setQualityFor("video", info.qualityIndex, true);
        refocus();
      } catch (_error) { showToast("Could not change the video quality."); }
    }));
  });
  renderUhdOption(host);
}

// ---------------------------------------------------------------------------
// 4K playback
//
// F1 TV serves 2160p only through the 3.0 PLAY API with the HDR_UHD_CMAFWV
// profile: HLS/CMAF, HEVC Main10 HLG, Widevine. dash.js cannot play that, so
// the 2160p choice uses hls.js (vendor/hls.min.js, loaded on demand) while every
// other quality keeps the dash.js path. The option is offered only when the TV
// qualifies (4K panel, HEVC through MSE, hardware-secure Widevine for HEVC) and
// is enabled only when this programme's master playlist lists an above-HD HEVC
// rendition whose media playlist actually answers (finished replays of the most
// recent events still return 404 there for a while). A fatal hls.js error falls
// back to the HD player at the same position.
//
// Every F1 rendition is 50 fps. Some TVs decode protected 2160p50 below real
// time (the OLED C9, webOS 4.x: ~43 fps in its secure video path) yet play the
// master's 2880x1620 HDR rendition at a full 50 fps. So 2160p is used only when
// MediaCapabilities reports 2160p50 HEVC as smooth; otherwise the option plays
// the best HDR rendition up to 1620p.
// ---------------------------------------------------------------------------
const UHD_HEIGHT = 2160;
const UHD_FALLBACK_HEIGHT = 1620;
const UHD_PROFILE = "HDR_UHD_CMAFWV";
const UHD_HEVC = 'video/mp4; codecs="hvc1.2.4.L153.B0"';
const UHD_PREFERENCE_KEY = "raceWeekendPreferUhd";
const ISO_639_2_TO_1 = {
  ara: "ar", chi: "zh", dan: "da", deu: "de", dut: "nl", eng: "en", fra: "fr", fre: "fr", ger: "de", hun: "hu",
  ita: "it", jpn: "ja", kor: "ko", nld: "nl", nor: "no", pol: "pl", por: "pt", rus: "ru", spa: "es", swe: "sv", zho: "zh",
};

function languageBase(code) {
  const base = String(code || "").trim().toLowerCase().split(/[-_]/)[0];
  return ISO_639_2_TO_1[base] || base;
}

function uhdPreferred() {
  try { return window.localStorage.getItem(UHD_PREFERENCE_KEY) === "1"; } catch (_error) { return false; }
}

function setUhdPreferred(enabled) {
  try {
    if (enabled) window.localStorage.setItem(UHD_PREFERENCE_KEY, "1");
    else window.localStorage.removeItem(UHD_PREFERENCE_KEY);
  } catch (_error) {}
}

function chromeMajorVersion() {
  const match = /Chrome\/(\d+)/.exec(navigator.userAgent || "");
  return match ? Number(match[1]) : 0;
}

function webosDeviceInfo() {
  try { return JSON.parse(window.PalmSystem.deviceInfo) || {}; } catch (_error) { return {}; }
}

function loadHlsEngine() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!state.hlsLoading) {
    state.hlsLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/hls.min.js";
      script.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error("The 4K player engine did not load.")));
      script.onerror = () => {
        script.remove();
        state.hlsLoading = null;
        reject(new Error("The 4K player engine did not load."));
      };
      document.head.appendChild(script);
    });
  }
  return state.hlsLoading;
}

function tvSupportsUhd() {
  if (!state.uhdTvCheck) {
    state.uhdTvCheck = (async () => {
      const info = webosDeviceInfo();
      if (!(Number(info.screenWidth) >= 3840 && Number(info.screenHeight) >= 2160)) return false;
      if (!window.MediaSource || !MediaSource.isTypeSupported(UHD_HEVC)) return false;
      try {
        await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{
          initDataTypes: ["cenc"],
          videoCapabilities: [{ contentType: UHD_HEVC, robustness: "HW_SECURE_DECODE" }],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: "HW_SECURE_CRYPTO" }],
        }]);
        const Hls = await loadHlsEngine();
        if (!Hls.isSupported()) return false;
        state.uhdMaxHeight = (await smoothUhdDecode()) ? UHD_HEIGHT : UHD_FALLBACK_HEIGHT;
        return true;
      } catch (_error) {
        return false;
      }
    })().then((supported) => {
      state.uhdTv = supported;
      return supported;
    });
  }
  return state.uhdTvCheck;
}

// True only when the TV says it decodes 2160p50 HEVC smoothly. Browsers without
// MediaCapabilities (Chromium < 66, e.g. webOS 4.x) cannot confirm it.
async function smoothUhdDecode() {
  if (!navigator.mediaCapabilities?.decodingInfo) return false;
  try {
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: "media-source",
      video: { contentType: UHD_HEVC, width: 3840, height: 2160, bitrate: 18000000, framerate: 50 },
    });
    return Boolean(info?.supported && info.smooth);
  } catch (_error) {
    return false;
  }
}

function uhdLabel(height) {
  return height >= UHD_HEIGHT ? `${height}p · 4K HDR` : `${height}p · HDR`;
}

// The webOS release ("4.10.2", "6.5.3"). F1 rejects the 3.0 PLAY request from
// older browsers (Chromium 53) when the device info has no osVersion.
function webosRelease() {
  if (!state.webosReleaseCheck) {
    state.webosReleaseCheck = new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(""), 2500);
      try {
        const bridge = new window.PalmServiceBridge();
        state.webosReleaseBridge = bridge;
        bridge.onservicecallback = (message) => {
          window.clearTimeout(timer);
          try { resolve(String(JSON.parse(message).webos_release || "").replace(/[^0-9.]/g, "")); }
          catch (_error) { resolve(""); }
        };
        bridge.call("luna://com.webos.service.systemservice/osInfo/query", JSON.stringify({ parameters: ["webos_release"] }));
      } catch (_error) {
        window.clearTimeout(timer);
        resolve("");
      }
    });
  }
  return state.webosReleaseCheck;
}

async function uhdDeviceHeader() {
  const model = String(webosDeviceInfo().modelName || "webOS TV").replace(/[^A-Za-z0-9._-]/g, "");
  const [release, version] = await Promise.all([webosRelease(), appVersion()]);
  const osVersion = release ? `osVersion=${release};` : "";
  return `device=web;screen=browser;os=webos;browser=chrome;browserVersion=${chromeMajorVersion()};model=${model};${osVersion}appVersion=${version || "0"};playerVersion=4.7.4;p=true;tms=1`;
}

function trustedUhdUrl(value, isLicense) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    const trusted = isLicense
      ? host === "f1tv.formula1.com"
      : host === "formula1.com" || host.endsWith(".formula1.com") || host === "f1prodlive.akamaized.net";
    return url.protocol === "https:" && !url.port && !url.username && !url.password && trusted ? url.href : "";
  } catch (_error) {
    return "";
  }
}

// The best above-HD HEVC rendition no taller than maxHeight: HDR before SDR,
// then the highest resolution, then the first listed.
function uhdVariant(master, maxHeight = state.uhdMaxHeight || UHD_HEIGHT) {
  const lines = String(master).split(/\r?\n/);
  let best = null;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (line.indexOf("#EXT-X-STREAM-INF:") !== 0 || !/\b(?:hev1|hvc1)\./.test(line)) continue;
    const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/);
    const height = resolution ? Number(resolution[2]) : 0;
    if (height <= 1080 || height > maxHeight) continue;
    const hdr = /VIDEO-RANGE=(?:HLG|PQ)/.test(line) ? 1 : 0;
    if (!best || hdr > best.hdr || (hdr === best.hdr && height > best.height)) {
      best = { line: index, uri: lines[index + 1].trim(), height, hdr };
    }
  }
  return best;
}

function setMediaAttribute(line, name, value) {
  const pattern = new RegExp(`([:,])${name}=[A-Z]+`);
  return pattern.test(line) ? line.replace(pattern, `$1${name}=${value}`) : `${line},${name}=${value}`;
}

// Keep only the chosen above-HD HEVC rendition (so hls.js never switches),
// start on the audio language that was playing in HD, and start with subtitles
// off unless the viewer already chose a subtitle language.
function prepareUhdMaster(master, { audioLanguage = "", subtitleLanguage = "" } = {}) {
  const lines = String(master).split(/\r?\n/);
  const variant = uhdVariant(master);
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
      if (!variant || index === variant.line) out.push(line, lines[index + 1]);
      index += 1;
    } else if (line.indexOf("#EXT-X-I-FRAME-STREAM-INF:") !== 0) {
      out.push(line);
    }
  }
  [["AUDIO", audioLanguage], ["SUBTITLES", subtitleLanguage]].forEach(([type, language]) => {
    const media = [];
    out.forEach((line, index) => {
      if (line.indexOf("#EXT-X-MEDIA:") === 0 && new RegExp(`TYPE=${type}(?:,|$)`).test(line)) media.push(index);
    });
    const wanted = language
      ? media.find((index) => languageBase((/LANGUAGE="([^"]*)"/.exec(out[index]) || [])[1]) === languageBase(language))
      : undefined;
    if (type === "AUDIO" && wanted === undefined) return; // keep the stream's own default audio
    media.forEach((index) => {
      const chosen = index === wanted ? "YES" : "NO";
      out[index] = setMediaAttribute(setMediaAttribute(out[index], "DEFAULT", chosen), "AUTOSELECT", chosen);
    });
  });
  return out.join("\n");
}

async function requestUhdStream(contentId, channelId) {
  if (!(await tvSupportsUhd())) return null;
  // Built by hand: Chromium 53 has no record constructor for URLSearchParams.
  let query = `contentId=${encodeURIComponent(String(contentId))}&player=player_bm`;
  if (channelId) query += `&channelId=${encodeURIComponent(String(channelId))}`;
  const device = await uhdDeviceHeader();
  const response = await fetch(`${API_ORIGIN}/3.0/R/ENG/BIG_SCREEN_DASH/ALL/CONTENT/PLAY?${query}`, {
    credentials: "omit",
    headers: {
      ...state.session.headers(),
      accept: "application/json",
      "x-f1-device-info": device,
      "x-f1-override-video-stream": UHD_PROFILE,
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const stream = data.resultObj;
  if (data.resultCode !== "OK" || !stream || stream.streamType !== UHD_PROFILE) return null;
  const url = trustedUhdUrl(stream.url || stream.manifestUrl, false);
  const licenseUrl = trustedUhdUrl(stream.laURL || stream.laUrl || stream.licenseUrl, true);
  if (!url || !licenseUrl) return null;
  const master = await fetch(url, { credentials: "omit" });
  if (!master.ok) return null;
  const variant = uhdVariant(await master.text());
  if (!variant || !variant.uri) return null;
  const media = await fetch(new URL(variant.uri, url).href, { credentials: "omit" });
  if (!media.ok) return null;
  return {
    url,
    licenseUrl,
    device,
    entitlementToken: stream.entitlementToken || state.session.entitlement,
    drmToken: stream.drmToken || "",
    height: variant.height,
  };
}

function uhdCheckKey(contentId, channelId) {
  return `${contentId}|${channelId || ""}`;
}

// One availability check per programme/feed, reused for up to 10 minutes (or
// maxAge). A network error is not remembered, so the next look retries.
function uhdStreamFor(contentId, channelId, { maxAge = 10 * 60 * 1000 } = {}) {
  const key = uhdCheckKey(contentId, channelId);
  const cached = state.uhdCheck;
  if (cached && cached.key === key && !cached.failed && (cached.pending || Date.now() - cached.time < maxAge)) return cached.promise;
  const check = { key, time: Date.now(), pending: true, failed: false, stream: null };
  check.promise = requestUhdStream(contentId, channelId).catch(() => {
    check.failed = true;
    return null;
  }).then((stream) => {
    check.pending = false;
    check.stream = stream;
    if (state.playerPanel === "language") renderPlayerQuality();
    return stream;
  });
  state.uhdCheck = check;
  return check.promise;
}

function currentContentId() {
  const item = state.selectedItem;
  return item ? item.metadata?.contentId || item.id : "";
}

function refreshUhdAvailability() {
  const contentId = currentContentId();
  if (!contentId) return;
  tvSupportsUhd().then((supported) => {
    if (state.playerPanel === "language") renderPlayerQuality();
    if (supported) uhdStreamFor(contentId, state.selectedChannelId);
  });
}

function renderUhdOption(host) {
  if (state.uhdTv !== true) return;
  const active = Boolean(state.hlsPlayer);
  const check = state.uhdCheck;
  const current = check?.key === uhdCheckKey(currentContentId(), state.selectedChannelId) ? check : null;
  const height = current?.stream?.height || state.uhdMaxHeight || UHD_HEIGHT;
  let label = uhdLabel(height);
  let disabled = false;
  if (!active) {
    if (!current || current.pending) {
      label = `${height}p · checking HDR…`;
      disabled = true;
    } else if (current.failed) {
      label = `${height}p · could not check HDR`;
      disabled = true;
    } else if (!current.stream) {
      label = `${height}p · not available for this video`;
      disabled = true;
    }
  }
  host.append(playerOption(label, active, () => {
    if (active) return;
    setUhdPreferred(true);
    restartPlayback({ resumeAt: resumePosition() });
  }, disabled));
}

function resumePosition() {
  const video = document.getElementById("player-video");
  return !state.playerLive && video && video.currentTime > 5 ? video.currentTime : 0;
}

function currentTrackLanguages() {
  try {
    if (state.hlsPlayer) {
      const hls = state.hlsPlayer;
      return {
        audioLanguage: hls.audioTracks[hls.audioTrack]?.lang || "",
        subtitleLanguage: hls.subtitleTrack >= 0 ? hls.subtitleTracks[hls.subtitleTrack]?.lang || "" : "",
      };
    }
    const player = state.dashPlayer;
    if (player) {
      const audio = player.getCurrentTrackFor("audio");
      const text = player.isTextEnabled?.() ? state.textTracks[player.getCurrentTextTrackIndex?.()] : null;
      return { audioLanguage: audio?.lang || "", subtitleLanguage: text?.lang || "" };
    }
  } catch (_error) {}
  return { audioLanguage: "", subtitleLanguage: "" };
}

function restartPlayback(options) {
  if (!state.selectedItem) return;
  startPlayback(state.selectedItem, { ...currentTrackLanguages(), ...options })
    .catch((error) => showPlayerError(error.message || "Could not start F1 TV playback."));
}

function leaveUhd(height = 0) {
  rememberHdQuality(height);
  restartPlayback({ resumeAt: resumePosition() });
}

// The viewer's last audio, subtitle and quality choices. Every programme starts
// with them (when the feed offers that language or quality), in HD and in 4K.
// With no subtitle choice yet, subtitles start off (the existing default).
const AUDIO_LANGUAGE_KEY = "raceWeekendAudioLanguage";
const SUBTITLE_LANGUAGE_KEY = "raceWeekendSubtitleLanguage";
const HD_QUALITY_KEY = "raceWeekendVideoQuality";

function rememberAudioLanguage(code) {
  const language = languageBase(code);
  if (language) writeSetting(AUDIO_LANGUAGE_KEY, language);
}

function rememberedAudioLanguage() {
  return readSetting(AUDIO_LANGUAGE_KEY) || "";
}

function rememberSubtitleLanguage(code) {
  // A track without a language tag cannot be found again; keep the last choice.
  const language = languageBase(code);
  if (language) writeSetting(SUBTITLE_LANGUAGE_KEY, language);
}

function rememberSubtitlesOff() {
  writeSetting(SUBTITLE_LANGUAGE_KEY, "off");
}

function rememberedSubtitleLanguage() {
  const value = readSetting(SUBTITLE_LANGUAGE_KEY) || "";
  return value === "off" ? "" : value;
}

// 0 = Auto, otherwise a fixed height. Choosing an HD quality also leaves 4K.
function rememberHdQuality(height) {
  setUhdPreferred(false);
  writeSetting(HD_QUALITY_KEY, height ? String(height) : null);
}

function rememberedHdQuality() {
  return Number.parseInt(readSetting(HD_QUALITY_KEY) || "", 10) || 0;
}

function fallBackFromUhd(message) {
  if (!state.hlsPlayer) return;
  showToast(message || "Ultra HD playback stopped. Switching to HD.");
  restartPlayback({ resumeAt: resumePosition(), skipUhd: true });
}

function freshPlayerVideo() {
  // A clean <video>: MediaKeys attached by one engine are not handed to the other.
  const old = document.getElementById("player-video");
  const video = old.cloneNode(false);
  video.removeAttribute("src");
  // cloneNode copies attributes, not the live mute/volume state.
  video.muted = old.muted;
  video.volume = old.volume;
  video.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openPlayerOptions();
  });
  old.parentNode.replaceChild(video, old);
  return video;
}

function hlsTrackLabel(track, index, fallback) {
  const name = String(track.name || "").trim();
  const language = subtitleLanguageName(languageBase(track.lang)) || languageName(languageBase(track.lang));
  const detail = [/^[a-z]{2,3}(?:[_-][a-z0-9]+)*$/i.test(name) ? "" : name, language]
    .filter(Boolean)
    .filter((part, i, all) => all.indexOf(part) === i);
  return detail.length ? detail.join(" · ") : `${fallback} ${index + 1}`;
}

function renderHlsAudio(host) {
  const hls = state.hlsPlayer;
  const tracks = hls.audioTracks || [];
  if (!tracks.length) {
    host.append(element("p", "player-options-note", "Audio tracks appear when playback starts."));
    return;
  }
  tracks.forEach((track, index) => {
    host.append(playerOption(hlsTrackLabel(track, index, "Audio"), index === hls.audioTrack, () => {
      hls.audioTrack = index;
      rememberAudioLanguage(track.lang);
      window.setTimeout(() => {
        renderPlayerAudio();
        host.querySelector(".player-option.is-selected")?.focus();
      }, 150);
    }));
  });
}

function renderHlsSubtitles(host) {
  const hls = state.hlsPlayer;
  const tracks = hls.subtitleTracks || [];
  if (!tracks.length) {
    host.append(element("p", "player-options-note", "No subtitles are available for this feed."));
    return;
  }
  const choose = (index) => () => {
    state.subtitleChoiceMade = true;
    state.subtitleManual = true;
    hls.subtitleDisplay = true;
    hls.subtitleTrack = index;
    if (index >= 0) rememberSubtitleLanguage(tracks[index].lang);
    else rememberSubtitlesOff();
    window.setTimeout(() => {
      renderPlayerSubtitles();
      host.querySelector(".player-option.is-selected")?.focus();
    }, 150);
  };
  host.append(playerOption("Off", hls.subtitleTrack < 0, choose(-1)));
  tracks.forEach((track, index) => {
    host.append(playerOption(hlsTrackLabel(track, index, "Subtitle"), index === hls.subtitleTrack, choose(index)));
  });
}

async function startUhdPlayback(uhd, { resumeAt = 0, audioLanguage = "", subtitleLanguage = "", playbackSeq = state.playbackSeq } = {}) {
  const Hls = await loadHlsEngine();
  if (playbackSeq !== state.playbackSeq || state.currentView !== "player") return;
  const status = document.getElementById("player-status-text");
  const video = freshPlayerVideo();
  state.lastEngine = "hls";
  const licenseHeaders = {
    ...state.session.headers(),
    entitlementtoken: uhd.entitlementToken,
    "x-f1-device-info": uhd.device,
  };
  // Same as the HD license request (auth.js) when the 3.0 response carries one.
  if (uhd.drmToken) licenseHeaders.customdata = uhd.drmToken;
  const masterOptions = { audioLanguage, subtitleLanguage };
  class UhdLoader extends Hls.DefaultConfig.loader {
    load(context, config, callbacks) {
      if (context.type === "manifest") {
        const done = callbacks.onSuccess;
        callbacks = {
          ...callbacks,
          onSuccess: (response, stats, ctx, details) => {
            response.data = prepareUhdMaster(response.data, masterOptions);
            done(response, stats, ctx, details);
          },
        };
      }
      return super.load(context, config, callbacks);
    }
  }
  const hls = new Hls({
    debug: false,
    enableWorker: false,
    autoStartLoad: false,
    emeEnabled: true,
    loader: UhdLoader,
    drmSystems: { "com.widevine.alpha": { licenseUrl: uhd.licenseUrl } },
    drmSystemOptions: { audioRobustness: "HW_SECURE_CRYPTO", videoRobustness: "HW_SECURE_DECODE" },
    licenseXhrSetup: (xhr) => {
      Object.keys(licenseHeaders).forEach((key) => xhr.setRequestHeader(key, licenseHeaders[key]));
    },
    maxBufferLength: 20,
    backBufferLength: 10,
  });
  state.hlsPlayer = hls;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const level = hls.levels.findIndex((entry) => entry.height === uhd.height);
    if (level < 0) {
      fallBackFromUhd("This video has no Ultra HD rendition. Switching to HD.");
      return;
    }
    hls.startLevel = level;
    hls.loadLevel = level;
    hls.startLoad(resumeAt > 0 ? resumeAt : -1);
  });
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
    if (state.playerPanel === "language") renderPlayerAudio();
  });
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
    if (state.playerPanel === "language") renderPlayerSubtitles();
  });
  hls.once(Hls.Events.FRAG_BUFFERED, () => {
    video.play().catch(() => {});
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data?.fatal) fallBackFromUhd();
  });
  video.onplaying = () => { status.textContent = `Playing on F1 TV · ${uhdLabel(uhd.height)}`; };
  video.onwaiting = () => { status.textContent = "Buffering…"; };
  video.onplay = () => { document.getElementById("player-toggle").textContent = "Pause"; };
  video.onpause = () => { document.getElementById("player-toggle").textContent = "Play"; };
  video.ontimeupdate = updateTimeline;
  video.onprogress = updateTimeline;
  status.textContent = `Starting ${uhdLabel(uhd.height)}…`;
  hls.attachMedia(video);
  hls.loadSource(uhd.url);
  if (state.playerPanel === "language") {
    renderPlayerQuality();
    renderPlayerAudio();
    renderPlayerSubtitles();
  } else if (!state.playerPanel) {
    video.focus();
  }
  window.clearInterval(state.timelineTimer);
  state.timelineTimer = window.setInterval(updateTimeline, 1000);
  state.playerTimer = window.setTimeout(() => hidePlayerChrome(), 5000);
}

function playerPanelElement(kind) {
  return document.getElementById(kind === "sources" ? "player-sources-panel" : "player-language-panel");
}

function showPlayerChrome({ pushHistory = true } = {}) {
  if (state.currentView === "player" && !state.playerOverlay && pushHistory) {
    window.history.pushState({ f1tv: true, screen: "player", panel: null, overlay: true }, "", window.location.href);
  }
  state.playerOverlay = true;
  document.querySelector(".player-chrome")?.classList.remove("is-hidden");
  window.clearTimeout(state.playerTimer);
}

function hidePlayerChrome({ updateHistory = true } = {}) {
  document.querySelector(".player-chrome")?.classList.add("is-hidden");
  state.playerOverlay = false;
  if (updateHistory && window.history.state?.f1tv && window.history.state.screen === "player") {
    window.history.replaceState({ ...window.history.state, panel: null, overlay: false }, "", window.location.href);
  }
}

function showPlayerPanel(kind, { pushHistory = true, focus = true } = {}) {
  const panel = playerPanelElement(kind);
  if (!panel) return;
  if (kind === "sources") renderPlayerSources();
  else {
    renderPlayerQuality();
    renderPlayerAudio();
    renderPlayerSubtitles();
    // Look for 4K only when the viewer opens the quality menu.
    if (!state.hlsPlayer) refreshUhdAvailability();
  }
  showPlayerChrome();
  if (pushHistory && state.playerPanel !== kind) {
    const historyState = { f1tv: true, screen: "player", panel: kind };
    if (state.playerPanel) window.history.replaceState(historyState, "", window.location.href);
    else window.history.pushState(historyState, "", window.location.href);
  }
  document.getElementById("player-sources-panel").hidden = kind !== "sources";
  document.getElementById("player-language-panel").hidden = kind !== "language";
  state.playerPanel = kind;
  if (focus) document.getElementById(kind === "sources" ? "player-sources-close" : "player-language-close").focus();
}

function closePlayerPanel({ fromHistory = false } = {}) {
  if (!state.playerPanel) return;
  if (!fromHistory && window.history.state?.f1tv && window.history.state.panel) {
    window.history.back();
    return;
  }
  const previousPanel = state.playerPanel;
  document.getElementById("player-sources-panel").hidden = true;
  document.getElementById("player-language-panel").hidden = true;
  state.playerPanel = null;
  const toggleId = previousPanel === "language" ? "player-language-toggle" : "player-sources-toggle";
  document.getElementById(toggleId)?.focus();
  state.playerTimer = window.setTimeout(() => hidePlayerChrome(), 5000);
}

function openPlayerOptions() {
  showPlayerPanel("sources");
}

function handleAppPopState(event) {
  const destination = event.state;
  if (!document.getElementById("update-dialog").hidden && destination?.modal !== "update") closeUpdateDialog({ fromHistory: true });
  if (!document.getElementById("sign-out-dialog").hidden && destination?.modal !== "logout") closeSignOutConfirmation({ fromHistory: true });
  if (!document.getElementById("sign-in-dialog").hidden && destination?.modal !== "signin") closeSignIn({ fromHistory: true });
  if (!destination?.f1tv) return;
  const previousView = state.currentView;
  const previousPanel = state.playerPanel;
  if (previousView === "player" && destination.screen !== "player") {
    // Invalidate a start that is still awaiting the network (4K check, PLAY).
    state.playbackSeq += 1;
    stopPlayback();
  }
  setView(destination.screen || "home", { pushHistory: false });
  if (destination.screen === "player" && destination.panel) {
    showPlayerPanel(destination.panel, { pushHistory: false });
  } else if (previousPanel) {
    closePlayerPanel({ fromHistory: true });
  }
  if (destination.screen === "player" && !destination.panel) {
    if (destination.overlay) showPlayerChrome({ pushHistory: false });
    else hidePlayerChrome({ updateHistory: false });
  }
}

function requestAppBack() {
  if (window.history.state?.f1tv) window.history.back();
  else if (state.currentView !== "home") setView("home", { pushHistory: false });
}

function exitPlayer() {
  const steps = state.playerPanel ? 3 : state.playerOverlay ? 2 : 1;
  window.history.go(-steps);
}

function findContentItem(data, id) {
  let found = null;
  function visit(value, depth = 0) {
    if (!value || found || depth > 7) return;
    if (Array.isArray(value)) { value.slice(0, 120).forEach((child) => visit(child, depth + 1)); return; }
    if (typeof value !== "object") return;
    if (value.metadata && String(value.metadata.contentId || value.id || "") === String(id)) { found = value; return; }
    ["resultObj", "containers", "items", "retrieveItems"].forEach((key) => visit(value[key], depth + 1));
  }
  visit(data);
  return found;
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
    const fullItem = findContentItem(data, id);
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

// ---------------------------------------------------------------------------
// App updates
//
// Race Weekend checks this repository's GitHub releases and offers a newer
// version when the project publishes one. Automatic checks run at most every
// 12 hours on launch and can be turned off in the updates dialog (Account →
// App updates). On TVs with the webOS Homebrew Channel (rooted TVs), "Update
// now" asks its service to download the release .ipk, verify the SHA-256 that
// GitHub reports for the asset, and install it; webOS closes the app while it
// is replaced. Without the Homebrew Channel the dialog shows the release page
// as a QR code so the package can be installed with Dev Manager or ares-install.
// ---------------------------------------------------------------------------
const UPDATE_REPOSITORY = "Ravboni/race-weekend";
const UPDATE_PACKAGE_PREFIX = "com.ravboni.raceweekend_";
const UPDATE_AUTO_KEY = "raceWeekendAutoUpdateChecks";
const UPDATE_SKIP_KEY = "raceWeekendSkippedVersion";
const UPDATE_LAST_CHECK_KEY = "raceWeekendLastUpdateCheck";
const UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000;
const HOMEBREW_SERVICE = "luna://org.webosbrew.hbchannel.service";
// scripts/transpile.js replaces this placeholder with appinfo.json's version
// when packaging. The app cannot read appinfo.json itself: the CSP limits
// connect-src to network origins, and Luna's getAppInfo is denied to apps.
const APP_VERSION = "__RACE_WEEKEND_VERSION__";

function appVersion() {
  return Promise.resolve(/^\d+\.\d+/.test(APP_VERSION) ? APP_VERSION : "");
}

function readSetting(key) {
  try { return window.localStorage.getItem(key); } catch (_error) { return null; }
}

function writeSetting(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch (_error) {}
}

function autoUpdateChecksEnabled() {
  return readSetting(UPDATE_AUTO_KEY) !== "off";
}

function versionParts(version) {
  return String(version || "").replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
  }
  return 0;
}

// Picks the newest published release and decides whether it replaces the
// installed version. Release order is decided by publication date when the
// installed version is itself a published release, because the project's
// version numbers have not always increased (v0.16.29 was followed by v0.2.0).
function newerRelease(releases, installedVersion) {
  const published = releases
    .filter((release) => release && !release.draft && !release.prerelease && release.tag_name)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const latest = published[0];
  if (!latest || !installedVersion) return null;
  const latestVersion = latest.tag_name.replace(/^v/i, "");
  if (latestVersion === installedVersion) return null;
  const installed = published.find((release) => release.tag_name.replace(/^v/i, "") === installedVersion);
  const newer = installed
    ? Date.parse(latest.published_at) > Date.parse(installed.published_at)
    : compareVersions(latestVersion, installedVersion) > 0;
  if (!newer) return null;
  const asset = (latest.assets || []).find((entry) => /\.ipk$/i.test(entry.name) && entry.name.indexOf(UPDATE_PACKAGE_PREFIX) === 0);
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset?.digest || "");
  const packageUrl = /^https:\/\/github\.com\//.test(asset?.browser_download_url || "") ? asset.browser_download_url : "";
  return {
    version: latestVersion,
    page: /^https:\/\/github\.com\//.test(latest.html_url || "") ? latest.html_url : `https://github.com/${UPDATE_REPOSITORY}/releases/latest`,
    packageUrl,
    sha256: digest ? digest[1].toLowerCase() : "",
  };
}

async function findUpdate() {
  const [installedVersion, response] = await Promise.all([
    appVersion(),
    fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=20`, {
      credentials: "omit",
      headers: { accept: "application/vnd.github+json" },
    }),
  ]);
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const releases = await response.json();
  writeSetting(UPDATE_LAST_CHECK_KEY, String(Date.now()));
  return { installedVersion, update: newerRelease(Array.isArray(releases) ? releases : [], installedVersion) };
}

function homebrewCall(method, params, onMessage) {
  const bridge = new window.PalmServiceBridge();
  bridge.onservicecallback = (text) => {
    let message = {};
    try { message = JSON.parse(text); } catch (_error) {}
    onMessage(message);
  };
  bridge.call(`${HOMEBREW_SERVICE}/${method}`, JSON.stringify(params || {}));
  return bridge;
}

function homebrewInstallerAvailable() {
  return new Promise((resolve) => {
    if (typeof window.PalmServiceBridge !== "function") { resolve(false); return; }
    const timer = window.setTimeout(() => resolve(false), 3000);
    try {
      state.homebrewProbe = homebrewCall("checkRoot", {}, (message) => {
        window.clearTimeout(timer);
        // Any reply without an error code means the service is installed and reachable.
        resolve(!message.errorCode && message.returnValue !== undefined);
      });
    } catch (_error) {
      window.clearTimeout(timer);
      resolve(false);
    }
  });
}

function updateDialogElements() {
  return {
    dialog: document.getElementById("update-dialog"),
    title: document.getElementById("update-title"),
    detail: document.getElementById("update-detail"),
    qr: document.getElementById("update-qr"),
    install: document.getElementById("update-install"),
    skip: document.getElementById("update-skip"),
    close: document.getElementById("update-close"),
    auto: document.getElementById("update-auto"),
  };
}

function drawQrCode(canvas, text) {
  if (typeof window.qrcode !== "function") return false;
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const context = canvas.getContext("2d");
  const count = qr.getModuleCount();
  const cell = canvas.width / (count + 8);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) context.fillRect(Math.ceil((column + 4) * cell), Math.ceil((row + 4) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
  return true;
}

function renderUpdateDialog({ title, detail = "", update = null, canInstall = false, busy = false }) {
  const ui = updateDialogElements();
  ui.title.textContent = title;
  ui.detail.textContent = detail;
  ui.install.hidden = !update || !canInstall || !update.packageUrl || !update.sha256;
  ui.install.disabled = busy;
  ui.skip.hidden = !update || busy;
  ui.close.textContent = update && !busy ? "Later" : "Close";
  ui.auto.textContent = `Automatic update checks: ${autoUpdateChecksEnabled() ? "On" : "Off"}`;
  ui.qr.hidden = !update || canInstall || !drawQrCode(ui.qr, update.page);
}

function openUpdateDialog() {
  const { dialog, install, close } = updateDialogElements();
  if (!dialog.hidden) return;
  if (state.currentView === "player") {
    // Never cover playback; show the offer when the viewer leaves the player.
    state.pendingUpdateDialog = true;
    return;
  }
  state.updateReturnFocus = document.activeElement;
  // Like the account dialogs: a history entry, so Back and popstate close it.
  const current = window.history.state?.f1tv ? window.history.state : { f1tv: true, screen: state.currentView };
  window.history.pushState({ ...current, modal: "update" }, "", window.location.href);
  dialog.hidden = false;
  (install.hidden ? close : install).focus();
}

function closeUpdateDialog({ fromHistory = false } = {}) {
  const { dialog } = updateDialogElements();
  // A check still running must not reopen a dialog the viewer dismissed.
  state.updateCheckSeq += 1;
  state.pendingUpdateDialog = false;
  if (dialog.hidden) return;
  if (!fromHistory && window.history.state?.f1tv && window.history.state.modal === "update") {
    const { modal, ...pageState } = window.history.state;
    window.history.replaceState(pageState, "", window.location.href);
  }
  dialog.hidden = true;
  const returnFocus = state.updateReturnFocus;
  state.updateReturnFocus = null;
  if (returnFocus && !returnFocus.closest("[hidden]") && returnFocus.getClientRects().length) returnFocus.focus();
  else if (!fromHistory) focusDefault(state.currentView);
}

function showUpdateResult(seq, interactive, view) {
  // Only the check the viewer is still waiting for may change the dialog.
  if (seq !== state.updateCheckSeq) return;
  renderUpdateDialog(view);
  const ui = updateDialogElements();
  if (ui.dialog.hidden) openUpdateDialog();
  else (ui.install.hidden ? ui.close : ui.install).focus();
}

async function checkForUpdates({ interactive = false } = {}) {
  if (state.updateInstalling) {
    if (interactive) openUpdateDialog();
    return;
  }
  state.updateCheckSeq += 1;
  const seq = state.updateCheckSeq;
  if (interactive) {
    renderUpdateDialog({ title: "Checking for updates…" });
    openUpdateDialog();
  }
  try {
    const [{ installedVersion, update }, canInstall] = await Promise.all([findUpdate(), homebrewInstallerAvailable()]);
    if (seq !== state.updateCheckSeq) return;
    state.update = update ? { ...update, canInstall } : null;
    if (!update) {
      if (interactive) showUpdateResult(seq, interactive, { title: "Race Weekend is up to date", detail: `Version ${installedVersion || "unknown"} is the latest release.` });
      return;
    }
    if (!interactive && readSetting(UPDATE_SKIP_KEY) === update.version) return;
    const how = canInstall
      ? "Update now downloads it from GitHub, checks its SHA-256, and installs it with the Homebrew Channel. Race Weekend closes while it is replaced; open it again afterwards."
      : "Scan the code to open the release page, then install the .ipk with webOS Dev Manager or ares-install.";
    showUpdateResult(seq, interactive, { title: `Race Weekend ${update.version} is available`, detail: `You have ${installedVersion}. ${how}`, update, canInstall });
  } catch (_error) {
    if (interactive) showUpdateResult(seq, interactive, { title: "Could not check for updates", detail: "Check the TV's internet connection and try again later." });
  }
}

function installUpdate() {
  const update = state.update;
  if (state.updateInstalling || !update?.canInstall || !update.packageUrl || !update.sha256) return;
  state.updateInstalling = true;
  renderUpdateDialog({ title: `Installing Race Weekend ${update.version}…`, detail: "Starting the download…", update, canInstall: true, busy: true });
  state.updateInstall = homebrewCall("install", { ipkUrl: update.packageUrl, ipkHash: update.sha256, subscribe: true }, (message) => {
    const { detail } = updateDialogElements();
    if (message.returnValue === false || message.errorText) {
      state.updateInstalling = false;
      renderUpdateDialog({ title: "The update could not be installed", detail: message.errorText || "The Homebrew Channel reported an error.", update, canInstall: true });
      return;
    }
    const progress = Number.isFinite(message.progress) ? ` ${Math.round(message.progress)}%` : "";
    if (message.statusText) detail.textContent = `${message.statusText}${progress}`;
    if (message.finished) detail.textContent = "Installed. Open Race Weekend again to use the new version.";
  });
}

function toggleAutoUpdateChecks() {
  writeSetting(UPDATE_AUTO_KEY, autoUpdateChecksEnabled() ? "off" : null);
  updateDialogElements().auto.textContent = `Automatic update checks: ${autoUpdateChecksEnabled() ? "On" : "Off"}`;
}

function scheduleAutomaticUpdateCheck() {
  if (!autoUpdateChecksEnabled()) return;
  const last = Number(readSetting(UPDATE_LAST_CHECK_KEY)) || 0;
  if (Date.now() - last < UPDATE_CHECK_INTERVAL) return;
  // Let the home feed load first; the check is a single small GitHub API request.
  window.setTimeout(() => checkForUpdates(), 8000);
}

function setAccountLabel() {
  const signedIn = Boolean(state.session?.signedIn);
  const button = document.getElementById("account-button");
  const label = signedIn ? "Log out of F1 TV" : "Sign in to F1 TV";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.signedIn = String(signedIn);
}

function closeSignOutConfirmation({ fromHistory = false } = {}) {
  const dialog = document.getElementById("sign-out-dialog");
  if (dialog.hidden) return;
  if (!fromHistory && window.history.state?.f1tv && window.history.state.modal === "logout") {
    const { modal, ...pageState } = window.history.state;
    window.history.replaceState(pageState, "", window.location.href);
  }
  dialog.hidden = true;
  const returnFocus = state.signOutReturnFocus;
  state.signOutReturnFocus = null;
  if (returnFocus && !returnFocus.closest("[hidden]") && returnFocus.getClientRects().length) returnFocus.focus();
  else if (!fromHistory) document.getElementById("account-button").focus();
}

function openSignOutConfirmation() {
  const dialog = document.getElementById("sign-out-dialog");
  state.signOutReturnFocus = document.activeElement;
  const current = window.history.state?.f1tv ? window.history.state : { f1tv: true, screen: state.currentView };
  window.history.pushState({ ...current, modal: "logout" }, "", window.location.href);
  dialog.hidden = false;
  document.getElementById("sign-out-cancel").focus();
}

async function confirmSignOut() {
  const confirm = document.getElementById("sign-out-confirm");
  confirm.disabled = true;
  confirm.textContent = "Logging out…";
  try {
    await state.session.signOut();
    closeSignOutConfirmation();
    setAccountLabel();
    showToast("Signed out of F1 TV on this TV.");
  } catch (error) {
    showToast(error.message || "Could not sign out of F1 TV.");
  } finally {
    confirm.disabled = false;
    confirm.textContent = "Log out";
  }
}

function closeSignIn({ fromHistory = false, navigate = true } = {}) {
  if (!fromHistory && window.history.state?.f1tv && window.history.state.modal === "signin") {
    if (navigate) window.history.back();
    else {
      const { modal, ...pageState } = window.history.state;
      window.history.replaceState(pageState, "", window.location.href);
    }
  }
  window.clearInterval(state.pairingTimer);
  state.pairingTimer = null;
  state.session?.cancelPairing();
  document.getElementById("sign-in-dialog").hidden = true;
  const returnFocus = state.signInReturnFocus;
  state.signInReturnFocus = null;
  if (returnFocus && !returnFocus.closest("[hidden]") && returnFocus.getClientRects().length) returnFocus.focus();
  else focusDefault(!document.getElementById("detail-view").hidden ? "detail" : "home");
}

async function beginSignIn() {
  const dialog = document.getElementById("sign-in-dialog");
  const status = document.getElementById("pairing-status");
  const code = document.getElementById("pairing-code");
  const canvas = document.getElementById("pairing-qr");
  state.signInReturnFocus = document.activeElement;
  if (window.history.state?.f1tv && window.history.state.modal !== "signin") {
    window.history.pushState({ ...window.history.state, modal: "signin" }, "", window.location.href);
  }
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
        closeSignIn({ navigate: false });
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

async function startPlayback(item, options = {}) {
  state.playbackSeq += 1;
  const playbackSeq = state.playbackSeq;
  if (state.hlsPlayer || state.lastEngine === "hls") {
    stopPlayback();
    freshPlayerVideo();
  }
  state.lastEngine = "dash";
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
  showPlayerChrome();
  // What was playing before an HD/4K switch, else the viewer's last choices.
  const audioLanguage = options.audioLanguage || rememberedAudioLanguage();
  const subtitleLanguage = options.subtitleLanguage || rememberedSubtitleLanguage();
  const hdQuality = rememberedHdQuality();
  state.subtitleChoiceMade = Boolean(subtitleLanguage);
  state.subtitleManual = false;
  try {
    if (!options.skipUhd && uhdPreferred() && (await tvSupportsUhd())) {
      status.textContent = "Checking 4K availability…";
      // Start from a fresh PLAY response; its playlist URLs are tokenized.
      const uhd = await uhdStreamFor(contentId, state.selectedChannelId, { maxAge: 60 * 1000 });
      if (playbackSeq !== state.playbackSeq || state.currentView !== "player") return;
      if (uhd) {
        await startUhdPlayback(uhd, { ...options, audioLanguage, subtitleLanguage, playbackSeq });
        return;
      }
      showToast("Ultra HD is not available for this video. Playing HD.");
      status.textContent = "Requesting your F1 TV stream…";
    }
    const stream = await state.session.play(contentId, state.selectedChannelId);
    if (playbackSeq !== state.playbackSeq || state.currentView !== "player") return;
    if (!window.dashjs?.MediaPlayer) throw new Error("The TV player engine did not load.");
    const player = window.dashjs.MediaPlayer().create();
    state.dashPlayer = player;
    // Start every TV in adaptive Auto mode with no legacy 540p ceiling.
    const abrSettings = {
      limitBitrateByPortal: false,
      autoSwitchBitrate: { audio: true, video: true },
      maxBitrate: { audio: -1, video: -1 },
    };
    player.updateSettings({ debug: { logLevel: 0 }, streaming: { abr: abrSettings } });
    if (stream.drmType === "widevine") {
      player.setProtectionData({
        "com.widevine.alpha": {
          serverURL: stream.licenseUrl,
          httpRequestHeaders: stream.headers,
          withCredentials: true,
          audioRobustness: "HW_SECURE_CRYPTO",
          videoRobustness: "HW_SECURE_DECODE",
        },
      });
    }
    // Subtitles start off unless the viewer chose a language; that language is
    // turned on once, as soon as the feed lists it.
    let subtitlesApplied = false;
    const applySubtitleLanguage = () => {
      if (!subtitleLanguage) {
        if (!state.subtitleChoiceMade) disableDefaultSubtitles(player);
        return;
      }
      if (subtitlesApplied || state.subtitleManual) return;
      const index = state.textTracks.findIndex((track) => languageBase(track.lang) === languageBase(subtitleLanguage));
      if (index < 0) {
        disableDefaultSubtitles(player);
        return;
      }
      subtitlesApplied = true;
      try { player.enableText(true); player.setTextTrack(index); } catch (_error) {}
    };
    player.on(window.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      status.textContent = "Playing on F1 TV";
      try { state.audioTracks = player.getTracksFor("audio") || []; } catch (_error) { state.audioTracks = []; }
      try { state.textTracks = player.getTracksFor("text") || []; } catch (_error) { state.textTracks = []; }
      if (audioLanguage) {
        const audio = state.audioTracks.find((track) => languageBase(track.lang) === languageBase(audioLanguage));
        try { if (audio) player.setCurrentTrack(audio); } catch (_error) {}
      }
      if (hdQuality) {
        // A remembered fixed height: the closest rung not above it.
        const rungs = videoQualityList(player);
        const rung = rungs.filter((info) => info.height <= hdQuality).pop() || rungs[0];
        try {
          if (rung) { setAutoQuality(player, false); player.setQualityFor("video", rung.qualityIndex, true); }
        } catch (_error) {}
      }
      applySubtitleLanguage();
      renderPlayerQuality();
      renderPlayerAudio();
      renderPlayerSubtitles();
      video.play().catch(() => {});
      updateTimeline();
    });
    const textTrackAdded = window.dashjs.MediaPlayer.events.TEXT_TRACK_ADDED;
    if (textTrackAdded) player.on(textTrackAdded, () => {
      try { state.textTracks = player.getTracksFor("text") || []; } catch (_error) { state.textTracks = []; }
      applySubtitleLanguage();
      renderPlayerSubtitles();
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
    // Switching from 4K resumes at the same position (VOD only).
    player.initialize(video, stream.manifest, true, options.resumeAt > 0 ? options.resumeAt : NaN);
    const ttmlRenderingDiv = document.getElementById("player-ttml-rendering");
    if (ttmlRenderingDiv) {
      try { player.attachTTMLRenderingDiv(ttmlRenderingDiv); }
      catch (error) { console.warn("Could not attach the TTML subtitle renderer.", error); }
    }
    if (!state.playerPanel) video.focus();
    window.clearInterval(state.timelineTimer);
    state.timelineTimer = window.setInterval(updateTimeline, 1000);
    state.playerTimer = window.setTimeout(() => hidePlayerChrome(), 5000);
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
  if (state.hlsPlayer) {
    try { state.hlsPlayer.destroy(); } catch (_error) {}
    state.hlsPlayer = null;
  }
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
  state.audioTracks = [];
  state.pendingSeekValue = null;
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
  const actualFraction = Math.max(0, Math.min(1, (video.currentTime - range.start) / (range.end - range.start)));
  if (state.pendingSeekValue === null) scrubber.value = String(Math.round(actualFraction * 1000));
  liveButton.hidden = !state.playerLive;
  if (state.pendingSeekValue !== null && document.activeElement === scrubber) {
    const target = range.start + (range.end - range.start) * (state.pendingSeekValue / 1000);
    const fromLive = Math.max(0, range.end - target);
    label.textContent = state.playerLive
      ? `LIVE −${formatTime(fromLive)} · OK to seek`
      : `${formatTime(target)} · OK to seek`;
    return;
  }
  if (document.activeElement === scrubber) {
    label.textContent = state.playerLive ? "LIVE · Left/right to move · OK to seek" : `${formatTime(video.currentTime)} · Left/right to move · OK to seek`;
    return;
  }
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
  state.pendingSeekValue = null;
  updateTimeline();
}

function adjustPendingSeek(direction) {
  const video = document.getElementById("player-video");
  const scrubber = document.getElementById("player-scrubber");
  const range = timelineRange(video);
  if (!range || range.end <= range.start) return;
  const span = range.end - range.start;
  const step = Math.max(1, Math.round(1000 * 5 / span));
  const currentValue = state.pendingSeekValue === null ? Number(scrubber.value) : state.pendingSeekValue;
  state.pendingSeekValue = Math.max(0, Math.min(1000, currentValue + direction * step));
  scrubber.value = String(state.pendingSeekValue);
  updateTimeline();
}

function confirmPendingSeek() {
  const scrubber = document.getElementById("player-scrubber");
  if (state.pendingSeekValue === null) {
    seekScrubber();
    return;
  }
  scrubber.value = String(state.pendingSeekValue);
  seekScrubber();
}

function cancelPendingSeek() {
  if (state.pendingSeekValue === null) return;
  state.pendingSeekValue = null;
  updateTimeline();
}

function goLive() {
  const video = document.getElementById("player-video");
  const range = timelineRange(video);
  if (!range) return;
  video.currentTime = Math.max(range.start, range.end - 1.5);
  updateTimeline();
}

function focusScope() {
  const updateDialog = document.getElementById("update-dialog");
  if (!updateDialog.hidden) return updateDialog;
  const signOutDialog = document.getElementById("sign-out-dialog");
  if (!signOutDialog.hidden) return signOutDialog;
  const signInDialog = document.getElementById("sign-in-dialog");
  if (!signInDialog.hidden) return signInDialog;
  const playerView = document.getElementById("player-view");
  if (!playerView.hidden) {
    const options = state.playerPanel ? playerPanelElement(state.playerPanel) : null;
    return options || document.querySelector(".player-chrome");
  }
  const activeView = ["home", "search", "detail", "error"]
    .map((id) => document.getElementById(`${id}-view`))
    .find((view) => view && !view.hidden);
  return { views: [document.querySelector(".topbar"), activeView].filter(Boolean) };
}

function focusables() {
  const scope = focusScope();
  const roots = scope.views || [scope];
  return roots.flatMap((root) => [...root.querySelectorAll(".focusable")])
    .filter((node) => !node.disabled && !node.closest("[hidden]") && node.getClientRects().length > 0);
}

function revealFocusTarget(target) {
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function nearestCardInSection(section, reference) {
  const cards = [...(section?.querySelectorAll(".content-card") || [])];
  if (!cards.length) return null;
  if (reference.matches?.(".content-card")) {
    const index = cards.indexOf(reference);
    if (index >= 0) return cards[index];
  }
  const referenceX = reference.getBoundingClientRect().left + reference.getBoundingClientRect().width / 2;
  return cards.reduce((nearest, card) => {
    const rect = card.getBoundingClientRect();
    const distance = Math.abs(rect.left + rect.width / 2 - referenceX);
    return !nearest || distance < nearest.distance ? { card, distance } : nearest;
  }, null)?.card || null;
}

function moveHomeBetweenRows(event, key, current) {
  if (state.currentView !== "home" || !["ArrowUp", "ArrowDown"].includes(key)) return false;
  const sections = [...document.querySelectorAll("#content-rails > .content-section")];
  const heroAction = document.querySelector("#hero .hero-actions .focusable");
  const main = document.getElementById("main-content");
  let target = null;

  if (key === "ArrowDown") {
    if (current.closest(".topbar")) {
      target = heroAction || nearestCardInSection(sections[0], current);
    } else if (current.closest("#hero")) {
      target = nearestCardInSection(sections[0], current);
    } else if (current.matches?.(".view-all")) {
      target = nearestCardInSection(current.closest(".content-section"), current);
    } else if (current.matches?.(".content-card")) {
      const rowIndex = sections.indexOf(current.closest(".content-section"));
      if (rowIndex >= 0 && rowIndex < sections.length - 1) {
        target = nearestCardInSection(sections[rowIndex + 1], current);
      }
    }
  } else if (current.matches?.(".content-card")) {
    const rowIndex = sections.indexOf(current.closest(".content-section"));
    target = rowIndex === 0
      ? heroAction
      : rowIndex > 0 ? nearestCardInSection(sections[rowIndex - 1], current) : null;
  }

  if (!target) return false;
  event.preventDefault();
  target.focus({ preventScroll: true });
  if (target.closest("#hero")) main.scrollTop = 0;
  else revealFocusTarget(target);
  return true;
}

function moveFocus(event, key = event.key) {
  const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key];
  if (!direction) return false;
  const current = document.activeElement;
  // The account button is the rightmost top-level control; don't let the
  // geometric focus search wrap into content when the user presses Right.
  if (current.id === "account-button" && key === "ArrowRight") {
    event.preventDefault();
    return true;
  }
  if ((key === "ArrowLeft" || key === "ArrowRight") && current.matches?.(".content-card")) {
    const rail = current.closest(".content-rail");
    const cards = rail ? [...rail.querySelectorAll(".content-card")] : [];
    const index = cards.indexOf(current);
    const next = cards[index + (key === "ArrowRight" ? 1 : -1)];
    event.preventDefault();
    if (next) {
      next.focus();
      revealFocusTarget(next);
    }
    return true;
  }
  if (current.matches?.("input:not([type='range']), textarea, [contenteditable='true']")
      && (key === "ArrowLeft" || key === "ArrowRight")) return false;
  if (moveHomeBetweenRows(event, key, current)) return true;
  const firstContentRail = document.querySelector("#content-rails .content-rail");
  const heroAction = document.querySelector("#hero .hero-actions .focusable");
  if (key === "ArrowUp" && current.matches?.(".content-card")
      && current.closest(".content-rail") === firstContentRail && heroAction) {
    event.preventDefault();
    heroAction.focus({ preventScroll: true });
    document.getElementById("main-content").scrollTop = 0;
    return true;
  }
  const items = focusables();
  if (!items.length) { event.preventDefault(); return true; }
  if (!items.includes(current)) {
    event.preventDefault();
    items[0].focus();
    revealFocusTarget(items[0]);
    return true;
  }
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
    // Prefer controls in the same visual row/column before jumping to a nearby
    // item in a different row, which is especially important on a TV remote.
    const score = primary + cross * 4;
    if (score < bestScore) { best = item; bestScore = score; }
  });
  event.preventDefault();
  if (best) {
    best.focus();
    if (key === "ArrowUp" && best.closest("#hero")) {
      // The large featured card fits inside the content viewport, but nearest
      // scrolling can leave it partly above the screen after moving down a row.
      // Restore the home scroll origin when D-pad focus returns to the hero.
      document.getElementById("main-content").scrollTop = 0;
    } else {
      revealFocusTarget(best);
    }
  }
  return true;
}

function onRemoteKey(event) {
  const key = event.key?.startsWith("Arrow") ? event.key : ({
    37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown",
  }[event.keyCode] || ({ Left: "ArrowLeft", Up: "ArrowUp", Right: "ArrowRight", Down: "ArrowDown" }[event.key] || event.key));
  const editingText = document.activeElement.matches?.("input:not([type='range']), textarea, [contenteditable='true']");
  if (!document.getElementById("update-dialog").hidden) {
    if (key === "Escape" || key === "Back" || (key === "Backspace" && !editingText) || event.keyCode === 461) {
      event.preventDefault();
      closeUpdateDialog();
    } else {
      moveFocus(event, key);
    }
    return;
  }
  if (!document.getElementById("sign-out-dialog").hidden) {
    if (key === "Escape" || key === "Back" || (key === "Backspace" && !editingText) || event.keyCode === 461) {
      event.preventDefault();
      closeSignOutConfirmation();
    } else {
      moveFocus(event, key);
    }
    return;
  }
  if (document.getElementById("sign-in-dialog") && !document.getElementById("sign-in-dialog").hidden) {
    if (key === "Escape" || key === "Back" || (key === "Backspace" && !editingText) || event.keyCode === 461) {
      event.preventDefault();
      closeSignIn();
    } else {
      moveFocus(event, key);
    }
    return;
  }
  if (!document.getElementById("player-view").hidden) {
    if (key === "Escape" || key === "Back" || (key === "Backspace" && !editingText) || event.keyCode === 461) {
      event.preventDefault();
      requestAppBack();
      return;
    }
    if (["ContextMenu", "Menu"].includes(key) || event.keyCode === 93) {
      event.preventDefault();
      showPlayerPanel("sources");
      return;
    }
    const scrubber = document.getElementById("player-scrubber");
    if (document.activeElement === scrubber) {
      if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        adjustPendingSeek(key === "ArrowLeft" ? -1 : 1);
        window.clearTimeout(state.playerTimer);
        return;
      }
      if (["Enter", "Select", "Accept"].includes(key) || event.keyCode === 13) {
        event.preventDefault();
        confirmPendingSeek();
        window.clearTimeout(state.playerTimer);
        return;
      }
    }
    if (key === "ArrowRight" && document.activeElement === document.getElementById("player-video")) {
      event.preventDefault();
      showPlayerPanel("sources");
      return;
    }
    showPlayerChrome();
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) moveFocus(event, key);
    window.clearTimeout(state.playerTimer);
    state.playerTimer = window.setTimeout(() => hidePlayerChrome(), 5000);
    return;
  }
  if (key === "Escape" || key === "Back" || (key === "Backspace" && !editingText) || event.keyCode === 461) {
    if (state.currentView !== "home" || (state.pageTitle !== "Home" && state.homeData)) {
      event.preventDefault();
      requestAppBack();
    }
    return;
  }
  if (activateAdjacentTab(event, key)) return;
  if (state.currentView === "home" && (key === "ArrowLeft" || key === "ArrowRight")
      && document.activeElement.closest?.("#hero")
      && advanceHeroFromControl(key, document.activeElement)) {
    event.preventDefault();
    return;
  }
  moveFocus(event, key);
}

function activateAdjacentTab(event, key) {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
  const current = document.activeElement;
  if (!current.matches?.("#primary-nav .nav-button")) return false;

  const tabs = [...document.querySelectorAll("#primary-nav .nav-button")];
  const index = tabs.indexOf(current);
  const adjacent = tabs[index + (key === "ArrowRight" ? 1 : -1)];
  if (!adjacent) return false;

  event.preventDefault();
  adjacent.click();
  // Search normally moves focus into its input on a pointer click. Keep focus
  // on the tab for D-pad navigation so the next arrow continues across tabs.
  adjacent.focus({ preventScroll: true });
  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  window.history.replaceState({ f1tv: true, screen: "home", panel: null }, "", window.location.href);
  window.addEventListener("popstate", handleAppPopState);
  document.getElementById("back-button").addEventListener("click", requestAppBack);
  document.getElementById("search-back").addEventListener("click", requestAppBack);
  document.getElementById("search-form").addEventListener("submit", submitSearch);
  document.getElementById("play-button").addEventListener("click", playSelected);
  document.getElementById("player-back").addEventListener("click", exitPlayer);
  document.getElementById("player-sources-toggle").addEventListener("click", () => showPlayerPanel("sources"));
  document.getElementById("player-language-toggle").addEventListener("click", () => showPlayerPanel("language"));
  document.getElementById("player-sources-close").addEventListener("click", () => closePlayerPanel());
  document.getElementById("player-language-close").addEventListener("click", () => closePlayerPanel());
  document.getElementById("player-video").tabIndex = 0;
  document.getElementById("player-video").addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openPlayerOptions();
  });
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
  document.getElementById("player-scrubber").addEventListener("click", () => {
    if (state.pendingSeekValue !== null) confirmPendingSeek();
  });
  document.getElementById("player-scrubber").addEventListener("blur", cancelPendingSeek);
  document.getElementById("sign-in-cancel").addEventListener("click", closeSignIn);
  document.getElementById("sign-out-cancel").addEventListener("click", () => closeSignOutConfirmation());
  document.getElementById("sign-out-confirm").addEventListener("click", confirmSignOut);
  document.getElementById("sign-out-updates").addEventListener("click", () => {
    closeSignOutConfirmation();
    checkForUpdates({ interactive: true });
  });
  document.getElementById("sign-in-updates").addEventListener("click", () => {
    // Signed-out viewers reach the updates dialog from the sign-in dialog.
    closeSignIn({ navigate: false });
    checkForUpdates({ interactive: true });
  });
  document.getElementById("update-install").addEventListener("click", installUpdate);
  document.getElementById("update-skip").addEventListener("click", () => {
    if (state.update) writeSetting(UPDATE_SKIP_KEY, state.update.version);
    closeUpdateDialog();
  });
  document.getElementById("update-close").addEventListener("click", closeUpdateDialog);
  document.getElementById("update-auto").addEventListener("click", toggleAutoUpdateChecks);
  appVersion().then((version) => {
    const label = document.getElementById("sign-out-version");
    if (label && version) label.textContent = `Race Weekend ${version}`;
  });
  document.getElementById("account-button").addEventListener("click", () => {
    if (state.session?.signedIn) {
      openSignOutConfirmation();
    } else if (!state.session?.signedIn) beginSignIn();
  });
  document.getElementById("retry-button").addEventListener("click", loadHome);
  document.addEventListener("keydown", onRemoteKey);
  state.session = new window.F1Session();
  state.session.restore().then(setAccountLabel).catch(() => setAccountLabel());
  loadHome();
  scheduleAutomaticUpdateCheck();
});
