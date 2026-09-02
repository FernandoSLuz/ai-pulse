-- AI Pulse window rules for Omarchy / Hyprland (Lua config, Hyprland >= 0.55).
-- Installed by `npm run linux:install -w @ai-pulse/widget` as
-- ~/.config/hypr/ai-pulse.lua and loaded from ~/.config/hypr/hyprland.lua with
--   require("hypr.ai-pulse")
--
-- Both windows carry class "ai-pulse" (app.setDesktopName in main.ts). Static
-- rules are evaluated when the window maps, against its initial class/title.

-- Leaderboard: floating, pinned to every workspace, docked to the right edge
-- just below the bar (26 px bar + gap = 38), never takes the initial focus.
-- Note: Hyprland has no always-on-top rule; `pin` means "on all workspaces".
o.window({ class = "^ai-pulse$", title = "^AI Pulse Widget$" }, {
  float = true,
  pin = true,
  no_initial_focus = true,
  no_anim = true,
  no_shadow = true,
  no_blur = true,
  no_dim = true,
  rounding = 10,
  tag = "-default-opacity",
  opacity = "1 1",
  size = { 760, "(monitor_h-80)" },
  move = { "(monitor_w-window_w)", 38 },
})

-- Settings / control window: floating and centered.
o.window({ class = "^ai-pulse$", title = "^AI Pulse$" }, {
  float = true,
  center = true,
  size = { 860, 720 },
})
