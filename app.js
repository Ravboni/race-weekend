const mediaTypes = {
  widevine: "com.widevine.alpha",
  playready: "com.microsoft.playready",
};

function setValue(id, value, state) {
  const element = document.getElementById(id);
  element.textContent = value;
  element.classList.remove("good", "bad");
  if (state) element.classList.add(state);
}

async function supportsDrm(keySystem) {
  if (typeof navigator.requestMediaKeySystemAccess !== "function") return false;

  const configurations = [{
    initDataTypes: ["cenc"],
    videoCapabilities: [
      { contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
      { contentType: 'video/mp4; codecs="avc1.42E01E"' },
    ],
  }];

  try {
    await navigator.requestMediaKeySystemAccess(keySystem, configurations);
    return true;
  } catch (_error) {
    return false;
  }
}

async function runDeviceCheck() {
  const ua = navigator.userAgent || "Unknown browser runtime";
  const webosMatch = ua.match(/Web0S|webOS[\s/]?([\d.]+)?/i);
  setValue("platform-value", webosMatch ? `webOS${webosMatch[1] ? ` ${webosMatch[1]}` : ""}` : "TV runtime (version unavailable)");

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

  const note = document.getElementById("check-note");
  note.textContent = "Capability results are a first-pass check only. F1 TV login, entitlement, manifest compatibility, and license-server acceptance still need separate testing.";
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

function openF1FromLaunchParams() {
  if (readLaunchParams().open === "f1") {
    window.location.assign("https://f1tv.formula1.com/");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  runDeviceCheck();
  document.getElementById("check-button").addEventListener("click", runDeviceCheck);
  document.getElementById("open-f1-button").addEventListener("click", () => {
    window.location.assign("https://f1tv.formula1.com/");
  });
  openF1FromLaunchParams();
});

document.addEventListener("webOSLaunch", openF1FromLaunchParams);
document.addEventListener("webOSRelaunch", openF1FromLaunchParams);
