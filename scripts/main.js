const MODULE_ID = "ptr1e-status-afflictions";
const FLAGS = {
  assignedCombatant: "assignedCombatant",
  processedRound: "processedRound",
  heavyShiftRound: "heavyShiftRound",
  weakenedImmuneUntil: "weakenedImmuneUntil",
  temporaryInjuries: "temporaryInjuries",
  nonlethalHits: "nonlethalHits",
  stageCounter: "stageCounter",
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
const SHEET_TEMPLATES = {
  character: `modules/${MODULE_ID}/templates/actor/trainer-sheet-compact.hbs`,
  pokemon: `modules/${MODULE_ID}/templates/actor/pokemon-sheet-compact.hbs`
};
const STAGE_COUNTER_RULE_KEY = "StageCounter";
const STRIKE_KINDS = {
  double: { label: "Double Strike", maxRolls: 2, mode: "double" },
  five: { label: "Five Strike", maxRolls: 5, mode: "add", maxBonus: 8 },
  ten: { label: "Ten Strike", maxRolls: 10, mode: "add", maxBonus: 16 }
};
const FAINTED_CONDITION = {
  id: "fainted",
  name: "PTU.ConditionFainted",
  img: "systems/ptu/static/images/conditions/Fainted.svg"
};
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
  installActorSheetSupport();
});

Hooks.once("setup", () => {
  if (game.system.id !== "ptu") return;
  registerStageCounterRuleElement();
  registerStageCounterRuleForm();
  installActorSheetSupport();
});

Hooks.once("ready", () => {
  if (game.system.id !== "ptu") return;
  registerStageCounterRuleElement();
  registerStageCounterRuleForm();
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

function registerStageCounterRuleElement() {
  const RuleElements = CONFIG.PTU?.rule?.elements;
  if (!RuleElements?.custom || RuleElements.custom[STAGE_COUNTER_RULE_KEY]) return;

  const BaseRuleElement = Object.getPrototypeOf(RuleElements.builtin?.RollOption);
  if (!BaseRuleElement?.defineSchema) return;

  class StageCounterRuleElement extends BaseRuleElement {
    constructor(source, item, options) {
      super({ priority: 1, ...source }, item, options);
    }

    static defineSchema() {
      const { fields } = foundry.data;
      return {
        ...super.defineSchema(),
        name: new fields.StringField({ required: false, nullable: false, blank: false, initial: "Stage" }),
        min: new fields.NumberField({ required: false, nullable: false, integer: true, initial: 0 }),
        max: new fields.NumberField({ required: false, nullable: false, integer: true, initial: 6 }),
        value: new fields.NumberField({ required: false, nullable: false, integer: true, initial: 0 }),
        rollOption: new fields.BooleanField({ required: false, nullable: false, initial: true })
      };
    }

    preCreate({ itemSource, ruleSource }) {
      if (itemSource?.type !== "effect") return;
      applyStageCounterToSource(itemSource, ruleSource ?? this.data, { preserveValue: false });
    }

    beforePrepareData() {
      if (this.item?.type !== "effect" || !this.test()) return;
      const stage = applyStageCounterRuntime(this.item, this.data);
      publishStageCounterRollOptions(this.actor, this.item, stage);
    }
  }

  RuleElements.custom[STAGE_COUNTER_RULE_KEY] = StageCounterRuleElement;
}

async function registerStageCounterRuleForm() {
  try {
    const forms = await import("/systems/ptu/src/module/item/sheet/rule-elements/index.js");
    if (!forms?.RULE_ELEMENT_FORMS || forms.RULE_ELEMENT_FORMS[STAGE_COUNTER_RULE_KEY]) return;

    class StageCounterForm extends forms.RuleElementForm {
      get template() {
        return `modules/${MODULE_ID}/templates/item/rules/stage-counter.hbs`;
      }

      _updateObject(rule) {
        const config = normalizeStageCounterConfig(rule);
        rule.name = config.name;
        rule.min = config.min;
        rule.max = config.max;
        rule.value = config.value;
        rule.rollOption = rule.rollOption !== false;
      }
    }

    forms.RULE_ELEMENT_FORMS[STAGE_COUNTER_RULE_KEY] = StageCounterForm;
  } catch (error) {
    warnThrottled("stage-counter-form", error);
  }
}

function patchPTR() {
  ensureModuleConfig();
  if (CONFIG.PTU?.[MODULE_ID]?.[FLAGS.patched]) return;
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
  patchMoveStrikeKeyword();
  installActorSheetSupport();
  registerMovementHooks();
  registerLinkedConditionCleanup();
  registerActorSheetHooks();
  registerTemporaryInjuryHooks();
  registerTemporaryInjuryObserver();
  registerTemporaryInjuryInputListener();
  registerStageCounterInputListener();
  refreshTemporaryInjuryDataForActors();
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
        applyStageCounterData(this);
        patchStrikeAttackActions(this);
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
      if (isNonlethalDamage(params.item, optionSet)) return applyNonlethalDamage(this, params);
    }
    return original.call(this, params);
  };
}

async function applyNonlethalDamage(contextActor, params = {}) {
  const targetActor = params.token?.actor ?? contextActor;
  const amount = calculateNonlethalDamage(contextActor, params);
  const label = params.item?.name ?? game.i18n.localize("PTR_STATUS.NonlethalHits.Label");

  if (amount <= 0) {
    await post("PTR_STATUS.Chat.NonlethalNoDamage", { actor: targetActor.link ?? targetActor.name, label }, targetActor);
    return contextActor;
  }

  const total = getNonlethalHits(targetActor) + amount;
  await setNonlethalHits(targetActor, total);
  await post("PTR_STATUS.Chat.NonlethalDamage", {
    actor: targetActor.link ?? targetActor.name,
    amount,
    total: clampNonlethalHits(total),
    label
  }, targetActor);

  const currentHP = getCurrentHealth(targetActor);
  if (clampNonlethalHits(total) > currentHP) {
    const created = await ensureFaintedCondition(targetActor);
    if (created) {
      await post("PTR_STATUS.Chat.NonlethalFainted", {
        actor: targetActor.link ?? targetActor.name,
        total: clampNonlethalHits(total),
        hp: currentHP
      }, targetActor);
    }
  }

  return contextActor;
}

