import QtQuick
import QtQuick.Controls
import Quickshell.Io
import qs.Ui
import qs.Commons

// AI Pulse for omarchy-shell: a bar readout (leader + curation health) and a
// popup panel with the leaderboard, opened from the bar like the first-party
// panels — it never moves other windows. Everything comes from the local
// AI Pulse server over loopback (curl), so this file has no Electron dependency.
//
//   bar: left = panel · right = AI Pulse settings · middle = refresh
//   panel: j/k move · Enter open model · R refresh · D dashboard · S settings · Esc close
Panel {
  id: root
  moduleName: "fernando.ai-pulse"
  ipcTarget: "fernando.ai-pulse"

  // ── Settings (mirror manifest.json barWidget.defaults) ──────────────────
  readonly property int port: setting("port", 3847)
  readonly property int intervalSec: setting("interval", 60)
  readonly property bool showLeader: setting("showLeader", true)
  readonly property int maxChars: setting("maxChars", 18)
  readonly property int rowLimit: setting("rows", 25)

  readonly property string icon: "" // nf-fa-signal
  readonly property string apiBase: "http://127.0.0.1:" + port
  readonly property bool vertical: bar ? bar.vertical : false
  readonly property color fg: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(fg, 1.5)
  readonly property color faint: Qt.darker(fg, 1.9)
  readonly property string mono: bar ? bar.fontFamily : Style.font.family

  // ── Server state ────────────────────────────────────────────────────────
  property bool online: false
  property bool degraded: false
  property string provider: ""
  property int modelCount: 0
  property var rankings: null   // { models, winners, variantAliases, updatedAt }
  property var stack: null      // { entries, roleGaps }
  property string headline: ""
  property string lastError: ""

  readonly property var models: rankings && rankings.models ? rankings.models : []
  readonly property var winners: rankings && rankings.winners ? rankings.winners : null
  readonly property var aliases: rankings && rankings.variantAliases ? rankings.variantAliases : ({})
  readonly property string leader: models.length > 0 ? shortName(models[0].displayName || models[0].name) : ""
  readonly property string updatedLabel: {
    if (!rankings || !rankings.updatedAt) return ""
    var d = new Date(rankings.updatedAt)
    return isNaN(d.getTime()) ? "" : Qt.formatTime(d, "HH:mm")
  }

  // ── Helpers (mirroring packages/web/widget.html) ────────────────────────
  readonly property var roleMeta: ({
    primary: { short: "Pri", label: "Primary" },
    secondary: { short: "Bud", label: "Budget" },
    free: { short: "Free", label: "Free" }
  })

  function resolveSlug(slug) { return aliases[slug] || slug }

  function shortName(name) {
    return String(name || "")
      .replace(/\s*\((?:Adaptive Reasoning|Non-reasoning|reasoning|Non-thinking|thinking)[^)]*\)/gi, "")
      .replace(/\s*\([^)]{18,}\)/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  }

  function cleanHeadline(text) {
    return String(text || "").replace(/\((\d+\.\d{2,})\)/g, function (_, n) { return "(" + Number(n).toFixed(1) + ")" })
  }

  function fmt(n) { return n > 0 ? String(Math.round(n * 10) / 10) : "—" }
  function fmtPrice(n) { return n > 0 ? Number(n).toFixed(2) : "—" }
  function fmtSpeed(n) { return n > 0 ? String(Math.round(n)) : "—" }

  function shortAccess(a) {
    if (!a) return "—"
    if (a.indexOf("Open") >= 0) return "Open"
    if (a.indexOf("Gated") >= 0) return "Gated"
    return "API"
  }

  function winnerMark(slug) {
    if (!winners) return ""
    if (winners.overall === slug) return "★"
    if (winners.coding === slug) return "C"
    if (winners.math === slug) return "M"
    if (winners.price === slug) return "$"
    if (winners.speed === slug) return "S"
    return ""
  }

  function quote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'" }

  readonly property var roleBySlug: {
    var map = {}
    var entries = stack && stack.entries ? stack.entries : []
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (!e.modelSlug) continue
      var key = resolveSlug(e.modelSlug)
      var meta = roleMeta[e.role] || { short: String(e.role).slice(0, 3) }
      map[key] = (map[key] ? map[key] + "+" : "") + meta.short
    }
    return map
  }

  // Top N by intelligence (the server sorts), plus the user's own picks even
  // when they fall outside the top N — the same rule the web widget applies.
  readonly property var rows: {
    var out = []
    var all = models
    var limit = Math.max(5, rowLimit)
    var shown = {}
    for (var i = 0; i < all.length && out.length < limit; i++) {
      var m = all[i]
      shown[m.slug] = true
      out.push(rowFor(m, i + 1))
    }
    for (var slug in roleBySlug) {
      if (shown[slug]) continue
      for (var j = 0; j < all.length; j++) {
        if (all[j].slug === slug) { out.unshift(rowFor(all[j], j + 1)); break }
      }
    }
    return out
  }

  function rowFor(m, rank) {
    return {
      rank: rank,
      win: winnerMark(m.slug),
      role: roleBySlug[m.slug] || "",
      name: shortName(m.displayName || m.name),
      creator: m.creator || "",
      intel: fmt(m.intelligence),
      code: fmt(m.coding),
      math: fmt(m.math),
      price: fmtPrice(m.priceBlended),
      spd: fmtSpeed(m.speed),
      acc: shortAccess(m.accessibility),
      url: m.url || "",
      top: rank === 1
    }
  }

  // Stack cards: current picks first, then the gaps the analyst wants filled.
  readonly property var cards: {
    var out = []
    var entries = stack && stack.entries ? stack.entries : []
    var top = models.length > 0 ? (models[0].intelligence || 0) : 0
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (!e.modelSlug) continue
      var meta = roleMeta[e.role] || { label: e.role }
      var model = null
      var idx = -1
      for (var j = 0; j < models.length; j++) {
        if (models[j].slug === resolveSlug(e.modelSlug)) { model = models[j]; idx = j; break }
      }
      var intel = model ? (model.intelligence || 0) : 0
      var delta = top && intel ? intel - top : 0
      var standing = !model ? "not in board" : (delta >= -0.05 ? "at top" : delta.toFixed(1) + " vs #1")
      out.push({ label: meta.label.toUpperCase(), name: shortName(e.modelName || e.modelSlug),
                 detail: (idx >= 0 ? "#" + (idx + 1) + " · " : "") + fmt(intel) + " · " + standing, gap: false })
    }
    var gaps = stack && stack.roleGaps ? stack.roleGaps : []
    for (var g = 0; g < gaps.length; g++) {
      var gm = roleMeta[gaps[g].role] || { label: gaps[g].role }
      out.push({ label: "MISSING " + gm.label.toUpperCase(), name: "Try " + shortName(gaps[g].modelName),
                 detail: "add on dashboard", gap: true })
    }
    return out.slice(0, 4)
  }

  // ── Bar readout ─────────────────────────────────────────────────────────
  readonly property string barText: {
    if (!online) return icon + " off"
    if (!showLeader || vertical || leader === "") return icon
    var name = leader.length > maxChars ? leader.slice(0, Math.max(3, maxChars - 1)) + "…" : leader
    return icon + " " + name
  }

  readonly property string barTooltip: {
    if (!online) return "AI Pulse: no server on port " + port + (lastError !== "" ? " (" + lastError + ")" : "")
    var lines = ["AI Pulse"]
    if (leader !== "") lines.push("Leader: " + leader)
    lines.push("Curation: " + (degraded ? "degraded (rules)" : (provider !== "" ? provider : "ok")))
    if (modelCount > 0) lines.push(modelCount + " models" + (updatedLabel !== "" ? " · updated " + updatedLabel : ""))
    return lines.join("\n")
  }

  readonly property string statusLine: {
    if (!online) return "SERVER OFFLINE · PORT " + port
    var parts = [degraded ? "CURATION DEGRADED (RULES)" : ("CURATION " + (provider !== "" ? provider.toUpperCase() : "OK"))]
    if (modelCount > 0) parts.push(modelCount + " MODELS")
    if (updatedLabel !== "") parts.push("UPDATED " + updatedLabel)
    return parts.join(" · ")
  }

  // ── Polling ─────────────────────────────────────────────────────────────
  function refresh() {
    if (!healthProc.running) healthProc.running = true
    if (!rankingsProc.running) rankingsProc.running = true
    if (!stackProc.running) stackProc.running = true
    if (!briefingProc.running) briefingProc.running = true
  }

  function applyHealth(text) {
    try {
      var h = JSON.parse(text)
      online = h.ok === true && (h.app === undefined || h.app === "ai-pulse")
      modelCount = h.models !== undefined ? Number(h.models) : 0
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
    try { rankings = JSON.parse(text) } catch (e) { /* keep the last good snapshot */ }
  }

  function applyStack(text) {
    try { stack = JSON.parse(text) } catch (e) { /* keep */ }
  }

  function applyBriefing(text) {
    try {
      var b = JSON.parse(text)
      headline = b && b.headline ? cleanHeadline(b.headline) : ""
    } catch (e) { /* keep */ }
  }

  Process {
    id: healthProc
    command: ["curl", "-fsS", "--max-time", "3", root.apiBase + "/api/health"]
    stdout: StdioCollector { onStreamFinished: root.applyHealth(text) }
    onExited: function (exitCode) {
      if (exitCode !== 0) { root.online = false; root.lastError = "curl exited " + exitCode }
    }
  }
  Process {
    id: rankingsProc
    command: ["curl", "-fsS", "--max-time", "5", root.apiBase + "/api/rankings"]
    stdout: StdioCollector { onStreamFinished: root.applyRankings(text) }
  }
  Process {
    id: stackProc
    command: ["curl", "-fsS", "--max-time", "5", root.apiBase + "/api/stack"]
    stdout: StdioCollector { onStreamFinished: root.applyStack(text) }
  }
  Process {
    id: briefingProc
    command: ["curl", "-fsS", "--max-time", "5", root.apiBase + "/api/briefing"]
    stdout: StdioCollector { onStreamFinished: root.applyBriefing(text) }
  }

  Timer {
    interval: Math.max(5000, root.intervalSec * 1000)
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // ── Keyboard cursor ─────────────────────────────────────────────────────
  property bool cursorActive: false
  property int selectedIndex: -1

  function selectByDelta(delta) {
    if (rows.length === 0) return
    selectedIndex = Math.max(0, Math.min(rows.length - 1, selectedIndex + delta))
  }

  function openUrl(url) {
    if (!url || !root.bar) return
    root.bar.run("xdg-open " + quote(url))
    root.close()
  }

  function activateSelected() {
    if (selectedIndex >= 0 && selectedIndex < rows.length) openUrl(rows[selectedIndex].url)
  }

  function openDashboard() {
    if (!root.bar) return
    root.bar.run("xdg-open " + quote(apiBase + "/"))
    root.close()
  }

  function openSettings() {
    if (!root.bar) return
    root.bar.run("xdg-open 'aipulse://settings'")
    root.close()
  }

  function openPanel() {
    cursorActive = false
    selectedIndex = -1
    refresh()
    root.open()
  }

  function handleBarPress(button) {
    if (button === Qt.RightButton) { openSettings(); return }
    if (button === Qt.MiddleButton) { refresh(); return }
    if (root.opened) root.close()
    else openPanel()
  }

  // ── Bar widget ──────────────────────────────────────────────────────────
  implicitWidth: layout.implicitWidth
  implicitHeight: layout.implicitHeight

  Row {
    id: layout
    anchors.centerIn: parent

    WidgetButton {
      bar: root.bar
      text: root.barText
      active: !root.online || root.degraded
      tooltipText: root.barTooltip
      onPressed: function (b) { root.handleBarPress(b) }
    }
  }

  // ── Panel ───────────────────────────────────────────────────────────────
  KeyboardPanel {
    id: panel
    anchorItem: layout
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(640))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent

      onMoveRequested: function (dx, dy) {
        if (!root.cursorActive) {
          root.cursorActive = true
          if (root.selectedIndex < 0) root.selectedIndex = 0
          return
        }
        if (dy !== 0) root.selectByDelta(dy)
      }
      onActivateRequested: if (root.cursorActive) root.activateSelected()
      onCloseRequested: root.close()
      onTabRequested: function (direction) { root.switchPanel(direction) }
      onTextKey: function (t) {
        if (t === "r" || t === "R") root.refresh()
        else if (t === "d" || t === "D") root.openDashboard()
        else if (t === "s" || t === "S") root.openSettings()
      }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(10)

        // ---------- Hero ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight)

          Text {
            id: heroIcon
            text: root.icon
            color: !root.online || root.degraded ? root.bar.urgent : Color.accent
            font.family: root.mono
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              width: parent.width
              text: root.leader !== "" ? root.leader : "AI Pulse"
              color: root.fg
              font.family: root.mono
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
            }
            Text {
              width: parent.width
              text: root.statusLine
              color: !root.online ? root.bar.urgent : root.dim
              font.family: root.mono
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
          }
        }

        // ---------- Analyst headline ----------
        Text {
          visible: root.headline !== ""
          width: parent.width
          text: root.headline
          color: Color.accent
          font.family: root.mono
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
          maximumLineCount: 3
          elide: Text.ElideRight
        }

        // ---------- My Stack cards ----------
        Row {
          id: cardRow
          visible: root.cards.length > 0
          width: parent.width
          spacing: Style.space(8)
          readonly property int cardWidth: root.cards.length > 0
            ? Math.floor((width - spacing * (root.cards.length - 1)) / root.cards.length) : width

          Repeater {
            model: root.cards
            delegate: Rectangle {
              required property var modelData
              width: cardRow.cardWidth
              implicitHeight: cardBody.implicitHeight + Style.space(16)
              radius: Style.space(6)
              color: Style.hoverFillFor(root.fg, Color.accent)
              border.width: 1
              border.color: Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.12)

              Column {
                id: cardBody
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.margins: Style.space(10)
                spacing: Style.space(2)

                Text {
                  width: parent.width
                  text: modelData.label
                  color: modelData.gap ? Color.accent : root.dim
                  font.family: root.mono
                  font.pixelSize: Style.font.caption
                  font.bold: true
                  elide: Text.ElideRight
                }
                Text {
                  width: parent.width
                  text: modelData.name
                  color: root.fg
                  font.family: root.mono
                  font.pixelSize: Style.font.body
                  elide: Text.ElideRight
                }
                Text {
                  width: parent.width
                  text: modelData.detail
                  color: root.faint
                  font.family: root.mono
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                }
              }
            }
          }
        }

        PanelSeparator { foreground: root.fg }

        // ---------- Leaderboard ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(sectionTitle.implicitHeight, sectionMeta.implicitHeight)

          PanelSectionHeader {
            id: sectionTitle
            text: "LEADERBOARD"
            foreground: root.fg
            fontFamily: root.mono
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }
          Text {
            id: sectionMeta
            text: root.models.length > 0 ? "TOP " + Math.min(root.rowLimit, root.models.length) + " OF " + root.models.length : ""
            color: root.faint
            font.family: root.mono
            font.pixelSize: Style.font.caption
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
          }
        }

        // Header row: same column geometry as the data rows below.
        HeaderRow { width: parent.width }

        ListView {
          id: list
          width: parent.width
          height: Math.min(contentHeight, Style.space(520))
          spacing: Style.space(1)
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height

          ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

          model: root.rows
          currentIndex: root.selectedIndex
          onCurrentIndexChanged: if (currentIndex >= 0) positionViewAtIndex(currentIndex, ListView.Contain)

          delegate: Item {
            required property var modelData
            required property int index
            width: ListView.view.width
            height: modelRow.implicitHeight

            ModelRow {
              id: modelRow
              width: parent.width
              entry: modelData
              index: parent.index
            }
          }
        }

        Text {
          visible: root.models.length === 0
          width: parent.width
          text: root.online ? "Waiting for benchmark data…" : "Start AI Pulse to see the leaderboard."
          color: root.dim
          font.family: root.mono
          font.pixelSize: Style.font.body
        }

        PanelSeparator { foreground: root.fg }

        Text {
          width: parent.width
          text: "j/k move · Enter open · R refresh · D dashboard · S settings · Esc close"
          color: root.faint
          font.family: root.mono
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }
    }
  }

  // ── Components ──────────────────────────────────────────────────────────

  // Column geometry shared by the header and every row (monospace widths).
  readonly property int colRank: Style.space(34)
  readonly property int colRole: Style.space(34)
  readonly property int colNum: Style.space(44)
  readonly property int colPrice: Style.space(52)
  readonly property int colAcc: Style.space(44)
  readonly property int colGap: Style.space(6)

  component Cell: Text {
    property bool alignRight: true
    textFormat: Text.PlainText
    font.family: root.mono
    font.pixelSize: Style.font.body
    horizontalAlignment: alignRight ? Text.AlignRight : Text.AlignLeft
    elide: Text.ElideRight
    verticalAlignment: Text.AlignVCenter
  }

  component HeaderRow: Item {
    implicitHeight: Style.space(18)
    Row {
      anchors.fill: parent
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: Style.space(8)
      spacing: root.colGap
      Cell { width: root.colRank; text: "#"; color: root.dim; font.pixelSize: Style.font.caption; alignRight: false }
      Cell { width: root.colRole; text: "ROLE"; color: root.dim; font.pixelSize: Style.font.caption; alignRight: false }
      Cell {
        width: parent.width - root.colRank - root.colRole - root.colNum * 4 - root.colPrice - root.colAcc - root.colGap * 8
        text: "MODEL"; color: root.dim; font.pixelSize: Style.font.caption; alignRight: false
      }
      Cell { width: root.colNum; text: "INT"; color: Color.accent; font.pixelSize: Style.font.caption; font.bold: true }
      Cell { width: root.colNum; text: "CODE"; color: root.dim; font.pixelSize: Style.font.caption }
      Cell { width: root.colNum; text: "MATH"; color: root.dim; font.pixelSize: Style.font.caption }
      Cell { width: root.colPrice; text: "$/1M"; color: root.dim; font.pixelSize: Style.font.caption }
      Cell { width: root.colNum; text: "SPD"; color: root.dim; font.pixelSize: Style.font.caption }
      Cell { width: root.colAcc; text: "ACC"; color: root.dim; font.pixelSize: Style.font.caption }
    }
  }

  component ModelRow: CursorSurface {
    id: row
    required property var entry
    required property int index

    hasCursor: root.cursorActive && root.selectedIndex === index
    current: entry.role !== ""
    foreground: root.fg
    implicitHeight: Style.space(22)

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: row.entry.url !== "" ? Qt.PointingHandCursor : Qt.ArrowCursor
      onContainsMouseChanged: if (containsMouse) { root.cursorActive = true; root.selectedIndex = row.index }
      onClicked: { root.cursorActive = true; root.selectedIndex = row.index; root.openUrl(row.entry.url) }
    }

    Row {
      anchors.fill: parent
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: Style.space(8)
      spacing: root.colGap
      Cell {
        width: root.colRank; alignRight: false
        text: row.entry.rank + (row.entry.win !== "" ? row.entry.win : "")
        color: row.entry.top ? Color.accent : root.dim
      }
      Cell { width: root.colRole; alignRight: false; text: row.entry.role; color: Color.accent; font.pixelSize: Style.font.caption }
      Cell {
        width: parent.width - root.colRank - root.colRole - root.colNum * 4 - root.colPrice - root.colAcc - root.colGap * 8
        alignRight: false; text: row.entry.name; color: root.fg
      }
      Cell { width: root.colNum; text: row.entry.intel; color: Color.accent; font.bold: true }
      Cell { width: root.colNum; text: row.entry.code; color: root.fg }
      Cell { width: root.colNum; text: row.entry.math; color: root.dim }
      Cell { width: root.colPrice; text: row.entry.price; color: root.fg }
      Cell { width: root.colNum; text: row.entry.spd; color: root.fg }
      Cell { width: root.colAcc; text: row.entry.acc; color: root.dim; font.pixelSize: Style.font.caption }
    }
  }
}
