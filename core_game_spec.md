# Core Game Specification

**Version:** 0.6 — synchronization, touch movement, reconnect lifecycle and coastline fit. Updated October 3, 2026.
**First-release modes:** 1v1 and 2v2  
**Status:** Current implemented rules; device and stability acceptance is tracked in outputs/development_status.md.

Power, vision, and position drive the game. Power is an economy resource, carried combat strength, and stored building defense. More carried Power means slower movement. Players transport Power through buildings; no direct player transfers or dropped loot exist.

## 1. Core Loop & Mode Scope

Create/join a room by code → choose 1v1 or 2v2 → generate an island → assign starting zones → place personal Cores → spawn → enable fog → explore, capture and transport Power → fight and destroy enemy Cores → determine the winning team → rematch with a new seed.

| Mode | Players / teams | Starting zones |
|---|---|---|
| 1v1 | 2 players; 2 teams of 1 | Two halves |
| 2v2 | 4 players; 2 teams of 2 | Four quadrants |

Keep `teamId` throughout ownership, targeting, vision, elimination and results. FFA and three-player matches are outside this release.

## 2. World & Procedural Map

Use continuous floating-point coordinates in an approximately **200 × 200 world-unit** world; player/building size is approximately **4 × 4 units**. Display pixels do not define simulation units.

Generate a seeded, irregular, connected island with an open interior. No walls, rivers, mountains or complex terrain. Avoid impassable narrow passages and ensure usable Core placement in each zone. Randomly scatter neutral Plants/Forts inside the playable boundary with valid footprints.

**Only the map boundary causes collision.** Players and buildings do not block movement; overlap/contact does not trigger attacks. Respawn and initial spawn occur at the player's Core position, so player/Core overlap is intentional.

Render the **entire island**, scaled to the map frame using the full public coastline bounds and a small water margin. The island fills more of the frame; world geometry and distances remain unchanged. There is no in-game camera pan/zoom. Native webpage scrolling and pinch zoom remain available. Fog still conceals information on the full-island display.

## 3. Placement, Spawn & Initial Power

Randomly assign starting zones. Diagonal teammate placement in 2v2 remains the preferred adjustable layout. Zones restrict only Core placement and disappear when gameplay begins.

During placement, each player sees only the neutral buildings inside their own assigned starting zone (their half in 1v1, their quadrant in 2v2). Teammate zones do not expand this disclosure. Neutral building Power amounts are hidden and omitted from the placement payload. Teammate Cores remain visible; enemy Cores are hidden. After placement, friendly Cores remain visible as team buildings and provide shared vision. Neutral/enemy objects outside team vision become hidden.

Each player places their Core inside their assigned zone. Core placement uses mouse click / touch tap in two steps: the first click previews a valid position with a visible marker; a second click on the selected spot confirms it. Clicking another valid spot moves the preview. No Core exists on the server until confirmation. The desktop six-key restriction applies only to active gameplay, not placement or lobby UI.

**Initial player:** at their Core position, carrying **1 Power**.  
**Initial Core:** **50 Power**.  
**Respawn:** at their own surviving Core, carrying **1 Power**.

Placement inactivity follows the timeout approach rather than automatic placement. Use a configurable **30-second** prototype inactivity/reconnection timeout; no-operation placement and actual disconnect handling are detailed in section 12. A placed, connected player waiting for others is not a placement-inactivity failure.

## 4. Teams & Ownership

- Lobby players may join a team with an open seat. A full team can exchange players after an explicit request and recipient acceptance. Teams are locked after the host starts placement; each side must have exactly 1 (1v1) or 2 (2v2) players. Room-entry order is preserved through team changes and chosen teams persist into rematches.
- Teammate players cannot attack or be selected as interaction targets.
- Plants/Forts are team-owned; teammates share their ownership, storage and vision.
- Each Core is owned by one player. Active teammates may deposit/withdraw there and share its vision.
- Destroying a Core eliminates its individual owner; the teammate continues while their Core survives.
- A team retains Plants/Forts after an individual elimination. Once the whole team is eliminated, its Plants/Forts become neutral without changing their stored Power.

## 5. Integer Power & Tick Production

All carried and stored Power is **integer-valued**. Production runs on server ticks with configurable prototype defaults:

| Building | Production interval | Increment |
|---|---|---|
| Power Plant | Every **10 ticks** | **1 Power** |
| Fort | Every **50 ticks** | **1 Power** |
| Core | Every **50 ticks** | **1 Power** |

