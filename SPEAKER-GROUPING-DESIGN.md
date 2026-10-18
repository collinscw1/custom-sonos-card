# Speaker Switcher Grouping — Design Brief

Add the ability to **group and ungroup Sonos speakers directly from the player's
speaker dropdown**, without opening the separate grouping section.

Status: implemented (see `design/Music Player.dc.html` for the final spec it was built from).

---

## 1. Context

### Where this lives

The Sonos card's **player section** has a header with a speaker switcher:

```
┌──────────────────────────────────────────┐
│ Speaker                                  │  ← small label, secondary color
│ Kitchen + Living Room  ⌄        ▮▮▮      │  ← name (600 weight) + chevron, playing bars
│                                          │
│ Song Title                     ♡   (▶)   │
│ Artist — Album                           │
└──────────────────────────────────────────┘
```

Tapping the name opens a dropdown listing every speaker:

```
┌──────────────────────────────────────────┐
│ ▮▮▮  Kitchen + Living Room   (bold=active)│
│      Playing — Song Title                │
│      Living Room                         │
│      Bedroom                             │
│      Some Track Name                     │
│      Office                              │
└──────────────────────────────────────────┘
```

Today a row does one thing: **tap = make this the active speaker.**

### What exists already

- The card already supports grouping: `join` / `unjoin` services, plus a
  full-screen **grouping section** with checkboxes and an Apply button. That
  section is still the place for batch changes and predefined groups.
- The **active speaker is always the group leader** (Sonos "coordinator"). Pick a
  speaker that's in a group and the card switches to that group's leader. So
  "add this speaker to the current group" is always well-defined.
- The dropdown already lists **every speaker individually**, grouped or not.
  The active row shows the combined name ("Kitchen + Living Room"), and other
  rows show their own names.

---

## 2. Goal

From the speaker dropdown, the user can:

1. **Add** any speaker to the currently active speaker's group.
2. **Remove** a speaker from the active group.
3. **Ungroup everything** in the active group in one action.
4. Keep doing what works today: **tap a speaker's name to switch to it.**

Non-goals (stay in the grouping section): predefined groups, batch edits with
Apply/Cancel, choosing a different group leader.

---

## 3. Interaction model

### Two tap targets per row

| Target | Action |
|---|---|
| Row body (name/subtitle) | Switch active speaker (unchanged) |
| Trailing group control | Toggle this speaker in/out of the active group |

The group control must be a **separate, clearly bounded hit area**, so a tap on
it never also switches speakers. Minimum touch target ~44×44 px on the tablet.

### Applies immediately

Each toggle takes effect as soon as it's tapped. **No Apply button.** This
matches the Sonos app and keeps the dropdown lightweight. Batch editing stays in
the grouping section.

### Row roles

| Row | Group control |
|---|---|
| **Active speaker** (group leader) | None. It can't be removed from its own group. Could show a "leader" marker or nothing. |
| **Grouped with active** | Shown **on** (filled / checked) |
| **Not grouped with active** | Shown **off** (outlined / unchecked) |
| **Disabled** (only if `grouping.disableMainSpeakers: true` is set, which is off by default and off on the tablet; then it applies to the leader of another multi-speaker group) | Shown dimmed, not tappable |

Grouping the leader of another group is **allowed by default**. The disabled
state exists only to honor that opt-in config flag.

### Footer action

When the active group has **more than one speaker**, show a footer action at the
bottom of the dropdown:

> **Ungroup all**

It removes every member except the active speaker. Hidden when the active
speaker is alone.

### Does the dropdown stay open?

**Yes.** Toggling group membership keeps the dropdown open so the user can add
several speakers in a row. Tapping a row body (switching speakers) closes it, as
today. Tapping outside closes it, as today.

---

## 4. States to design

Each row's group control needs these states:

| State | When | Notes |
|---|---|---|
| **Off** | Not in active group | Outlined circle / empty |
| **On** | In active group | Filled circle / check |
| **Pending** | Tapped, waiting for Sonos to confirm | Spinner in place of the control; control not tappable. Takes ~1–5 s, up to 30 s timeout |
| **Error** | Service call failed or timed out | Control returns to its previous state. Brief inline message on that row (e.g. "Couldn't group — try again"). **No automatic retry.** |
| **Disabled** | Not allowed by config | Dimmed, no hover |