function calculateNonlethalDamage(actor, params = {}) {
  const health = actor?.system?.health;
  if (!health) return 0;

  const item = params.item;
  const damage = params.damage;
  const rollOptions = normalizeRollOptions(params.rollOptions);
  let effectiveness = params.effectiveness;
  const flatDamage = effectiveness === -1;
  if (flatDamage) effectiveness = 1;

  const currentDamage = Number(typeof damage === "number" ? damage : damage?.total);
  if (!Number.isFinite(currentDamage) || currentDamage <= 0) return 0;

  const defense = (() => {
    if (flatDamage) return 0;
    const overwrite = rollOptions.find((option) => String(option).startsWith("item:overwrite:defense"));
    if (overwrite) {
      const stat = String(overwrite).replace(/(item:overwrite:defense:)/, "");
      return Number(actor.system?.stats?.[stat]?.total ?? 0);
    }
    if (item?.system?.category === "Physical") return Number(actor.system?.stats?.def?.total ?? 0);
    if (item?.system?.category === "Special") return Number(actor.system?.stats?.spdef?.total ?? 0);
    return 0;
  })();
  const damageAbsorbedByDefense = Math.min(currentDamage, Math.max(0, defense));

  const damageReduction = (() => {
    if (flatDamage) return 0;
    if (item?.system?.category === "Physical") return Number(actor.system?.modifiers?.damageReduction?.physical?.total ?? 0);
    if (item?.system?.category === "Special") return Number(actor.system?.modifiers?.damageReduction?.special?.total ?? 0);
    return 0;
  })();
  const damageAbsorbedByReduction = Math.min(currentDamage - damageAbsorbedByDefense, Math.max(0, damageReduction));
  const reducedDamage = currentDamage - damageAbsorbedByDefense - damageAbsorbedByReduction;

  const finalDamage = (() => {
    if (typeof damage === "number") {
      if (params.skipIWR || flatDamage) return currentDamage;
      return Math.max(reducedDamage, 1);
    }
    if (params.skipIWR || flatDamage || !(actor.applyIWR instanceof Function)) return currentDamage;
    return Number(actor.applyIWR({
      actor,
      damage: { ...damage, reduced: reducedDamage },
      item,
      effectiveness,
      rollOptions
    })?.finalDamage ?? 0);
  })();

  return Math.max(0, Math.trunc(finalDamage <= 0 ? 0 : Math.max(1, finalDamage)));
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

function ensureModuleConfig() {
  CONFIG.PTU ??= {};
  CONFIG.PTU[MODULE_ID] ??= {};
  return CONFIG.PTU[MODULE_ID];
}

function installActorSheetSupport() {
  ensureModuleConfig();
  if (!CONFIG.PTU?.Actor?.sheetClasses) return false;
  registerModuleActorSheets();
  patchActorSheets();
  patchTemplateRendering();
  return true;
}

function registerModuleActorSheets() {
  ensureModuleConfig();
  if (!CONFIG.PTU?.Actor?.sheetClasses) return false;
  const registry = foundry.documents?.collections?.Actors;
  const CharacterBase = CONFIG.PTU.Actor.sheetClasses?.character;
  const PokemonBase = CONFIG.PTU.Actor.sheetClasses?.pokemon;
  if (!registry || CONFIG.PTU[MODULE_ID].sheetsRegistered) {
    patchActorSheetTemplate(CharacterBase, SHEET_TEMPLATES.character);
    patchActorSheetTemplate(PokemonBase, SHEET_TEMPLATES.pokemon);
    return false;
  }

  CONFIG.PTU[MODULE_ID].originalSheetClasses = {
    character: CharacterBase,
    pokemon: PokemonBase
  };

  patchActorSheetTemplate(CharacterBase, SHEET_TEMPLATES.character);
  patchActorSheetTemplate(PokemonBase, SHEET_TEMPLATES.pokemon);

  if (CharacterBase) {
    class PTRStatusCharacterSheet extends CharacterBase {
      static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
          template: SHEET_TEMPLATES.character
        }, { inplace: false, overwrite: true });
      }
    }

    registry.registerSheet(MODULE_ID, PTRStatusCharacterSheet, {
      types: ["character"],
      makeDefault: true,
      label: "PTR_STATUS.Sheet.Character"
    });
    CONFIG.PTU.Actor.sheetClasses.character = PTRStatusCharacterSheet;
  }

  if (PokemonBase) {
    class PTRStatusPokemonSheet extends PokemonBase {
      static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
          template: SHEET_TEMPLATES.pokemon
        }, { inplace: false, overwrite: true });
      }
    }

    registry.registerSheet(MODULE_ID, PTRStatusPokemonSheet, {
      types: ["pokemon"],
      makeDefault: true,
      label: "PTR_STATUS.Sheet.Pokemon"
    });
    CONFIG.PTU.Actor.sheetClasses.pokemon = PTRStatusPokemonSheet;
  }

  CONFIG.PTU[MODULE_ID].sheetsRegistered = true;
  console.log(`${MODULE_ID} | Registered PTR Status actor sheets.`);
  return true;
}

