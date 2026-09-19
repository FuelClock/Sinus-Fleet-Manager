# Fleet Manager — Step-by-Step Guide

> Plugin file: `A_fleetmanager.js` | SinusBot backend: `ts3`

## 1. What this plugin does

Fleet Manager automates a TeamSpeak 3 channel hierarchy for squad-based fleet
operations. It creates a **Command Room** under a parent channel, manages squad
channels inside it, and optionally splits them across **divisions** (Division 1,
Division 2, …).

- Squad names follow the pattern `[D<div>] Squad <Alpha|Bravo|Charlie|Delta>`.
- Division names follow `Division <N>` or a custom pool (Alpha, Bravo, …).
- The bot tracks channel state in SinusBot's `store` so it survives reconnects.

## 2. Configuration (SinusBot Web UI → Plugins → Fleet Manager)

| Variable | Default | Purpose |
|---|---|---|
| `BOT_NAME` | `fs` | Command prefix. `!fs` activates the plugin. |
| `ADMIN_GROUP` | `17` | Server group ID allowed to run commands. |
| `PARENT_CHANNEL_ID` | *(empty)* | Channel ID of the existing parent channel that will hold the fleet system. |
| `COMMAND_ROOM_NAME` | `Command Room` | Name of the Command Room channel. |
| `SPACER_NAME` | `── Fleet System ──` | Spacer above the Command Room. |
| `SPACER_BELOW_NAME` | `━━ Fleet System ━━` | Spacer below the Command Room. |
| `DIVISION_NAMING_MODE` | `number` | `number` → "Division 1", "Division 2"; `pool` → uses `DIVISION_NAME_POOL`. |
| `DIVISION_NAME_POOL` | `Alpha,Bravo,Charlie,Delta` | Custom division names when pool mode is on. |
| `MAX_SQUADS` | `4` | Max squad channels per division. |
| `SQUAD_DELETE_DELAY` | `30` | Seconds to wait before deleting an empty squad. |
| `DIVISION_DELETE_DELAY` | `60` | Seconds to wait before deleting an empty division. |

**Important:** `PARENT_CHANNEL_ID` must point to an existing channel before the
plugin is activated. If it's empty, `!fs on` will refuse to start.

## 3. Installation steps

1. Upload `A_fleetmanager.js` to your SinusBot scripts directory (e.g.
   `/opt/sinusbot/scripts/`).
2. In the SinusBot Web UI, go to **Scripts** and add the file as a new script.
3. Set the three required variables:
   - `BOT_NAME` — choose the command prefix.
   - `ADMIN_GROUP` — your admin server group ID.
   - `PARENT_CHANNEL_ID` — ID of the parent channel.
4. **Start** the script (it does not autorun by default; you must start it once
   manually or set `autorun: true` after verifying config).
5. Connect to your TeamSpeak server as an admin and type `!fs on`.

## 4. Commands

All commands require admin server group membership.

| Command | Effect |
|---|---|
| `!fs on` | Creates the Command Room, spacers, and the initial `[D1] Squad Alpha` channel. |
| `!fs off` | Deactivates the entire fleet system and **deletes all created channels**. |
| `!fs division on` | Splits the Command Room into Division 1 and Division 2, moving existing squads to D1 and creating `[D2] Squad Alpha` in D2. |
| `!fs division off` | Merges all squads from Division 1 & Division 2 back into the Command Room with collision-safe `[D1]` renaming, then deletes the empty division channels. |
| `!fs+` | Creates a new division (D3, D4, …) with one empty squad inside it. |
| `!fs help` | Prints the help text listing all commands. |

### Bare `!fs` without parameters

Typing just `!fs` (no subcommand) is **not a valid command**. The plugin
responds with "Unknown command. Use !fs help". This is intentional — there is
no "default" action for a bare prefix.

## 5. Division mode — target behavior

### `!fs division on`

1. Creates Division 1 and Division 2 channels under the Command Room.
2. Moves all existing squads from the Command Room into Division 1.
3. Creates `[D2] Squad Alpha` inside Division 2.
4. Sets `divisionModeActive = true`.

### `!fs division off`

1. Discovers all real division channels under the Command Room (tree scan, not stale state).
2. Moves every squad channel from Division 1 and Division 2 back to the Command Room.
3. Renames all squads to `[D1]` prefix with collision-safe numbering (Alpha,
   Bravo, Charlie, Delta, then Squad 5, 6, … if needed).
4. Deletes the now-empty Division 1 and Division 2 channels.
5. Resets state and restarts reconciliation.

**Expected log order for `!fs division off`:**

```
Fleet Manager: Division mode deactivated.
Moved channel "[D2] Squad Alpha" (id=951) to parent 945
Moved channel "[D2] Squad Alpha" (id=950) to parent 945
Deleted channel "Division 2" (id=949)
Deleted channel "Division 1" (id=948)
```

If you see division deletion **before** the moves, the plugin is running an
older version — update to the latest commit and restart the script.

## 6. Dynamic division expansion / contraction

- `!fs+` adds a new division (D3, D4, …) with an empty squad. If the division
  stays empty for `DIVISION_DELETE_DELAY` seconds, it is removed automatically.
- **`!fs-` (shrink) is not yet implemented.** This is a known gap. When added,
  it should merge squads from the last division into the previous one and delete
  the empty division channel.

## 7. Squad naming and collision safety

- Valid squad base names: `Alpha`, `Bravo`, `Charlie`, `Delta`.
- If more than 4 squads exist in a division, extras are named `Squad 5`,
  `Squad 6`, etc.
- When two squads would get the same name, the second is shifted to the next
  free slot (e.g., two Alphas → Alpha + Bravo, or Alpha + "Alpha 2").
- Division off always syncs all squads to `[D1]` prefix before deleting division
  channels, so no duplicate base names remain under the Command Room.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `!fs on` says "No parent channel configured" | `PARENT_CHANNEL_ID` is empty | Set the variable to a valid channel ID |
| `!fs division on` creates `[D2] Squad alpha` in Division 1 | Plugin version < fix for `activateDivisionMode` race | Update to latest commit; restart script |
| Duplicate `[D2] Squad Alpha` channels under Command Room after `!fs division off` | Old version with stale `syncSquadNamesUnder` | Update to latest commit; restart script |
| Division channels deleted before squads moved | Old version with race condition | Update to latest commit; restart script |
| Bot leaves parent channel after `!fs` command | Bot channel guard failure | Ensure bot has `b_client_kick_power` and `b_channel_move_power` |

## 9. Verification checklist (after each deploy)

1. `node --check A_fleetmanager.js` → exit code 0
2. Restart the SinusBot script.
3. `!fs on` → Command Room + `[D1] Squad Alpha` appear.
4. `!fs division on` → Division 1 & Division 2 appear; D1 has the original
   squad, D2 has `[D2] Squad Alpha`.
5. `!fs division off` → squads merge back under Command Room with `[D1]`
   prefix; Division 1 and Division 2 channels deleted **after** the moves.
6. Check log for correct move-before-delete order.

## 10. Updating the plugin

1. SSH to the server.
2. `cd /path/to/sinus-squad-manager && git pull origin dev`
3. Restart the SinusBot script via Web UI or CLI.
4. Run the verification checklist above.

---

*This guide was generated from the plugin source at commit `c2d7ce4` and
subsequent fixes. If the source changes, re-run the verification checklist.*