**Neutral buildings do not produce Power.** Only team-owned buildings produce. Neutral Plants/Forts receive seeded, integer random initial Power within a configurable reasonable range; **10–50 inclusive is the current prototype range, subject to future balance review**. When an eliminated team’s Plants/Forts become neutral, their production stops; stored Power is unchanged.

At 200 ms/tick these intervals are 2 and 10 seconds. Maintain an integer tick counter per building; prototype accounting starts at match start for initial buildings and does not reset on capture. Counters continue advancing while neutral, but scheduled neutral increments are skipped, never stored or backfilled. Capture changes ownership and stored Power, not the generation schedule; production becomes eligible at the next scheduled tick after capture. This accounting choice is an implementation default, not a new gameplay feature.

Every active player retains at least **1 Power**. Building withdrawal reserves are **40 for Cores**, **1 for Plants/Forts**. These are transfer limits, not free replenishment or attack immunity.

## 6. Building Power Transfers

The interaction key/button supports these confirmed commands at friendly buildings:

| Input | Command |
|---|---|
| Single press / tap | Half withdrawal |
| Double press / tap | Maximum withdrawal |
| Hold | Maximum deposit |

“No gestures” excludes map pan/zoom, not these button patterns. Do not add transfer keys. Arbitrate the input so a double press is one maximum withdrawal and a hold is one deposit, without an earlier accidental half withdrawal. Input timing windows remain configurable implementation parameters.

Use integer, conservative transfers. With building Power `B`, player Power `P`, and reserve `R` (Core 40, otherwise 1):

```text
requestedHalf = floor(B / 2)
availableWithdrawal = max(0, B − R)
halfWithdrawal = min(requestedHalf, availableWithdrawal)
maximumWithdrawal = availableWithdrawal
maximumDeposit = max(0, P − 1)

withdraw x: building B → B − x; player P → P + x
deposit x:  player P → P − x; building B → B + x
```

The Core reserve does not alter the initial half calculation; it caps the actual transfer. **Core 50: half requests 25, transfers only 10, leaves 40. Core 100: half transfers 50, leaves 50.** Odd half withdrawals round downward, leaving the larger half stored.

Never withdraw an amount and then create Power to restore the reserve. A captured Plant/Fort starts at 0 and cannot be withdrawn from until it has sufficient Power. A Core below its reserve is not automatically topped up. Withdrawal never destroys a Core. Enemy attacks destroy Cores; surrender/timeout retirement is separate elimination cleanup, as described in section 12.

## 7. Movement & Confirmed Sprint

WASD provides free-direction movement; normalize diagonal keyboard input. A map tap/click sets a valid destination: move straight toward it and stop on arrival. A new tap replaces the destination. There is no pathfinding, automatic boundary avoidance or automatic attack. WASD takes control and clears the tap target; releasing movement stops. Blur, hidden page, disconnect, leaving play and respawn clear the target. The server validates destinations, constrains movement at the coast and requires the existing 600 ms input lease; active intent is renewed at about 300 ms. The normal-speed function decreases with current carried Power; base/minimum speed and the curve remain balance configuration.

**Q / mobile Sprint button:**

- Require carried Power **> 10** and no active sprint.
- Deduct **10 Power**, then compute normal speed from the remaining carried Power and multiply by **1.5** for **1 second**.
- During the sprint, normal speed continues to use current carried Power, with the same 1.5 multiplier.
- Ignore activation while already sprinting; do not charge again, stack or extend the sprint.
- Respawn cancels the sprint.
- At 10 or below, activation does nothing and costs nothing. At 11, it leaves 1.

The authoritative server times the effect; at the prototype tick rate, one second is five ticks. There is no additional cooldown after the sprint expires.

## 8. Fog / Vision

Use moving circular player vision and fixed circular friendly-building vision; Cores have the largest radius. Teammates share current vision. Friendly Cores remain visible; they are themselves vision sources.

No permanent map memory: areas, enemy players and neutral/enemy buildings outside current team vision are hidden again. Placement disclosure does not create persistent remembered markers. Vision radii remain configurable.

## 9. Universal Interaction & Eligible Targets

Use **E** / the mobile interaction button. Range is **8 world units, center-to-center**. Highlight the nearest eligible, visible player/building in range before input, indicating what the button can act on.

Eligibility excludes teammate players and **enemy players whose Power is greater than or equal to the acting player's Power**. Thus two players cannot mutually select one another for attack: only the strictly stronger player is eligible to select the weaker.

Friendly buildings support transfers. Neutral/enemy buildings support attack attempts; their strict cost threshold is checked by the server. Movement or overlap never performs an interaction.

