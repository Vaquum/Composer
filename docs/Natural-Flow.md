# Natural flow

Composer follows the Tactile flow used in Poise and eightchord-com: stiffness
180, damping 20, mass 1. `motion.js` owns the solver, live DOM channels and the
sampled CSS spring. Control feedback is 100 ms ease-out. Entry travels 20 px;
local information travels 8 px. There is no decorative looping animation.

## Ownership

Live requests keep their position and velocity when retargeted. Only the latest
request owns completion. Layout and entry use independent translation channels.
Keyed result cards, timeframe chips, forecast controls and pane readings retain
their nodes. Disclosures retain their native open state and focus. Departures
are immediately removed from interaction; their inert, clipped visuals retire.
Intrinsic sizing uses fixed measurement clones and releases temporary dimensions.

## Surfaces

| Surface | Treatment |
| --- | --- |
| Canvas bars | Shared springs for arrivals, departures, endpoint changes, framing and horizontal positions. Pointer movement remains direct, including existing press easing, edge give and detents. A drag takes over the presented shape. |
| Forecast | Paths/States share a reversible spring. Branch, cohort and mode changes retain the presented forecast layer while the current scene arrives. The fan switch and underlay use the shared model. Logical selection and stale-result guards remain immediate. |
| Historical traces | Incoming and departing traces share the spring; inactive traces have no controls. Background emphasis follows trace visibility. |
| Results and panes | Keyed reconciliation and layout motion retain focused controls and open details. New actors arrive once, removed actors retire, and pane bodies resize around natural content. Counts and changed text remain immediate. |
| Reference | The left-anchored panel reverses continuously; desktop columns move with its width. Mobile keeps the native fixed overlay. Close and focus return are immediate. Topics resize; spotlight visibility settles while its bounds follow the live target directly. |
| Menus and tooltips | Local entry/exit reverses without resetting momentum. Close immediately removes pointer, keyboard and accessibility availability. Hover intent remains 500 ms; focus and touch explanations remain immediate. |
| Controls | Hover, selection, disabled and progress feedback use 100 ms ease-out. Threshold and clear-pin disclosures resize continuously. |
| Stationary behavior | Drawing, candle width, selection indicators, pin threads, statistical text, footer identity, native scroll, theme and font/viewport geometry remain direct. Copy acknowledges immediately and expires after its existing 1.4 s. Search retains its existing 140 ms debounce. |

## Lifecycle and proof

Reduced motion settles all spatial channels immediately and removes CSS delays.
Preference changes, print, resize, hidden documents and page departure finish
active destinations and release retained visuals and temporary sizing. Panel
resize observers follow panel motion rather than restarting it. Native scrolling
is never taken over by the motion system.

`checks/motion-model.mjs` proves the physical model and momentum on reversal.
`checks/motion-browser.mjs` runs the real UI/runtime in Chromium and WebKit,
using explicitly synthetic UI fixtures, to check retained focus and disclosure
state, reversal continuity, inert exits, forecast changes, direct input, reduced
motion, responsive geometry and lifecycle cleanup. Existing current-data checks
remain the authority for matching and statistical results.