function patchActorSheetTemplate(SheetClass, template) {
  if (!SheetClass || !template || SheetClass[`${MODULE_ID}TemplatePatched`]) return;
  const descriptor = Object.getOwnPropertyDescriptor(SheetClass, "defaultOptions");
  const original = descriptor?.get;
  if (!(original instanceof Function)) return;

  Object.defineProperty(SheetClass, "defaultOptions", {
    configurable: true,
    get() {
      return foundry.utils.mergeObject(original.call(this), { template }, { inplace: false, overwrite: true });
    }
  });
  SheetClass[`${MODULE_ID}TemplatePatched`] = true;
}

function getActorSheetClasses() {
  const originals = CONFIG.PTU?.[MODULE_ID]?.originalSheetClasses ?? {};
  return new Set([
    CONFIG.PTU?.Actor?.sheetClasses?.character,
    CONFIG.PTU?.Actor?.sheetClasses?.pokemon,
    originals.character,
    originals.pokemon,
    CONFIG.PTU?.Actor?.sheetClass
  ].filter(Boolean));
}

function patchActorSheets() {
  const classes = getActorSheetClasses();

  for (const SheetClass of classes) {
    const originalGetData = SheetClass.prototype.getData;
    if (originalGetData instanceof Function && !originalGetData[`${MODULE_ID}TemporaryData`]) {
      const patchedGetData = async function patchedGetData(...args) {
        const data = await originalGetData.apply(this, args);
        if (isEnabled() && this.actor) {
          applyTemporaryInjuryData(this.actor);
          syncTemporaryInjurySheetData(data, this.actor);
        }
        return data;
      };
      patchedGetData[`${MODULE_ID}TemporaryData`] = true;
      SheetClass.prototype.getData = patchedGetData;
    }

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

function syncTemporaryInjurySheetData(data, actor) {
  const health = actor?.system?.health;
  if (!health) return;

  for (const candidate of [data?.actor, data?.document, data?.object]) {
    if (!candidate?.system?.health) continue;
    candidate.system.health.temporaryInjuries = health.temporaryInjuries;
    candidate.system.health.effectiveInjuries = health.effectiveInjuries;
    candidate.system.health.nonlethalHits = health.nonlethalHits;
  }

  if (data?.data?.health) {
    data.data.health.temporaryInjuries = health.temporaryInjuries;
    data.data.health.effectiveInjuries = health.effectiveInjuries;
    data.data.health.nonlethalHits = health.nonlethalHits;
  }
}

function patchMoveStrikeKeyword() {
  const MoveClass = CONFIG.PTU?.Item?.documentClasses?.move;
  if (!MoveClass?.prototype || MoveClass[`${MODULE_ID}StrikePatched`]) return;

  const descriptor = Object.getOwnPropertyDescriptor(MoveClass.prototype, "isFiveStrike");
  const original = descriptor?.get;
  if (!(original instanceof Function)) return;

  Object.defineProperty(MoveClass.prototype, "isFiveStrike", {
    configurable: true,
    get() {
      if (isEnabled() && getStrikeKind(this)) return false;
      return original.call(this);
    }
  });
  MoveClass[`${MODULE_ID}StrikePatched`] = true;
}

function patchStrikeAttackActions(actor) {
  const attacks = actor?.system?.attacks;
  const values = attacks?.values instanceof Function ? Array.from(attacks.values()) : Array.from(attacks ?? []);
  for (const action of values) {
    const item = action?.item;
    if (!item || !getStrikeKind(item)) continue;

    if (action.roll instanceof Function && !action.roll[`${MODULE_ID}StrikeRoll`]) {
      const original = action.roll;
      const patched = async function patchedStrikeRoll(params = {}) {
        const originalCallback = params.callback;
        const wrappedParams = {
          ...params,
          callback: async (rolls, targets, message, event) => {
            await annotateStrikeAttackMessage(actor, action, rolls, targets, message);
            if (originalCallback instanceof Function) return originalCallback(rolls, message?.targets ?? targets, message, event);
            return null;
          }
        };
        return original.call(this, wrappedParams);
      };
      patched[`${MODULE_ID}StrikeRoll`] = true;
      action.roll = patched;
    }

    if (action.damage instanceof Function && !action.damage[`${MODULE_ID}StrikeDamage`]) {
      const original = action.damage;
      const patched = async function patchedStrikeDamage(params = {}) {
        const adjustment = parseStrikeDamageAdjustment(params.options);
        if (!adjustment) return original.call(this, params);

        const move = action.item;
        return withAdjustedStrikeDamageBase(move, adjustment, () => original.call(this, params));
      };
      patched[`${MODULE_ID}StrikeDamage`] = true;
      action.damage = patched;
    }
  }
}

async function withAdjustedStrikeDamageBase(move, adjustment, callback) {
  if (!move || !(callback instanceof Function)) return callback?.();

  const originalDamageBase = move.damageBase;
  const adjustedPreStab = getAdjustedStrikeDamageBase(originalDamageBase?.preStab ?? move.system?.damageBase, adjustment);
  if (adjustedPreStab === null) return callback();

  const stabBonus = Math.max(0, Number(originalDamageBase?.postStab ?? adjustedPreStab) - Number(originalDamageBase?.preStab ?? adjustedPreStab));
  const adjustedDamageBase = {
    preStab: adjustedPreStab,
    postStab: adjustedPreStab + stabBonus,
    isStab: stabBonus > 0
  };

  const hadOwnDescriptor = Object.prototype.hasOwnProperty.call(move, "damageBase");
  const ownDescriptor = Object.getOwnPropertyDescriptor(move, "damageBase");
  Object.defineProperty(move, "damageBase", {
    configurable: true,
    get: () => adjustedDamageBase
  });

  try {
    return await callback();
  } finally {
    if (hadOwnDescriptor && ownDescriptor) Object.defineProperty(move, "damageBase", ownDescriptor);
    else delete move.damageBase;
  }
}

async function annotateStrikeAttackMessage(actor, action, rolls, targets, message) {
  try {
    if (!isEnabled() || !(message instanceof ChatMessage)) return;
    const item = action?.item;
    const kind = getStrikeKind(item);
    if (!kind) return;

    const context = message.flags?.ptu?.context;
    const firstRoll = rolls?.[0] ?? message.rolls?.[0];
    if (!context || !firstRoll) return;

    const strike = await resolveStrikeResults(kind, firstRoll, context.targets ?? targets ?? [], context.outcomes ?? {});
    if (!strike?.targets?.length) return;

    const options = mergeStrikeOptions(context.options ?? [], strike);
    const updatedTargets = mergeStrikeTargets(context.targets ?? [], strike);
    const outcomes = mergeStrikeOutcomes(context.outcomes ?? {}, strike);
    const firstHitForEffects = strike.targets.some((target) => target.firstHit);
    const rollResult = firstHitForEffects ? context.rollResult : 0;
    const content = appendStrikeSummary(message.content, strike);

    await message.update({
      "flags.ptu.context.options": options,
      "flags.ptu.context.targets": updatedTargets,
      "flags.ptu.context.outcomes": outcomes,
      "flags.ptu.context.rollResult": rollResult,
      "flags.ptu.context.ptrStatusStrike": strike,
      content
    });
  } catch (error) {
    warnThrottled("strike-attack", error);
  }
}

async function resolveStrikeResults(kind, firstRoll, targets, outcomes) {
  const config = STRIKE_KINDS[kind];
  if (!config) return null;

  const modifier = Number(firstRoll.options?.modifierValue ?? firstRoll.options?.totalModifiers ?? 0);
  const firstNatural = Number(firstRoll.options?.rollResult ?? getD20Result(firstRoll) ?? 0);
  const targetResults = [];

  for (const target of targets ?? []) {
    const actorUuid = target.actor;
    const actorId = actorUuidToId(actorUuid);
    const dc = Number(target.dc?.value ?? target.dc ?? 0);
    if (!actorUuid || !Number.isFinite(dc) || dc <= 0) continue;
    const targetName = await getStrikeTargetName(actorUuid, target.token);

    const firstOutcome = target.outcome ?? outcomes[actorUuid] ?? outcomes[actorId] ?? "miss";
    const firstHit = isHitOutcome(firstOutcome);
    const rolls = [{
      index: 1,
      natural: firstNatural,
      total: Number(firstRoll.total ?? firstNatural + modifier),
      dc,
      hit: firstHit,
      outcome: firstOutcome,
      first: true
    }];

    if (config.mode === "double") {
      const second = await rollStrikeAccuracy(modifier, dc, 2);
      rolls.push(second);
    } else if (firstHit) {
      for (let index = 2; index <= config.maxRolls; index++) {
        const result = await rollStrikeAccuracy(modifier, dc, index);
        rolls.push(result);
        if (!result.hit) break;
      }
    }

    const hitCount = rolls.filter((roll) => roll.hit).length;
    const missCount = rolls.length - hitCount;
    const outcome = getStrikeOutcome(firstOutcome, hitCount);
    const damage = config.mode === "double"
      ? { multiplier: hitCount >= 2 ? 2 : 1, bonus: 0 }
      : { multiplier: 1, bonus: Math.min(Math.max(hitCount - 1, 0) * 2, config.maxBonus) };

    targetResults.push({
      actor: actorUuid,
      actorId,
      name: targetName,
      token: target.token,
      dc,
      firstHit,
      outcome,
      hitCount,
      missCount,
      damage,
      rolls
    });
  }

  const damage = targetResults.reduce((best, target) => {
    if (target.damage.multiplier > best.multiplier) return target.damage;
    if (target.damage.multiplier === best.multiplier && target.damage.bonus > best.bonus) return target.damage;
    return best;
  }, { multiplier: 1, bonus: 0 });

  return {
    kind,
    label: config.label,
    damage,
    targets: targetResults
  };
}

async function rollStrikeAccuracy(modifier, dc, index) {
  const roll = await new Roll("1d20").evaluate();
  const natural = Number(roll.total ?? 0);
  const total = natural + modifier;
  const hit = natural !== 1 && (natural === 20 || total >= dc);
  return { index, natural, total, dc, hit, outcome: hit ? "hit" : "miss", first: false };
}

function getStrikeOutcome(firstOutcome, hitCount) {
  if (hitCount <= 0) return firstOutcome === "crit-miss" ? "crit-miss" : "miss";
  if (firstOutcome === "crit-hit" || firstOutcome === "blocked-crit") return firstOutcome;
  return "hit";
}

function mergeStrikeTargets(targets, strike) {
  const byActor = new Map(strike.targets.map((target) => [target.actor, target]));
  return (targets ?? []).map((target) => {
    const strikeTarget = byActor.get(target.actor);
    return strikeTarget ? { ...target, outcome: strikeTarget.outcome } : target;
  });
}

function mergeStrikeOutcomes(outcomes, strike) {
  const merged = { ...(outcomes ?? {}) };
  for (const target of strike.targets) {
    merged[target.actor] = target.outcome;
    if (target.actorId) merged[target.actorId] = target.outcome;
  }
  return merged;
}

function mergeStrikeOptions(options, strike) {
  const clean = normalizeRollOptions(options).filter((option) => !String(option).startsWith("ptr-status:strike:"));
  clean.push(
    `ptr-status:strike:kind:${strike.kind}`,
    `ptr-status:strike:damage-base-bonus:${strike.damage.bonus}`,
    `ptr-status:strike:damage-base-multiplier:${strike.damage.multiplier}`
  );
  return Array.from(new Set(clean)).sort();
}

function parseStrikeDamageAdjustment(options) {
  const normalized = normalizeRollOptions(options);
  const kind = getOptionSuffix(normalized, "ptr-status:strike:kind:");
  if (!kind) return null;
  const bonus = Number(getOptionSuffix(normalized, "ptr-status:strike:damage-base-bonus:") ?? 0);
  const multiplier = Number(getOptionSuffix(normalized, "ptr-status:strike:damage-base-multiplier:") ?? 1);
  return {
    kind,
    bonus: Number.isFinite(bonus) ? bonus : 0,
    multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  };
}

function getAdjustedStrikeDamageBase(value, adjustment) {
  const base = Number(value);
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.max(1, Math.trunc((base * adjustment.multiplier) + adjustment.bonus));
}

function getOptionSuffix(options, prefix) {
  const option = options.find((entry) => String(entry).startsWith(prefix));
  return option ? String(option).slice(prefix.length) : null;
}

function appendStrikeSummary(content, strike) {
  if (String(content ?? "").includes("ptr-status-strike-summary")) return content;
  return `${content ?? ""}${buildStrikeSummaryHtml(strike)}`;
}

function buildStrikeSummaryHtml(strike) {
  const damageText = strike.damage.multiplier > 1
    ? `DB x${strike.damage.multiplier}`
    : strike.damage.bonus > 0
      ? `DB +${strike.damage.bonus}`
      : "DB normal";
  const rows = strike.targets.map((target) => buildStrikeTargetSummaryHtml(target)).join("");
  const details = strike.targets.map((target) => buildStrikeTargetDetailsHtml(target)).join("");

  return `<details class="ptr-status-strike-summary" style="margin-top:6px;padding:5px 7px;border:1px solid #999;border-radius:4px;background:#f7f3e8;">
    <summary style="cursor:pointer;list-style:none;">
      <div style="display:flex;justify-content:space-between;gap:8px;"><strong>${escapeHtml(strike.label)}</strong><span>${escapeHtml(damageText)}</span></div>
      ${rows}
    </summary>
    <div style="margin-top:5px;padding-top:5px;border-top:1px solid #c8c0ad;">
      ${details}
    </div>
  </details>`;
}

function buildStrikeTargetSummaryHtml(target) {
  const actor = game.actors?.get(target.actorId);
  const name = escapeHtml(target.name ?? actor?.name ?? target.actorId ?? target.actor);
  const icons = target.rolls.map((roll) => {
    const color = roll.hit ? "#15803d" : "#b91c1c";
    const symbol = roll.hit ? "&#10003;" : "&#10007;";
    const title = `Roll ${roll.index}: ${roll.total} vs ${roll.dc}${roll.first ? " (first accuracy)" : ""}`;
    return `<span title="${escapeHtml(title)}" style="display:inline-block;margin-right:3px;color:${color};font-weight:700;font-size:15px;">${symbol}</span>`;
  }).join("");
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px;">
    <span>${name}</span>
    <span>${icons}</span>
    <small>${target.hitCount} hit / ${target.missCount} miss</small>
  </div>`;
}

function buildStrikeTargetDetailsHtml(target) {
  const actor = game.actors?.get(target.actorId);
  const name = escapeHtml(target.name ?? actor?.name ?? target.actorId ?? target.actor);
  const rolls = target.rolls.map((roll) => {
    const symbol = roll.hit ? "&#10003;" : "&#10007;";
    const color = roll.hit ? "#15803d" : "#b91c1c";
    const suffix = roll.first ? " - first accuracy" : "";
    return `<li style="margin:1px 0;"><span style="color:${color};font-weight:700;">${symbol}</span> Roll ${roll.index}: ${roll.natural} natural / ${roll.total} total vs ${roll.dc}${suffix}</li>`;
  }).join("");
  return `<div style="margin:3px 0;">
    <strong>${name}</strong>
    <ul style="margin:2px 0 0 1rem;padding:0;">${rolls}</ul>
  </div>`;
}

async function getStrikeTargetName(actorUuid, tokenUuid) {
  const actor = await fromUuid(actorUuid).catch(() => null);
  if (actor?.name) return actor.name;
  const token = await fromUuid(tokenUuid).catch(() => null);
  return token?.actor?.name ?? token?.name ?? null;
}

function getD20Result(roll) {
  const die = roll?.dice?.find((term) => term instanceof foundry.dice.terms.Die && term.faces === 20);
  return die?.total ?? null;
}

function isHitOutcome(outcome) {
  return outcome === "hit" || outcome === "crit-hit" || outcome === "blocked-crit";
}

function actorUuidToId(uuid) {
  return /^Actor\.([A-Za-z0-9]+)$/.exec(String(uuid ?? ""))?.[1] ?? null;
}

function getStrikeKind(item) {
  const slugs = getMoveKeywordSlugs(item);
  const kinds = ["double", "ten", "five"].filter((kind) => slugs.has(`${kind}-strike`));
  if (!kinds.length) return null;
  if (kinds.length > 1) warnThrottled(`strike-conflict-${item?.uuid ?? item?.id ?? item?.name}`, new Error(`${item?.name ?? "Move"} has multiple Strike keywords; using ${STRIKE_KINDS[kinds[0]].label}.`));
  return kinds[0];
}

function getMoveKeywordSlugs(item) {
  const values = [
    ...(Array.isArray(item?.system?.keywords) ? item.system.keywords : []),
    ...String(item?.system?.range ?? "").split(",")
  ];
  return new Set(values.map(sluggify).filter(Boolean));
}

function isNonlethalDamage(item, optionSet = new Set()) {
  if (getMoveKeywordSlugs(item).has("nonlethal")) return true;
  for (const option of optionSet) {
    const text = String(option);
    if (text === "move:nonlethal" || text === "item:nonlethal" || text === "attack:nonlethal") return true;
    if (text === "move:range:nonlethal" || text === "item:range:nonlethal" || text === "attack:range:nonlethal") return true;
  }
  return false;
}

async function ensureFaintedCondition(actor) {
  if (!actor || hasCondition(actor, "fainted")) return false;
  try {
    const ConditionClass = CONFIG.PTU?.Item?.documentClasses?.condition;
    if (ConditionClass?.FromEffects instanceof Function) {
      const conditions = await ConditionClass.FromEffects([FAINTED_CONDITION]);
      if (conditions?.length) {
        await actor.createEmbeddedDocuments("Item", conditions);
        return true;
      }
    }
    await actor.createEmbeddedDocuments("Item", [createConditionData("fainted", {
      name: game.i18n.localize(FAINTED_CONDITION.name),
      img: FAINTED_CONDITION.img
    })]);
    return true;
  } catch (error) {
    warnThrottled("nonlethal-fainted", error);
    return false;
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
      scheduleStageCounterInjection(app, html);
      scheduleTemporaryInjuryScan();
    });
  }
}

function registerTemporaryInjuryHooks() {
  Hooks.on("preUpdateActor", (_actor, changed) => {
    const temporaryFlagPath = `flags.${MODULE_ID}.${FLAGS.temporaryInjuries}`;
    const temporarySystemPath = "system.health.temporaryInjuries";
    const temporaryFlagValue = foundry.utils.getProperty(changed, temporaryFlagPath);
    const temporarySystemValue = foundry.utils.getProperty(changed, temporarySystemPath);
    const temporaryValue = temporarySystemValue ?? temporaryFlagValue;
    if (temporaryValue !== undefined) {
      const clamped = clampTemporaryInjuries(temporaryValue);
      foundry.utils.setProperty(changed, temporaryFlagPath, clamped);
      foundry.utils.setProperty(changed, temporarySystemPath, clamped);
    }

    const nonlethalFlagPath = `flags.${MODULE_ID}.${FLAGS.nonlethalHits}`;
    const nonlethalSystemPath = "system.health.nonlethalHits";
    const nonlethalFlagValue = foundry.utils.getProperty(changed, nonlethalFlagPath);
    const nonlethalSystemValue = foundry.utils.getProperty(changed, nonlethalSystemPath);
    const nonlethalValue = nonlethalSystemValue ?? nonlethalFlagValue;
    if (nonlethalValue !== undefined) {
      const clamped = clampNonlethalHits(nonlethalValue);
      foundry.utils.setProperty(changed, nonlethalFlagPath, clamped);
      foundry.utils.setProperty(changed, nonlethalSystemPath, clamped);
    }
  });
}

function registerTemporaryInjuryInputListener() {
  document.addEventListener("change", async (event) => {
    const temporaryInput = event.target?.closest?.("[data-ptr-temporary-injuries]");
    const nonlethalInput = event.target?.closest?.("[data-ptr-nonlethal-hits]");
    const input = temporaryInput ?? nonlethalInput;
    if (!input) return;

    try {
      const root = input.closest(".app.sheet.actor, .window-app.sheet.actor, .ptu.sheet.actor");
      const actor = getSheetActor(getAppFromSheetRoot(root), root);
      if (!actor) return;
      if (temporaryInput) {
        const value = clampTemporaryInjuries(input.value);
        input.value = value;
        await setTemporaryInjuries(actor, value);
      } else {
        const value = clampNonlethalHits(input.value);
        input.value = value;
        await setNonlethalHits(actor, value);
      }
      scheduleTemporaryInjuryScan();
    } catch (error) {
      warnThrottled("temporary-injury-input", error);
    }
  }, true);
}

function registerStageCounterInputListener() {
  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-ptr-stage-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    try {
      const item = getStageCounterItemFromElement(button);
      if (!item) return;
      const stage = getStageCounterFlag(item) ?? applyStageCounterRuntime(item, getStageCounterRuleSource(item));
      const delta = button.dataset.ptrStageAction === "increase" ? 1 : -1;
      await setStageCounter(item, Number(stage.value ?? 0) + delta);
      scheduleTemporaryInjuryScan();
    } catch (error) {
      warnThrottled("stage-counter-click", error);
    }
  }, true);

  document.addEventListener("change", async (event) => {
    const input = event.target?.closest?.("[data-ptr-stage-input]");
    if (!input) return;
    event.preventDefault();
    event.stopPropagation();

    try {
      const item = getStageCounterItemFromElement(input);
      if (!item) return;
      const stage = getStageCounterFlag(item) ?? applyStageCounterRuntime(item, getStageCounterRuleSource(item));
      const value = clampStageCounter(input.value, stage.min, stage.max);
      input.value = value;
      await setStageCounter(item, value);
      scheduleTemporaryInjuryScan();
    } catch (error) {
      warnThrottled("stage-counter-input", error);
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

function refreshTemporaryInjuryDataForActors() {
  if (!isEnabled()) return;
  for (const actor of game.actors ?? []) {
    try {
      applyTemporaryInjuryData(actor);
      applyBossEvasionPenalty(actor);
      applyStageCounterData(actor);
    } catch (error) {
      warnThrottled(`temporary-injury-refresh-${actor?.id ?? "unknown"}`, error);
    }
  }
}

function applyStageCounterData(actor) {
  if (!actor?.items) return;
  for (const item of actor.items.filter((candidate) => candidate.type === "effect")) {
    const rule = getStageCounterRuleSource(item);
    if (!rule && !getStageCounterFlag(item)) continue;
    const stage = applyStageCounterRuntime(item, rule);
    publishStageCounterRollOptions(actor, item, stage);
  }
}

function getStageCounterRuleSource(item) {
  return (item?.system?.rules ?? []).find((rule) => rule?.key === STAGE_COUNTER_RULE_KEY) ?? null;
}

function applyStageCounterToSource(itemSource, ruleSource, { preserveValue = true } = {}) {
  const existing = foundry.utils.getProperty(itemSource, `flags.${MODULE_ID}.${FLAGS.stageCounter}`) ?? {};
  const baseName = existing.baseName ?? itemSource.name ?? "Effect";
  const stage = buildStageCounterData(ruleSource, existing, baseName, { preserveValue });
  foundry.utils.setProperty(itemSource, `flags.${MODULE_ID}.${FLAGS.stageCounter}`, stage);
  return stage;
}

function applyStageCounterRuntime(item, ruleSource = null) {
  const existing = getStageCounterFlag(item);
  const baseName = existing?.baseName ?? item?._source?.name ?? item?.name ?? "Effect";
  const stage = buildStageCounterData(ruleSource ?? existing, existing, baseName, { preserveValue: true });

  item.flags ??= {};
  item.flags[MODULE_ID] ??= {};
  item.flags[MODULE_ID][FLAGS.stageCounter] = stage;
  item.name = formatStageCounterName(stage);
  return stage;
}

function buildStageCounterData(ruleSource = {}, existing = {}, baseName = "Effect", { preserveValue = true } = {}) {
  const config = normalizeStageCounterConfig(ruleSource);
  const value = preserveValue
    ? clampStageCounter(existing?.value ?? config.value, config.min, config.max)
    : config.value;
  return {
    enabled: true,
    baseName: existing?.baseName ?? baseName,
    name: config.name,
    min: config.min,
    max: config.max,
    value,
    rollOption: config.rollOption
  };
}

function normalizeStageCounterConfig(source = {}) {
  const min = stageInteger(source?.min, 0);
  const max = Math.max(min, stageInteger(source?.max, 6));
  const value = clampStageCounter(stageInteger(source?.value, min), min, max);
  const name = String(source?.name ?? source?.stageName ?? "Stage").trim() || "Stage";
  return {
    name,
    min,
    max,
    value,
    rollOption: source?.rollOption !== false
  };
}

function publishStageCounterRollOptions(actor, item, stage) {
  if (!actor?.rollOptions?.all || !stage?.rollOption) return;
  const stageSlug = sluggify(stage.name) || "stage";
  const effectSlug = item?.rollOptionSlug ?? item?.slug ?? sluggify(stage.baseName);
  actor.rollOptions.all[`self:stage:${stageSlug}`] = true;
  actor.rollOptions.all[`self:stage:${stageSlug}:${stage.value}`] = stage.value;
  if (effectSlug) {
    actor.rollOptions.all[`self:effect:${effectSlug}:stage`] = true;
    actor.rollOptions.all[`self:effect:${effectSlug}:stage:${stage.value}`] = stage.value;
  }
}

function formatStageCounterName(stage) {
  return `${stage?.baseName ?? "Effect"} (${stageCounterSummary(stage)})`;
}

function stageCounterSummary(stage) {
  const value = clampStageCounter(stage?.value, stage?.min ?? 0, stage?.max ?? 0);
  const label = String(stage?.name ?? "").trim();
  return label ? `${value} ${label}` : String(value);
}

function getStageCounterFlag(item) {
  return item?.getFlag?.(MODULE_ID, FLAGS.stageCounter) ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.${FLAGS.stageCounter}`) ?? null;
}

async function setStageCounter(item, value) {
  if (!item) return null;
  const rule = getStageCounterRuleSource(item);
  const stage = buildStageCounterData(rule ?? getStageCounterFlag(item), getStageCounterFlag(item), item._source?.name ?? item.name, { preserveValue: true });
  stage.value = clampStageCounter(value, stage.min, stage.max);
  return item.setFlag(MODULE_ID, FLAGS.stageCounter, stage);
}

function applyTemporaryInjuryData(actor) {
  const system = actor?.system;
  const health = system?.health;
  if (!health) return;

  const temporary = getTemporaryInjuries(actor);
  const normal = Number(health.injuries ?? 0);
  const effective = Math.max(0, normal + temporary);
  const nonlethalHits = getNonlethalHits(actor);

  health.temporaryInjuries = temporary;
  health.effectiveInjuries = effective;
  health.nonlethalHits = nonlethalHits;

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
  actor.attributes.health.nonlethalHits = nonlethalHits;
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

function scheduleStageCounterInjection(app, html) {
  window.setTimeout(() => {
    try {
      if (!isEnabled() || !app?.actor) return;
      injectStageCounters(app, html);
    } catch (error) {
      warnThrottled("stage-counter-sheet", error);
    }
  }, 0);
}

function injectTemporaryInjuryIntoTemplate(path, html, data = {}) {
  try {
    if (!isEnabled() || typeof html !== "string" || !isActorSheetTemplate(path)) return html;
    const actor = getTemplateActor(data);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const temporaryInjected = injectTemporaryInjuryRow(wrapper, actor);
    const nonlethalInjected = injectNonlethalHitRow(wrapper, actor);
    const injected = temporaryInjected || nonlethalInjected;
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
      injectStageCountersInOpenSheets();
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

function injectStageCountersInOpenSheets() {
  for (const app of Object.values(ui.windows ?? {})) {
    if (!getSheetActor(app)?.items) continue;
    injectStageCounters(app, app.element);
  }

  for (const root of document.querySelectorAll(".app.sheet.actor, .window-app.sheet.actor, .ptu.sheet.actor")) {
    const app = getAppFromSheetRoot(root);
    if (!getSheetActor(app, root)?.items) continue;
    injectStageCounters(app, root);
  }
}

function injectTemporaryInjuries(app, html) {
  const root = getSheetRoot(app, html);
  const actor = getSheetActor(app, root);
  if (!actor?.system?.health) return;
  injectTemporaryInjuryRow(root, actor);
  injectNonlethalHitRow(root, actor);
}

function injectStageCounters(app, html) {
  const root = getSheetRoot(app, html);
  const actor = getSheetActor(app, root);
  if (!root || !actor?.items) return;
  applyStageCounterData(actor);

  for (const item of actor.items.filter((candidate) => candidate.type === "effect")) {
    const stage = getStageCounterFlag(item);
    if (!stage?.enabled) continue;
    injectStageCounterControl(root, item, stage);
  }
}

function injectStageCounterControl(root, item, stage) {
  const row = root.querySelector(`li.effect-item[data-item-id="${escapeCss(item.id)}"], li.item.effect-item[data-item-id="${escapeCss(item.id)}"]`);
  if (!row) return false;

  const name = row.querySelector(".item-name h4");
  if (name) name.textContent = formatStageCounterName(stage);

  const existing = row.querySelector(".ptr-stage-counter");
  const html = buildStageCounterControlHtml(stage);
  if (existing) {
    existing.outerHTML = html;
    return true;
  }

  const controls = row.querySelector(".item-info .item-controls");
  if (controls) {
    controls.insertAdjacentHTML("beforebegin", html);
    return true;
  }
  const info = row.querySelector(".item-info");
  if (info) {
    info.insertAdjacentHTML("beforeend", html);
    return true;
  }
  return false;
}

function buildStageCounterControlHtml(stage) {
  const value = clampStageCounter(stage.value, stage.min, stage.max);
  const min = stageInteger(stage.min, 0);
  const max = Math.max(min, stageInteger(stage.max, 6));
  const name = escapeHtml(stage.name ?? "Stage");
  return `<div class="ptr-stage-counter" style="display:flex;align-items:center;gap:3px;margin-left:auto;margin-right:4px;white-space:nowrap;" title="${escapeHtml(game.i18n.localize("PTR_STATUS.StageCounter.Label"))}">
    <button type="button" data-ptr-stage-action="decrease" style="width:22px;height:22px;line-height:18px;padding:0;">-</button>
    <input type="number" min="${min}" max="${max}" step="1" value="${value}" data-ptr-stage-input style="width:42px;height:22px;text-align:center;">
    <span style="font-size:12px;">/ ${max} ${name}</span>
    <button type="button" data-ptr-stage-action="increase" style="width:22px;height:22px;line-height:18px;padding:0;">+</button>
  </div>`;
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

function injectNonlethalHitRow(root, actor) {
  if (!root || root.querySelector(".ptr-nonlethal-hits-row")) return false;

  const tempHpInput = root.querySelector('input[name="system.tempHp.value"]');
  if (!tempHpInput) return false;

  const healthBody = tempHpInput.closest(".swsh-body") ?? tempHpInput.closest(".d-flex");
  if (!healthBody?.parentElement) return false;

  const row = document.createElement("div");
  row.className = "ptr-nonlethal-hits-row swsh-body d-flex flex-row center-text justify-content-center";
  row.innerHTML = buildNonlethalHitRowHtml(getNonlethalHits(actor));
  healthBody.insertAdjacentElement("afterend", row);
  return true;
}

function buildNonlethalHitRowHtml(nonlethalHits) {
  return `
    <div style="flex:0 0 45%;max-width:180px;margin:0 auto;">
      <label style="display:block;white-space:nowrap;text-align:center;">${escapeHtml(game.i18n.localize("PTR_STATUS.NonlethalHits.Label"))}</label>
      <input name="flags.${MODULE_ID}.${FLAGS.nonlethalHits}" type="number" min="0" step="1" value="${nonlethalHits}" data-dtype="Number" data-ptr-nonlethal-hits style="width:100%;text-align:center;">
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

function getStageCounterItemFromElement(element) {
  const root = element?.closest?.(".app.sheet.actor, .window-app.sheet.actor, .ptu.sheet.actor");
  const actor = getSheetActor(getAppFromSheetRoot(root), root);
  const itemId = element?.closest?.("[data-item-id]")?.dataset?.itemId;
  return actor?.items?.get?.(itemId) ?? null;
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
    setNonlethalHits,
    getNonlethalHits,
    setStageCounter,
    getStageCounter: (item) => getStageCounterFlag(item),
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

function getNonlethalHits(actor) {
  return clampNonlethalHits(actor?.getFlag?.(MODULE_ID, FLAGS.nonlethalHits) ?? actor?.system?.health?.nonlethalHits ?? 0);
}

function getCurrentHealth(actor) {
  const value = Number(actor?.system?.health?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function setNonlethalHits(actor, value) {
  if (!actor) return null;
  const clamped = clampNonlethalHits(value);
  try {
    return await actor.update({
      [`flags.${MODULE_ID}.${FLAGS.nonlethalHits}`]: clamped,
      "system.health.nonlethalHits": clamped
    });
  } catch (error) {
    warnThrottled("nonlethal-hit-system-update", error);
    return actor.setFlag(MODULE_ID, FLAGS.nonlethalHits, clamped);
  }
}

function clampTemporaryInjuries(value) {
  const number = Math.trunc(Number(value ?? 0));
  return Math.clamp(Number.isFinite(number) ? number : 0, 0, MAX_TEMPORARY_INJURIES);
}

function clampNonlethalHits(value) {
  const number = Math.trunc(Number(value ?? 0));
  return Math.max(0, Number.isFinite(number) ? number : 0);
}

function stageInteger(value, fallback) {
  const number = Math.trunc(Number(value ?? fallback));
  return Number.isFinite(number) ? number : fallback;
}

function clampStageCounter(value, min = 0, max = 6) {
  const low = stageInteger(min, 0);
  const high = Math.max(low, stageInteger(max, 6));
  return Math.clamp(stageInteger(value, low), low, high);
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

function escapeCss(value) {
  if (globalThis.CSS?.escape instanceof Function) return CSS.escape(String(value ?? ""));
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}
