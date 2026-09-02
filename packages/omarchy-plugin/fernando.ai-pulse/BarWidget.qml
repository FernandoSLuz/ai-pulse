import QtQuick
import Quickshell.Io
import qs.Ui
import qs.Commons

// AI Pulse bar widget for omarchy-shell: shows the current leaderboard leader
// and goes urgent when the local server is down or AI curation has fallen
// back to rules. Everything comes from the server's HTTP API on loopback.
//
//   left   = open the dashboard in the browser
//   right  = open the AI Pulse settings window (aipulse:// deep link)
//   middle = refresh now
BarWidget {
  id: root
  moduleName: "fernando.ai-pulse"

  // ── Settings (mirror manifest.json barWidget.defaults) ──────────────────
  readonly property int port: setting("port", 3847)
  readonly property int intervalSec: setting("interval", 60)
  readonly property bool showLeader: setting("showLeader", true)
  readonly property int maxChars: setting("maxChars", 18)

  // Nerd Font glyph (nf-fa-signal), written as an escape so editors can't mangle it.
  readonly property string icon: ""

  // ── State ───────────────────────────────────────────────────────────────
  property bool online: false
  property bool degraded: false
  property string leader: ""
  property string leaderScore: ""
  property string provider: ""
  property string models: ""
  property string lastError: ""

  readonly property string barText: {
    if (!online) return icon + " off"
    if (!showLeader || leader === "") return icon
    var name = leader.length > maxChars ? leader.slice(0, Math.max(3, maxChars - 1)) + "…" : leader
    return icon + " " + name
  }

  readonly property string barTooltip: {
    if (!online) return "AI Pulse: no server on port " + port + (lastError !== "" ? " (" + lastError + ")" : "")
    var lines = ["AI Pulse"]
    if (leader !== "") lines.push("Leader: " + leader + (leaderScore !== "" ? "  (" + leaderScore + ")" : ""))
    lines.push("Curation: " + (degraded ? "degraded (rules)" : (provider !== "" ? provider : "ok")))
    if (models !== "") lines.push("Models: " + models)
    return lines.join("\n")
  }

  // ── Polling ─────────────────────────────────────────────────────────────
  function refresh() {
    if (!healthProc.running) healthProc.running = true
    if (!rankingsProc.running) rankingsProc.running = true
  }

  function applyHealth(text) {
    try {
      var h = JSON.parse(text)
      online = h.ok === true && (h.app === undefined || h.app === "ai-pulse")
      models = h.models !== undefined ? String(h.models) : ""
      // lastOutcome = { source, model, degraded, at } (packages/server/src/analyst/engine.ts)
      var outcome = h.analyst ? h.analyst.lastOutcome : null
      var served = outcome ? (outcome.model || outcome.source || "") : ""
      degraded = !!outcome && (outcome.degraded === true || outcome.source === "rules")
      provider = degraded ? "" : String(served)
      lastError = ""
    } catch (e) {
      online = false
      lastError = "unreadable health payload"
    }
  }

  function applyRankings(text) {
    try {
      var r = JSON.parse(text)
      var list = Array.isArray(r) ? r : (r.models || r.rankings || r.items || [])
      var top = list.length > 0 ? list[0] : null
      leader = top ? String(top.name || top.slug || "") : ""
      var score = top && top.intelligence !== undefined && top.intelligence !== null ? top.intelligence : null
      leaderScore = score !== null ? "int " + (Math.round(Number(score) * 10) / 10) : ""
    } catch (e) {
      leader = ""
      leaderScore = ""
    }
  }

  Process {
    id: healthProc
    command: ["curl", "-fsS", "--max-time", "3", "http://127.0.0.1:" + root.port + "/api/health"]
    stdout: StdioCollector {
      onStreamFinished: root.applyHealth(text)
    }
    onExited: function (exitCode) {
      if (exitCode !== 0) {
        root.online = false
        root.lastError = "curl exited " + exitCode
      }
    }
  }

  Process {
    id: rankingsProc
    command: ["curl", "-fsS", "--max-time", "5", "http://127.0.0.1:" + root.port + "/api/rankings"]
    stdout: StdioCollector {
      onStreamFinished: root.applyRankings(text)
    }
  }

  Timer {
    interval: Math.max(5000, root.intervalSec * 1000)
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // ── Bar reading ─────────────────────────────────────────────────────────
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barText
    tooltipText: root.barTooltip
    active: !root.online || root.degraded
    onPressed: function (b) {
      if (b === Qt.RightButton) Util.execArgv(["xdg-open", "aipulse://settings"])
      else if (b === Qt.MiddleButton) root.refresh()
      else Util.execArgv(["xdg-open", "http://127.0.0.1:" + root.port + "/"])
    }
  }
}