Implementation choices: break equal-distance target ties by stable entity ID; lock the target when an action starts and revalidate visibility, range, ownership and eligibility when it resolves. If invalid, cancel rather than redirect to another entity. Choose configurable double-press/hold timing; building command arbitration must prevent unintended extra transfers.

## 10. Attack Thresholds & Costs

| Target | Defense coefficient |
|---|---|
| Enemy player | **0.5** |
| Power Plant | **0.6** |
| Fort | **1.0** |
| Core | **1.0** |

```text
attackCost = ceil(targetPower × defenseCoefficient)
successful player attack: attackerPower > defenderPower
successful building attack: attackerPower > attackCost
attackerPowerAfter = attackerPowerBefore − attackCost
```

The player coefficient changes the victory cost only, not the strength threshold. All comparisons are strict. Failed attacks leave Power, ownership and gameplay state unchanged.

Examples: player 51 defeats player 50, pays 25 and retains 26; player 50 cannot defeat player 50. Plant 50 costs 30 and requires at least 31. Fort/Core 50 costs 50 and requires at least 51.

**Player defeat:** deduct attacker cost, reset defender to 1 and respawn at their surviving Core; no loot or Power transfer to the attacker.  
**Plant/Fort capture:** deduct cost, transfer to attacker's team, set stored Power to **0**.  
**Core attack:** deduct cost, destroy the Core and eliminate its owner at tick-end settlement. Core is never captured.

## 11. Tick Ordering & Concurrent Actions

Compute actions sequentially in a private tick working state; commit and publish the resulting effects together at the end of the tick. An internal intermediate state is not a client-visible update.

Resolve each tick in this order:

1. Advance timed effects and due production; validate/activate sprint, then calculate movement and boundary constraints.
2. Determine eligible interaction targets from the current working state.
3. Resolve **all building transfers before attacks**. Same-team commands use stable room-entry order. Use that order as the general deterministic fallback for other simultaneous commands too.
4. Recheck strict player-selection eligibility after transfers, then resolve attacks. Validate costs against current working Power. Apply costs/captures internally; queue player defeat, Core destruction and elimination for final settlement.
5. Resolve player defeat/respawn and Core destruction/elimination, determine team outcomes, neutralize eliminated-team buildings, then publish the tick.

Do not eliminate an attacker mid-tick solely because their own Core was marked destroyed earlier in that tick: their valid pending attack must still be considered, allowing mutual Core destruction. A Core already marked destroyed or a player already marked defeated cannot incur duplicate defeat costs that tick. Revalidate ownership for later building attacks so teammate commands cannot attack a newly friendly building. Do not spend the same stored Power twice in concurrent transfers.

Team tie-break scoring is separate from ordinary attack cost and eligibility.

## 12. Disconnect, Inactivity & Surrender

- Prototype reconnection window: **30 seconds**, configurable. During placement, a player who fails to act/place their Core within the inactivity window follows the same timeout approach; do not automatically place a Core.
- An actual connection loss opens the reconnection window; restoring the same player/session in time avoids timeout elimination. Merely standing still while connected during active gameplay is not a disconnect.
- Exceeding the window causes elimination. Active-player input stops while disconnected; there is no invulnerability or automatic pause of the entire match.
- Explicit **Leave room** immediately clears local identity and, when delivered, retires the player, removes the seat and invalidates its session, with no reconnection grace. If offline, queue the credential-validated Leave for the next connection without resuming; if delivery never occurs, the existing disconnected seat expires after 30 seconds. **Surrender your Core** retires only the Core/player in combat; the connected member can stay for results/rematch.
- Anonymous credentials live in this tab’s site-scoped `sessionStorage`; the server validates them in memory. Refresh/network loss can resume within 30 seconds. A newly opened page without those credentials does not recover an old identity; the old disconnected seat expires. No cross-device, cross-site or server-restart recovery is promised. Closing versus refreshing cannot reliably be distinguished; restored browser/tab sessions may retain credentials and resume within the window. Do not send Leave automatically on unload/pagehide.
- Host identity is stored independently of entry order. When the host leaves/disconnects, randomly choose among other connected members; the former host does not reclaim host on reconnect. If everyone disconnects, keep their seats during the grace window, establish a host when a member reconnects, and close only after the last member Leaves or the last retained seat expires. Seat/session cleanup also runs after game over. Entry order for simultaneous actions remains unchanged.
- In 2v2, surrender/timeout eliminates **only that player**; the teammate continues. Retire the eliminated player and their personal Core from the active match, preventing continued production, vision or respawns from that Core. Shared Plants/Forts remain with the surviving team. If no teammate remains with an active Core, eliminate the team. A timed-out player who never placed a Core cannot retain an unplaced survival slot.

