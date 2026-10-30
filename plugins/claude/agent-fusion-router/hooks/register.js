// Generated from packages/claude-adapter by scripts/build.mjs. Edit the source and run `npm run build`.

// packages/core/src/types.ts
var TIERS = ["light", "standard", "heavy"];
var tierRank = (tier) => TIERS.indexOf(tier);
var bumpTier = (tier, steps = 1) => {
  const index = Math.min(TIERS.length - 1, Math.max(0, tierRank(tier) + steps));
  return TIERS[index] ?? tier;
};

// packages/core/src/catalog.ts
var PRICES_AS_OF = "2026-10-06";
var price = (input, output, cacheRead = input * 0.1) => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25
});
var CLAUDE_MODELS = [
  { id: "claude-fable-5-1", family: "fable", price: price(10, 50, 0.25) },
  { id: "claude-fable-5", family: "fable", price: price(10, 50, 1) },
  { id: "claude-opus-5-5", family: "opus", price: price(4, 20, 0.2) },
  { id: "claude-opus-5", family: "opus", price: price(5, 25) },
  { id: "claude-opus-4-8", family: "opus", price: price(5, 25) },
  { id: "claude-opus-4-7", family: "opus", price: price(5, 25) },
  { id: "claude-opus-4-6", family: "opus", price: price(5, 25) },
  { id: "claude-sonnet-5-5", family: "sonnet", price: price(2, 10, 0.2) },
  { id: "claude-sonnet-5", family: "sonnet", price: price(2, 10) },
  { id: "claude-sonnet-4-6", family: "sonnet", price: price(3, 15) },
  {
    id: "claude-haiku-5-5",
    family: "haiku",
    price: price(0.1, 0.5),
    longContext: { aboveInputTokens: 1e5, price: price(0.5, 2.5) }
  },
  { id: "claude-haiku-4-5", family: "haiku", price: price(1, 5) }
];
var FAMILY_RANK = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };
var BY_ID_LENGTH = [...CLAUDE_MODELS].sort((a, b) => b.id.length - a.id.length);
var findModel = (idOrAlias) => {
  const name = idOrAlias.toLowerCase().trim();
  return CLAUDE_MODELS.find((m) => m.id === name) ?? BY_ID_LENGTH.find((m) => name.startsWith(m.id)) ?? CLAUDE_MODELS.find((m) => m.family === name);
};
var familyOf = (idOrAlias) => {
  const listed = findModel(idOrAlias)?.family;
  if (listed) return listed;
  const name = idOrAlias.toLowerCase();
  return Object.keys(FAMILY_RANK).find((f) => name.includes(f));
};
var capabilityRank = (idOrAlias) => {
  const family = familyOf(idOrAlias);
  return family === void 0 ? void 0 : FAMILY_RANK[family];
};
var CLAUDE_TIER_DEFAULTS = {
  light: { model: "haiku", effort: "low" },
  standard: {},
  heavy: { model: "opus", effort: "high" }
};

