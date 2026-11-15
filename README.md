# karate-tournament-scoreboard-system
A professional, offline-capable web and desktop application for managing Karate tournament scoring, penalties, and match timing.

The top mode switcher changes both windows immediately: Kumite, Team Kumite,
Kata, and Team Kata. Existing Kumite controls and Settings uploads remain available.

- Team Kumite: choose 3+1 or 5+2 before recording the first bout. Finish a bout,
  then select **Record Bout & Next Fighter**. Wins and cumulative points come
  from recorded bouts. Scheduled bouts resolve by wins, then cumulative points;
  extra bouts are available for ties. A tied series after all extra bouts requires
  a referee decision. Reset Team Match clears the series.
- Kata: enter each kata name and select flags or points. Judge flags cycle
  Neutral → AKA → AO. Points require all five or seven marks, between 7.0 and
  10.0 in 0.1 steps. Calculate & Publish drops exactly one highest and one
  lowest mark per competitor. Equal totals remain tied; no automatic tie-break
  rule is applied. Score edits remain drafts until calculated again.
- Team Kata: enter the team name and three athletes. Choose a five- or
  six-minute Kata & Bunkai clock. Arena Start/Stop/Reset buttons request actions
  from the control console, which owns the countdown.
- Settings → Tournament Logos & Sponsors accepts PNG, JPEG, and SVG uploads
  up to 200 KB each. Save & Sync persists logos and publishes the full state.

The requested tournament scoring rules live in `js/tournament.js`; mode controls,
arena presentation, and layout styles are in `js/mode-control.js`,
`js/mode-display.js`, and `css/modes.css`. Both HTML entry points load these modules.

Validation:

```powershell
node --test tests/tournament.test.js tests/dynamic-logos.test.js
# Hidden Electron integration test; uses an isolated temporary app profile.
$env:ELECTRON_RUN_AS_NODE = $null
.\node_modules\.bin\electron.cmd tests/electron-modes.cjs
```
