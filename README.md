# PTR1e Status Afflictions

Foundry VTT module for Pokemon Tabletop Reunited (`ptu`) that replaces the common status-affliction flow with fast turn automation and Boss Template handling.

## Manifest

Use this manifest URL for Foundry VTT or Forge VTT:

```text
https://github.com/marcbenoitcote-star/ptr1e-status-afflictions/releases/latest/download/module.json
```

## What it automates

- Replaces PTR's HUD status-effect creation path for managed afflictions, so clicking **Assign Status Effects** creates this module's condition items instead of the original compendium versions.
- Creates easy-access world Item documents in a **PTR Status Afflictions** folder for all managed afflictions.
- Posts a compact clickable chat summary at the start of a combatant's turn when it has active managed afflictions.
- Burned, Poisoned, Badly Poisoned, Bleeding, Seeded tick/drain timing.
- Sleep, Frozen, Confused, Infatuation, Rage Save Checks.
- Boss conversion: Sleep -> Drowsy and Frozen -> Chilled.
- Boss damage-over-time once per round, current HP bar only through PTR's normal boss HP handling.
- Boss action-denial assignment to one initiative count where the system exposes a current combatant.
- Weakened duration and 3-round Boss cooldown.
- Immunities for Ice-Type Frozen/Chilled and Ghost-Type Bleeding.

## Status item access

After the module is enabled and a GM loads the world, it creates or refreshes a world Item folder named:

```text
PTR Status Afflictions
```

Those Items can be dragged onto actors or used as references. The Token HUD **Assign Status Effects** menu is also patched so managed statuses use the module definitions directly.

## Turn chat summary

When an actor starts its turn and has active managed afflictions, the module posts one compact chat card. The card shows the active states as chips and contains collapsible sections for the full rules text plus an `@UUID` link to the condition Item.

## Install in Foundry VTT

1. Open Foundry VTT.
2. Go to **Add-on Modules**.
3. Click **Install Module**.
4. Paste the manifest URL above in **Manifest URL**.
5. Click **Install**.
6. Open your PTR world and enable **PTR1e Status Afflictions** in **Manage Modules**.

If Foundry cannot download from the manifest, install from the release zip instead:

```text
https://github.com/marcbenoitcote-star/ptr1e-status-afflictions/releases/latest/download/module.zip
```

Extract the zip into Foundry's `Data/modules/ptr1e-status-afflictions` folder, then restart Foundry.

## Install on Forge VTT

1. Open **The Forge**.
2. Go to **My Foundry**.
3. Open **Add-on Modules**.
4. Choose **Install via Manifest URL**.
5. Paste the manifest URL:

```text
https://github.com/marcbenoitcote-star/ptr1e-status-afflictions/releases/latest/download/module.json
```

6. Install the module.
7. Launch the PTR world.
8. Enable **PTR1e Status Afflictions** in **Manage Modules**.

For private worlds or cached Forge installs, use the latest release zip if the manifest cache has not refreshed yet:

```text
https://github.com/marcbenoitcote-star/ptr1e-status-afflictions/releases/latest/download/module.zip
```

## Macro API

```js
await game.ptrStatus.apply(actor, "bleeding");
await game.ptrStatus.apply(actor, "weakened");
await game.ptrStatus.remove(actor, "bleeding");
await game.ptrStatus.markHeavyShift(actor);
await game.ptrStatus.setTemporaryInjuries(actor, 2);
```

`markHeavyShift(actor)` makes the next Bleeding tick lose 2 Ticks instead of 1 Tick.
`setTemporaryInjuries(actor, value)` stores a manual Temporary Injury count from 0 to 5.

## Notes

The module deliberately keeps Mark and Coat source-specific effects flexible. Seeded uses the selected linked source for its default drain: the target loses 1 Tick at end turn and the source recovers the HP lost. Tables can still adjudicate source-specific Seeded variants manually when a move or feature changes that behavior.

## Test Checklist