// packages/core/src/analyzer.ts
var RULES = [
  {
    name: "lookup",
    kind: "lookup",
    tier: "light",
    weight: 2,
    pattern: /\b(where (is|are|does|do)|find (the|all|where|every)|look up|which files?|list (all|the|every)|show me|grep|search for)\b|어디(에|서)?\s?(있|정의|쓰|사용)|찾아(줘|봐|서)?|목록|보여\s?줘|검색해/i
  },
  {
    name: "mechanical",
    kind: "mechanical",
    tier: "light",
    weight: 3,
    pattern: /\b(rename|typos?|spelling|reformat|sort (the )?imports|bump (the )?version|update (the )?(copyright|year|version)|add (a )?comments?|remove (unused|dead)|replace \S.{0,40} with)\b|오타|이름(을)?\s?바꿔|포맷(팅)?|import\s?정렬|주석(을)?\s?(달|추가)|버전(을)?\s?올려|치환/i
  },
  {
    name: "explain",
    kind: "lookup",
    tier: "light",
    weight: 1,
    pattern: /\b(explain|summari[sz]e|what is|what does|how does)\b|설명해|요약해/i
  },
  {
    name: "implement",
    kind: "implement",
    tier: "standard",
    weight: 2,
    pattern: /\b(implement|add(?! (a )?comments?\b) \w+|create (a|an|the)|build (a|an)|write (a|an|the)|hook up|wire up|endpoint|component|feature|support for)\b|구현|추가해|만들어|작성해|기능/i
  },
  {
    // A bare verb: "fix the typo" is still a typo.
    name: "fix",
    kind: "debug",
    tier: "standard",
    weight: 1,
    pattern: /\b(fix|change|update|modify)\b|고쳐|수정해|바꿔/i
  },
  {
    name: "debug",
    kind: "debug",
    tier: "standard",
    weight: 2,
    pattern: /\b(bugs?|errors?|exception|crash(es|ing)?|fail(s|ing|ed)?|broken|stack ?trace|traceback|regression)\b|버그|에러|오류|실패|예외/i
  },
  {
    name: "design",
    kind: "design",
    tier: "heavy",
    weight: 3,
    pattern: /\b(architect(ure)?|design (a|the|an)|redesign|re-?architect|trade-?offs?|strategy|approach (for|to)|migrat(e|ion)|refactor (the|our|all)|overhaul|rewrite)\b|설계|아키텍처|구조(를)?\s?(바꿔|개선|잡)|전략|마이그레이션|리팩(터|토)링|재작성|전면/i
  },
  {
    name: "investigate",
    kind: "debug",
    tier: "heavy",
    weight: 2,
    pattern: /\b(why (does|is|do|did|are)|root cause|investigate|intermittent|flaky|race condition|deadlock|memory leak|non-?deterministic)\b|왜\s|원인|간헐적|경쟁\s?조건|교착|메모리\s?누수/i
  },
  {
    name: "uncertain",
    kind: "design",
    tier: "heavy",
    weight: 2,
    pattern: /\b(should (i|we)|which (is|would be) better|best way|not sure|unclear|pros and cons)\b|좋을까|나을까|어떻게 하면 좋|장단점|모르겠/i
  }
];
var RISK = /\b(prod(uction)?|deploy(ment)?|schema change|auth(entication|orization)?|payments?|billing|security|secrets?|credentials?|encryption|data loss)\b|운영\s?(서버|환경|DB)|배포|결제|인증|권한|보안|암호화|개인정보|데이터\s?삭제/i;
var BREADTH = /\b(all files|every (file|module|component|package)|entire (codebase|repo|project|app)|across (the )?(codebase|repo|project|modules|packages)|whole (codebase|project|repo)|everywhere|project-?wide)\b|전체\s?(코드|파일|프로젝트)|모든\s?(파일|모듈|컴포넌트|패키지)|프로젝트\s?전반/i;
var VERIFY = /\b(tests?|specs?|typecheck|lint|ci)\b|테스트/i;
var FILE_REF = /(?:[\w.-]+\/)*[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|cc|cpp|hpp|css|scss|html|vue|svelte|md|json|ya?ml|toml|sql|sh)\b/gi;
var CONTINUE = /^\s*(continue|go on|go ahead|proceed|keep going|yes|yep|yeah|ok(ay)?|sure|do it|lgtm|sounds good|계속(해|하자)?|진행(해)?|응|네|예|ㅇㅇ|ㅇㅋ|좋아|그래|해줘|부탁해)[\s.!~]*$/i;
var FAILURE = /\b(still (fails?|failing|broken|not working|doesn'?t work|getting|seeing|the same)|didn'?t (work|fix)|same (error|problem|issue)|wrong again|that broke)\b|여전히|아직도\s?(안|에러|오류)|똑같은\s?(에러|오류|문제)|또\s?(에러|오류|안)|해결이\s?안|안\s?고쳐/i;
var MAX_CHARS = 4e3;
var analyzeTask = (input) => {
  const text2 = input.slice(0, MAX_CHARS);
  const signals = [];
  if (CONTINUE.test(text2)) {
    return { kind: "unknown", tier: "standard", confidence: 0, followUp: "continue", signals: ["follow-up:continue"] };
  }
  const followUp = FAILURE.test(text2) ? "failure" : void 0;
  if (followUp) signals.push("follow-up:failure");
  const scores = { light: 0, standard: 0, heavy: 0 };
  const kinds = /* @__PURE__ */ new Map();
  for (const rule of RULES) {
    if (!rule.pattern.test(text2)) continue;
    scores[rule.tier] += rule.weight;
    kinds.set(rule.kind, (kinds.get(rule.kind) ?? 0) + rule.weight);
    signals.push(rule.name);
  }
  const files = new Set(text2.match(FILE_REF) ?? []).size;
  if (files >= 4) {
    scores.heavy += 1;
    signals.push("files:many");
  } else if (files > 0) {
    signals.push(`files:${files}`);
  }
  if (RISK.test(text2)) {
    scores.heavy += 2;
    signals.push("risk");
  }
  const isWide = BREADTH.test(text2);
  if (isWide) signals.push("scope:wide");
  const hasVerification = VERIFY.test(text2);
  if (hasVerification) signals.push("verify");
  const ranked = [...TIERS].sort((a, b) => scores[b] - scores[a] || tierRank(b) - tierRank(a));
  const [first2 = "standard", second = "standard"] = ranked;
  const top = scores[first2];
  if (top === 0) {
    return { kind: "unknown", tier: "standard", confidence: 0, followUp, signals };
  }
  const tier = isWide && first2 === "light" ? bumpTier(first2) : first2;
  const margin = (top - scores[second]) / (top + 1);
  const confidence = Math.min(0.95, margin + (hasVerification && tier !== "heavy" ? 0.1 : 0));
  const kind = [...kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  return { kind, tier, confidence: round(confidence), followUp, signals };
};
var round = (n) => Math.round(n * 100) / 100;

// packages/core/src/router.ts
var DEFAULT_POLICY = {
  mode: "observe",
  strategy: "model",
  tiers: CLAUDE_TIER_DEFAULTS,
  minLightConfidence: 0.5,
  cacheGuardTokens: 5e4
};
var route = (input, policy = DEFAULT_POLICY) => {
  const { analysis } = input;
  const reasons = [];
  let tier = analysis.tier;
  if (analysis.followUp && input.previousTier) {
    tier = input.previousTier;
    reasons.push(`follow-up:${analysis.followUp}`);
    if (analysis.followUp === "failure" || input.lastVerificationFailed) {
      tier = bumpTier(tier);
      reasons.push("escalate:previous-attempt-failed");
    }
  } else if (tier === "light" && analysis.confidence < policy.minLightConfidence) {
    tier = "standard";
    reasons.push(`light-held:confidence-${analysis.confidence}`);
  } else {
    reasons.push(`analysis:${analysis.kind}`);
  }
  const escalations = input.escalations ?? 0;
  if (escalations > 0) {
    tier = bumpTier(tier, escalations);
    reasons.push(`escalate:verification-failed-x${escalations}`);
  }
  const target2 = policy.tiers[tier];
  const model = policy.strategy === "model" && target2.model !== void 0 ? pickModel(tier, target2.model, input, policy, reasons) : void 0;
  const takesEffort = input.currentEffort !== void 0 || model !== void 0;
  const effort = takesEffort && target2.effort !== void 0 && target2.effort !== input.currentEffort ? target2.effort : void 0;
  return {
    tier,
    model,
    effort,
    reasons,
    applied: policy.mode === "route" && (model !== void 0 || effort !== void 0)
  };
};
var pickModel = (tier, target2, input, policy, reasons) => {
  const from = capabilityRank(input.currentModel);
  const to = capabilityRank(target2);
  if (from === void 0 || to === void 0) {
    reasons.push("model-held:unknown-model");
    return void 0;
  }
  if (from === to) return void 0;
  if (tier === "light" && to > from) return void 0;
  if (tier === "heavy" && to < from) return void 0;
  const context = input.contextTokens ?? 0;
  if (to < from && context > policy.cacheGuardTokens) {
    reasons.push(`cache-guard:${context}`);
    return void 0;
  }
  return target2;
};
var routeSpawn = (input, policy = DEFAULT_POLICY) => {
  const { analysis } = input;
  const isLight = analysis.tier === "light" && analysis.confidence >= policy.minLightConfidence;
  const tier = isLight ? "light" : "standard";
  const reasons = [`analysis:${analysis.kind}`];
  if (input.requestedModel !== void 0) {
    return { tier, reasons: [...reasons, "model-held:requested"], applied: false };
  }
  const target2 = policy.tiers.light.model;
  const from = capabilityRank(input.parentModel);
  const to = target2 === void 0 ? void 0 : capabilityRank(target2);
  const isDowngrade = from !== void 0 && to !== void 0 && to < from;
  const model = isLight && policy.strategy === "model" && isDowngrade ? target2 : void 0;
  return { tier, model, reasons, applied: policy.mode === "route" && model !== void 0 };
};

// packages/core/src/escalation.ts
var VERIFICATION_COMMAND = /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|type-check|check|verify)\b|npx\s+(?:tsc|jest|vitest|eslint|playwright\s+test)\b|(?:tsc|jest|vitest|mocha|pytest|phpunit|rspec|eslint|ruff|mypy|pyright)(?=[\s;&|)]|$)|go\s+(?:test|build|vet)\b|cargo\s+(?:test|build|check|clippy)\b|(?:mvn|\.\/mvnw|mvnw)\s+(?:test|verify|package)\b|(?:gradle|\.\/gradlew|gradlew)\s+(?:test|build|check)\b|make\s+(?:test|check)\b|dotnet\s+(?:test|build)\b|python3?\s+-m\s+(?:pytest|unittest|mypy)\b|node\s+--test\b|deno\s+(?:test|check|lint)\b)/;
var isVerificationCommand = (command) => VERIFICATION_COMMAND.test(` ${command}`);
var DEFAULT_ESCALATION = {
  failuresBeforeEscalation: 2,
  maxEscalationsPerTurn: 1
};
var newVerificationState = () => ({
  passes: 0,
  failures: 0,
  consecutiveFailures: 0,
  escalations: 0
});
var recordVerification = (state, hasPassed, policy = DEFAULT_ESCALATION) => {
  if (hasPassed) {
    return {
      state: { ...state, passes: state.passes + 1, consecutiveFailures: 0, last: "pass" },
      escalate: false
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  const escalate = consecutiveFailures >= policy.failuresBeforeEscalation && state.escalations < policy.maxEscalationsPerTurn;
  return {
    state: {
      ...state,
      failures: state.failures + 1,
      consecutiveFailures: escalate ? 0 : consecutiveFailures,
      escalations: state.escalations + (escalate ? 1 : 0),
      last: "fail"
    },
    escalate
  };
};

// packages/core/src/usage.ts
var emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
var addTokens = (a, b) => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite
});
var promptTokens = (t) => t.input + t.cacheRead + t.cacheWrite;
var estimateCostUsd = (tokens, model) => {
  const entry = findModel(model);
  if (!entry) return void 0;
  const long = entry.longContext;
  const p = long && promptTokens(tokens) > long.aboveInputTokens ? long.price : entry.price;
  return (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + tokens.cacheWrite * p.cacheWrite) / 1e6;
};
var summarize = (records) => {
  const sessions = /* @__PURE__ */ new Set();
  const models = /* @__PURE__ */ new Map();
  const unpriced = /* @__PURE__ */ new Set();
  const s = {
    sessions: 0,
    requests: 0,
    byModel: [],
    turns: 0,
    turnsByTier: {},
    turnsByOutcome: {},
    escalatedTurns: 0,
    routedRequests: 0,
    wouldRouteRequests: 0,
    spawns: 0,
    routedSpawns: 0,
    costUsd: 0,
    unroutedCostUsd: 0,
    potentialCostUsd: 0,
    unpricedModels: []
  };
  for (const r of records) {
    sessions.add(r.session);
    s.from = Math.min(s.from ?? r.ts, r.ts);
    s.to = Math.max(s.to ?? r.ts, r.ts);
    if (r.kind === "turn") {
      s.turns += 1;
      if (r.tier) s.turnsByTier[r.tier] = (s.turnsByTier[r.tier] ?? 0) + 1;
      s.turnsByOutcome[r.outcome] = (s.turnsByOutcome[r.outcome] ?? 0) + 1;
      if (r.escalations > 0) s.escalatedTurns += 1;
      continue;
    }
    if (r.kind === "spawn") {
      s.spawns += 1;
      if (r.applied) s.routedSpawns += 1;
      continue;
    }
    s.requests += 1;
    if (r.applied) s.routedRequests += 1;
    const wouldRoute = !r.applied && (r.decidedModel !== void 0 || r.decidedEffort !== void 0);
    if (wouldRoute) s.wouldRouteRequests += 1;
    if (!r.tokens) continue;
    const model = r.model ?? r.requestedModel;
    const row = models.get(model) ?? { model, requests: 0, tokens: emptyTokens(), costUsd: 0 };
    const cost = estimateCostUsd(r.tokens, model);
    row.requests += 1;
    row.tokens = addTokens(row.tokens, r.tokens);
    if (cost === void 0) {
      unpriced.add(model);
      row.costUsd = void 0;
    } else if (row.costUsd !== void 0) {
      row.costUsd += cost;
    }
    models.set(model, row);
    const actual = cost ?? 0;
    s.costUsd += actual;
    s.unroutedCostUsd += r.applied ? estimateCostUsd(r.tokens, r.requestedModel) ?? actual : actual;
    s.potentialCostUsd += wouldRoute && r.decidedModel ? estimateCostUsd(r.tokens, r.decidedModel) ?? actual : actual;
  }
  s.sessions = sessions.size;
  s.byModel = [...models.values()].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
  s.unpricedModels = [...unpriced];
  return s;
};
var compact = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`;
var usd = (n) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
var day = (ts) => new Date(ts).toISOString().slice(0, 10);
var pad = (cells, widths) => cells.map((c, i) => i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)).join("  ");
var counts = (record) => Object.entries(record).map(([k, v]) => `${k} ${v}`).join(" · ") || "none";
var formatReport = (s) => {
  if (s.requests === 0 && s.turns === 0) return "No usage recorded yet.";
  const header = ["Model", "Requests", "Input", "Output", "Cache rd", "Cache wr", "Est. USD"];
  const rows = s.byModel.map((r) => [
    r.model,
    `${r.requests}`,
    compact(r.tokens.input),
    compact(r.tokens.output),
    compact(r.tokens.cacheRead),
    compact(r.tokens.cacheWrite),
    r.costUsd === void 0 ? "n/a" : usd(r.costUsd)
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const period = s.from === void 0 || s.to === void 0 ? "" : `${day(s.from)} to ${day(s.to)}`;
  const lines = [
    `Agent Fusion Router usage, ${period}`,
    `Sessions ${s.sessions} · Turns ${s.turns} · Requests ${s.requests} · Subagents ${s.spawns}`,
    "",
    pad(header, widths),
    ...rows.map((r) => pad(r, widths)),
    "",
    `Turns by tier: ${counts(s.turnsByTier)} (escalated ${s.escalatedTurns})`,
    `Turn outcomes: ${counts(s.turnsByOutcome)}`,
    `Routed: ${s.routedRequests} requests, ${s.routedSpawns} subagents`
  ];
  if (s.wouldRouteRequests > 0) {
    lines.push(`Observe mode: the router would have changed ${s.wouldRouteRequests} requests`);
  }
  lines.push("", `Estimated cost: ${usd(s.costUsd)}`);
  if (s.routedRequests > 0) {
    lines.push(`Same tokens at the models asked for before routing: ${usd(s.unroutedCostUsd)}`);
  }
  if (s.wouldRouteRequests > 0) {
    lines.push(`Same tokens at the router's choices: ${usd(s.potentialCostUsd)}`);
  }
  if (s.unpricedModels.length > 0) {
    lines.push(`No price for: ${s.unpricedModels.join(", ")} (left out of the totals)`);
  }
  lines.push(
    "",
    `Estimates use Anthropic list prices as of ${PRICES_AS_OF}; they are not your bill.`,
    "On a Claude subscription, usage counts against plan limits, not dollars.",
    "Comparisons reuse the same token counts, so they ignore tokenizer and cache differences between models."
  );
  return lines.join("\n");
};

