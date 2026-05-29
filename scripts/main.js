const MODULE_ID = "ptr1e-status-afflictions";
const FLAGS = {
  assignedCombatant: "assignedCombatant",
  processedRound: "processedRound",
  heavyShiftRound: "heavyShiftRound",
  weakenedImmuneUntil: "weakenedImmuneUntil",
  patched: "patched"
};

const DOT_SLUGS = new Set(["burned", "poisoned", "badly-poisoned", "bleeding", "seeded", "cursed"]);
const SAVE_SLUGS = new Set(["sleep", "frozen", "drowsy", "chilled", "confused", "infatuation", "rage"]);
const ACTION_GATE_SLUGS = new Set(["paralysis", "confused", "infatuation", "provoked", "suppressed", "flinch", "disabled", "drowsy", "chilled"]);
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
    img: "systems/ptu/static/images/conditions/Badly Poisoned.png",
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
    effect: "<p>Special Mark/Coat condition. Its drain or loss is defined by the source. Boss drain/loss is limited to once per round.</p>"
  },
  cursed: {
    name: "Cursed",
    img: "systems/ptu/static/images/conditions/Cursed.svg",
    effect: "<p>Persistent loss is limited to once per round against Boss Templates.</p>"
  },
  bleeding: {
    name: "Bleeding",
    img: "icons/svg/blood.svg",
    effect: "<p>Lose 1 Tick at end turn, or 2 Ticks after a heavy shift. Healing received is halved manually by the table.</p>"
  },
  weakened: {
    name: "Weakened",
    img: "icons/svg/downgrade.svg",
    duration: { value: 1, unit: "rounds", expiry: "turn-start" },
    effect: "<p>Damaging attacks are resisted one step more; attacks against this target are resisted one step less.</p>"
  },
  provoked: {
    name: "Provoked",
    img: "icons/svg/target.svg",
    duration: { value: 1, unit: "rounds", expiry: "turn-start" },
    effect: "<p>Attacks that do not include the provoking combatant suffer -6 Accuracy, and non-crush accuracy modifiers cannot exceed 0.</p>"
  },
  drowsy: {
    name: "Drowsy",
    img: "systems/ptu/static/images/conditions/Sleep.svg",
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
    effect: "<p>Boss Sleep replacement. Actions are retained, evasion is halved, and a failed save gives -10 to the next damage roll.</p>"
  },
  chilled: {
    name: "Chilled",
    img: "systems/ptu/static/images/conditions/Frozen.svg",
    persistent: { type: "save", dc: 16, decrease: false, formula: "" },
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
}

function registerStatusEffects() {
  const statusEffects = CONFIG.PTU?.statusEffects ?? CONFIG.statusEffects;
  if (!Array.isArray(statusEffects)) return;

  for (const [id, data] of Object.entries(CONDITION_DEFINITIONS)) {
    if (statusEffects.some((effect) => effect.id === id)) continue;
    statusEffects.push({
      id,
      name: data.name,
      img: data.img,
      changes: [{ key: `flags.ptu.is_${id.replaceAll("-", "_")}`, value: true, mode: 5, priority: 50 }]
    });
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
  patchActorPrepareDerivedData();
  patchConditionTurnEnd();
  patchParalysisHandler();
}

function patchActorCreateEmbedded() {
  const ActorClass = CONFIG.PTU.Actor.documentClass;
  const original = ActorClass.prototype.createEmbeddedDocuments;

  ActorClass.prototype.createEmbeddedDocuments = async function patchedCreateEmbeddedDocuments(embeddedName, data = [], context = {}) {
    if (!isEnabled() || embeddedName !== "Item" || !Array.isArray(data)) {
      return original.call(this, embeddedName, data, context);
    }

    const transformed = [];
    const helperCreates = [];
    for (const datum of data) {
      if (datum?.type !== "condition") {
        transformed.push(datum);
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
      for (const helperSlug of normalized.helpers) {
        if (!hasCondition(this, helperSlug)) helperCreates.push(createConditionData(helperSlug));
      }
    }

    const created = transformed.length ? await original.call(this, embeddedName, transformed, context) : [];
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
  });
  return { data, helpers, blocked: false };
}

function mergeConditionDefaults(data, slug) {
  const definition = CONDITION_DEFINITIONS[slug];
  if (!definition) {
    data.system ??= {};
    data.system.slug ??= slug;
    return data;
  }

  return foundry.utils.mergeObject(createConditionData(slug), data, { inplace: false, overwrite: true });
}

function blocked(label, reason) {
  return { blocked: true, label, reason, helpers: [] };
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

function patchActorPrepareDerivedData() {
  const ActorClass = CONFIG.PTU.Actor.documentClass;
  const original = ActorClass.prototype.prepareDerivedData;

  ActorClass.prototype.prepareDerivedData = function patchedPrepareDerivedData(...args) {
    const result = original.apply(this, args);
    if (!isEnabled()) return result;

    if (isBossActor(this) && (hasCondition(this, "drowsy") || hasCondition(this, "chilled"))) {
      for (const key of ["physical", "special", "speed"]) {
        const current = Number(this.system.evasion?.[key] ?? 0);
        foundry.utils.setProperty(this, `system.evasion.${key}`, Math.floor(current / 2));
      }
    }
    return result;
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

async function handleManagedConditionTurnEnd(condition, options = {}) {
  const actor = condition.actor;
  const combatant = game.combat?.combatant;
  if (isBossActor(actor) && condition.getFlag(MODULE_ID, FLAGS.processedRound) === game.combat?.round) return;

  if (DOT_SLUGS.has(condition.slug)) await applyDot(condition);
  if (SAVE_SLUGS.has(condition.slug)) await rollConditionSave(condition, options);

  if (isBossActor(actor)) await condition.setFlag(MODULE_ID, FLAGS.processedRound, game.combat?.round ?? 0);
}

async function applyDot(condition) {
  const actor = condition.actor;
  if (condition.slug === "seeded" && !condition.system?.persistent?.formula) return;

  const amount = dotAmount(condition);
  if (amount <= 0) return;
  await applyFlatHpLoss(actor, amount, condition.name);

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
    return;
  }

  if (condition.slug === "drowsy" || condition.slug === "chilled") {
    await applyBossDamagePenalty(actor, condition.name);
  }
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
  if (newHp === oldHp) return;
  await actor.update({ "system.health.value": newHp });
  await post("PTR_STATUS.Chat.Damage", { actor: actor.link, amount: oldHp - newHp, label }, actor);
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
  return foundry.utils.mergeObject(data, overrides, { inplace: false, overwrite: true });
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
  return foundry.utils.mergeObject(data, overrides, { inplace: false, overwrite: true });
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
  return Boolean(actor?.system?.boss?.is);
}

function isWeakenedImmune(actor) {
  return isBossActor(actor) && Number(actor.getFlag(MODULE_ID, FLAGS.weakenedImmuneUntil) ?? -1) >= (game.combat?.round ?? 0);
}

function hasHeavyShifted(actor) {
  return Number(actor.getFlag(MODULE_ID, FLAGS.heavyShiftRound) ?? -1) === (game.combat?.round ?? 0);
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
  if (!game.settings.get(MODULE_ID, "chat")) return;
  const content = game.i18n.format(key, data);
  return ChatMessage.create({
    content: `<p>${content}</p>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: recipients(actor)
  });
}

function isEnabled() {
  return game.settings.get(MODULE_ID, "enabled");
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