- Open a world as GM and confirm the **PTR Status Afflictions** Item folder is created or refreshed.
- Open the Token HUD **Assign Status Effects** menu and confirm Bleeding, Weakened, Provoked, Drowsy, and Chilled appear with icons.
- Apply Frozen to a normal actor. Confirm it can still use Moves, receives linked Stuck and Vulnerable, and receives Weakened for 1 full round.
- Remove Frozen. Confirm the linked Stuck from Frozen is removed.
- Try dragging a Stuck token. Confirm movement is blocked and a chat/notification message appears.
- Try dragging a Tripped token. Confirm movement is blocked and the message explains standing with a Shift Action and Attack of Opportunity risk from adjacent or Reach opponents.
- Apply Weakened to a target and deal damage to it. Confirm incoming effectiveness is one step better.
- Have a Weakened actor deal damage. Confirm its outgoing damage is treated as resisted one additional step.
- Apply Sleep to a Boss Template. Confirm it becomes Drowsy, keeps actions, has halved evasion, and failed saves apply a -10 next Damage Roll effect.
- Apply Frozen to a Boss Template. Confirm it becomes Chilled instead of Frozen, keeps actions, and halves evasion.
- Apply Provoked, Infatuation, or Seeded. Confirm the module asks for the linked scene actor.
- With Provoked, attack a target that does not include the provoking actor and confirm -6 Accuracy appears.
- With Infatuation, attack without the Crush and confirm -5 damage; attack the Crush and confirm the Attack/Special Attack contribution is reduced.
- With Seeded, end the seeded actor's turn and confirm it loses 1 Tick while the linked source recovers the HP lost.
- On a Trainer and a Pokemon sheet, open the Combat tab and confirm Temporary Injuries appears below Injuries, caps at 5, and lowers Max HP like normal Injuries without changing the normal Injury field.
- Run Burned, Poisoned, Badly Poisoned, Bleeding, Seeded, and weather/curse-like persistent damage against a Boss with multiple turns. Confirm loss triggers once per round, not once per boss turn.
- Start a combatant turn with active managed afflictions. Confirm one compact chat card appears with expandable information and item links.

## Changelog

### 0.3.6

- Added a lightweight DOM observer fallback that scans open actor sheets after PTR/Foundry render mutations and injects the Temporary Injuries controls if the standard sheet hooks are bypassed.

### 0.3.5

- Patched PTR actor sheet listener activation directly so the Temporary Injuries controls are injected on the compact Trainer and Pokemon sheets even when Foundry's generic sheet render hook is not fired.

### 0.3.4

- Drowsy and Chilled now halve Boss evasion after PTR recalculates derived evasion, so the penalty applies even when the visible condition Rule Elements are not sufficient by themselves.
- Added manual Temporary Injuries on actor combat sheets, stored separately from normal Injuries and capped at 5.
- Temporary Injuries contribute to effective Injury count and Max HP reduction without being gained automatically by damage thresholds.
- Added macro helpers `getTemporaryInjuries(actor)` and `setTemporaryInjuries(actor, value)`.

### 0.3.3

- Fixed Boss Sleep/Frozen conversion by forcing converted condition slugs after merging PTR's original status item data.
- Added default Seeded drain: the seeded target loses 1 Tick and the linked source heals the HP lost.
- Added broader Boss detection for Boss actors with multiple turns or HP bars.
- Added throttled error guards around chat posting, turn summaries, linked-condition cleanup, and movement blocking.
- Normalized damage roll options before PTR damage application to avoid repeated errors from Set-based roll options.

### 0.3.2

- Changed the recommended manifest to the GitHub latest-release `module.json` asset to avoid short GitHub Raw cache delays during Foundry/Forge updates.

### 0.3.1

- Moved Drowsy and Chilled evasion reduction onto their condition items with `ActiveEffectLike` Rule Elements.
- Removed the older runtime-derived-data evasion patch so Boss Drowsy/Chilled does not double-apply the evasion reduction.

### 0.3.0

- Frozen no longer blocks Move usage through PTR's original `condition:frozen` attack gate.
- Frozen now creates linked Stuck and Vulnerable helpers; removing Frozen removes those linked helpers.
- Added movement blocking for Stuck and Tripped with explanatory chat/notification messages.
- Added scene-actor selection prompts for Seeded, Provoked, and Infatuation.
- Provoked and Infatuation now add predicate-based Rule Elements tied to the selected actor UUID.
- Weakened now includes Effectiveness Rule Elements for incoming attacks and outgoing resisted-step automation.
- Status item descriptions now include Normal and Boss Template behavior.

### 0.2.0

- Replaced PTR's Token HUD status creation path for managed statuses.
- Added local icons for Bleeding, Weakened, Provoked, Drowsy, and Chilled.
- Added world Item creation in the **PTR Status Afflictions** folder.
- Added compact turn-start chat summaries with expandable status information.

### 0.1.0

- Initial module release with normal and Boss Template status automation.