// packages/claude-adapter/src/config.ts
var text = (value, fallback) => typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
var count = (value, fallback) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
var flag = (value, fallback) => typeof value === "boolean" ? value : fallback;
var oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
var target = (model, base) => {
  const name = text(model, "");
  return name === "" ? { effort: base.effort } : { ...base, model: name };
};
var readConfig = (options) => ({
  policy: {
    mode: oneOf(options.mode, ["observe", "route"], DEFAULT_POLICY.mode),
    strategy: oneOf(options.strategy, ["model", "effort"], DEFAULT_POLICY.strategy),
    tiers: {
      light: target(options.lightModel ?? CLAUDE_TIER_DEFAULTS.light.model, CLAUDE_TIER_DEFAULTS.light),
      standard: target(options.standardModel, CLAUDE_TIER_DEFAULTS.standard),
      heavy: target(options.heavyModel ?? CLAUDE_TIER_DEFAULTS.heavy.model, CLAUDE_TIER_DEFAULTS.heavy)
    },
    minLightConfidence: count(options.minLightConfidence, DEFAULT_POLICY.minLightConfidence),
    cacheGuardTokens: count(options.cacheGuardTokens, DEFAULT_POLICY.cacheGuardTokens)
  },
  escalation: {
    failuresBeforeEscalation: count(options.failuresBeforeEscalation, DEFAULT_ESCALATION.failuresBeforeEscalation),
    maxEscalationsPerTurn: count(options.maxEscalationsPerTurn, DEFAULT_ESCALATION.maxEscalationsPerTurn)
  },
  routeSubagents: flag(options.routeSubagents, true),
  showStatus: flag(options.showStatus, true),
  logDir: text(options.logDir, "")
});

