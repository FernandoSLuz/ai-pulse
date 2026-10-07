(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const rawHandle = (params.get("handle") || "").trim().replace(/^@+/, "");
  const handle = /^[A-Za-z0-9_]{1,15}$/.test(rawHandle) ? rawHandle : "";
  const theme = params.get("theme") === "light" ? "light" : "dark";
  const requestedHeight = Number(params.get("height"));
  const height = Number.isFinite(requestedHeight) && requestedHeight >= 180 && requestedHeight <= 1200
    ? Math.round(requestedHeight)
    : 560;
  const container = document.getElementById("embed");
  const timeoutMs = 15_000;
  let timer;
  let sent = false;
  let settled = false;

  function send(state) {
    if (sent) return;
    sent = true;
    window.parent.postMessage({ type: "x-embed", handle, state }, "*");
  }

  function showUnavailable(message) {
    if (!container) return;
    container.innerHTML = "";
    const text = document.createElement("p");
    text.className = "unavailable";
    text.textContent = message || "This X profile is unavailable here.";
    if (handle) {
      const link = document.createElement("a");
      link.href = `https://x.com/${encodeURIComponent(handle)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = " Open on X";
      text.append(link);
    }
    container.append(text);
  }

  function unavailable(message) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    showUnavailable(message);
    send("unavailable");
  }

  function loadWidgets() {
    return new Promise((resolve, reject) => {
      if (window.twttr?.widgets?.createTimeline) {
        resolve(window.twttr);
        return;
      }
      const existing = document.querySelector("script[data-x-widgets]");
      if (existing) {
        existing.addEventListener("load", () => window.twttr?.widgets ? resolve(window.twttr) : reject(new Error("X widgets unavailable")), { once: true });
        existing.addEventListener("error", () => reject(new Error("X widgets unavailable")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      script.dataset.xWidgets = "true";
      script.onload = () => window.twttr?.widgets ? resolve(window.twttr) : reject(new Error("X widgets unavailable"));
      script.onerror = () => reject(new Error("X widgets unavailable"));
      document.head.append(script);
    });
  }

  if (!handle || !container) {
    unavailable("Enter a valid X username to load this profile.");
    return;
  }

  timer = setTimeout(() => unavailable("X did not load this profile in time."), timeoutMs);
  // Let the widget render into a disposable mount. If its promise settles
  // after timeout, the detached mount prevents late DOM mutations from
  // replacing the unavailable state shown to the parent.
  const mount = document.createElement("div");
  container.innerHTML = "";
  container.append(mount);
  loadWidgets()
    .then((twttr) => twttr.widgets.createTimeline(
      { sourceType: "profile", screenName: handle },
      mount,
      { theme, dnt: true, height },
    ))
    .then((frame) => {
      if (settled) return;
      if (!frame) throw new Error("X profile unavailable");
      settled = true;
      clearTimeout(timer);
      send("ready");
    })
    .catch(() => unavailable("This X profile is unavailable here."));
})();
