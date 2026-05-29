# PTR1e Status Afflictions

Foundry VTT module for Pokemon Tabletop Reunited (`ptu`) that replaces the common status-affliction flow with fast turn automation and Boss Template handling.

## Manifest

Use this manifest URL for Foundry VTT or Forge VTT:

```text
https://raw.githubusercontent.com/marcbenoitcote-star/ptr1e-status-afflictions/main/module.json
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
https://raw.githubusercontent.com/marcbenoitcote-star/ptr1e-status-afflictions/main/module.json
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
```

`markHeavyShift(actor)` makes the next Bleeding tick lose 2 Ticks instead of 1 Tick.

## Notes

The module deliberately keeps Mark, Coat, Seeded source-specific effects flexible. If a Seeded item has PTR persistent damage data, it is processed once per eligible round for bosses. Otherwise Seeded remains a tracked special condition for table rulings or source-specific automation.