// packages/claude-adapter/src/log.ts
var FILE_LINES = 2e3;
var createLog = () => {
  const part = Math.random().toString(36).slice(2, 8);
  const pending = /* @__PURE__ */ new Map();
  let dir;
  let lines = [];
  let fileIndex = 0;
  let isFlushing = false;
  let error;
  return {
    get dir() {
      return dir;
    },
    get error() {
      return error;
    },
    setDir(path) {
      dir = path.replace(/[\\/]+$/, "");
    },
    add(record) {
      if (dir === void 0) return;
      if (lines.length >= FILE_LINES) {
        lines = [];
        fileIndex += 1;
      }
      lines.push(JSON.stringify(record));
      const date = new Date(record.ts).toISOString().slice(0, 10);
      pending.set(`${dir}/${date}_${record.session}_${part}-${fileIndex}.jsonl`, `${lines.join("\n")}
`);
    },
    /**
     * Writes whatever is pending, one write at a time, so a slow write never
     * lands after a newer one. A call while another flushes returns at once:
     * the running flush picks up its record.
     */
    async flush(write) {
      if (isFlushing) return;
      isFlushing = true;
      try {
        for (let next = first(pending); next !== void 0; next = first(pending)) {
          pending.delete(next.path);
          await write(next);
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        isFlushing = false;
      }
    }
  };
};
var first = (files) => {
  const entry = files.entries().next().value;
  return entry === void 0 ? void 0 : { path: entry[0], text: entry[1] };
};
var parseRecords = (texts) => texts.flatMap(
  (text2) => text2.split("\n").flatMap((line) => {
    try {
      return line.trim() === "" ? [] : [JSON.parse(line)];
    } catch {
      return [];
    }
  })
);

// packages/claude-adapter/src/register.ts
var MAIN = "main";
var toTokens = (u) => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens
});
function register(on, options) {
  const config = readConfig(options);
  const turns = /* @__PURE__ */ new Map();
  const loops = /* @__PURE__ */ new Map();
  const log = createLog();
  const loopOf = (agentId) => {
    const key = agentId ?? MAIN;
    const loop = loops.get(key) ?? {};
    loops.set(key, loop);
    return loop;
  };
  const onShellCommand = (command, agentId, ran) => {
    if (ran.deny !== void 0 || !isVerificationCommand(command)) return void 0;
    const turnId = loops.get(agentId ?? MAIN)?.currentTurn;
    const turn = turnId === void 0 ? void 0 : turns.get(turnId);
    if (!turn) return void 0;
    const { state, escalate } = recordVerification(turn.verification, ran.isError !== true, config.escalation);
    turn.verification = state;
    const shouldShow = escalate && agentId === void 0 && config.showStatus && config.policy.mode === "route";
    return shouldShow ? `router: verification failed ${state.failures}x, moving up a tier` : void 0;
  };
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "router",
      description: 'Agent Fusion Router: routing and usage for this session. "/router explain <task>" shows a decision.',
      argumentHint: "[explain <task>]"
    });
    return next(e);
  });
  on("command.run", { command: "router" }, async ($, e) => {
    const task = /^explain\s+([\s\S]+)/i.exec(e.args.trim())?.[1];
    if (task !== void 0) {
      const analysis = analyzeTask(task);
      const decision = route(
        { analysis, currentModel: await $.session.model(), previousTier: loops.get(MAIN)?.previousTier },
        config.policy
      );
      return { text: describe(analysis, decision, config) };
    }
    const dir = log.dir;
    const session = await $.session.id();
    const entries = dir === void 0 ? [] : await $.fs.list(dir).catch(() => []);
    const files = entries.filter((f) => f.kind === "file" && f.name.includes(`_${session}_`));
    const texts = await Promise.all(files.map((f) => $.fs.read(`${dir}/${f.name}`)));
    const where = log.error !== void 0 ? `Logs are not being written: ${log.error}` : `Logs: ${dir ?? "set at the first turn"}`;
    return {
      text: [
        `Mode ${config.policy.mode} · strategy ${config.policy.strategy}`,
        where,
        "",
        formatReport(summarize(parseRecords(texts)))
      ].join("\n")
    };
  });
  on("turn.start", async ($, e, next) => {
    if (log.dir === void 0) {
      const home = await $.env.get("HOME") ?? await $.env.get("USERPROFILE") ?? ".";
      log.setDir(config.logDir !== "" ? config.logDir : `${home.replace(/[\\/]+$/, "")}/.agent-fusion-router/logs`);
    }
    loopOf(e.agentId).currentTurn = e.turnId;
    turns.set(e.turnId, {
      analysis: analyzeTask(e.text),
      decidedAtEscalation: 0,
      verification: newVerificationState()
    });
    return next(e);
  });
  on("turn.step", async function* ($, e, next) {
    const loop = loopOf(e.agentId);
    const turn = turns.get(e.turnId);
    const isMain = e.agentId === void 0;
    if (isMain && turn && (turn.decision === void 0 || turn.decidedAtEscalation !== turn.verification.escalations)) {
      turn.decision = route(
        {
          analysis: turn.analysis,
          currentModel: e.model,
          currentEffort: e.effort,
          previousTier: loop.previousTier,
          lastVerificationFailed: loop.lastVerificationFailed,
          contextTokens: loop.contextTokens,
          escalations: turn.verification.escalations
        },
        config.policy
      );
      turn.decidedAtEscalation = turn.verification.escalations;
      if (config.showStatus) $.ui.status(statusText(turn.decision, config));
    }
    const decision = isMain ? turn?.decision : void 0;
    const sent = decision?.applied ? {
      ...e,
      ...decision.model === void 0 ? {} : { model: decision.model },
      ...decision.effort === void 0 ? {} : { effort: decision.effort }
    } : e;
    const result = yield* next(sent);
    const tokens = result.usage ? toTokens(result.usage) : void 0;
    if (tokens) loop.contextTokens = promptTokens(tokens);
    log.add({
      v: 1,
      kind: "step",
      ts: Date.now(),
      product: "claude-code",
      session: await $.session.id(),
      agent: e.agentId,
      turn: e.turnId,
      step: e.index,
      mode: config.policy.mode,
      tier: decision?.tier,
      requestedModel: e.model,
      decidedModel: decision?.model,
      decidedEffort: decision?.effort,
      applied: decision?.applied ?? false,
      model: result.usage?.model,
      tokens,
      stop: result.stopReason,
      reasons: decision?.reasons
    });
    await log.flush((file) => $.fs.write(file.path, file.text));
    return result;
  });
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const ran = await next(e);
    const status = onShellCommand(e.command, e.agentId, ran);
    if (status !== void 0) $.ui.status(status);
    return ran;
  }).catch((_, e, next) => next(e));
  on("tool.call", { tool: "PowerShell" }, async ($, e, next) => {
    const ran = await next(e);
    const status = onShellCommand(e.command, e.agentId, ran);
    if (status !== void 0) $.ui.status(status);
    return ran;
  }).catch((_, e, next) => next(e));
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    const turn = turns.get(e.turnId);
    if (!turn) return result;
    turns.delete(e.turnId);
    const loop = loopOf(e.agentId);
    loop.previousTier = turn.decision?.tier ?? loop.previousTier;
    loop.lastVerificationFailed = turn.verification.last === "fail";
    log.add({
      v: 1,
      kind: "turn",
      ts: Date.now(),
      product: "claude-code",
      session: await $.session.id(),
      agent: e.agentId,
      turn: e.turnId,
      tier: turn.decision?.tier,
      taskKind: turn.analysis.kind,
      signals: turn.analysis.signals,
      outcome: e.reason,
      durationMs: e.durationMs,
      verifyPasses: turn.verification.passes,
      verifyFailures: turn.verification.failures,
      escalations: turn.verification.escalations
    });
    await log.flush((file) => $.fs.write(file.path, file.text));
    return result;
  });
  on("agent.spawn", async ($, e, next) => {
    const isEligible = config.routeSubagents && e.resume === void 0 && e.workflow === void 0 && e.subagentType !== "fork";
    if (!isEligible) return next(e);
    const decision = routeSpawn(
      {
        analysis: analyzeTask(`${e.description}
${e.prompt}`),
        parentModel: e.parentModel,
        requestedModel: e.model
      },
      config.policy
    );
    const result = await next(decision.applied && decision.model ? { ...e, model: decision.model } : e);
    log.add({
      v: 1,
      kind: "spawn",
      ts: Date.now(),
      product: "claude-code",
      session: await $.session.id(),
      agent: result.agentId,
      subagentType: e.subagentType,
      tier: decision.tier,
      requestedModel: e.model,
      decidedModel: decision.model,
      applied: decision.applied,
      model: result.model,
      reasons: decision.reasons
    });
    await log.flush((file) => $.fs.write(file.path, file.text));
    return result;
  }).catch((_, e, next) => next(e));
}
var statusText = (d, config) => {
  const change = [d.model, d.effort && `effort ${d.effort}`].filter(Boolean).join(", ");
  if (change === "") return `router: ${d.tier}`;
  if (config.policy.mode === "observe") return `router (observe): ${d.tier}, would use ${change}`;
  return `router: ${d.tier} → ${change}`;
};
var describe = (a, d, config) => [
  `Kind ${a.kind} · suggested tier ${a.tier} · confidence ${a.confidence}`,
  `Signals: ${a.signals.join(", ") || "none"}`,
  `Decision: ${statusText(d, config).replace(/^router[^:]*: /, "")}`,
  `Reasons: ${d.reasons.join(", ")}`,
  config.policy.mode === "observe" ? "Observe mode: nothing is applied." : ""
].filter(Boolean).join("\n");
export {
  register
};
