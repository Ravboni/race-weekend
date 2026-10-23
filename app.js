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
  const error = document.getElementById("error-view");
  home.hidden = name !== "home";
  detail.hidden = name !== "detail";
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
  const href = contentHref(item);
  if (!href) {
    showToast("A playback link was not provided for this item.");
    return;
  }
  window.location.assign(new URL(href, API_ORIGIN).toString());
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
  document.getElementById("retry-button").addEventListener("click", loadHome);
  document.addEventListener("keydown", onRemoteKey);
  loadHome();
});
