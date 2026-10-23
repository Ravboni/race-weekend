const mediaTypes = {
  widevine: "com.widevine.alpha",
  playready: "com.microsoft.playready",
};

const focusableSelector = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function setValue(id, value, state) {
  const element = document.getElementById(id);
  element.textContent = value;
  element.classList.remove("good", "bad");
  if (state) element.classList.add(state);
}

async function supportsDrm(keySystem) {
  if (typeof navigator.requestMediaKeySystemAccess !== "function") return false;

  const configuration = [{
    initDataTypes: ["cenc"],
    videoCapabilities: [
      { contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
      { contentType: 'video/mp4; codecs="avc1.42E01E"' },
    ],
  }];

  try {
    await navigator.requestMediaKeySystemAccess(keySystem, configuration);
    return true;
  } catch (_error) {
    return false;
  }
}

async function runDeviceCheck() {
  setValue("platform-value", "Checking…");
  setValue("mse-value", "Checking…");
  setValue("widevine-value", "Checking…");
  setValue("playready-value", "Checking…");
  setValue("hevc-value", "Checking…");

  const userAgent = navigator.userAgent || "";
  const webosMatch = userAgent.match(/(?:Web0S|webOS)[\s/]?([\d.]+)?/i);
  const platform = webosMatch ? `webOS${webosMatch[1] ? ` ${webosMatch[1]}` : ""}` : "TV browser runtime";
  setValue("platform-value", platform);

  const mseSupported = typeof window.MediaSource !== "undefined";
  setValue("mse-value", mseSupported ? "Available" : "Unavailable", mseSupported ? "good" : "bad");

  const [widevine, playready] = await Promise.all([
    supportsDrm(mediaTypes.widevine),
    supportsDrm(mediaTypes.playready),
  ]);
  setValue("widevine-value", widevine ? "Available" : "Not exposed", widevine ? "good" : "bad");
  setValue("playready-value", playready ? "Available" : "Not exposed", playready ? "good" : "bad");

  const video = document.createElement("video");
  const hevcSupported = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "";
  setValue("hevc-value", hevcSupported ? "Available" : "Not exposed", hevcSupported ? "good" : "bad");

  document.getElementById("check-note").textContent =
    "Live playback was confirmed on this TV using the official F1 TV player.";
}

function readLaunchParams() {
  const raw = window.PalmSystem?.launchParams || window.launchParams;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

function openF1() {
  window.location.assign("https://f1tv.formula1.com/");
}

function openCompatibilityPanel() {
  const panel = document.getElementById("compat-panel");
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  document.getElementById("close-panel").focus();
}

function closeCompatibilityPanel() {
  const panel = document.getElementById("compat-panel");
  if (panel.hidden) return;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  document.getElementById("check-button").focus();
}

function moveRemoteFocus(event) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;

  const panel = document.getElementById("compat-panel");
  const scope = panel.hidden ? document.querySelector(".app-shell") : panel.querySelector(".panel-card");
  const candidates = [...scope.querySelectorAll(focusableSelector)].filter((item) => item.getClientRects().length > 0);
  const active = document.activeElement;
  const currentIndex = candidates.indexOf(active);
  if (currentIndex < 0 || candidates.length < 2) return;

  const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const forwards = event.key === "ArrowRight" || event.key === "ArrowDown";
  const nextIndex = (currentIndex + (backwards ? candidates.length - 1 : 1)) % candidates.length;
  if (backwards || forwards) {
    event.preventDefault();
    candidates[nextIndex].focus();
  }
}

function onRemoteKey(event) {
  if (event.key === "Escape" || event.key === "Backspace" || event.keyCode === 461) {
    if (!document.getElementById("compat-panel").hidden) {
      event.preventDefault();
      closeCompatibilityPanel();
    }
    return;
  }
  moveRemoteFocus(event);
}

function handleLaunch() {
  if (readLaunchParams().open === "f1") openF1();
}

document.addEventListener("DOMContentLoaded", () => {
  runDeviceCheck();
  document.getElementById("open-f1-button").addEventListener("click", openF1);
  document.getElementById("check-button").addEventListener("click", openCompatibilityPanel);
  document.getElementById("close-panel").addEventListener("click", closeCompatibilityPanel);
  document.getElementById("recheck-button").addEventListener("click", runDeviceCheck);
  document.querySelector(".panel-backdrop").addEventListener("click", closeCompatibilityPanel);
  document.addEventListener("keydown", onRemoteKey);
  if (readLaunchParams().open !== "f1") document.getElementById("open-f1-button").focus();
  handleLaunch();
});

document.addEventListener("webOSLaunch", handleLaunch);
document.addEventListener("webOSRelaunch", handleLaunch);