## 13. Team Victory & Same-Tick Tie-break

Ordinarily, the last team with a surviving Core wins. Apply all tick-end Core destructions before deciding the result.

If both teams lose their last surviving Core in the **same tick**, compare their total Power across all buildings and carried player Power. Greater total wins; equal totals produce a **draw**. With two teams, rankings are winner/loser or shared placement; no FFA leaderboard is required.

**Confirmed scoring snapshot:** after this tick's production, transfers and attack-cost deductions, but **before** defeat resets/respawns, asset removal or eliminated-team neutralization. Include current team-owned building reserves (including Cores destroyed in this tick) and carried Power of that team's players (including players eliminated in this tick). Exclude assets already removed in previous ticks and neutral buildings. Capture ownership/reset results from this tick are reflected in the snapshot.

Save these totals at the end of the attack stage. Apply all Core destruction flags, and if both teams now have no surviving Core, use the saved totals. Do not score only the leftovers after deleting eliminated assets.

Rematches reset players, buildings and results and generate a new map seed.

## 14. Controls & English UI

| Platform | Active-play controls | Placement |
|---|---|---|
| Desktop | **W, A, S, D, E, Q** only | Mouse click |
| Mobile | **Map tap destination, Interaction button, Sprint button** | Tap |

Show the full island fitted to the available map frame. Map taps act on release, within an 8 CSS-pixel movement tolerance and 600 ms tap duration; dragging, multiple pointers and pointer cancellation do not move or deploy. These gestures remain available to the webpage for scrolling/zooming. Core placement still requires two taps on the same preview. Single/double/hold apply only to the interaction key/button.

Only during `playing`, prevent selection and unnecessary text editing in the game interface. Lobby, placement, results and Home restore normal selection/form use. Preserve WASDEQ, room entry inputs and webpage scrolling/zooming. Canvas backing pixels follow devicePixelRatio and native page zoom; drawing and tapping use the same coast-fitted transform. Font design/layout are unchanged.

All player-facing UI, rules, hints and feedback are **English only**. Provide Home, Lobby, room-code joining, HUD, How to Play, Game Over and Rematch. Explain teams, individual Cores, victory/draw, Power/speed, strict attacks, reserves, fog, sprint and surrender. Show target highlighting and sprint availability.

## 15. Technical Direction & Configuration

**TypeScript; React + Vite UI; HTML Canvas world/fog/effects; Node.js + Socket.IO.** No full game engine. Authoritative server approximately **200 ms / 5 Hz**; clients approximately **60 FPS** with interpolation. Clients send intent; the server owns movement, Power, timing, transfers, attacks, visibility and results. Share one match, filtering outgoing information by team vision. Dynamic visible entity/vision collections remain complete at 5 Hz. Send public boundary once per connection/map version and changed room metadata reliably on the same state channel; reconnect and rematch provide fresh initialization. Suppress unchanged non-playing states, while placement/reconnect countdowns still update. Send an unrelated opaque map version, not the private generation seed. Omit private production counters/player bookkeeping and other players’ placement zones. Never initialize with hidden buildings, Power or enemy positions.

Centralize these provisional defaults for easy playtest changes:

| Parameter | Prototype default |
|---|---|
| World extent / entity size | Approximately 200 × 200 / 4 × 4 units |
| Interaction radius | 8 units |
| Player starting / respawn Power; player reserve | 1 / 1; 1 |
| Core starting Power; withdrawal reserve | 50; 40 |
| Plant/Fort withdrawal reserve; captured Power | 1; 0 |
| Plant / Fort / Core production interval | 10 / 50 / 50 ticks, each producing 1 |
| Sprint cost / multiplier / duration | 10 / 1.5 / 1 second |
| Reconnection / placement inactivity window | 30 seconds |

Also configure base/minimum speed, speed curve, vision radii, initial neutral-building Power, counts/spacing, map parameters, spawn layout and input timing. Values remain tunable; do not invent resource caps or additional mechanics.

## 16. Delivery and Scope

Players join anonymous browser rooms without installation. The frontend and authoritative backend must be reachable for remote play. Real-device, multi-network and novice-comprehension acceptance remains tracked in outputs/development_status.md.

This release excludes FFA, extra units, skills, items, upgrades and additional building types. Deployment configuration is environment-specific and is not part of this rules document.
