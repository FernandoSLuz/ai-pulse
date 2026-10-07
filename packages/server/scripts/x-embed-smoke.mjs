import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../web/x-embed.js", import.meta.url), "utf8");

async function run({ search = "?handle=sama", script = "success", timeline = "success", advance = null } = {}) {
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const children = [];
  const container = {
    _innerHTML: "<p>Loading X profile…</p>",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) { this._innerHTML = value; if (!value) children.splice(0, children.length); },
    append(child) { children.push(child); this._innerHTML = ""; },
    replaceChildren(...next) { children.splice(0, children.length, ...next); },
  };
  const head = {
    append(element) {
      if (script === "success") {
        setImmediate(() => {
          window.twttr = { widgets: {
            createTimeline(_source, mount) {
              mount.append({ type: "iframe" });
              return timeline === "reject" ? Promise.reject(new Error("unavailable")) : Promise.resolve({});
            },
          } };
          element.onload?.();
        });
      } else if (script === "failure") {
        setImmediate(() => element.onerror?.(new Error("network")));
      }
    },
  };
  const document = {
    head,
    getElementById(id) { return id === "embed" ? container : null; },
    querySelector() { return null; },
    createElement(tag) {
      const element = {
        tagName: tag,
        dataset: {},
        addEventListener(type, callback) { listeners.set(type, callback); },
        append() {},
      };
      return element;
    },
  };
  const window = {
    location: { search },
    parent: { postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); } },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const context = vm.createContext({ window, document, URLSearchParams, setImmediate, Promise, Number, encodeURIComponent, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout });
  vm.runInContext(source, context, { filename: "x-embed.js" });
  if (advance !== null) {
    for (const { callback } of timers.values()) callback();
  }
  await new Promise((resolve) => setImmediate(resolve));
  return { messages, container, children };
}

const success = await run();
assert.deepEqual(success.messages, [{ type: "x-embed", handle: "sama", state: "ready" }]);
assert.equal(success.children.length, 1);

const rejected = await run({ timeline: "reject" });
assert.deepEqual(rejected.messages, [{ type: "x-embed", handle: "sama", state: "unavailable" }]);

const scriptFailure = await run({ script: "failure" });
assert.deepEqual(scriptFailure.messages, [{ type: "x-embed", handle: "sama", state: "unavailable" }]);

const timeout = await run({ script: "success", advance: 0 });
assert.deepEqual(timeout.messages, [{ type: "x-embed", handle: "sama", state: "unavailable" }]);
assert.equal(timeout.children.length, 1);

const invalid = await run({ search: "?handle=@not-valid!" });
assert.deepEqual(invalid.messages, [{ type: "x-embed", handle: "", state: "unavailable" }]);

console.log("x embed smoke: OK");
