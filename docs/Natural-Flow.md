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
Framing springs its center and logarithmic span; even a one-price composition
keeps an ordered, positive frame.

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

## Performance contract

Pane updates share one geometry transaction. Unchanged markup and invisible
native-disclosure contents skip reconciliation/layout work. Retirement reads
styles before committing removals; shallow CSS-context shells preserve the
presented actor without copying every computed property of its descendants.
Natural-size targets use the live unconstrained box first, then reuse measurements
until content or available width changes. An unchanged size creates no spring.

Guides, forecasts and foreground candles/traces use clipped native canvas layers
in their original paint order. Scene opacity is composited by the browser; an
interrupted scene is captured once at the next scene change. Offscreen capacity
grows in chunks. Wide reference layouts retain reading-pane widths where space
allows and composite those scrolling panes, avoiding repeated Retina text/track
repainting. The blurred fan wash uses bounded low-density pixels and may
reuse projections within half a CSS pixel; quantile contours remain exact and
render at native density. Forecast semantics and hit geometry update only when
their state or geometry changes. Pointer drawing remains direct.

Pane geometry is reused only when structure, identity/order and text width
remain equivalent; readout digits are tabular. New actors need no prior-position
geometry read. First disclosures seed natural size from their live open body.
Disclosure contents use a stable composited inner layer so the height clip does
not repaint the full reading list each frame. Restored actors cancel queued
retirement inside a geometry transaction.
Equal-geometry pane updates also skip container size reads. Ordinary styles apply
as one declaration; spring-owned styles retain their protected-property path.
Reference contents hold their destination width while their outer track opens
or closes, avoiding repeated paragraph wrapping and text repainting.
Motion offset properties do not inherit into SVG/reading descendants. Stable
readouts validate tree shape and identity before updating attributes/text in
place; changed structure falls back to keyed reconciliation.
Signal readout bindings share the full renderer's formatting/track fields and
live in the markup cache, avoiding reparsing the reading list on equal-geometry
updates. Viewport arrivals enter locally; unseen retained actors settle directly.
Nested removals keep the outer snapshot and do not paint a child twice. Batch
markup caches record planned bookends after queued removals. Tests also replace
every result card and change the reading order/text width at maximum composition.
Scrolling pane bodies keep natural height: their rows/sections carry motion,
avoiding a second size animation and duplicated geometry work. Cached viewport
visibility skips offscreen geometry in settled scenes; scroll/resize resets it,
and disconnected targets are released. Active scenes retain live measurements.
Reconciliation prepares all nested retirements before retained DOM writes, so
later sibling snapshots do not repeatedly force layout. Desktop grid columns
contain their layout and paint during the reference track's resize.

`npm run test:performance` exercises native Chromium, Chromium at 4× CPU and
WebKit at 390/1600 px, DPR 1/2 and 2/20 bars, with 140 readings and all 729 six-bar
sequences in the largest synthetic fixture. It reports frame delivery, application
work, input/result handler time, pointer-to-paint latency and long tasks. Guards
require local native p95 frame intervals below 25 ms, native p95 application work below
16.7 ms (66.8 ms at 4× CPU throttling), and input/result work and pointer latency
below 100 ms. Reduced motion waits for the browser's reported preference before
measurement. Bounded intrinsic measurements, idle DOM writes, retained styling,
pixel reuse, focus and repeated-transition DOM/heap cleanup are also checked.
These budgets characterize the tested environment; current-data checks validate
the actual statistics independently of the presentation fixtures.
Shared GitHub runners report frame cadence, pointer-to-next-frame wait and their
graphics renderer, while enforcing application-work, actual pointer-handler,
input/result, semantic, allocation and cleanup budgets. Both frame delivery and
pointer-to-next-frame wait remain enforced on the local native graphics host.
Their uncontrolled virtual display/GPU cadence is not a native frame-delivery gate.
