const MODULE_ID = "ptr1e-status-afflictions";
const FLAGS = {
  assignedCombatant: "assignedCombatant",
  processedRound: "processedRound",
  heavyShiftRound: "heavyShiftRound",
  weakenedImmuneUntil: "weakenedImmuneUntil",
  temporaryInjuries: "temporaryInjuries",
  patched: "patched"
};

const DOT_SLUGS = new Set(["burned", "poisoned", "badly-poisoned", "bleeding", "seeded", "cursed"]);
const SAVE_SLUGS = new Set(["sleep", "frozen", "drowsy", "chilled", "confused", "infatuation", "rage"]);
const ACTION_GATE_SLUGS = new Set(["paralysis", "confused", "infatuation", "provoked", "suppressed", "flinch", "disabled", "drowsy", "chilled"]);
const LINKED_SOURCE_SLUGS = new Set(["seeded", "provoked", "infatuation"]);
const FREEZE_LINKED_HELPERS = new Set(["vulnerable", "stuck"]);
const WORLD_ITEM_FOLDER = "PTR Status Afflictions";
const ERROR_COOLDOWN_MS = 5000;
const MOVEMENT_MESSAGE_COOLDOWN_MS = 2000;
const MAX_TEMPORARY_INJURIES = 5;
const throttledErrors = new Map();
const movementMessages = new Map();
let temporaryInjuryObserver = null;
let temporaryInjuryScanQueued = false;
const TYPES = [
  "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel",
  "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy",
  "Shadow", "Nuclear", "Untyped"
];

function halfEvasionRules(label) {
  return ["physical", "special", "speed"].map((path) => ({
    key: "ActiveEffectLike",
    mode: "multiply",
    path: `system.evasion.${path}`,
    value: 0.5,
    phase: "afterDerived",
    label
  }));
}

const ON_CREATE_HELPERS = new Map([
  ["frozen", ["vulnerable", "stuck", "weakened"]],
  ["chilled", ["weakened"]],
  ["flinch", ["vulnerable"]],
  ["paralysis-fail", ["vulnerable"]]
]);

const CONDITION_DEFINITIONS = {
  burned: {
    name: "Burned",
    img: "systems/ptu/static/images/conditions/Burned.svg",
    rules: [{ key: "ActiveEffectLike", path: "system.stats.def.stage.mod", mode: "add", value: -2 }],
    effect: "<p>Defense is lowered by 2 Combat Stages. Lose 1 Tick at end turn after acting or being action-denied.</p>"
  },
  poisoned: {
    name: "Poisoned",
    img: "systems/ptu/static/images/conditions/Poisoned.svg",
    rules: [{ key: "ActiveEffectLike", path: "system.stats.spdef.stage.mod", mode: "add", value: -2 }],
    effect: "<p>Special Defense is lowered by 2 Combat Stages. Lose 1 Tick at end turn after acting or being action-denied.</p>"
  },
  "badly-poisoned": {
    name: "Badly Poisoned",
    img: "systems/ptu/static/images/conditions/Badly-Poisoned.svg",
    rules: [{ key: "ActiveEffectLike", path: "system.stats.spdef.stage.mod", mode: "add", value: -2 }],
    effect: "<p>Special Defense is lowered by 2 Combat Stages. Lose 5 HP, then double the loss each consecutive round.</p>"
  },
  sleep: {
    name: "Sleep",
    img: "systems/ptu/static/images/conditions/Sleep.svg",
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
    effect: "<p>Cannot use moves unless an effect permits it. Save Check 16+ at end turn removes Sleep.</p>"
  },
  frozen: {
    name: "Frozen",
    img: "systems/ptu/static/images/conditions/Frozen.svg",
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
    rules: [
      { key: "RollOption", domain: "all", option: "condition:frozen" }
    ],
    effect: "<p>Gains Vulnerable and Stuck. Save Check 16+ at end turn removes Frozen; Fire-Type lowers the DC to 11.</p>"
  },
  paralysis: {
    name: "Paralysis",
    img: "systems/ptu/static/images/conditions/Paralysis.svg",
    effect: "<p>Save Check 11+ at start turn to act normally. On failure, take either a Standard Action or a Shift Action and become Vulnerable for 1 full round.</p>"
  },
  confused: {
    name: "Confused",
    img: "systems/ptu/static/images/conditions/Confused.svg",
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
    effect: "<p>Cannot make Attacks of Opportunity. On attacks, roll the confusion check. Save Check 16+ at end turn removes Confused.</p>"
  },
  infatuation: {
    name: "Infatuation",
    img: "systems/ptu/static/images/conditions/Infatuated.svg",
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
    sourcePrompt: "PTR_STATUS.Prompt.Crush",
    effect: "<p>The source is the Crush. Damage rolls not including the Crush suffer -5; against the Crush, Attack and Special Attack are halved for damage. Save Check 16+ removes it.</p>"
  },
  rage: {
    name: "Rage",
    img: "systems/ptu/static/images/conditions/Rage.svg",
    persistent: { type: "save", dc: 15, decrease: false, formula: "" },
    effect: "<p>Cannot use Status Moves. Save Check 15+ at end turn removes Rage.</p>"
  },
  flinch: {
    name: "Flinch",
    img: "systems/ptu/static/images/conditions/Flinched.svg",
    duration: { value: 1, unit: "rounds", expiry: "turn-start" },
    rules: [{ key: "ActiveEffectLike", path: "system.modifiers.initiative.mod", mode: "add", value: -5 }],
    effect: "<p>Vulnerable for 1 full round and -5 Initiative for the Scene or until Recall.</p>"
  },
  suppressed: {
    name: "Suppressed",
    img: "systems/ptu/static/images/conditions/Suppressed.svg",
    duration: { value: 1, unit: "rounds", expiry: "turn-start" },
    effect: "<p>Can only use At-Will Moves.</p>"
  },
  disabled: {
    name: "Disabled",
    img: "systems/ptu/static/images/conditions/Disabled.svg",
    effect: "<p>The chosen Move is disabled. Boss Templates can only have one Disabled Move at a time.</p>"
  },
  seeded: {
    name: "Seeded",
    img: "systems/ptu/static/images/conditions/Seeded.svg",
    sourcePrompt: "PTR_STATUS.Prompt.SeededSource",
    effect: "<p>Special Mark/Coat condition. The target loses 1 Tick at end turn and the linked source recovers the HP lost. Boss drain/loss is limited to once per round.</p>"
  },
  cursed: {
    name: "Cursed",
    img: "systems/ptu/static/images/conditions/Cursed.svg",
    effect: "<p>Persistent loss is limited to once per round against Boss Templates.</p>"
  },
  bleeding: {
    name: "Bleeding",
    img: `modules/${MODULE_ID}/images/conditions/Bleeding.svg`,
    effect: "<p>Lose 1 Tick at end turn, or 2 Ticks after a heavy shift. Healing received is halved manually by the table.</p>"
  },
  weakened: {
    name: "Weakened",
    img: `modules/${MODULE_ID}/images/conditions/Weakened.svg`,
    duration: { value: 1, unit: "rounds", expiry: "turn-start" },
    rules: TYPES.map((type) => ({ key: "Effectiveness", type, value: 2, label: "Weakened" })),
    effect: "<p>Damaging attacks are resisted one step more; attacks against this target are resisted one step less.</p>"
  },
  provoked: {
    name: "Provoked",
    img: `modules/${MODULE_ID}/images/conditions/Provoked.svg`,
    duration: { value: 1, unit: "rounds", expiry: "turn-start" },
    sourcePrompt: "PTR_STATUS.Prompt.ProvokingActor",
    effect: "<p>Attacks that do not include the provoking combatant suffer -6 Accuracy, and non-crush accuracy modifiers cannot exceed 0.</p>"
  },
  drowsy: {
    name: "Drowsy",
    img: `modules/${MODULE_ID}/images/conditions/Drowsy.svg`,
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
    rules: halfEvasionRules("Drowsy"),
    effect: "<p>Boss Sleep replacement. Actions are retained, evasion is halved, and a failed save gives -10 to the next damage roll.</p>"
  },
  chilled: {
    name: "Chilled",
    img: `modules/${MODULE_ID}/images/conditions/Chilled.svg`,
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
    rules: halfEvasionRules("Chilled"),
    effect: "<p>Boss Frozen replacement. Actions are retained, evasion is halved, and a failed save gives -10 to the next damage roll.</p>"
  }
};