The **header** also changes as grouping changes: the active speaker's name grows
from "Kitchen" to "Kitchen + Living Room". This should update once the change is
confirmed, not while it's still pending.

The **"Ungroup all"** footer needs default, pending (all affected rows show
spinners), and hidden states.

### Ordering (open for design input)

Current order follows HA's internal grouping. Options:

- **A.** Keep current order (stable, rows don't jump when toggled).
- **B.** Active speaker first, then grouped members, then everyone else
  (clearer, but rows move after each toggle).

Recommendation: **A while the dropdown is open**, and re-sort only on next open,
so a row never moves out from under the user's finger.

---

## 5. Behavior the user should understand

These are Sonos behaviors, not bugs, but the UI may want to hint at them:

- **Joining a speaker that's playing something else stops that playback** and
  it starts playing the active group's audio.
- **Joining a speaker that leads its own group** pulls only that speaker over.
  Its old group stays together under a new leader. (To verify on the real
  system.)
- **Removing a speaker** leaves it stopped/idle as its own standalone speaker.

Possible treatment: show a subtle subtitle like "Playing — Song" on rows that
are currently playing something else. The existing rows already do this. The
user can then see what joining will interrupt. No confirmation dialog is
recommended, since it's too heavy for a frequent action.

---

## 6. Layout constraints (important)

The card follows a fixed size system. See the project's `claude.md` §2–§3.

- **Current placement on the tablet:** W size, **384 × 188 px**.
- **1rem = 14px** in Home Assistant (not 16px).
- The card's outer frame clips overflow. **The dropdown is clipped at the
  bottom of the 188px card.** After the header, there's roughly room for **2–3
  rows** before the list scrolls or cuts off.
- Use container-relative sizing (`%`, `cq` units), not viewport media queries.
  Design against the real boxes: 384×188 (W), 384×384 (L).

### Decision needed: how does the dropdown escape the card?

| Option | Pros | Cons |
|---|---|---|
| **1. In-card dropdown (today)** | No new pattern; simple | Clipped at W size; only ~2–3 speakers visible, scroll for the rest |
| **2. Popover / sheet over the whole page** | Full list visible, room for footer and errors | New pattern; must be opened as a page-level overlay, not inside the card |
| **3. Make the card taller** (L, 384×384) | No code pattern change | Costs dashboard space |

Speaker count decides this. With ≤3 speakers, option 1 is fine. With more,
option 2 is likely right.

---

## 7. Visual language to match

Pull from the existing dropdown and card styles:

- Dropdown surface: `--card-background-color`, radius **1.125rem**, shadow
  `--ha-card-box-shadow`, inner padding 0.5rem
- Rows: radius 0.75rem, padding 0.625rem × 0.75rem, hover
  `--secondary-background-color`
- Name: 0.95× base, weight 500 (700 when active), `--primary-text-color`
- Subtitle: 0.8× base, `--secondary-text-color`
- Playing indicator: the existing animated `sonos-playing-bars`, leading the row
- Existing grouping-section icons: `check-circle` (on) /
  `checkbox-blank-circle-outline` (off). Reusing these keeps both grouping UIs
  consistent.
- Must work in HA light and dark themes (use HA CSS variables only, no fixed
  colors).

---

## 8. Configuration

Proposed opt-out flag under `player:` so the card's default behavior can stay
unchanged where wanted (e.g. mobile):

```yaml
player:
  switcherGrouping: true   # show group toggles in the speaker dropdown
```

Existing grouping config that should be respected:

- `grouping.disableMainSpeakers` → leaders of other multi-speaker groups are disabled
- `grouping.dontSwitchPlayer` → don't change the active speaker as a side effect

---

## 9. Open questions

1. **Mobile too, or tablet only?** It affects default for the config flag and
   whether a phone-width layout needs specifying.
2. **How many Sonos speakers?** It decides §6 (in-card vs. page overlay).
3. **Active row marker:** show a "leader" badge/icon, or nothing?
4. **Error message wording and duration**: inline under the row, or a toast?
5. **Ordering:** confirm recommendation in §4 (stable while open).

---

## 10. Out of scope

- Predefined groups in the dropdown
- Per-speaker volume in the dropdown (the volumes section covers this)
- Changing which speaker leads a group
- Any change to the full grouping section