Hooks.once("init", () => {
  if (game.system.id !== "ptu") return;
  registerSettings();
});

Hooks.once("ready", () => {
  if (game.system.id !== "ptu") return;
  registerStatusEffects();
  patchPTR();
  exposeApi();
  registerTurnSummaryHook();
  if (game.user.isGM && game.settings.get(MODULE_ID, "worldItems")) {
    ensureWorldStatusItems().catch((error) => warnThrottled("world-items", error));
  }
  console.log(`${MODULE_ID} | Ready.`);
});

function registerSettings() {
  game.settings.register(MODULE_ID, "enabled", {
    name: "PTR_STATUS.Settings.Enabled.Name",
    hint: "PTR_STATUS.Settings.Enabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "chat", {
    name: "PTR_STATUS.Settings.Chat.Name",
    hint: "PTR_STATUS.Settings.Chat.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "bossCounts", {
    name: "PTR_STATUS.Settings.BossCounts.Name",
    hint: "PTR_STATUS.Settings.BossCounts.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "turnSummary", {
    name: "PTR_STATUS.Settings.TurnSummary.Name",
    hint: "PTR_STATUS.Settings.TurnSummary.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "worldItems", {
    name: "PTR_STATUS.Settings.WorldItems.Name",
    hint: "PTR_STATUS.Settings.WorldItems.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

function registerStatusEffects() {
  const statusEffects = CONFIG.PTU?.statusEffects ?? CONFIG.statusEffects;
  if (!Array.isArray(statusEffects)) return;

  for (const [id, data] of Object.entries(CONDITION_DEFINITIONS)) {
    const replacement = {
      id,
      name: data.nameKey ?? data.name,
      img: data.img,
      changes: [{ key: `flags.ptu.is_${id.replaceAll("-", "_")}`, value: true, mode: 5, priority: 50 }]
    };
    const existing = statusEffects.find((effect) => effect.id === id);
    if (existing) foundry.utils.mergeObject(existing, replacement, { inplace: true, overwrite: true });
    else statusEffects.push(replacement);
  }
  CONFIG.statusEffects = statusEffects;
}

function patchPTR() {
  if (CONFIG.PTU?.[MODULE_ID]?.[FLAGS.patched]) return;
  CONFIG.PTU ??= {};
  CONFIG.PTU[MODULE_ID] ??= {};
  CONFIG.PTU[MODULE_ID][FLAGS.patched] = true;

  patchActorCreateEmbedded();
  patchActorGetRollOptions();
  patchActorGetFilteredRollOptions();
  patchActorGetSelfRollOptions();
  patchActorPrepareDerivedData();
  patchActorApplyDamage();
  patchConditionTurnEnd();
  patchParalysisHandler();
  patchConditionFromEffects();
  patchActorSheets();
  patchTemplateRendering();
  registerMovementHooks();
  registerLinkedConditionCleanup();
  registerActorSheetHooks();
  registerTemporaryInjuryHooks();
  registerTemporaryInjuryObserver();
  registerTemporaryInjuryInputListener();
}

function patchActorCreateEmbedded() {
  const ActorClass = CONFIG.PTU.Actor.documentClass;
  const original = ActorClass.prototype.createEmbeddedDocuments;

  ActorClass.prototype.createEmbeddedDocuments = async function patchedCreateEmbeddedDocuments(embeddedName, data = [], context = {}) {
    if (!isEnabled() || embeddedName !== "Item" || !Array.isArray(data)) {
      return original.call(this, embeddedName, data, context);
    }

    const transformed = [];
    const helperQueue = [];
    for (const datum of data) {
      if (datum?.type !== "condition") {
        transformed.push(datum);
        helperQueue.push([]);
        continue;
      }

      const normalized = await normalizeIncomingCondition(this, foundry.utils.deepClone(datum));
      if (normalized.blocked) {
        await post("PTR_STATUS.Chat.Blocked", {
          actor: this.link,
          label: normalized.label,
          reason: normalized.reason
        }, this);
        continue;
      }

      transformed.push(normalized.data);
      helperQueue.push(normalized.helpers);
    }

    const created = transformed.length ? await original.call(this, embeddedName, transformed, context) : [];
    const helperCreates = [];
    for (let index = 0; index < created.length; index++) {
      const parent = created[index];
      if (parent?.type !== "condition") continue;
      for (const helper of helperQueue[index] ?? []) {
        const helperSlug = typeof helper === "string" ? helper : helper.slug;
        if (!helperSlug || hasCondition(this, helperSlug)) continue;
        const helperData = createConditionData(helperSlug, helper.overrides ?? {});
        if (helper.linked) {
          helperData.flags ??= {};
          helperData.flags[MODULE_ID] ??= {};
          helperData.flags[MODULE_ID].linkedTo = parent.id;
          helperData.flags[MODULE_ID].linkedSlug = parent.slug;
          helperData.system.references.parent = { id: parent.id, type: "condition" };
        }
        helperCreates.push(helperData);
      }
    }
    if (helperCreates.length) await original.call(this, embeddedName, helperCreates, context);
    return created;
  };
}

async function normalizeIncomingCondition(actor, data) {
  const sourceSlug = sluggify(data.system?.slug ?? data.slug ?? data.name);
  let slug = sourceSlug;
  const isBoss = isBossActor(actor);

  if (slug === "sleep" && isBoss) slug = "drowsy";
  if (slug === "frozen" && isBoss) slug = "chilled";

  const label = conditionLabel(slug);
  if (slug === "bleeding" && hasType(actor, "Ghost")) {
    return blocked(label, game.i18n.localize("PTR_STATUS.Reason.GhostBleeding"));
  }
  if ((slug === "frozen" || slug === "chilled") && hasType(actor, "Ice")) {
    return blocked(label, game.i18n.localize("PTR_STATUS.Reason.IceFrozen"));
  }
  if (slug === "weakened" && isBoss && isWeakenedImmune(actor)) {
    return blocked(label, game.i18n.localize("PTR_STATUS.Reason.WeakenedCooldown"));
  }
  if (slug === "disabled" && isBoss && hasCondition(actor, "disabled")) {
    return blocked(label, game.i18n.localize("PTR_STATUS.Reason.DisableActive"));
  }

  data = mergeConditionDefaults(data, slug);
  if (LINKED_SOURCE_SLUGS.has(slug) && !data.flags?.[MODULE_ID]?.linkedActor?.uuid) {
    const linkedActor = await promptLinkedActor(actor, slug);
    if (linkedActor) {
      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID].linkedActor = linkedActor;
      data.system.effect = appendLinkedActorEffect(data.system.effect, linkedActor, slug);
      data.system.rules = mergeLinkedActorRules(data.system.rules ?? [], slug, linkedActor, actor);
    }
  }
  if (isBoss && ACTION_GATE_SLUGS.has(slug)) {
    const assigned = findBossAssignedCombatant(actor);
    if (assigned) {
      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID][FLAGS.assignedCombatant] = assigned.id;
      await post("PTR_STATUS.Chat.BossAssigned", { actor: actor.link, label, initiative: assigned.initiative ?? "?" }, actor);
    }
  }

  const helpers = (ON_CREATE_HELPERS.get(slug) ?? []).filter((helperSlug) => {
    if (helperSlug !== "weakened") return true;
    if (isBoss && isWeakenedImmune(actor)) return false;
    return !hasCapability(actor, "Heater") && !hasCapability(actor, "heater");
  }).map((helperSlug) => ({
    slug: helperSlug,
    linked: slug === "frozen" && FREEZE_LINKED_HELPERS.has(helperSlug)
  }));
  return { data, helpers, blocked: false };
}

function mergeConditionDefaults(data, slug) {
  const definition = CONDITION_DEFINITIONS[slug];
  if (!definition) {
    data.system ??= {};
    data.system.slug ??= slug;
    return data;
  }

  const base = createConditionData(slug);
  const merged = foundry.utils.mergeObject(base, data, { inplace: false, overwrite: true });
  merged.name = base.name;
  merged.img = base.img;
  merged.system.slug = slug;
  merged.system.effect = fullStatusEffect(slug, definition.effect ?? "");
  merged.system.rules = base.system.rules;
  if (base.system.persistent) merged.system.persistent = base.system.persistent;
  return merged;
}

function blocked(label, reason) {
  return { blocked: true, label, reason, helpers: [] };
}

async function promptLinkedActor(targetActor, slug) {
  const choices = getSceneActorChoices(targetActor);
  if (!choices.length) return null;

  const prompt = game.i18n.localize(CONDITION_DEFINITIONS[slug]?.sourcePrompt ?? "PTR_STATUS.Prompt.LinkedActor");
  const content = `<form><div class="form-group"><label>${escapeHtml(prompt)}</label><select name="actor">${choices.map((choice) => `<option value="${escapeHtml(choice.uuid)}">${escapeHtml(choice.name)}</option>`).join("")}</select></div></form>`;

  return new Promise((resolve) => {
    new Dialog({
      title: conditionLabel(slug),
      content,
      buttons: {
        ok: {
          label: game.i18n.localize("PTU.Action.Apply") || "Apply",
          callback: (html) => {
            const uuid = html.find("[name=actor]").val();
            resolve(choices.find((choice) => choice.uuid === uuid) ?? null);
          }
        },
        skip: {
          label: game.i18n.localize("Cancel") || "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

function getSceneActorChoices(targetActor) {
  const scene = canvas?.scene ?? game.scenes?.active;
  const choices = new Map();
  for (const token of scene?.tokens?.contents ?? []) {
    const actor = token.actor;
    if (!actor || actor.id === targetActor?.id) continue;
    choices.set(actor.uuid, {
      uuid: actor.uuid,
      id: actor.id,
      name: token.name || actor.name,
      tokenUuid: token.uuid
    });
  }
  return Array.from(choices.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function appendLinkedActorEffect(effect, linkedActor, slug) {
  const label = slug === "infatuation"
    ? "Crush"
    : slug === "provoked"
      ? "Provoking Combatant"
      : "Source";
  return `${effect ?? ""}<p><strong>${escapeHtml(label)}:</strong> @UUID[${linkedActor.uuid}]{${escapeHtml(linkedActor.name)}}</p>`;
}

function mergeLinkedActorRules(rules, slug, linkedActor, actor) {
  const targetId = linkedActor.id;
  const targetUuid = linkedActor.uuid;
  const targetPredicate = [`target:uuid:${targetUuid}`];
  const notTargetPredicate = [{ not: `target:uuid:${targetUuid}` }];
  const linkedRules = [];

  if (slug === "provoked") {
    linkedRules.push({
      key: "FlatModifier",
      selectors: ["attack"],
      value: -6,
      label: "Provoked",
      predicate: notTargetPredicate
    });
  }

  if (slug === "infatuation") {
    linkedRules.push(
      {
        key: "FlatModifier",
        selectors: ["damage"],
        value: -5,
        label: "Infatuation",
        predicate: notTargetPredicate
      },
      {
        key: "FlatModifier",
        selectors: ["physical-damage"],
        value: -Math.floor(Number(actor.system?.stats?.atk?.total ?? 0) / 2),
        label: "Infatuation vs Crush",
        predicate: targetPredicate
      },
      {
        key: "FlatModifier",
        selectors: ["special-damage"],
        value: -Math.floor(Number(actor.system?.stats?.spatk?.total ?? 0) / 2),
        label: "Infatuation vs Crush",
        predicate: targetPredicate
      }
    );
  }

  if (slug === "seeded") {
    linkedRules.push({
      key: "RollOption",
      domain: "all",
      option: `condition:seeded:source:${targetId}`,
      label: "Seeded Source"
    });
  }

  return [...rules, ...linkedRules];
}

function patchActorGetRollOptions() {
  const ActorClass = CONFIG.PTU.Actor.documentClass;
  const original = ActorClass.prototype.getRollOptions;

  ActorClass.prototype.getRollOptions = function patchedGetRollOptions(domains = []) {
    const options = original.call(this, domains);
    if (!isEnabled() || !game.settings.get(MODULE_ID, "bossCounts") || !isBossActor(this)) return options;

    const activeCombatant = game.combat?.combatant ?? null;
    if (!activeCombatant || activeCombatant.actorId !== this.id) return options;

    const inactive = this.conditions?.active
      ?.filter((condition) => ACTION_GATE_SLUGS.has(condition.slug) && !conditionAppliesToCombatant(condition, activeCombatant))
      ?.map((condition) => `condition:${condition.slug}`) ?? [];
    if (!inactive.length) return options;

    const inactiveSet = new Set(inactive);
    return options.filter((option) => !inactiveSet.has(option));
  };
}

function patchActorGetFilteredRollOptions() {
  const ActorClass = CONFIG.PTU.Actor.documentClass;
  const original = ActorClass.prototype.getFilteredRollOptions;

  ActorClass.prototype.getFilteredRollOptions = function patchedGetFilteredRollOptions(prefix, domains = []) {
    const options = original.call(this, prefix, domains);
    if (!isEnabled() || prefix !== "condition") return options;
    return options.filter((option) => option !== "condition:frozen");
  };
}

function patchActorGetSelfRollOptions() {
  const ActorClass = CONFIG.PTU.Actor.documentClass;
  const original = ActorClass.prototype.getSelfRollOptions;

  ActorClass.prototype.getSelfRollOptions = function patchedGetSelfRollOptions(prefix = "self") {
    const options = original.call(this, prefix);
    options.push(`${prefix}:uuid:${this.uuid}`);
    return Array.from(new Set(options));
  };
}

function patchActorPrepareDerivedData() {
  const specificClasses = Object.values(CONFIG.PTU.Actor.documentClasses ?? {}).filter(Boolean);
  const classes = new Set(specificClasses.length ? specificClasses : [CONFIG.PTU.Actor.documentClass].filter(Boolean));

  for (const ActorClass of classes) {
    const original = ActorClass.prototype.prepareDerivedData;
    if (!(original instanceof Function) || original[MODULE_ID]) continue;

    const patched = function patchedPrepareDerivedData(...args) {
      const result = original.apply(this, args);
      if (isEnabled()) {
        applyTemporaryInjuryData(this);
        applyBossEvasionPenalty(this);
      }
      return result;
    };
    patched[MODULE_ID] = true;
    ActorClass.prototype.prepareDerivedData = patched;
  }
}

function patchActorApplyDamage() {
  const ActorClass = CONFIG.PTU.Actor.documentClass;
  const original = ActorClass.prototype.applyDamage;

  ActorClass.prototype.applyDamage = async function patchedApplyDamage(params = {}) {
    if (isEnabled()) {
      const rollOptions = normalizeRollOptions(params.rollOptions);
      const optionSet = new Set(rollOptions);
      params = { ...params, rollOptions };
      if (optionSet.has("origin:condition:weakened") && params.effectiveness !== -1) {
        params = { ...params, effectiveness: (params.effectiveness ?? 1) * 0.5 };
      }
    }
    return original.call(this, params);
  };
}

function patchConditionTurnEnd() {
  const ConditionClass = CONFIG.PTU.Item.documentClasses.condition;
  const original = ConditionClass.prototype.onTurnEnd;

  ConditionClass.prototype.onTurnEnd = async function patchedConditionTurnEnd(options = {}) {
    if (!isEnabled() || !this.active || !this.actor) return original.call(this, options);
    if (DOT_SLUGS.has(this.slug) || SAVE_SLUGS.has(this.slug)) {
      return handleManagedConditionTurnEnd(this, options);
    }
    if (this.slug === "weakened") return handleWeakenedTurnEnd(this);
    return original.call(this, options);
  };
}

function patchParalysisHandler() {
  const ConditionClass = CONFIG.PTU.Item.documentClasses.condition;
  const original = ConditionClass.HandleParalyzed;
  if (!(original instanceof Function)) return;

  ConditionClass.HandleParalyzed = async function patchedHandleParalyzed(actor, paralyzed) {
    if (!isEnabled() || !isBossActor(actor)) return original.call(this, actor, paralyzed);
    const current = game.combat?.combatant ?? null;
    if (current && current.actorId === actor.id && !conditionAppliesToCombatant(paralyzed, current)) return null;
    return handleParalysisSave(actor, paralyzed);
  };
}

function patchConditionFromEffects() {
  const ConditionClass = CONFIG.PTU.Item.documentClasses.condition;
  const original = ConditionClass.FromEffects;
  if (!(original instanceof Function)) return;

  ConditionClass.FromEffects = async function patchedFromEffects(effects) {
    if (!isEnabled()) return original.call(this, effects);

    const managed = [];
    const passthrough = [];
    for (const effect of effects ?? []) {
      const slug = sluggify(effect?.id ?? effect?.system?.slug ?? effect?.slug ?? effect?.name);
      if (CONDITION_DEFINITIONS[slug]) {
        managed.push(createConditionData(slug, {
          system: { origin: slug }
        }));
      } else {
        passthrough.push(effect);
      }
    }

    const originalItems = passthrough.length ? await original.call(this, passthrough) : [];
    return [...managed, ...originalItems];
  };
}

function patchActorSheets() {
  const classes = new Set([
    CONFIG.PTU.Actor.sheetClasses?.character,
    CONFIG.PTU.Actor.sheetClasses?.pokemon,
    CONFIG.PTU.Actor.sheetClass
  ].filter(Boolean));

  for (const SheetClass of classes) {
    const original = SheetClass.prototype.activateListeners;
    if (!(original instanceof Function) || original[MODULE_ID]) continue;

    const patched = function patchedActivateListeners(html, ...args) {
      const result = original.call(this, html, ...args);
      scheduleTemporaryInjuryInjection(this, html);
      scheduleTemporaryInjuryScan();
      return result;
    };
    patched[MODULE_ID] = true;
    SheetClass.prototype.activateListeners = patched;
  }
}

function patchTemplateRendering() {
  const handlebars = foundry.applications?.handlebars;
  if (handlebars?.renderTemplate instanceof Function && !handlebars.renderTemplate[MODULE_ID]) {
    const original = handlebars.renderTemplate;
    const patched = async function patchedRenderTemplate(path, data = {}, ...args) {
      const html = await original.call(this, path, data, ...args);
      return injectTemporaryInjuryIntoTemplate(path, html, data);
    };
    patched[MODULE_ID] = true;
    handlebars.renderTemplate = patched;
  }

  if (globalThis.renderTemplate instanceof Function && !globalThis.renderTemplate[MODULE_ID]) {
    const original = globalThis.renderTemplate;
    const patched = async function patchedLegacyRenderTemplate(path, data = {}, ...args) {
      const html = await original.call(this, path, data, ...args);
      return injectTemporaryInjuryIntoTemplate(path, html, data);
    };
    patched[MODULE_ID] = true;
    globalThis.renderTemplate = patched;
  }
}

function registerMovementHooks() {
  Hooks.on("preUpdateToken", (tokenDocument, changed, options) => {
    try {
      if (!isEnabled() || options?.[MODULE_ID]?.ignoreStatusMovement) return true;
      if (!("x" in changed || "y" in changed)) return true;

      const actor = tokenDocument.actor;
      if (!actor) return true;

      if (hasCondition(actor, "stuck")) {
        notifyMovementBlocked(actor, "PTR_STATUS.Movement.Stuck");
        return false;
      }

      if (hasCondition(actor, "tripped")) {
        notifyMovementBlocked(actor, "PTR_STATUS.Movement.Tripped");
        return false;
      }

      return true;
    } catch (error) {
      warnThrottled("movement-hook", error);
      return true;
    }
  });
}

function registerLinkedConditionCleanup() {
  Hooks.on("deleteItem", async (item) => {
    try {
      if (!isEnabled() || item?.type !== "condition" || !item.actor) return;
      const linkedIds = item.actor.items
        .filter((candidate) => candidate.type === "condition" && candidate.getFlag(MODULE_ID, "linkedTo") === item.id)
        .map((candidate) => candidate.id);
      if (linkedIds.length) await item.actor.deleteEmbeddedDocuments("Item", linkedIds);
    } catch (error) {
      warnThrottled("linked-cleanup", error);
    }
  });
}

function registerActorSheetHooks() {
  for (const hook of ["renderActorSheet", "renderPTUActorSheet", "renderPTUCharacterSheet", "renderPTUPokemonSheet"]) {
    Hooks.on(hook, (app, html) => {
      scheduleTemporaryInjuryInjection(app, html);
      scheduleTemporaryInjuryScan();
    });
  }
}

function registerTemporaryInjuryHooks() {
  Hooks.on("preUpdateActor", (_actor, changed) => {
    const flagPath = `flags.${MODULE_ID}.${FLAGS.temporaryInjuries}`;
    const systemPath = "system.health.temporaryInjuries";
    const flagValue = foundry.utils.getProperty(changed, flagPath);
    const systemValue = foundry.utils.getProperty(changed, systemPath);
    const value = systemValue ?? flagValue;
    if (value === undefined) return;

    const clamped = clampTemporaryInjuries(value);
    foundry.utils.setProperty(changed, flagPath, clamped);
    foundry.utils.setProperty(changed, systemPath, clamped);
  });
}

function registerTemporaryInjuryInputListener() {
  document.addEventListener("change", async (event) => {
    const input = event.target?.closest?.("[data-ptr-temporary-injuries]");
    if (!input) return;

    try {
      const root = input.closest(".app.sheet.actor, .window-app.sheet.actor, .ptu.sheet.actor");
      const actor = getSheetActor(getAppFromSheetRoot(root), root);
      if (!actor) return;
      const value = clampTemporaryInjuries(input.value);
      input.value = value;
      await setTemporaryInjuries(actor, value);
      scheduleTemporaryInjuryScan();
    } catch (error) {
      warnThrottled("temporary-injury-input", error);
    }
  }, true);
}

function registerTemporaryInjuryObserver() {
  if (temporaryInjuryObserver || typeof MutationObserver === "undefined" || !document?.body) return;

  temporaryInjuryObserver = new MutationObserver((mutations) => {
    const shouldScan = mutations.some((mutation) => Array.from(mutation.addedNodes ?? []).some(nodeContainsActorSheet));
    if (shouldScan) scheduleTemporaryInjuryScan();
  });
  temporaryInjuryObserver.observe(document.body, { childList: true, subtree: true });
  scheduleTemporaryInjuryScan();
}

function nodeContainsActorSheet(node) {
  if (!(node instanceof HTMLElement)) return false;
  return Boolean(
    node.matches?.(".app.sheet.actor, .ptu.sheet.actor, .window-app.sheet.actor")
    || node.querySelector?.('input[name="system.health.injuries"]')
    || node.querySelector?.(".app.sheet.actor, .ptu.sheet.actor, .window-app.sheet.actor")
  );
}

async function handleManagedConditionTurnEnd(condition, options = {}) {
  try {
    const actor = condition.actor;
    if (!actor) return;
    if (isBossActor(actor) && condition.getFlag(MODULE_ID, FLAGS.processedRound) === game.combat?.round) return;

    if (DOT_SLUGS.has(condition.slug)) await applyDot(condition);
    const removed = SAVE_SLUGS.has(condition.slug) ? await rollConditionSave(condition, options) : false;

    if (!removed && condition.actor && isBossActor(actor)) {
      await condition.setFlag(MODULE_ID, FLAGS.processedRound, game.combat?.round ?? 0);
    }
  } catch (error) {
    warnThrottled(`turn-end:${condition?.slug ?? "unknown"}`, error);
  }
}

async function applyDot(condition) {
  const actor = condition.actor;
  const amount = dotAmount(condition);
  if (amount <= 0) return;
  const applied = await applyFlatHpLoss(actor, amount, condition.name);

  if (condition.slug === "seeded" && applied > 0) {
    await applySeededDrain(condition, applied);
  }

  if (condition.slug === "badly-poisoned" && typeof condition.value === "number") {
    await condition.increase();
  }
}

function dotAmount(condition) {
  const actor = condition.actor;
  const tick = getTickAmount(actor);
  switch (condition.slug) {
    case "burned":
    case "poisoned":
    case "cursed":
    case "seeded":
      return tick;
    case "badly-poisoned":
      return 5 * (2 ** Math.max(0, Number(condition.value ?? 1) - 1));
    case "bleeding":
      return tick * (hasHeavyShifted(actor) ? 2 : 1);
    default:
      return 0;
  }
}

async function rollConditionSave(condition) {
  const actor = condition.actor;
  const dc = saveDc(condition);
  const roll = await new Roll("1d20").evaluate();
  const success = roll.total >= dc;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="header-bar"><p class="action">${escapeHtml(actor.name)}: ${escapeHtml(condition.name)} Save Check ${dc}+</p></div>`,
    whisper: recipients(actor)
  });

  await post(success ? "PTR_STATUS.Chat.SaveSuccess" : "PTR_STATUS.Chat.SaveFail", {
    actor: actor.link,
    label: condition.name,
    roll: roll.total,
    dc
  }, actor);

  if (success) {
    await condition.delete();
    return true;
  }

  if (condition.slug === "drowsy" || condition.slug === "chilled") {
    await applyBossDamagePenalty(actor, condition.name);
  }
  return false;
}

function saveDc(condition) {
  const actor = condition.actor;
  if (condition.slug === "rage") return 15;
  if (condition.slug === "frozen" || condition.slug === "chilled") {
    let dc = hasType(actor, "Fire") ? 11 : 16;
    const weather = getWeatherState();
    if (weather === "sun") dc -= 4;
    if (weather === "hail" || weather === "snow") dc += 2;
    return Math.max(2, dc);
  }
  return 16;
}

async function handleParalysisSave(actor, paralyzed) {
  const roll = await new Roll("1d20").evaluate();
  const success = roll.total >= 11;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="header-bar"><p class="action">${escapeHtml(actor.name)}: Paralysis Save Check 11+</p></div>`,
    whisper: recipients(actor)
  });
  await post(success ? "PTR_STATUS.Chat.SaveSuccess" : "PTR_STATUS.Chat.SaveFail", {
    actor: actor.link,
    label: paralyzed.name,
    roll: roll.total,
    dc: 11
  }, actor);

  if (!success && !hasCondition(actor, "vulnerable")) {
    await actor.createEmbeddedDocuments("Item", [createConditionData("vulnerable", {
      duration: { value: 1, unit: "rounds", expiry: "turn-start" }
    })]);
  }
}

async function handleWeakenedTurnEnd(condition) {
  if (!isBossActor(condition.actor)) return;
  await condition.actor.setFlag(MODULE_ID, FLAGS.weakenedImmuneUntil, (game.combat?.round ?? 0) + 3);
}

async function applyBossDamagePenalty(actor, label) {
  const data = createEffectData(`${label} Damage Penalty`, [
    { key: "FlatModifier", selectors: ["damage", "all"], value: -10, label }
  ], {
    duration: { value: 1, unit: "rounds", expiry: "turn-end" },
    img: "icons/svg/degen.svg"
  });
  await actor.createEmbeddedDocuments("Item", [data]);
  await post("PTR_STATUS.Chat.BossPenalty", { actor: actor.link, label }, actor);
}

async function applyFlatHpLoss(actor, amount, label) {
  const oldHp = Number(actor.system?.health?.value ?? 0);
  const newHp = Math.max(0, oldHp - amount);
  if (newHp === oldHp) return 0;
  await actor.update({ "system.health.value": newHp });
  await post("PTR_STATUS.Chat.Damage", { actor: actor.link, amount: oldHp - newHp, label }, actor);
  return oldHp - newHp;
}

async function applySeededDrain(condition, amount) {
  const source = await getLinkedActor(condition);
  if (!source || source.id === condition.actor?.id) return;
  await healFlatHp(source, amount, condition.name);
}

async function healFlatHp(actor, amount, label) {
  const oldHp = Number(actor.system?.health?.value ?? 0);
  const maxHp = Number(actor.system?.health?.max ?? actor.system?.health?.total ?? 0);
  const newHp = maxHp > 0 ? Math.min(maxHp, oldHp + amount) : oldHp + amount;
  if (newHp === oldHp) return 0;
  await actor.update({ "system.health.value": newHp });
  await post("PTR_STATUS.Chat.Heal", { actor: actor.link, amount: newHp - oldHp, label }, actor);
  return newHp - oldHp;
}

async function getLinkedActor(condition) {
  const linked = condition.getFlag(MODULE_ID, "linkedActor");
  const uuid = linked?.tokenUuid ?? linked?.uuid;
  if (!uuid) return null;
  const document = await fromUuid(uuid);
  return document?.actor ?? (document?.documentName === "Actor" ? document : null);
}

function applyTemporaryInjuryData(actor) {
  const system = actor?.system;
  const health = system?.health;
  if (!health) return;

  const temporary = getTemporaryInjuries(actor);
  const normal = Number(health.injuries ?? 0);
  const effective = Math.max(0, normal + temporary);

  health.temporaryInjuries = temporary;
  health.effectiveInjuries = effective;

  if (effective > 0 && Number.isFinite(Number(health.total))) {
    health.max = calculateInjuredMaxHealth(system, effective);
  } else if (Number.isFinite(Number(health.total))) {
    health.max = Number(health.total);
  }

  const max = Number(health.max ?? 0);
  const total = Number(health.total ?? 0);
  const value = Number(health.value ?? 0);
  health.percent = max > 0 ? Math.round((value / max) * 100) : 0;
  health.totalPercent = total > 0 ? Math.round((value / total) * 100) : 0;

  actor.attributes ??= {};
  actor.attributes.health ??= {};
  actor.attributes.health.max = health.max;
  actor.attributes.health.injuries = effective;
  actor.attributes.health.temporaryInjuries = temporary;
}

function applyBossEvasionPenalty(actor) {
  if (!isBossActor(actor) || !(hasCondition(actor, "drowsy") || hasCondition(actor, "chilled"))) return;
  const evasion = actor.system?.evasion;
  if (!evasion) return;

  for (const key of ["physical", "special", "speed"]) {
    const current = Number(evasion[key] ?? 0);
    if (Number.isFinite(current)) evasion[key] = Math.floor(current / 2);
  }
}

function calculateInjuredMaxHealth(system, injuries) {
  const total = Number(system.health?.total ?? 0);
  const hardened = Boolean(system.modifiers?.hardened);
  const injuryFactor = (hardened ? Math.min(injuries, 5) : injuries) / 10;
  return Math.max(0, Math.trunc(total * (1 - injuryFactor)));
}

function registerTurnSummaryHook() {
  Hooks.on("ptu.startTurn", async (combatant) => {
    try {
      if (!isEnabled() || !game.settings.get(MODULE_ID, "turnSummary")) return;
      const actor = combatant?.actor;
      if (!actor || actor.primaryUpdater && game.user !== actor.primaryUpdater) return;
      await postTurnStatusSummary(actor);
    } catch (error) {
      warnThrottled("turn-summary", error);
    }
  });
}

async function postTurnStatusSummary(actor) {
  const conditions = actor.conditions?.active
    ?.filter((condition) => CONDITION_DEFINITIONS[condition.slug])
    ?.sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  if (!conditions.length) return;

  const title = game.i18n.format("PTR_STATUS.Chat.TurnSummaryTitle", { actor: actor.name });
  const content = buildTurnSummaryHtml(title, conditions);

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

function buildTurnSummaryHtml(title, conditions) {
  const chips = conditions.map((condition) => `<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid #999;border-radius:4px;padding:2px 6px;margin:2px;background:#f7f3e8;"><img src="${escapeHtml(condition.img)}" width="18" height="18" style="border:0;">${escapeHtml(condition.name)}</span>`).join("");
  const details = conditions.map((condition) => {
    const definition = CONDITION_DEFINITIONS[condition.slug] ?? {};
    const body = condition.system?.effect || definition.effect || "";
    const duration = describeDuration(condition);
    return `<details style="margin-top:6px;">
      <summary><strong>${escapeHtml(condition.name)}</strong>${duration ? ` <small>${escapeHtml(duration)}</small>` : ""}</summary>
      <div style="margin:.35rem 0 .35rem .5rem;">${body}</div>
      <p style="margin:.25rem 0 .25rem .5rem;">@UUID[${condition.uuid}]{${escapeHtml(game.i18n.localize("PTR_STATUS.Chat.OpenItem"))}}</p>
    </details>`;
  }).join("");

  return `<section class="ptr-status-summary">
    <h3>${escapeHtml(title)}</h3>
    <div>${chips}</div>
    ${details}
  </section>`;
}

function describeDuration(condition) {
  const duration = condition.system?.duration;
  if (!duration) return "";
  if (duration.unit === "unlimited") return "Persistent";
  if (duration.unit === "encounter") return "Encounter";
  if (duration.value) return `${duration.value} ${duration.unit}`;
  return "";
}

function scheduleTemporaryInjuryInjection(app, html) {
  window.setTimeout(() => {
    try {
      if (!isEnabled() || !app?.actor) return;
      injectTemporaryInjuries(app, html);
    } catch (error) {
      warnThrottled("temporary-injury-sheet", error);
    }
  }, 0);
}

function injectTemporaryInjuryIntoTemplate(path, html, data = {}) {
  try {
    if (!isEnabled() || typeof html !== "string" || !isActorSheetTemplate(path)) return html;
    const actor = getTemplateActor(data);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const injected = injectTemporaryInjuryRow(wrapper, actor);
    return injected ? wrapper.innerHTML : html;
  } catch (error) {
    warnThrottled("temporary-injury-template", error);
    return html;
  }
}

function isActorSheetTemplate(path) {
  return /systems\/ptu\/static\/templates\/actor\/(?:trainer|pokemon)-sheet(?:-compact)?\.hbs$/i.test(String(path ?? ""));
}

function scheduleTemporaryInjuryScan() {
  if (temporaryInjuryScanQueued) return;
  temporaryInjuryScanQueued = true;
  window.setTimeout(() => {
    temporaryInjuryScanQueued = false;
    try {
      injectTemporaryInjuriesInOpenSheets();
    } catch (error) {
      warnThrottled("temporary-injury-scan", error);
    }
  }, 50);
}

function injectTemporaryInjuriesInOpenSheets() {
  for (const app of Object.values(ui.windows ?? {})) {
    if (!getSheetActor(app)?.system?.health) continue;
    injectTemporaryInjuries(app, app.element);
  }

  for (const root of document.querySelectorAll(".app.sheet.actor, .window-app.sheet.actor, .ptu.sheet.actor")) {
    const app = getAppFromSheetRoot(root);
    if (!getSheetActor(app, root)?.system?.health) continue;
    injectTemporaryInjuries(app, root);
  }
}

function injectTemporaryInjuries(app, html) {
  const root = getSheetRoot(app, html);
  const actor = getSheetActor(app, root);
  if (!actor?.system?.health) return;
  injectTemporaryInjuryRow(root, actor);
}

function injectTemporaryInjuryRow(root, actor) {
  if (!root || root.querySelector(".ptr-temp-injuries-row")) return false;

  const combatTab = root.querySelector('[data-tab="combat"]') ?? root;
  const injuryInput = combatTab.querySelector('input[name="system.health.injuries"]');
  if (!injuryInput) return false;

  const anchorRow = injuryInput.closest(".d-flex") ?? injuryInput.parentElement;
  if (!anchorRow?.parentElement) return false;

  const columnClass = injuryInput.closest(".col-sm-6") ? "col-sm-6" : "fb-48";
  const temporary = getTemporaryInjuries(actor);
  const normal = Number(actor?.system?.health?.injuries ?? 0);
  const effective = normal + temporary;

  const row = document.createElement("div");
  row.className = `ptr-temp-injuries-row d-flex w-100 mt-1 mb-1 ${columnClass === "fb-48" ? "justify-content-between" : ""}`;
  row.innerHTML = buildTemporaryInjuryRowHtml(columnClass, temporary, effective);
  anchorRow.insertAdjacentElement("afterend", row);
  return true;
}

function buildTemporaryInjuryRowHtml(columnClass, temporary, effective) {
  return `
    <div class="${columnClass}">
      <label>${escapeHtml(game.i18n.localize("PTR_STATUS.TemporaryInjuries.Label"))}</label>
      <input name="system.health.temporaryInjuries" type="number" min="0" max="${MAX_TEMPORARY_INJURIES}" step="1" value="${temporary}" data-dtype="Number" data-ptr-temporary-injuries>
    </div>
    <div class="${columnClass}">
      <label>${escapeHtml(game.i18n.localize("PTR_STATUS.TemporaryInjuries.Effective"))}</label>
      <input type="number" value="${effective}" disabled>
    </div>`;
}

function getSheetRoot(app, html) {
  if (html?.jquery) return html[0];
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (app?.element?.jquery) return app.element[0];
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  return document.getElementById(app?.id) ?? null;
}

function getAppFromSheetRoot(root) {
  const appId = root?.dataset?.appid ?? root?.closest?.("[data-appid]")?.dataset?.appid;
  if (appId && ui.windows?.[appId]) return ui.windows[appId];
  return null;
}

function getSheetActor(app, root = null) {
  const actor = app?.actor ?? app?.document ?? app?.object;
  const ActorClass = CONFIG.Actor?.documentClass ?? CONFIG.PTU?.Actor?.documentClass;
  if (actor?.documentName === "Actor" || (ActorClass && actor instanceof ActorClass)) return actor;
  return getActorFromSheetRoot(root);
}

function getTemplateActor(data = {}) {
  const actor = data.actor ?? data.document ?? data.object;
  const ActorClass = CONFIG.Actor?.documentClass ?? CONFIG.PTU?.Actor?.documentClass;
  if (actor?.documentName === "Actor" || (ActorClass && actor instanceof ActorClass)) return actor;
  if (actor?.id && game.actors?.get(actor.id)) return game.actors.get(actor.id);
  return null;
}

function getActorFromSheetRoot(root) {
  if (!(root instanceof HTMLElement)) return null;
  const actorId = root.dataset?.actorId ?? root.dataset?.documentId ?? root.id?.match(/^actor-([A-Za-z0-9]+)/)?.[1];
  if (actorId && game.actors?.get(actorId)) return game.actors.get(actorId);

  const tokenId = root.dataset?.tokenId ?? root.id?.match(/^actor-[A-Za-z0-9]+-([A-Za-z0-9]+)/)?.[1];
  if (tokenId) return canvas?.scene?.tokens?.get(tokenId)?.actor ?? canvas?.tokens?.get(tokenId)?.actor ?? null;
  return null;
}

async function ensureWorldStatusItems() {
  const folder = await getOrCreateStatusFolder();
  const creations = [];
  const updates = [];

  for (const slug of Object.keys(CONDITION_DEFINITIONS)) {
    const data = createConditionData(slug);
    data.folder = folder?.id ?? null;
    data.flags ??= {};
    data.flags[MODULE_ID] = { statusSlug: slug };

    const existing = game.items.find((item) => item.getFlag(MODULE_ID, "statusSlug") === slug);
    if (existing) {
      updates.push({
        _id: existing.id,
        name: data.name,
        img: data.img,
        folder: data.folder,
        system: data.system,
        flags: foundry.utils.mergeObject(existing.flags ?? {}, data.flags, { inplace: false })
      });
    } else {
      creations.push(data);
    }
  }

  if (creations.length) await Item.createDocuments(creations);
  if (updates.length) await Item.updateDocuments(updates);
}

async function getOrCreateStatusFolder() {
  const existing = game.folders.find((folder) => folder.type === "Item" && folder.name === WORLD_ITEM_FOLDER);
  if (existing) return existing;
  return Folder.create({ name: WORLD_ITEM_FOLDER, type: "Item", sorting: "a" });
}

function exposeApi() {
  game.ptrStatus = {
    apply: async (actor, slug, options = {}) => actor?.createEmbeddedDocuments?.("Item", [createConditionData(slug, options)]),
    remove: async (actor, slug) => {
      const ids = actor?.conditions?.bySlug?.(sluggify(slug), { active: true })?.map((condition) => condition.id) ?? [];
      if (ids.length) return actor.deleteEmbeddedDocuments("Item", ids);
      return [];
    },
    markHeavyShift: async (actor) => actor?.setFlag?.(MODULE_ID, FLAGS.heavyShiftRound, game.combat?.round ?? 0),
    setTemporaryInjuries,
    getTemporaryInjuries,
    createConditionData,
    createEffectData
  };
}

function createConditionData(slug, overrides = {}) {
  const normalized = sluggify(slug);
  const definition = CONDITION_DEFINITIONS[normalized] ?? {};
  const status = CONFIG.PTU?.statusEffects?.find((effect) => effect.id === normalized) ?? CONFIG.statusEffects?.find((effect) => effect.id === normalized);
  const data = {
    name: definition.name ?? status?.name ?? titleCase(normalized),
    type: "condition",
    img: definition.img ?? status?.img ?? "icons/svg/aura.svg",
    system: {
      origin: "",
      effect: definition.effect ?? "",
      snippet: "",
      rules: definition.rules ?? [],
      enabled: true,
      slug: normalized,
      source: { value: "PTR Status Afflictions" },
      duration: definition.duration ?? { value: -1, unit: "unlimited", expiry: null },
      value: {
        isValued: normalized === "badly-poisoned",
        value: 1,
        autoIncrement: false
      },
      references: { children: [], overrides: [], overriddenBy: [] },
      overrides: [],
      persistent: definition.persistent ?? null
    }
  };
  data.system.effect = fullStatusEffect(normalized, definition.effect ?? data.system.effect);
  return foundry.utils.mergeObject(data, normalizeDocumentOverrides(overrides), { inplace: false, overwrite: true });
}

function createEffectData(name, rules, overrides = {}) {
  const data = {
    name,
    type: "effect",
    img: overrides.img ?? "icons/svg/aura.svg",
    system: {
      origin: "",
      effect: `<p>Managed by ${MODULE_ID}.</p>`,
      snippet: "",
      rules,
      enabled: true,
      slug: sluggify(name),
      source: { value: "PTR Status Afflictions" },
      duration: overrides.duration ?? { value: -1, unit: "unlimited", expiry: null },
      start: { value: 0, initiative: null },
      target: null,
      tokenIcon: { show: false },
      badge: null,
      context: null
    }
  };
  return foundry.utils.mergeObject(data, normalizeDocumentOverrides(overrides), { inplace: false, overwrite: true });
}

function fullStatusEffect(slug, summary) {
  const extra = {
    burned: `
      <h3>Normal</h3><ul><li>Persistent.</li><li>Defense -2 Combat Stages.</li><li>Lose 1 Tick at end turn after taking a Standard Action or being prevented from taking one.</li><li>No natural Save Check.</li></ul>
      <h3>Boss Template</h3><ul><li>HP loss applies once per round only.</li><li>Damage affects the current HP Bar through PTR's normal boss HP handling.</li></ul>`,
    poisoned: `
      <h3>Normal</h3><ul><li>Persistent.</li><li>Special Defense -2 Combat Stages.</li><li>Lose 1 Tick at end turn after acting or being action-denied.</li><li>No natural Save Check.</li></ul>
      <h3>Boss Template</h3><ul><li>HP loss applies once per round only.</li><li>Damage affects only the current HP Bar.</li></ul>`,
    "badly-poisoned": `
      <h3>Normal</h3><ul><li>Persistent.</li><li>Special Defense -2 Combat Stages.</li><li>HP loss starts at 5 HP and doubles each consecutive round: 5, 10, 20, 40.</li></ul>
      <h3>Boss Template</h3><ul><li>HP loss applies once per round only.</li><li>Damage affects only the current HP Bar.</li></ul>`,
    sleep: `
      <h3>Normal</h3><ul><li>Volatile.</li><li>Save Check 16+ at end turn removes Sleep.</li><li>Damage from an active attack wakes the target; passive Burn/Poison damage does not.</li></ul>
      <h3>Boss Template</h3><ul><li>Converted to Drowsy when applied.</li></ul>`,
    frozen: `
      <h3>Normal</h3><ul><li>Persistent.</li><li>The target gains Vulnerable and linked Stuck.</li><li>The target can still use Moves; this module removes PTR's original attack lock.</li><li>Weakened is applied for 1 full round unless the target has Heater.</li><li>Save Check 16+ at end turn removes Frozen. Fire-Type DC is 11. Sun grants +4 to the check; Hail/Snow applies -2.</li><li>Ice-Type targets are immune.</li></ul>
      <h3>Boss Template</h3><ul><li>Converted to Chilled when applied.</li></ul>`,
    paralysis: `
      <h3>Normal</h3><ul><li>Persistent.</li><li>Save Check 11+ at start turn to act normally.</li><li>On failure, the target may take a Standard Action or a Shift Action, not both; it becomes Vulnerable for 1 full round.</li></ul>
      <h3>Boss Template</h3><ul><li>Affects only the assigned boss Initiative Count.</li></ul>`,
    confused: `
      <h3>Normal</h3><ul><li>Volatile.</li><li>Cannot make Attacks of Opportunity.</li><li>When attacking, the PTR confusion check may damage the user after the attack.</li><li>Save Check 16+ at end turn removes Confused.</li></ul>
      <h3>Boss Template</h3><ul><li>Affects only the assigned boss Initiative Count.</li></ul>`,
    infatuation: `
      <h3>Normal</h3><ul><li>Volatile.</li><li>Choose the Crush when applied.</li><li>Damage rolls that do not include the Crush suffer -5.</li><li>Against the Crush, Attack and Special Attack contribution to damage is halved by predicate rules.</li><li>Save Check 16+ at end turn removes Infatuation.</li></ul>
      <h3>Boss Template</h3><ul><li>Affects only the assigned boss Initiative Count.</li></ul>`,
    rage: `
      <h3>Normal</h3><ul><li>Volatile.</li><li>Cannot use Status Moves.</li><li>Save Check 15+ at end turn removes Rage.</li></ul>
      <h3>Boss Template</h3><ul><li>Affects only the assigned boss Initiative Count when relevant.</li></ul>`,
    flinch: `
      <h3>Normal</h3><ul><li>1 full round.</li><li>Applies Vulnerable and -5 Initiative.</li></ul>
      <h3>Boss Template</h3><ul><li>Can affect only one Initiative Count and cannot remove multiple boss turns in one round.</li></ul>`,
    suppressed: `
      <h3>Normal</h3><ul><li>Usually 1 full round.</li><li>The target can only use At-Will Moves.</li></ul>
      <h3>Boss Template</h3><ul><li>Affects only the assigned boss Initiative Count.</li></ul>`,
    bleeding: `
      <h3>Normal</h3><ul><li>Persistent.</li><li>Lose 1 Tick at end turn, or 2 Ticks if marked as heavy-shifted this round.</li><li>Healing received is halved manually while Bleeding is active.</li><li>Ghost-Type targets are immune.</li></ul>
      <h3>Boss Template</h3><ul><li>Triggers once per round only, at the first eligible boss turn.</li><li>Damage affects only the current HP Bar.</li></ul>`,
    weakened: `
      <h3>Normal</h3><ul><li>Default duration: 1 full round.</li><li>Incoming attacks against this target are one effectiveness step better, implemented with Effectiveness Rule Elements.</li><li>Outgoing damage from a Weakened origin is resisted one additional step by automation during damage application.</li></ul>
      <h3>Boss Template</h3><ul><li>Expires after 1 full round.</li><li>After expiry, the boss cannot become Weakened again for 3 full rounds.</li></ul>`,
    provoked: `
      <h3>Normal</h3><ul><li>Default duration: 1 full round.</li><li>Choose the Provoking Combatant when applied.</li><li>Attacks that do not include the provoking combatant suffer -6 Accuracy via predicate rules.</li></ul>
      <h3>Boss Template</h3><ul><li>Affects only the assigned boss Initiative Count.</li></ul>`,
    seeded: `
      <h3>Normal</h3><ul><li>Special Mark/Coat condition.</li><li>Choose the source when applied.</li><li>At end turn, the target loses 1 Tick and the linked source recovers the HP lost.</li><li>Source-specific Seeded effects can still be adjudicated by the table.</li></ul>
      <h3>Boss Template</h3><ul><li>HP loss and drain apply once per round only and affect only the current HP Bar.</li></ul>`,
    drowsy: `
      <h3>Boss Template</h3><ul><li>Boss Sleep replacement.</li><li>The boss keeps its actions.</li><li>Evasion is halved by automation.</li><li>On a failed Save Check 16+, the boss suffers -10 to its next Damage Roll.</li><li>Taking damage does not automatically remove Drowsy.</li></ul>`,
    chilled: `
      <h3>Boss Template</h3><ul><li>Boss Frozen replacement.</li><li>The boss keeps its actions.</li><li>Evasion is halved by automation.</li><li>On a failed Save Check 16+, the boss suffers -10 to its next Damage Roll.</li><li>Weakened, if applied, lasts 1 full round and then triggers the 3-round boss cooldown.</li></ul>`
  };
  return `${summary ?? ""}${extra[slug] ?? ""}`;
}

function normalizeDocumentOverrides(overrides = {}) {
  const normalized = foundry.utils.expandObject(overrides);
  if (normalized.duration) {
    normalized.system ??= {};
    normalized.system.duration = normalized.duration;
    delete normalized.duration;
  }
  if (normalized.persistent) {
    normalized.system ??= {};
    normalized.system.persistent = normalized.persistent;
    delete normalized.persistent;
  }
  if (normalized.rules) {
    normalized.system ??= {};
    normalized.system.rules = normalized.rules;
    delete normalized.rules;
  }
  return normalized;
}

function findBossAssignedCombatant(actor) {
  const combat = game.combat;
  if (!combat || !actor) return null;
  const turns = combat.turns?.filter((combatant) => combatant.actorId === actor.id) ?? [];
  if (!turns.length) return null;

  const current = combat.combatant;
  if (current && current.actorId === actor.id) return current;
  const currentIndex = combat.turn ?? -1;
  return turns.find((combatant) => combat.turns.indexOf(combatant) > currentIndex)
    ?? turns[0]
    ?? null;
}

function conditionAppliesToCombatant(condition, combatant) {
  const assigned = condition.getFlag(MODULE_ID, FLAGS.assignedCombatant);
  return !assigned || assigned === combatant.id;
}

function isBossActor(actor) {
  const boss = actor?.system?.boss;
  if (!boss) return false;
  if (isTruthy(boss.is)) return true;
  return Number(boss.turns ?? 1) > 1 || Number(boss.bars ?? 1) > 1;
}

function isWeakenedImmune(actor) {
  return isBossActor(actor) && Number(actor.getFlag(MODULE_ID, FLAGS.weakenedImmuneUntil) ?? -1) >= (game.combat?.round ?? 0);
}

function isTruthy(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function hasHeavyShifted(actor) {
  return Number(actor.getFlag(MODULE_ID, FLAGS.heavyShiftRound) ?? -1) === (game.combat?.round ?? 0);
}

function getTemporaryInjuries(actor) {
  return clampTemporaryInjuries(actor?.getFlag?.(MODULE_ID, FLAGS.temporaryInjuries) ?? actor?.system?.health?.temporaryInjuries ?? 0);
}

async function setTemporaryInjuries(actor, value) {
  if (!actor) return null;
  const clamped = clampTemporaryInjuries(value);
  try {
    return await actor.update({
      [`flags.${MODULE_ID}.${FLAGS.temporaryInjuries}`]: clamped,
      "system.health.temporaryInjuries": clamped
    });
  } catch (error) {
    warnThrottled("temporary-injury-system-update", error);
    return actor.setFlag(MODULE_ID, FLAGS.temporaryInjuries, clamped);
  }
}

function clampTemporaryInjuries(value) {
  const number = Math.trunc(Number(value ?? 0));
  return Math.clamp(Number.isFinite(number) ? number : 0, 0, MAX_TEMPORARY_INJURIES);
}

function getTickAmount(actor) {
  const maxHP = Number(actor?.system?.health?.max ?? 0);
  const tick = Number(actor?.system?.health?.tick ?? 0);
  return Math.max(1, tick || Math.floor(maxHP / 10));
}

function hasCondition(actor, slug) {
  const wanted = sluggify(slug);
  return Boolean(actor?.conditions?.bySlug?.(wanted, { active: true })?.length);
}

function hasType(actor, type) {
  const wanted = String(type).toLowerCase();
  return (actor?.types ?? actor?.system?.typing ?? []).map((entry) => String(entry).toLowerCase()).includes(wanted);
}

function hasCapability(actor, key) {
  const wanted = String(key).toLowerCase();
  const capabilities = actor?.system?.capabilities ?? {};
  for (const [name, value] of Object.entries(capabilities)) {
    if (String(name).toLowerCase() === wanted && Number(value) > 0) return true;
  }
  return false;
}

function getWeatherState() {
  const state = canvas?.scene?.getFlag?.("ptr1e-weather-atmosphere", "state");
  const family = state?.weather?.family ?? state?.weatherSecondary?.family ?? "";
  if (String(family).toLowerCase().includes("sun")) return "sun";
  if (String(family).toLowerCase().includes("snow")) return "snow";
  if (String(family).toLowerCase().includes("hail")) return "hail";
  return "";
}

function recipients(actor) {
  return game.users.filter((user) => user.isGM || actor?.testUserPermission?.(user, "OWNER")).map((user) => user.id);
}

async function post(key, data, actor) {
  try {
    if (!game.settings.get(MODULE_ID, "chat")) return null;
    const content = game.i18n.format(key, data);
    return await ChatMessage.create({
      content: `<p>${content}</p>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: recipients(actor)
    });
  } catch (error) {
    warnThrottled(`post:${key}`, error);
    return null;
  }
}

function isEnabled() {
  return game.settings.get(MODULE_ID, "enabled");
}

function notifyMovementBlocked(actor, key) {
  const throttleKey = `${actor.uuid}:${key}`;
  const now = Date.now();
  if (now - Number(movementMessages.get(throttleKey) ?? 0) < MOVEMENT_MESSAGE_COOLDOWN_MS) return;
  movementMessages.set(throttleKey, now);

  ui.notifications.warn(game.i18n.format(key, { actor: actor.name }));
  post(key, { actor: actor.link }, actor);
}

function normalizeRollOptions(rollOptions) {
  if (!rollOptions) return [];
  if (Array.isArray(rollOptions)) return rollOptions;
  if (rollOptions instanceof Set) return Array.from(rollOptions);
  if (typeof rollOptions[Symbol.iterator] === "function") return Array.from(rollOptions);
  return [];
}

function warnThrottled(scope, error) {
  const now = Date.now();
  if (now - Number(throttledErrors.get(scope) ?? 0) < ERROR_COOLDOWN_MS) return;
  throttledErrors.set(scope, now);
  console.warn(`${MODULE_ID} | ${scope}`, error);
}

function conditionLabel(slug) {
  return CONDITION_DEFINITIONS[slug]?.name ?? titleCase(slug);
}

function titleCase(value) {
  return String(value ?? "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sluggify(value) {
  return CONFIG.PTU?.util?.sluggify?.(value) ?? String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
