
// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
let S = {
  profiles: [],
  activeId: 0,
  hasOnboarded: false,
  logDate: today(),
  foodMethod: null,
  foodImg: null,
  analyzeImg: null,
  pendingFood: null,
  isDark: true,
  ciAnswers: {},
  ciTargetDate: null,
};

function today() { return new Date().toISOString().split('T')[0]; }

function getP() { return S.profiles[S.activeId] || {}; }
function getPD() {
  const p = S.profiles[S.activeId];
  if (!p) return { stack: [], logs: {}, savedMeals: [], briefs: [] };
  if (!p.data) p.data = { stack: [], logs: {}, savedMeals: [], briefs: [] };
  return p.data;
}
function getLog(d) {
  const pd = getPD();
  if (!pd.logs) pd.logs = {};
  if (!pd.logs[d]) pd.logs[d] = { water: 0, foods: [], metrics: {}, checkin: null };
  return pd.logs[d];
}

function save() {
  try { localStorage.setItem('bl6', JSON.stringify({ profiles: S.profiles, activeId: S.activeId, isDark: S.isDark, hasOnboarded: S.hasOnboarded })); } catch(e) {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('bl6') || '{}');
    if (d.profiles) S.profiles = d.profiles;
    if (d.activeId !== undefined) S.activeId = d.activeId;
    if (d.isDark !== undefined) S.isDark = d.isDark;
    if (d.hasOnboarded !== undefined) S.hasOnboarded = d.hasOnboarded;
    else if (S.profiles.some(p => p.onboarded)) S.hasOnboarded = true;
  } catch(e) {}
}

// ══════════════════════════════════════
// SMART DEFAULTS ENGINE
// ══════════════════════════════════════
const ACTIVITY_MULTIPLIER = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 };

function calcSmartDefaults(weight, activity, goal, glp1, waterGoal) {
  const w = parseFloat(weight) || 150;
  const actMult = ACTIVITY_MULTIPLIER[activity] || 1.55;

  // Protein based on goal
  let proteinPerLb = 0.75;
  if (goal === 'muscle' || goal === 'performance') proteinPerLb = 1.0;
  if (goal === 'glp1' || glp1 === 'yes') proteinPerLb = 0.85;
  if (goal === 'weight-loss') proteinPerLb = 0.8;
  const protein = Math.round(w * proteinPerLb / 5) * 5;

  // BMR (Mifflin-St Jeor simplified — no sex data required)
  const bmr = 10 * (w * 0.453592) + 500;
  const tdee = Math.round(bmr * actMult);

  // Calorie floor and ceiling based on goal
  let calFloor, calCeil;
  if (goal === 'weight-loss' || goal === 'glp1' || glp1 === 'yes') {
    calFloor = Math.round((tdee - 500) / 50) * 50;
    calCeil = Math.round(tdee / 50) * 50;
  } else if (goal === 'muscle') {
    calFloor = Math.round(tdee / 50) * 50;
    calCeil = Math.round((tdee + 400) / 50) * 50;
  } else {
    calFloor = Math.round((tdee - 300) / 50) * 50;
    calCeil = Math.round((tdee + 200) / 50) * 50;
  }

  // Minimum floors
  calFloor = Math.max(calFloor, 1200);
  calCeil = Math.max(calCeil, calFloor + 300);

  const water = waterGoal || Math.round(w * 0.5 / 8) * 8;

  return { protein, calFloor, calCeil, water };
}

// Quick foods by goal
const QUICK_FOODS_BY_GOAL = {
  glp1: [
    { name: 'Protein shake', icon: '🥤', portion: '16 oz', calories: 150, protein: 30 },
    { name: 'Greek yogurt with honey and berries', icon: '🫙', portion: '1 cup', calories: 200, protein: 17 },
    { name: 'Cottage cheese', icon: '🥣', portion: '1 cup', calories: 200, protein: 28 },
    { name: 'Hard boiled eggs', icon: '🥚', portion: '2 eggs', calories: 140, protein: 12 },
    { name: 'Electrolyte drink', icon: '⚡', portion: '16 oz', calories: 20, protein: 0 },
  ],
  'weight-loss': [
    { name: 'Protein shake', icon: '🥤', portion: '16 oz', calories: 150, protein: 30 },
    { name: 'Greek yogurt', icon: '🫙', portion: '1 cup', calories: 130, protein: 17 },
    { name: 'Tuna packet', icon: '🐟', portion: '1 packet', calories: 100, protein: 22 },
    { name: 'Hard boiled eggs', icon: '🥚', portion: '2 eggs', calories: 140, protein: 12 },
    { name: 'Cottage cheese', icon: '🥣', portion: '1 cup', calories: 200, protein: 28 },
  ],
  muscle: [
    { name: 'Protein shake', icon: '🥤', portion: '16 oz', calories: 200, protein: 40 },
    { name: 'Ground beef bowl', icon: '🥩', portion: '6 oz beef + rice', calories: 500, protein: 40 },
    { name: 'Cottage cheese', icon: '🥣', portion: '1 cup', calories: 200, protein: 28 },
    { name: 'Hard boiled eggs', icon: '🥚', portion: '3 eggs', calories: 210, protein: 18 },
    { name: 'Greek yogurt', icon: '🫙', portion: '1 cup', calories: 130, protein: 17 },
  ],
  performance: [
    { name: 'Protein shake', icon: '🥤', portion: '16 oz', calories: 200, protein: 40 },
    { name: 'Banana + peanut butter', icon: '🍌', portion: '1 banana + 2 tbsp', calories: 280, protein: 7 },
    { name: 'Greek yogurt', icon: '🫙', portion: '1 cup', calories: 130, protein: 17 },
    { name: 'Electrolyte drink', icon: '⚡', portion: '16 oz', calories: 20, protein: 0 },
    { name: 'Hard boiled eggs', icon: '🥚', portion: '2 eggs', calories: 140, protein: 12 },
  ],
  default: [
    { name: 'Protein shake', icon: '🥤', portion: '16 oz', calories: 150, protein: 30 },
    { name: 'Greek yogurt', icon: '🫙', portion: '1 cup', calories: 130, protein: 17 },
    { name: 'Tuna packet', icon: '🐟', portion: '1 packet', calories: 100, protein: 22 },
    { name: 'Hard boiled eggs', icon: '🥚', portion: '2 eggs', calories: 140, protein: 12 },
    { name: 'Electrolyte drink', icon: '⚡', portion: '16 oz', calories: 20, protein: 0 },
  ],
};

function getSmartQuickFoods(goal, glp1) {
  const key = glp1 === 'yes' ? 'glp1' : (QUICK_FOODS_BY_GOAL[goal] ? goal : 'default');
  return (QUICK_FOODS_BY_GOAL[key] || QUICK_FOODS_BY_GOAL.default).map(f => ({ ...f }));
}

// Temp storage for onboarding quick foods
let obQuickFoods = [];

// ══════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════
let obStep = 0;
function obNext() {
  if (obStep === 0) { obStep = 1; document.getElementById('ob-btn').textContent = 'Continue →'; }
  else if (obStep === 1) { obStep = 2; }
  else if (obStep === 2) { obStep = 3; }
  else if (obStep === 3) {
    // Move to confirmation step — calculate smart defaults
    obStep = 4;
    document.getElementById('ob-btn').textContent = 'Looks good, let\'s go →';
    buildConfirmationStep();
  }
  else if (obStep === 4) {
    finishOb();
    return;
  }

  document.querySelectorAll('.ob-step').forEach((el,i) => el.classList.toggle('active', i === obStep));
  document.querySelectorAll('.ob-pip').forEach((el,i) => {
    el.classList.remove('active','done');
    if (i < obStep) el.classList.add('done');
    if (i === obStep) el.classList.add('active');
  });
}

function buildConfirmationStep() {
  const weight = document.getElementById('ob-weight').value;
  const activity = document.getElementById('ob-activity').value || 'moderate';
  const goal = document.getElementById('ob-goal').value || 'wellness';
  const glp1 = document.getElementById('ob-glp1').value || 'no';
  const waterGoal = parseInt(document.getElementById('ob-water').value) || 80;

  const defaults = calcSmartDefaults(weight, activity, goal, glp1, waterGoal);

  document.getElementById('ob-t-protein').value = defaults.protein;
  document.getElementById('ob-t-calfloor').value = defaults.calFloor;
  document.getElementById('ob-t-calceil').value = defaults.calCeil;
  document.getElementById('ob-t-water').value = defaults.water;

  // Seed quick foods
  obQuickFoods = getSmartQuickFoods(goal, glp1);
  renderObQfChips();
}

function renderObQfChips() {
  const el = document.getElementById('ob-qf-preview');
  if (!el) return;
  el.innerHTML = obQuickFoods.map((f, i) =>
    '<div class="ob-qf-chip" onclick="removeObQf(' + i + ')">' +
    f.icon + ' ' + f.name +
    '<span class="remove">&#10005;</span></div>'
  ).join('');
}

function removeObQf(idx) {
  obQuickFoods.splice(idx, 1);
  renderObQfChips();
}
function finishOb() {
  const p = buildObProfile();
  S.profiles = [p]; S.activeId = 0;
  S.hasOnboarded = true;
  save();
  document.getElementById('ob').classList.add('hidden');
  initApp();
}
function buildObProfile() {
  const goal = document.getElementById('ob-goal').value || 'wellness';
  const glp1 = document.getElementById('ob-glp1').value || 'no';
  const waterGoal = parseInt(document.getElementById('ob-water').value) || 80;
  const weight = document.getElementById('ob-weight').value || '';
  const activity = document.getElementById('ob-activity').value || 'moderate';

  // If step 4 was never rendered, calculate defaults now
  if (!obQuickFoods.length) {
    obQuickFoods = getSmartQuickFoods(goal, glp1);
  }

  // Grab targets — use field values if available, otherwise calculate
  let protein = null, calFloor = null, calCeil = null, water = waterGoal;
  const tProtein = document.getElementById('ob-t-protein');
  const tCalFloor = document.getElementById('ob-t-calfloor');
  const tCalCeil = document.getElementById('ob-t-calceil');
  const tWater = document.getElementById('ob-t-water');

  if (tProtein && tCalFloor && tCalCeil && tWater) {
    protein = parseInt(tProtein.value) || null;
    calFloor = parseInt(tCalFloor.value) || null;
    calCeil = parseInt(tCalCeil.value) || null;
    water = parseInt(tWater.value) || waterGoal;
  } else {
    // Calculate smart defaults if step 4 was skipped
    const defaults = calcSmartDefaults(weight, activity, goal, glp1, waterGoal);
    protein = defaults.protein;
    calFloor = defaults.calFloor;
    calCeil = defaults.calCeil;
    water = defaults.water;
  }

  return {
    id: Date.now(),
    name: document.getElementById('ob-name').value.trim() || 'Friend',
    age: document.getElementById('ob-age').value || '30-50',
    sex: document.getElementById('ob-sex').value || 'prefer-not',
    weight,
    activity,
    goal,
    supGoals: selChips('ob-chips'),
    conditions: document.getElementById('ob-cond').value || 'none',
    meds: document.getElementById('ob-meds').classList.contains('on'),
    glp1,
    waterGoal: water,
    whoopClientId: '',
    briefTone: 'direct',
    onboarded: true,
    targets: { protein, calFloor, calCeil, water, bedtime: null, wake: null },
    quickFoods: [...obQuickFoods],
    data: { stack: [], logs: {}, savedMeals: [], briefs: [] },
  };
}
function skipOb() {
  const defaults = calcSmartDefaults('', 'moderate', 'wellness', 'no', 80);
  S.hasOnboarded = true;
  S.profiles = [{
    id: Date.now(),
    name: 'Friend',
    onboarded: true,
    waterGoal: 80,
    goal: 'wellness',
    briefTone: 'direct',
    targets: { protein: defaults.protein, calFloor: defaults.calFloor, calCeil: defaults.calCeil, water: 80, bedtime: null, wake: null },
    quickFoods: getSmartQuickFoods('wellness', 'no'),
    data: { stack: [], logs: {}, savedMeals: [], briefs: [] }
  }];
  S.activeId = 0; save();
  document.getElementById('ob').classList.add('hidden');
  initApp();
}
function selChips(id) { return Array.from(document.querySelectorAll('#' + id + ' .chip.sel')).map(c => c.dataset.v); }
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => c.classList.toggle('sel')));

// ══════════════════════════════════════
// THEME
// ══════════════════════════════════════
function toggleTheme() {
  S.isDark = !S.isDark; applyTheme(); save();
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.isDark ? 'dark' : 'light');
  document.getElementById('themeBtn').textContent = S.isDark ? '🌙' : '☀️';
  const pt = document.getElementById('p-theme');
  if (pt) pt.classList.toggle('on', !S.isDark);
}

// ══════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════
function nav(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  document.getElementById('s-' + screen).classList.add('active');
  const nb = document.getElementById('nb-' + screen);
  if (nb) nb.classList.add('active');
  document.querySelector('.content').scrollTop = 0;
  closePsDrop();
  if (screen === 'home') refreshHome();
  if (screen === 'log') refreshLog();
  if (screen === 'stack') refreshStack();
  if (screen === 'profile') refreshProfile();
  if (screen === 'carlos' && !CARLOS.threadId) carlosInit();
}

// ══════════════════════════════════════
// PROFILE SWITCHER
// ══════════════════════════════════════
function togglePsDrop() { document.getElementById('psDrop').classList.toggle('open'); }
function closePsDrop() { document.getElementById('psDrop').classList.remove('open'); }
document.addEventListener('click', e => { if (!document.getElementById('psSwitcher').contains(e.target)) closePsDrop(); });

function refreshPsSwitcher() {
  const p = getP();
  const init = (p.name || '?').charAt(0).toUpperCase();
  document.getElementById('psAv').textContent = init;
  const isDefaultName = !p.name || p.name === 'Friend';
  const psNameEl = document.getElementById('psName');
  psNameEl.textContent = isDefaultName ? 'Set name' : p.name.split(' ')[0];
  if (isDefaultName) psNameEl.classList.add('ps-name-setup');
  else psNameEl.classList.remove('ps-name-setup');
  document.getElementById('psList').innerHTML = S.profiles.map((prof, i) => {
    const pi = (prof.name || '?').charAt(0).toUpperCase();
    return '<div class="ps-drop-item ' + (i === S.activeId ? 'cur' : '') + '" onclick="switchProfile(' + i + ')"><div class="psd-av">' + pi + '</div><div class="psd-name">' + (prof.name || 'Profile') + '</div></div>';
  }).join('');
}

function switchProfile(idx) {
  S.activeId = idx; save(); closePsDrop();
  refreshPsSwitcher(); refreshHome(); refreshLog(); refreshStack();
}

function openAddProfile() { closePsDrop(); document.getElementById('addProfileModal').classList.add('open'); }

function addProfile() {
  const name = document.getElementById('np-name').value.trim() || 'Family Member';
  S.profiles.push({
    id: Date.now(), name,
    age: document.getElementById('np-age').value,
    goal: document.getElementById('np-goal').value,
    waterGoal: parseInt(document.getElementById('np-water').value) || 80,
    onboarded: true,
    data: { stack: [], logs: {}, savedMeals: [], briefs: [] },
  });
  S.activeId = S.profiles.length - 1; save();
  closeModal('addProfileModal');
  refreshPsSwitcher(); refreshHome();
  document.getElementById('np-name').value = '';
}

// ══════════════════════════════════════
// DAILY BRIEF — THE CORE FEATURE
// ══════════════════════════════════════
let currentBriefWins = [];

async function generateBrief() {
  document.getElementById('briefEmpty').style.display = 'none';
  document.getElementById('briefLoading').style.display = 'flex';
  document.getElementById('briefContent').style.display = 'none';
  document.getElementById('dtBadge').textContent = 'Generating...';
  document.getElementById('dtBadge').className = 'dt-badge loading';

  const p = getP();
  const pd = getPD();
  const log = getLog(S.logDate);
  const yestDate = new Date(); yestDate.setDate(yestDate.getDate() - 1);
  const yest = getLog(yestDate.toISOString().split('T')[0]);

  const todayCal = (log.foods || []).reduce((s,f) => s + (f.calories||0), 0);
  const todayPro = (log.foods || []).reduce((s,f) => s + (f.protein||0), 0);
  const yestCal = (yest.foods || []).reduce((s,f) => s + (f.calories||0), 0);
  const yestPro = (yest.foods || []).reduce((s,f) => s + (f.protein||0), 0);
  const water = log.water || 0;
  const waterGoal = p.waterGoal || 80;
  const stack = pd.stack || [];
  const checkin = yest.checkin || null;
  const w = _whoopData?.latest ?? null;

  // ── Pre-classify recovery zone from Whoop data ─────────────────────────────
  const whoopConnected = !!w;
  const recovery = w?.recovery_score ?? null;
  const hrv      = w?.hrv_ms      != null ? Math.round(w.hrv_ms)       : null;
  const rhr      = w?.rhr_bpm     ?? null;
  const sleepPct = w?.sleep_performance ?? null;
  const sleepHrs = w?.sleep_hours ?? null;
  const sleepCon = w?.sleep_consistency ?? null;
  const strain   = w?.day_strain  != null ? parseFloat(w.day_strain.toFixed(1)) : null;

  const zone = recovery != null
    ? recovery >= 67 ? 'green' : recovery >= 34 ? 'yellow' : 'red'
    : null;
  const determinedDayType = zone === 'green' ? 'Push' : zone === 'yellow' ? 'Baseline' : zone === 'red' ? 'Recovery' : null;

  // ── Zone-specific brief instructions ──────────────────────────────────────
  const zoneGuidance = !zone ? '' : zone === 'green' ? `
DAY TYPE: PUSH — Recovery ${recovery}% (Green zone, ≥67)
Body is ready. Lean in.
- Wins: be specific and ambitious. This is a day to hit real targets, not maintain.
- Reality/truth: name what the data says about readiness. Don't hedge.
- If protein target set, push toward ceiling not floor.
- High-output language is earned today. Use it.
- Strain yesterday was ${strain ?? 'unknown'}/21 — factor this into intensity suggestion.
` : zone === 'yellow' ? `
DAY TYPE: BASELINE — Recovery ${recovery}% (Yellow zone, 34–66)
Solid but not peak. Consistent beats heroic.
- Wins: reliable and achievable. No aggressive targets. Think "solid day."
- Reality/truth: name the specific numbers, don't just say "moderate." HRV ${hrv ?? '—'}ms, RHR ${rhr ?? '—'}bpm.
- Sleep was ${sleepHrs ?? '—'}h at ${sleepPct ?? '—'}% performance — reference this if relevant.
- Don't push nutrition or activity harder than the data supports.
- Strain yesterday was ${strain ?? 'unknown'}/21 — if low, mild activity is fine; if high, rest.
` : `
DAY TYPE: RECOVERY — Recovery ${recovery}% (Red zone, <34)
Pull back. The body is telling you something.
- Wins: rest, food, water. No performance targets.
- Reality/truth: be direct that today is a maintenance day, not a build day. Don't soften this.
- Explicitly deprioritize intensity. This is not laziness — it's the data.
- Sleep ${sleepHrs ?? '—'}h at ${sleepPct ?? '—'}% — this matters. Prioritize earlier bedtime tonight.
- HRV ${hrv ?? '—'}ms, RHR ${rhr ?? '—'}bpm — if RHR is elevated, name it.
- Strain yesterday ${strain ?? 'unknown'}/21 — if strain was high, that's likely why recovery is low.
`;

  // ── HRV context signal ─────────────────────────────────────────────────────
  const hrvSignal = hrv == null ? '' : hrv >= 55
    ? `HRV ${hrv}ms — elevated. Strong autonomic readiness.`
    : hrv >= 40
    ? `HRV ${hrv}ms — normal range. No alarm.`
    : `HRV ${hrv}ms — suppressed. Body under stress. Reduce load.`;

  // ── Build the context ──────────────────────────────────────────────────────
  const briefHour = new Date().getHours();
  const timingCtx = briefHour < 8
    ? 'Before 8am — use "within the first hour of your morning" not "within 30 minutes."'
    : briefHour < 12 ? 'Morning — "before noon", "by lunch" appropriate.'
    : briefHour < 17 ? 'Afternoon — "before dinner", "this afternoon."'
    : 'Evening — focus on what can still be done before bed.';

  const context = `== PROFILE ==
${p.name || 'User'} | ${p.age || 'adult'} | ${p.sex || ''} | ${p.weight ? p.weight + ' lbs' : ''} | ${p.activity || 'moderate'} activity
Goal: ${p.goal || 'general wellness'} | GLP-1: ${p.glp1 || 'no'} | Conditions: ${p.conditions || 'none'}
Water goal: ${waterGoal} oz${p.targets?.protein ? ' | Protein target: ' + p.targets.protein + 'g' : ''}${p.targets?.calFloor ? ' | Cal floor: ' + p.targets.calFloor : ''}${p.targets?.calCeil ? ' | Cal ceiling: ' + p.targets.calCeil : ''}
Stack: ${stack.length ? stack.map(s => s.name).join(', ') : 'none'}
${p.quickFoods?.length ? 'Favorite foods: ' + p.quickFoods.map(f => f.name).join(', ') : ''}

== WHOOP BIOMETRICS (${w?.date || 'today'}) ==
${whoopConnected ? `Recovery:   ${recovery}% — ${zone === 'green' ? 'GREEN (ready)' : zone === 'yellow' ? 'YELLOW (moderate)' : 'RED (pull back)'}
HRV:        ${hrv ?? '—'}ms  ${hrvSignal}
Resting HR: ${rhr ?? '—'} bpm${rhr && rhr > 70 ? ' (elevated — note this)' : ''}
Sleep:      ${sleepHrs ?? '—'}h | Performance ${sleepPct ?? '—'}% | Consistency ${sleepCon ?? '—'}%
Strain (yesterday): ${strain ?? '—'}/21` : 'NOT CONNECTED — base day type on nutrition and check-in data only.'}

== NUTRITION ==
Today: ${todayCal} cal | ${todayPro}g protein | ${water} oz water
Yesterday: ${yestCal} cal | ${yestPro}g protein | ${yest.water || 0} oz water
${checkin ? 'Check-in: day ' + checkin.day + ' | water ' + checkin.water + ' | food ' + checkin.food : 'No check-in from yesterday.'}
${log.metrics?.weight ? 'Weight: ' + log.metrics.weight + ' lbs' : ''}

Timing: ${timingCtx}`;

  const tone = p.briefTone || 'direct';
  const toneInstructions = tone === 'gentle'
    ? 'Voice: Warm but honest. Acknowledge challenges with care. Supportive without cheerleading. Short sentences. No em dashes.'
    : 'Voice: Direct, calm, honest, slightly blunt. Never preachy or motivational. Respect the user enough to tell the truth. Short sentences. No em dashes.';

  const system = `You are Baseline — the adult in the room. Read the biometric and nutrition data and write a specific, honest daily brief.

${toneInstructions}

${zoneGuidance}

${!zone ? `Day type rules (no Whoop data):
- Push: good nutrition, on track, user has momentum
- Baseline: mixed signals, maintain consistency
- Recovery: under-eating, low hydration, rough check-in` : `The day type is DETERMINED by recovery score above. Output it exactly as given. Do not override it.`}

REALITY must reference specific numbers from the data — not generic observations.
TRUTH must name the practical implication for today — what this actually means for how to move through the day.
WINS must be concrete and timed. No vague targets. Use actual numbers from the profile (protein target, water goal, cal targets).
${p.glp1 && p.glp1 !== 'no' ? 'GLP-1 protocol: prioritize early eating window, liquid calories, electrolytes. Wins must reflect this.' : ''}

Return ONLY valid JSON — no markdown, no backticks:
{
  "day_type": "${determinedDayType || 'Push | Baseline | Recovery'}",
  "reality": "1-2 sentences. Specific numbers. What is actually true right now.",
  "truth": "1-2 sentences. What this means in practice today.",
  "wins": ["specific timed win 1", "specific timed win 2", "specific timed win 3"],
  "use_what_works": ["food or action 1", "food or action 2", "food or action 3"],
  "grocery_list": ["item 1", "item 2", "item 3", "item 4", "item 5"]
}

Win examples: "Hit ${p.targets?.protein || 100}g protein before dinner", "Drink 32oz before noon", "In bed by 10pm — HRV recovery in progress"
Use what works: pull from favorite foods if set. Simple, repeatable.`;

  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: context }]
      })
    });

    if (!res.ok) throw new Error('API error ' + res.status);
    const data = await res.json();
    const raw = data.content[0].text.trim();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); else throw new Error('Parse failed'); }

    renderBrief(parsed);
    saveBriefToHistory(parsed);

  } catch(err) {
    document.getElementById('briefLoading').style.display = 'none';
    document.getElementById('briefEmpty').style.display = 'block';
    document.getElementById('briefEmpty').querySelector('.brief-empty-head').textContent = 'Could not generate brief.';
    document.getElementById('briefEmpty').querySelector('.brief-empty-body').textContent = 'Check your connection and try again. ' + err.message;
  }
}

function renderBrief(data) {
  // reset compact state on new render
  const log = getLog(S.logDate);
  log.briefDismissed = false;
  document.getElementById('briefCompact').style.display = 'none';
  document.getElementById('briefCard').style.display = 'block';

  const dt = (data.day_type || 'Baseline').toLowerCase();
  const badge = document.getElementById('dtBadge');
  badge.textContent = data.day_type || 'Baseline Day';
  badge.className = 'dt-badge ' + dt;

  document.getElementById('briefReality').textContent = data.reality || '';
  document.getElementById('briefTruth').textContent = data.truth || '';

  currentBriefWins = data.wins || [];
  const winsList = document.getElementById('winsList');
  winsList.innerHTML = (data.wins || []).map((w, i) => `
    <div class="win-item" id="win-${i}" onclick="toggleWin(${i})">
      <div class="win-check" id="wincheck-${i}"></div>
      <div class="win-text">${w}</div>
    </div>`).join('');

  // restore checked win states
  (log.briefWins || []).forEach((done, i) => {
    if (done) {
      const item = document.getElementById('win-' + i);
      const check = document.getElementById('wincheck-' + i);
      if (item) item.classList.add('done');
      if (check) check.textContent = '✓';
    }
  });

  const uww = document.getElementById('useWhatWorks');
  if (data.use_what_works && data.use_what_works.length) {
    uww.style.display = 'block';
    document.getElementById('uwwItems').innerHTML = data.use_what_works.map(item =>
      `<div class="uww-item" onclick="logQuickFromBrief('${item.replace(/'/g, "\\'")}')">+ ${item}</div>`
    ).join('');
  } else {
    uww.style.display = 'none';
  }

  window.currentGroceryList = data.grocery_list || [];
  document.getElementById('briefLoading').style.display = 'none';
  document.getElementById('briefContent').style.display = 'block';
}

function renderBriefFromHistory(brief, wins) {
  const dt = (brief.dayType || 'Baseline').toLowerCase();
  document.getElementById('dtBadge').textContent = brief.dayType || 'Baseline Day';
  document.getElementById('dtBadge').className = 'dt-badge ' + dt;
  document.getElementById('briefReality').textContent = brief.reality || '';
  document.getElementById('briefTruth').textContent = brief.truth || '';
  currentBriefWins = brief.wins || [];
  document.getElementById('winsList').innerHTML = (brief.wins || []).map((w, i) => {
    const done = wins[i] || false;
    return '<div class="win-item' + (done ? ' done' : '') + '" id="win-' + i + '" onclick="toggleWin(' + i + ')"><div class="win-check" id="wincheck-' + i + '">' + (done ? '✓' : '') + '</div><div class="win-text">' + w + '</div></div>';
  }).join('');
  const uww = document.getElementById('useWhatWorks');
  if (brief.use_what_works && brief.use_what_works.length) {
    uww.style.display = 'block';
    document.getElementById('uwwItems').innerHTML = brief.use_what_works.map(item =>
      '<div class="uww-item" onclick="logQuickFromBrief(\'' + item.replace(/'/g, "\\'") + '\')">+ ' + item + '</div>'
    ).join('');
  } else { uww.style.display = 'none'; }
  document.getElementById('briefEmpty').style.display = 'none';
  document.getElementById('briefLoading').style.display = 'none';
  document.getElementById('briefContent').style.display = 'block';
}

function toggleWin(i) {
  const item = document.getElementById('win-' + i);
  item.classList.toggle('done');
  const check = document.getElementById('wincheck-' + i);
  check.textContent = item.classList.contains('done') ? '✓' : '';
  const log = getLog(S.logDate);
  if (!log.briefWins) log.briefWins = [false, false, false];
  log.briefWins[i] = item.classList.contains('done');
  save();
}

function saveBriefToHistory(data) {
  const pd = getPD();
  if (!pd.briefs) pd.briefs = [];
  pd.briefs.unshift({
    date: S.logDate,
    displayDate: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    dayType: data.day_type || 'Baseline',
    reality: data.reality || '',
    truth: data.truth || '',
    wins: data.wins || [],
    use_what_works: data.use_what_works || [],
  });
  if (pd.briefs.length > 14) pd.briefs = pd.briefs.slice(0, 14);
  save();
  refreshBriefHistory();
}

function dismissBrief() {
  const log = getLog(S.logDate);
  log.briefDismissed = true;
  save();
  const pd = getPD();
  const todayBrief = (pd.briefs || []).find(b => b.date === S.logDate);
  if (todayBrief) {
    document.getElementById('briefCard').style.display = 'none';
    showBriefCompact(todayBrief, log.briefWins || []);
  }
}

function expandBrief() {
  const log = getLog(S.logDate);
  log.briefDismissed = false;
  save();
  document.getElementById('briefCompact').style.display = 'none';
  document.getElementById('briefCard').style.display = 'block';
  (log.briefWins || []).forEach((done, i) => {
    const item = document.getElementById('win-' + i);
    const check = document.getElementById('wincheck-' + i);
    if (item) { if (done) item.classList.add('done'); else item.classList.remove('done'); }
    if (check) check.textContent = done ? '✓' : '';
  });
}

function showBriefCompact(brief, wins) {
  const compact = document.getElementById('briefCompact');
  compact.style.display = 'block';
  const dt = (brief.dayType || 'Baseline').toLowerCase();
  document.getElementById('bcBadge').textContent = brief.dayType || 'Baseline';
  document.getElementById('bcBadge').className = 'dt-badge ' + dt;
  document.getElementById('bcWins').innerHTML = (brief.wins || []).map((w, i) => {
    const done = wins[i] || false;
    return '<div class="bc-win" onclick="event.stopPropagation();toggleCompactWin(' + i + ')"><div class="bc-check' + (done ? ' done' : '') + '" id="bcc-' + i + '">' + (done ? '&#10003;' : '') + '</div><div class="bc-win-text' + (done ? ' done' : '') + '" id="bct-' + i + '">' + w + '</div></div>';
  }).join('');
}

function toggleCompactWin(i) {
  const log = getLog(S.logDate);
  if (!log.briefWins) log.briefWins = [false, false, false];
  log.briefWins[i] = !log.briefWins[i];
  save();
  const check = document.getElementById('bcc-' + i);
  const text = document.getElementById('bct-' + i);
  if (check) {
    if (log.briefWins[i]) { check.classList.add('done'); check.innerHTML = '&#10003;'; }
    else { check.classList.remove('done'); check.innerHTML = ''; }
  }
  if (text) {
    if (log.briefWins[i]) text.classList.add('done'); else text.classList.remove('done');
  }
}

function refreshBriefHistory() {
  const pd = getPD();
  const el = document.getElementById('briefHistory');
  if (!pd.briefs || !pd.briefs.length) {
    el.innerHTML = '<div class="emp"><div class="emp-t">No briefs yet</div><div class="emp-s">Generate your first brief above.</div></div>';
    return;
  }
  el.innerHTML = pd.briefs.slice(0, 7).map(b => {
    const dt = (b.dayType || 'baseline').toLowerCase();
    return `<div class="bh-item">
      <div class="bh-top"><div class="bh-date">${b.displayDate || b.date}</div><div class="bh-type ${dt}">${b.dayType}</div></div>
      <div class="bh-reality">${b.reality}</div>
      <div class="bh-wins">${(b.wins || []).map(w => `<div class="bh-win">${w}</div>`).join('')}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════
// CHECK-IN
// ══════════════════════════════════════
function toggleCheckin() { document.getElementById('ciBody').classList.toggle('open'); }

function selCI(type, val, el) {
  S.ciAnswers[type] = val;
  const parent = el.parentElement;
  parent.querySelectorAll('.copt').forEach(c => c.className = 'copt');
  const cls = val === 'good' || val === 'yes' ? 'sel-g' : val === 'okay' || val === 'almost' || val === 'light' ? 'sel-o' : 'sel-r';
  el.className = 'copt ' + cls;
}

function submitCI() {
  if (!S.ciAnswers.day && !S.ciAnswers.water && !S.ciAnswers.food) {
    toast('Select at least one answer first', 'warn'); return;
  }
  const targetDate = S.ciTargetDate || S.logDate;
  const log = getLog(targetDate);
  log.checkin = S.ciAnswers;
  save();
  document.getElementById('ciDone').innerHTML = '&#10003; Done';
  document.getElementById('ciBody').classList.remove('open');
  S.ciAnswers = {};
  S.ciTargetDate = null;
  refreshHome();
  toast('Check-in saved');
}

function openCatchUpCheckin() {
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  S.ciTargetDate = yd.toISOString().split('T')[0];
  document.getElementById('catchUpPrompt').style.display = 'none';
  const card = document.getElementById('checkinCard');
  card.style.display = 'block';
  card.classList.add('ci-evening-mode');
  document.getElementById('ciBody').classList.add('open');
}

function skipCatchUp() {
  document.getElementById('catchUpPrompt').style.display = 'none';
}

// ══════════════════════════════════════
// DON'T FEEL LIKE EATING
// ══════════════════════════════════════
function openDnfle() { refreshDnfle(); document.getElementById('dnfleModal').classList.add('open'); }

function logQuick(name, portion, cal, pro, carb, fat, caff) {
  const log = getLog(S.logDate);
  log.foods.push({ name, portion, calories: cal, protein: pro, carbs: carb, fat: fat, caffeine: caff });
  save(); refreshLog(); refreshHome();
  closeModal('dnfleModal');
  toast('Logged: ' + name);
}

function logQuickFromBrief(name) {
  const log = getLog(S.logDate);
  log.foods.push({ name, portion: '1 serving', calories: 0, protein: 0, carbs: 0, fat: 0, caffeine: 0 });
  save(); refreshLog(); refreshHome();
}

// ══════════════════════════════════════
// INSTACART
// ══════════════════════════════════════
function openInstacart() {
  const list = window.currentGroceryList || ['protein', 'greek yogurt', 'eggs', 'tuna', 'electrolytes'];
  const query = list.slice(0, 4).join(', ');
  const url = 'https://www.instacart.com/store?utm_source=baseline&search=' + encodeURIComponent(query);
  window.open(url, '_blank');
  closeModal('dnfleModal');
}

// ══════════════════════════════════════
// HOME
// ══════════════════════════════════════
function refreshHome() {
  const p = getP();
  const pd = getPD();
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const n = p.name || '';
  document.getElementById('greeting').innerHTML = g + (n ? ', <em>' + n + '.</em>' : '.');
  document.getElementById('homeDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const log = getLog(S.logDate);
  document.getElementById('sScans').textContent = (pd.stack || []).length;
  document.getElementById('sWater').textContent = log.water || 0;
  document.getElementById('sStack').textContent = (pd.stack || []).length;
  const cal = (log.foods || []).reduce((s,f) => s + (f.calories||0), 0);
  document.getElementById('sCal').textContent = cal;
  refreshPsSwitcher();
  refreshBriefHistory();

  // Restore brief display state (handles page reload / profile switch)
  const todayBrief = (pd.briefs || []).find(b => b.date === S.logDate);
  const briefCardEl = document.getElementById('briefCard');
  const briefCompactEl = document.getElementById('briefCompact');
  if (todayBrief && log.briefDismissed) {
    briefCardEl.style.display = 'none';
    showBriefCompact(todayBrief, log.briefWins || []);
  } else if (todayBrief && document.getElementById('briefContent').style.display !== 'block') {
    briefCompactEl.style.display = 'none';
    briefCardEl.style.display = 'block';
    renderBriefFromHistory(todayBrief, log.briefWins || []);
  } else {
    briefCompactEl.style.display = 'none';
    briefCardEl.style.display = 'block';
  }

  // Time-gate check-in card (evening only: 7pm+)
  const isEvening = new Date().getHours() >= 19;
  const ciCard = document.getElementById('checkinCard');
  if (ciCard) {
    ciCard.style.display = isEvening ? 'block' : 'none';
    if (isEvening) ciCard.classList.add('ci-evening-mode'); else ciCard.classList.remove('ci-evening-mode');
  }
  // Restore done state across reloads
  const ciDoneEl = document.getElementById('ciDone');
  if (ciDoneEl) ciDoneEl.innerHTML = log.checkin ? '&#10003; Done' : '';
  // Morning catch-up: show if pre-7pm and yesterday had no check-in
  const cup = document.getElementById('catchUpPrompt');
  if (cup) {
    const yd = new Date(); yd.setDate(yd.getDate() - 1);
    const yestLog = getLog(yd.toISOString().split('T')[0]);
    cup.style.display = (!isEvening && !yestLog.checkin) ? 'block' : 'none';
  }
}

function refreshProfileUI() {
  const p = getP();
  const init = (p.name || '?').charAt(0).toUpperCase();
  document.getElementById('pAv').textContent = init;
  document.getElementById('pName').textContent = p.name || 'Set up profile';
  const gm = { 'weight-loss': 'Weight management', 'muscle': 'Build muscle', 'energy': 'Improve energy', 'sleep': 'Better sleep', 'glp1': 'GLP-1 support', 'performance': 'Athletic performance', 'recovery': 'Recovery', 'wellness': 'General wellness' };
  document.getElementById('pGoal').textContent = gm[p.goal] || 'Set your goals';
}

// ══════════════════════════════════════
// ANALYZE
// ══════════════════════════════════════
document.getElementById('aImg').addEventListener('change', e => { if (e.target.files[0]) procAImg(e.target.files[0]); });
document.getElementById('aZone').addEventListener('dragover', e => { e.preventDefault(); document.getElementById('aZone').style.borderColor = 'rgba(212,240,0,0.5)'; });
document.getElementById('aZone').addEventListener('dragleave', () => { document.getElementById('aZone').style.borderColor = ''; });
document.getElementById('aZone').addEventListener('drop', e => { e.preventDefault(); document.getElementById('aZone').style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) procAImg(f); });
document.getElementById('aRm').addEventListener('click', () => { S.analyzeImg = null; document.getElementById('aPreview').style.display = 'none'; document.getElementById('aZone').style.display = 'block'; });

// Compress image before storing — keeps under Netlify function 6MB limit
function compressImg(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function procAImg(file) {
  compressImg(file, 1024, 0.7).then(compressed => {
    S.analyzeImg = compressed;
    document.getElementById('aPrevImg').src = compressed;
    document.getElementById('aPreview').style.display = 'block';
    document.getElementById('aZone').style.display = 'none';
  });
}

let sTmr = null;
function startSteps() {
  ['ss1','ss2','ss3','ss4'].forEach(id => { const el = document.getElementById(id); el.classList.remove('active','done'); });
  document.getElementById('ss1').classList.add('active');
  let i = 1;
  sTmr = setInterval(() => {
    if (i < 4) { document.getElementById('ss' + i).classList.remove('active'); document.getElementById('ss' + i).classList.add('done'); document.getElementById('ss' + (i+1)).classList.add('active'); i++; }
  }, 2200);
}
function stopSteps() { if (sTmr) clearInterval(sTmr); }

function scCls(n) { return n >= 70 ? 'g' : n >= 40 ? 'o' : 'r'; }
function scoreContext(n) { return n >= 80 ? 'Excellent' : n >= 70 ? 'Solid' : n >= 60 ? 'Adequate' : 'Weak'; }

function estimateCaffeine(name) {
  const n = name.toLowerCase();
  if (/energy drink|red bull|monster|bang|celsius|prime/.test(n)) return -1;
  if (/espresso/.test(n)) return 64;
  if (/coffee|cold brew|americano|latte|cappuccino|macchiato|cortado/.test(n)) return 90;
  if (/green tea/.test(n)) return 40;
  if (/black tea/.test(n)) return 45;
  if (/decaf/.test(n)) return 5;
  if (/tea/.test(n)) return 25;
  return 0;
}

function autoEstimateCaff(name) {
  const hint = document.getElementById('caffHint');
  const override = document.getElementById('caffOverride');
  const btn = document.getElementById('caffToggleBtn');
  if (!hint) return;
  const caff = estimateCaffeine(name);
  if (caff === -1) {
    hint.textContent = 'Energy drink — enter caffeine manually';
    hint.style.display = 'block';
    override.style.display = 'block';
    btn.style.display = 'none';
  } else if (caff > 0) {
    hint.textContent = 'Est. ' + caff + 'mg caffeine auto-applied';
    hint.style.display = 'block';
    override.style.display = 'none';
    btn.style.display = 'inline';
  } else {
    hint.style.display = 'none';
    override.style.display = 'none';
    btn.style.display = 'inline';
  }
}

function toggleCaffOverride() {
  const el = document.getElementById('caffOverride');
  const btn = document.getElementById('caffToggleBtn');
  const visible = el.style.display !== 'none';
  el.style.display = visible ? 'none' : 'block';
  btn.textContent = visible ? '+ set caffeine manually' : '− hide caffeine field';
}
function rcCls(r) {
  const s = (r||'').toLowerCase();
  if (s.includes('effective') || s.includes('solid') || s.includes('strong')) return 'g';
  if (s.includes('underdosed') || s.includes('low dose') || s.includes('token') || s.includes('poor') || s.includes('weak')) return 'r';
  if (s.includes('interaction')) return 'x';
  if (s.includes('informational')) return 'i';
  return 'o';
}

async function runAnalysis() {
  const name = document.getElementById('aName').value.trim();
  const text = document.getElementById('aText').value.trim();
  if (!S.analyzeImg && !text) { alert('Upload a label photo or paste ingredients first.'); return; }
  document.getElementById('aForm').style.display = 'none';
  document.getElementById('aLoading').style.display = 'flex';
  document.getElementById('aResults').style.display = 'none';
  startSteps();
  const p = getP();
  const pd = getPD();
  const pCtx = p.name ? 'User: ' + (p.age||'adult') + ', ' + (p.sex||'') + ', ' + (p.activity||'moderate') + ' activity, goal: ' + (p.goal||'wellness') + ', ' + (p.meds ? 'takes prescription medications' : 'no medications') + ', conditions: ' + (p.conditions||'none') + ', GLP-1: ' + (p.glp1||'no') + '.' : '';
  const uc = document.getElementById('aUseCase').value;
  const stackNames = (pd.stack||[]).map(s => s.name).join(', ');
  const existing = (pd.stack||[]).find(s => s.name.toLowerCase() === name.toLowerCase());
  const system = `You are Baseline — an independent honest supplement analyzer. No financial relationships with any brand. Your only job is the plain truth.
${pCtx}${uc ? ' Evaluate specifically for: ' + uc + '.' : ''}${stackNames ? ' Current stack: ' + stackNames + '. Note overlaps.' : ''}

Return ONLY valid JSON:
{
  "product_name": "string",
  "overall_score": number (0-100),
  "summary": "string (2-4 sentences, honest plain English)",
  "ingredients": [{"name":"string","dose":"string","rating":"Effective|Solid|Adequate|Low Dose|Underdosed|Token Amount|Informational|Known Interaction","explanation":"string"}],
  "flags": [{"type":"good|warn|bad|interaction","text":"string"}],
  "stack_notes": "string or null"
}
Scoring — apply DETERMINISTICALLY. The same ingredient list must score within 5 points on any rescan:
Start at 50. Adjust per ingredient based on clinical dose evidence:
  +6 to +10: ingredient at or above effective clinical dose with good bioavailability form
  +3 to +5: ingredient at 75-99% of effective dose, or solid but not optimal form
  +1 to +2: ingredient at 50-74% of effective dose (adequate but light)
  -2 to -5: ingredient clearly underdosed (<50% of clinical dose)
  -5 to -10: token/label-dressing dose (cosmetic only, no physiological effect)
  -10 to -15: proprietary blend hiding doses
  -10 to -20: known drug interaction
  -2: poor bioavailability form (e.g. oxide, carbonate where chelate exists)
Final band meanings: 80-100 well-dosed actives throughout. 60-79 mostly effective, minor gaps. 40-59 mixed — some good, some underdosed. 20-39 mostly underdosed or blends. 0-19 misleading doses throughout.
Be conservative — when dose evidence is ambiguous, score toward the lower end of the band.
Flag drug interactions as interaction type, neutral language, recommend prescriber.
Flag proprietary blends. Flag suspicious serving size math.
Return ONLY JSON.`;
  const msgs = [];
  if (S.analyzeImg) {
    const b64 = S.analyzeImg.split(',')[1];
    const mime = S.analyzeImg.split(';')[0].split(':')[1];
    msgs.push({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: 'Analyze this supplement.' + (name ? ' Product: ' + name + '.' : '') + (text ? ' Additional: ' + text : '') }] });
  } else {
    msgs.push({ role: 'user', content: 'Analyze this supplement.' + (name ? ' Product: ' + name + '.' : '') + '\n\nIngredients:\n' + text });
  }
  try {
    const res = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system, messages: msgs }) });
    stopSteps();
    if (!res.ok) throw new Error('Error ' + res.status);
    const data = await res.json();
    const raw = data.content[0].text.trim();
    let parsed;
    try {
      // Try direct parse first
      parsed = JSON.parse(raw);
    } catch {
      try {
        // Strip markdown code blocks if present
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        try {
          // Extract just the JSON object
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) {
            // Fix common JSON issues — trailing commas
            const fixed = m[0].replace(/,\s*([}\]])/g, '$1');
            parsed = JSON.parse(fixed);
          } else throw new Error('No JSON found');
        } catch {
          // Last resort — build a minimal result from what we have
          parsed = {
            product_name: name || 'This Formula',
            overall_score: 50,
            summary: 'Analysis completed but response formatting was unusual. Try again or paste the ingredients as text for a more detailed analysis.',
            ingredients: [],
            flags: []
          };
        }
      }
    }
    renderAnalysis(parsed, name, existing);
  } catch(err) {
    stopSteps();
    document.getElementById('aLoading').style.display = 'none';
    document.getElementById('aForm').style.display = 'flex';
    alert('Analysis failed: ' + err.message);
  }
}

function renderAnalysis(data, fallback, existing) {
  const name = data.product_name || fallback || 'This Formula';
  const cls = scCls(data.overall_score);
  let compareHTML = '';
  if (existing) {
    const diff = data.overall_score - existing.score;
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    const dcls = diff > 0 ? 'color:var(--green-bright)' : diff < 0 ? 'color:var(--red)' : 'color:var(--amber)';
    compareHTML = '<div style="background:var(--raised);border:1px solid var(--border-warm);padding:12px 14px;border-left:2px solid var(--yellow);margin-bottom:4px;"><div style="font-family:DM Mono,monospace;font-size:9px;letter-spacing:0.12em;color:var(--yellow);text-transform:uppercase;margin-bottom:8px;">Rescan Comparison</div><div style="font-size:13px;color:var(--cream-muted);">Previous score: <span style="font-family:Fraunces,serif;font-size:16px;color:var(--cream-muted);text-decoration:line-through;">' + existing.score + '</span> ' + arrow + ' <span style="font-family:Fraunces,serif;font-size:18px;font-weight:700;' + dcls + '">' + data.overall_score + '</span></div>' + (Math.abs(diff) > 5 ? '<div style="font-size:11px;color:var(--cream-muted);font-style:italic;margin-top:4px;">Score ' + (diff > 0 ? 'improved' : 'dropped') + ' ' + Math.abs(diff) + ' points since last scan.</div>' : '<div style="font-size:11px;color:var(--cream-muted);font-style:italic;margin-top:4px;">Formula appears unchanged.</div>') + '</div>';
  }
  const stackNote = data.stack_notes ? '<div style="font-size:13px;line-height:1.8;color:var(--cream-dim);font-weight:300;font-style:italic;padding:12px 14px;background:var(--raised);border-left:2px solid var(--amber);">Stack note: ' + data.stack_notes + '</div>' : '';
  const flagsHTML = (data.flags||[]).map(f => { const m = f.type==='good'?'&#10003;':f.type==='interaction'?'&#9888;':f.type==='warn'?'!':'&#10007;'; return '<div class="flag-row"><div class="fm-tag ' + f.type + '">' + m + '</div><span>' + f.text + '</span></div>'; }).join('');
  const ingsHTML = (data.ingredients||[]).map(ing => { const c = rcCls(ing.rating); return '<div class="ic ' + c + '"><div class="ic-top"><div><div class="ic-name">' + ing.name + '</div><div class="ic-dose">' + (ing.dose||'') + '</div></div><div class="ic-badge ' + c + '">' + ing.rating + '</div></div><div class="ic-exp">' + ing.explanation + '</div></div>'; }).join('');
  document.getElementById('aResultsInner').innerHTML = compareHTML + '<div class="r-hdr"><div><div class="r-name">' + name + '</div><div class="r-meta">Baseline Analysis &middot; ' + new Date().toLocaleDateString() + '</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;"><div class="score-ring ' + cls + '"><div class="sr-num">' + data.overall_score + '</div><div class="sr-den">/100</div></div><div class="score-ctx ' + cls + '">' + scoreContext(data.overall_score) + '</div></div></div><div class="r-summary">' + data.summary + '</div>' + stackNote + (flagsHTML ? '<div class="rsec-lbl">Key Findings</div><div class="flags-list">' + flagsHTML + '</div>' : '') + (ingsHTML ? '<div class="rsec-lbl">Ingredients</div><div class="ing-cards">' + ingsHTML + '</div>' : '') + '<button class="btn-g" id="saveStackBtn" onclick="saveToStack(\'' + name.replace(/'/g,"\\'") + '\',' + data.overall_score + ')">+ Save to My Stack</button><div class="r-disc">For informational purposes only. Not medical advice. Consult a healthcare provider before starting any supplement.</div>';
  document.getElementById('aLoading').style.display = 'none';
  document.getElementById('aResults').style.display = 'flex';
}

function saveToStack(name, score) {
  const pd = getPD();
  if (!pd.stack) pd.stack = [];
  const idx = pd.stack.findIndex(s => s.name === name);
  if (idx >= 0) { pd.stack[idx] = { ...pd.stack[idx], score, date: new Date().toLocaleDateString(), updatedAt: Date.now() }; }
  else { pd.stack.push({ name, score, date: new Date().toLocaleDateString(), savedAt: Date.now() }); }
  save();
  const btn = document.getElementById('saveStackBtn');
  btn.textContent = idx >= 0 ? '&#10003; Stack Updated' : '&#10003; Saved to Stack';
  btn.style.background = 'var(--forest)'; btn.disabled = true;
  refreshHome();
  toast(idx >= 0 ? 'Stack updated' : name + ' saved to stack');
}

function resetAnalyze() {
  S.analyzeImg = null;
  document.getElementById('aName').value = '';
  document.getElementById('aText').value = '';
  document.getElementById('aPreview').style.display = 'none';
  document.getElementById('aZone').style.display = 'block';
  document.getElementById('aImg').value = '';
  document.getElementById('aForm').style.display = 'flex';
  document.getElementById('aLoading').style.display = 'none';
  document.getElementById('aResults').style.display = 'none';
}

// ══════════════════════════════════════
// LOG
// ══════════════════════════════════════
function refreshLog() {
  const log = getLog(S.logDate);
  const p = getP();
  document.getElementById('dateLbl').textContent = new Date(S.logDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const goal = p.waterGoal || 80;
  document.getElementById('hydAmt').textContent = log.water || 0;
  document.getElementById('hydGoalLbl').textContent = goal;
  document.getElementById('hydFill').style.width = Math.min(100, ((log.water||0)/goal)*100) + '%';
  let cal=0,pro=0,carb=0,fat=0,caff=0;
  (log.foods||[]).forEach(f => { cal+=f.calories||0; pro+=f.protein||0; carb+=f.carbs||0; fat+=f.fat||0; caff+=f.caffeine||0; });
  document.getElementById('mCal').textContent = cal;
  document.getElementById('mPro').textContent = pro + 'g';
  document.getElementById('mCarb').textContent = carb + 'g';
  document.getElementById('mFat').textContent = fat + 'g';
  document.getElementById('mCaff').textContent = caff + 'mg';
  document.getElementById('foodList').innerHTML = (log.foods||[]).length === 0 ? '' : (log.foods||[]).map((f,i) =>
    '<div class="food-item"><div><div class="fi-n">' + f.name + '</div><div class="fi-m">' + (f.portion||'') + ' &middot; ' + (f.calories||0) + ' cal &middot; ' + (f.protein||0) + 'g protein' + (f.caffeine ? ' &middot; ' + f.caffeine + 'mg caff' : '') + '</div></div><button class="fi-del" onclick="removeFood(' + i + ')">&#10005;</button></div>'
  ).join('');
  if (log.metrics) {
    if (log.metrics.weight) document.getElementById('metWeight').value = log.metrics.weight;
    if (log.metrics.energy) document.getElementById('metEnergy').value = log.metrics.energy;
    if (log.metrics.mood) document.getElementById('metMood').value = log.metrics.mood;
  } else {
    document.getElementById('metWeight').value = '';
    document.getElementById('metEnergy').value = '';
    document.getElementById('metMood').value = '';
  }
  refreshSuggestedFoods();
  refreshSavedMeals();
}

function saveMetric(type, val) {
  const log = getLog(S.logDate);
  if (!log.metrics) log.metrics = {};
  log.metrics[type] = parseFloat(val) || 0;
  save();
}

function changeDate(dir) {
  const d = new Date(S.logDate + 'T12:00:00'); d.setDate(d.getDate() + dir);
  const nd = d.toISOString().split('T')[0];
  if (nd <= today()) { S.logDate = nd; refreshLog(); }
}

function addWater(oz) {
  const log = getLog(S.logDate);
  log.water = Math.max(0, (log.water||0) + oz);
  save(); refreshLog();
  document.getElementById('sWater').textContent = log.water;
  if (oz > 0) toast(oz + ' oz logged');
}

function removeFood(idx) {
  const log = getLog(S.logDate);
  log.foods.splice(idx, 1); save(); refreshLog();
}

// FOOD METHODS
let bcStarted = false;
function openFood(method) {
  S.foodMethod = method; S.foodImg = null; S.pendingFood = null;
  const panel = document.getElementById('foodPanel');
  panel.classList.add('open');
  ['barcodeSection','imageSection','manualSection','describeSection','servingSection'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('foodResultPrev').classList.remove('show');
  document.getElementById('foodActionBtn').style.display = 'block';
  document.getElementById('foodActionBtn').textContent = 'Analyze →';
  document.getElementById('foodLogBtn').style.display = 'none';
  document.getElementById('foodSaveBtn').style.display = 'none';
  document.getElementById('describeRetryBtn').style.display = 'none';
  const titles = { barcode: '&#128247; Barcode Scan', label: '&#127991; Nutrition Label', recipe: '&#128218; Recipe Photo', plate: '&#127869; Plate Photo', manual: '&#9999; Manual Entry', describe: '&#9997;&#65039; Describe Meal' };
  document.getElementById('fpTitle').innerHTML = titles[method];
  if (method === 'barcode') { document.getElementById('barcodeSection').style.display = 'block'; document.getElementById('foodActionBtn').style.display = 'none'; startBC(); }
  else if (method === 'manual') { document.getElementById('manualSection').style.display = 'block'; document.getElementById('foodActionBtn').textContent = 'Estimate Macros →'; document.getElementById('mName').focus(); }
  else if (method === 'describe') { document.getElementById('describeSection').style.display = 'block'; document.getElementById('foodActionBtn').textContent = 'Estimate Macros →'; document.getElementById('describeText').focus(); }
  else {
    document.getElementById('imageSection').style.display = 'block';
    const icons = { label: '&#127991;', recipe: '&#128218;', plate: '&#127869;' };
    const tips = { label: 'Photo of nutrition facts', recipe: 'Recipe card, cookbook, screenshot', plate: 'Photo of your meal' };
    document.getElementById('fzI').innerHTML = icons[method];
    document.getElementById('fzT').textContent = tips[method];
    if (method === 'recipe') document.getElementById('servingSection').style.display = 'block';
    document.getElementById('foodActionBtn').textContent = method === 'plate' ? 'Estimate Plate &#8594;' : 'Read &#38; Calculate &#8594;';
  }
  panel.scrollIntoView({ behavior: 'smooth' });
}

function describeRetry() {
  S.pendingFood = null;
  document.getElementById('foodResultPrev').classList.remove('show');
  document.getElementById('foodLogBtn').style.display = 'none';
  document.getElementById('foodSaveBtn').style.display = 'none';
  document.getElementById('describeRetryBtn').style.display = 'none';
  document.getElementById('describeSection').style.display = 'block';
  document.getElementById('foodActionBtn').style.display = 'block';
  document.getElementById('foodActionBtn').textContent = 'Estimate Macros →';
  document.getElementById('describeText').focus();
}

function closeFoodPanel() {
  document.getElementById('foodPanel').classList.remove('open');
  stopBC(); S.foodImg = null; S.pendingFood = null;
  document.getElementById('foodPrev').style.display = 'none';
  document.getElementById('foodZone').style.display = 'block';
  document.getElementById('foodImg').value = '';
  document.getElementById('mName').value = '';
  document.getElementById('mAmount').value = '';
  document.getElementById('mCaff').value = '';
  document.getElementById('describeText').value = '';
  document.getElementById('caffHint').style.display = 'none';
  document.getElementById('caffOverride').style.display = 'none';
  document.getElementById('caffToggleBtn').style.display = 'inline';
}

function clearFoodImg() { S.foodImg = null; document.getElementById('foodPrev').style.display = 'none'; document.getElementById('foodZone').style.display = 'block'; document.getElementById('foodImg').value = ''; }

document.getElementById('foodImg').addEventListener('change', e => {
  if (e.target.files[0]) {
    compressImg(e.target.files[0], 1024, 0.7).then(compressed => {
      S.foodImg = compressed;
      document.getElementById('fpImg').src = compressed;
      document.getElementById('foodPrev').style.display = 'block';
      document.getElementById('foodZone').style.display = 'none';
    });
  }
});

function startBC() {
  if (bcStarted) return;
  document.getElementById('bStatus').textContent = 'Starting camera...';
  Quagga.init({ inputStream: { name: 'Live', type: 'LiveStream', target: document.getElementById('bvc'), constraints: { facingMode: 'environment' } }, decoder: { readers: ['ean_reader','upc_reader','upc_e_reader','code_128_reader'] } }, err => {
    if (err) { document.getElementById('bStatus').textContent = 'Camera unavailable — try manual entry'; return; }
    Quagga.start(); bcStarted = true; document.getElementById('bStatus').textContent = 'Point camera at barcode';
  });
  Quagga.onDetected(async result => {
    const code = result.codeResult.code; stopBC(); document.getElementById('bStatus').textContent = 'Found ' + code + ' — looking up...';
    await lookupBC(code);
  });
}
function stopBC() { if (bcStarted) { try { Quagga.stop(); } catch(e) {} bcStarted = false; } }

async function lookupBC(code) {
  try {
    const res = await fetch('https://world.openfoodfacts.org/api/v0/product/' + code + '.json');
    const data = await res.json();
    if (data.status === 1 && data.product) {
      const p = data.product; const n = p.product_name || 'Unknown Product'; const nr = p.nutriments;
      showFoodPreview({ name: n, portion: p.serving_size || '1 serving', calories: Math.round(nr['energy-kcal_serving']||nr['energy-kcal_100g']||0), protein: Math.round((nr.proteins_serving||nr.proteins_100g||0)*10)/10, carbs: Math.round((nr.carbohydrates_serving||nr.carbohydrates_100g||0)*10)/10, fat: Math.round((nr.fat_serving||nr.fat_100g||0)*10)/10, caffeine: 0 });
      document.getElementById('bStatus').textContent = 'Found: ' + n;
    } else { document.getElementById('bStatus').textContent = 'Not found — switching to manual'; setTimeout(() => openFood('manual'), 1500); }
  } catch(e) { document.getElementById('bStatus').textContent = 'Lookup failed'; setTimeout(() => openFood('manual'), 1500); }
}

function showFoodPreview(food, note) {
  S.pendingFood = food;
  document.getElementById('frpName').textContent = food.name;
  document.getElementById('frpCal').textContent = food.calories;
  document.getElementById('frpPro').textContent = (food.protein||0) + 'g';
  document.getElementById('frpCarb').textContent = (food.carbs||0) + 'g';
  document.getElementById('frpFat').textContent = (food.fat||0) + 'g';
  document.getElementById('frpCaff').textContent = (food.caffeine||0) + 'mg';
  document.getElementById('adjCal').value = food.calories;
  document.getElementById('adjPro').value = food.protein || 0;
  const noteEl = document.getElementById('frpNote');
  if (note) { noteEl.textContent = note; noteEl.style.display = 'block'; } else { noteEl.style.display = 'none'; }
  document.getElementById('foodResultPrev').classList.add('show');
  document.getElementById('foodActionBtn').style.display = 'none';
  document.getElementById('foodLogBtn').style.display = 'block';
  document.getElementById('foodSaveBtn').style.display = 'block';
}

async function foodAction() {
  const method = S.foodMethod;
  if (method === 'describe') {
    const text = document.getElementById('describeText').value.trim();
    if (!text) { toast('Describe what you ate first', 'warn'); return; }
    document.getElementById('foodActionBtn').textContent = 'Estimating...'; document.getElementById('foodActionBtn').disabled = true;
    try {
      const res = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: 'Estimate nutrition for a complete meal as described. Return ONLY JSON: {"name":"string","calories":number,"protein":number,"carbs":number,"fat":number,"caffeine":number}. Use typical restaurant/home portions if amounts not specified. Caffeine: only if a caffeinated item is present, otherwise 0. No markdown.', messages: [{ role: 'user', content: 'Meal: ' + text }] }) });
      const data = await res.json();
      const raw = data.content[0].text.trim();
      let parsed; try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }
      if (parsed) {
        showFoodPreview({ name: parsed.name || text, portion: 'full meal', calories: parsed.calories||0, protein: parsed.protein||0, carbs: parsed.carbs||0, fat: parsed.fat||0, caffeine: parsed.caffeine||0 });
      } else {
        showFoodPreview({ name: text, portion: 'full meal', calories: 0, protein: 0, carbs: 0, fat: 0, caffeine: 0 });
      }
      document.getElementById('describeRetryBtn').style.display = 'block';
    } catch(e) { showFoodPreview({ name: text, portion: 'full meal', calories: 0, protein: 0, carbs: 0, fat: 0, caffeine: 0 }); document.getElementById('describeRetryBtn').style.display = 'block'; }
    finally { document.getElementById('foodActionBtn').textContent = 'Estimate Macros →'; document.getElementById('foodActionBtn').disabled = false; }
    return;
  }
  if (method === 'manual') {
    const name = document.getElementById('mName').value.trim();
    const amount = document.getElementById('mAmount').value.trim();
    const caffOverrideVisible = document.getElementById('caffOverride').style.display !== 'none';
    const caffEst = estimateCaffeine(name);
    const caff = caffOverrideVisible ? (parseInt(document.getElementById('mCaff').value) || 0) : (caffEst > 0 ? caffEst : 0);
    if (!name) { alert('Enter a food name.'); return; }
    document.getElementById('foodActionBtn').textContent = 'Estimating...'; document.getElementById('foodActionBtn').disabled = true;
    try {
      const res = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, system: 'Estimate nutrition. Return ONLY JSON: {"calories":number,"protein":number,"carbs":number,"fat":number}. No markdown.', messages: [{ role: 'user', content: 'Nutrition for: ' + name + (amount ? ', ' + amount : '') }] }) });
      const data = await res.json();
      const macros = JSON.parse(data.content[0].text.trim());
      showFoodPreview({ name, portion: amount || '1 serving', caffeine: caff, ...macros });
    } catch(e) { showFoodPreview({ name, portion: amount||'1 serving', calories:0, protein:0, carbs:0, fat:0, caffeine:caff }); }
    finally { document.getElementById('foodActionBtn').textContent = 'Estimate Macros →'; document.getElementById('foodActionBtn').disabled = false; }
    return;
  }
  if (!S.foodImg) { alert('Take or upload a photo first.'); return; }
  document.getElementById('foodActionBtn').textContent = 'Analyzing...'; document.getElementById('foodActionBtn').disabled = true;
  const servings = parseFloat(document.getElementById('servingCount').value) || 1;
  const prompts = {
    label: 'Read this nutrition facts label. Return ONLY JSON: {"name":"string","calories":number,"protein":number,"carbs":number,"fat":number,"serving":"string","caffeine":number}. Per serving. No markdown.',
    recipe: 'Read this recipe. Calculate total nutrition divided by ' + servings + ' servings. Return ONLY JSON: {"name":"string","calories":number,"protein":number,"carbs":number,"fat":number,"serving":"string","caffeine":number}. No markdown.',
    plate: 'Estimate nutrition in this meal photo. Return ONLY JSON: {"name":"description","calories":number,"protein":number,"carbs":number,"fat":number,"serving":"estimated portion","caffeine":number,"confidence":"low|medium|high"}. No markdown.',
  };
  try {
    const b64 = S.foodImg.split(',')[1]; const mime = S.foodImg.split(';')[0].split(':')[1];
    const res = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: 'Analyze food images for nutrition. Return only valid JSON. No markdown.', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: prompts[method] }] }] }) });
    const data = await res.json();
    const raw = data.content[0].text.trim();
    let parsed; try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { name:'Food', calories:0, protein:0, carbs:0, fat:0 }; }
    const note = method === 'plate' && parsed.confidence === 'low' ? 'Low confidence estimate — adjust values as needed.' : null;
    showFoodPreview({ name: parsed.name||'Food', portion: parsed.serving||'1 serving', calories: parsed.calories||0, protein: parsed.protein||0, carbs: parsed.carbs||0, fat: parsed.fat||0, caffeine: parsed.caffeine||0 }, note);
  } catch(e) { showFoodPreview({ name:'Food', portion:'1 serving', calories:0, protein:0, carbs:0, fat:0, caffeine:0 }); }
  finally { document.getElementById('foodActionBtn').textContent = method==='plate'?'Estimate Plate →':'Read &#38; Calculate →'; document.getElementById('foodActionBtn').disabled = false; }
}

function logFoodItem() {
  if (!S.pendingFood) return;
  const adjCal = parseInt(document.getElementById('adjCal').value) || S.pendingFood.calories;
  const adjPro = parseInt(document.getElementById('adjPro').value) || S.pendingFood.protein;
  const log = getLog(S.logDate);
  log.foods.push({ ...S.pendingFood, calories: adjCal, protein: adjPro });
  save();
  closeFoodPanel(); // auto-dismiss
  refreshLog();
  refreshHome();
  toast('Logged: ' + S.pendingFood.name);
}

function saveMeal() {
  if (!S.pendingFood) return;
  const pd = getPD();
  if (!pd.savedMeals) pd.savedMeals = [];
  const adjCal = parseInt(document.getElementById('adjCal').value) || S.pendingFood.calories;
  const adjPro = parseInt(document.getElementById('adjPro').value) || S.pendingFood.protein;
  pd.savedMeals.push({ ...S.pendingFood, calories: adjCal, protein: adjPro, savedAt: Date.now() });
  save();
  document.getElementById('foodSaveBtn').textContent = '&#10003; Saved'; document.getElementById('foodSaveBtn').disabled = true;
  toast('Saved as meal');
}

let _sfFoods = [];

function refreshSuggestedFoods() {
  _sfFoods = [];
  const pd = getPD();
  const p = getP();
  const logs = pd.logs || {};

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const countMap = {};   // nameKey -> total count
  const latestMap = {};  // nameKey -> food object (most recent occurrence)
  const recentOrder = []; // nameKeys in order seen within the 7-day window

  Object.keys(logs).sort().forEach(date => {
    (logs[date].foods || []).forEach(f => {
      if (!f.name) return;
      const key = f.name.toLowerCase().trim();
      countMap[key] = (countMap[key] || 0) + 1;
      latestMap[key] = f;
      if (date >= cutoffStr && !recentOrder.includes(key)) recentOrder.push(key);
    });
  });

  const frequentKeys = new Set();
  const frequent = Object.entries(countMap)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => { frequentKeys.add(k); return latestMap[k]; });

  const recentKeys = new Set(recentOrder);
  const recent = [...recentOrder].reverse()
    .filter(k => !frequentKeys.has(k))
    .slice(0, 6)
    .map(k => latestMap[k]);

  const quickFoods = (p.quickFoods || []).filter(qf => {
    const k = qf.name.toLowerCase().trim();
    return !frequentKeys.has(k) && !recentKeys.has(k);
  });

  const wrap = document.getElementById('sfWrap');
  if (!frequent.length && !recent.length && !quickFoods.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  function chipHtml(f) {
    const idx = _sfFoods.length;
    _sfFoods.push(f);
    return '<button class="sf-chip" onclick="relogFood(' + idx + ')">' + f.name + '</button>';
  }
  function tierHtml(label, foods) {
    return '<div class="sf-tier"><div class="sf-tier-lbl">' + label + '</div><div class="sf-chips">' + foods.map(chipHtml).join('') + '</div></div>';
  }

  let html = '';
  if (frequent.length) html += tierHtml('Frequent', frequent);
  if (recent.length) html += tierHtml('Recent', recent);
  if (quickFoods.length) html += tierHtml('Quick Foods', quickFoods);
  document.getElementById('sfContent').innerHTML = html;
}

function relogFood(idx) {
  const f = _sfFoods[idx];
  if (!f) return;
  const log = getLog(S.logDate);
  log.foods.push({ name: f.name, portion: f.portion || '1 serving', calories: f.calories || 0, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0, caffeine: f.caffeine || 0 });
  save(); refreshLog(); refreshHome();
  toast('Logged: ' + f.name);
}

function refreshSavedMeals() {
  const pd = getPD();
  const wrap = document.getElementById('smWrap');
  if (!(pd.savedMeals||[]).length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  document.getElementById('smList').innerHTML = (pd.savedMeals||[]).map((m,i) =>
    '<div class="sm-item" onclick="quickLog(' + i + ')"><div><div class="sm-n">' + m.name + '</div><div class="sm-m">' + m.portion + ' &middot; ' + m.calories + 'cal &middot; ' + m.protein + 'g protein</div></div><div class="sm-add">+</div></div>'
  ).join('');
}

function quickLog(idx) {
  const pd = getPD(); const meal = pd.savedMeals[idx]; const log = getLog(S.logDate);
  log.foods.push({ ...meal }); save(); refreshLog(); refreshHome();
  toast('Logged: ' + meal.name);
}

// ══════════════════════════════════════
// STACK
// ══════════════════════════════════════
function refreshStack() {
  const pd = getPD();
  const stack = pd.stack || [];
  document.getElementById('stCnt').textContent = stack.length;
  if (!stack.length) {
    document.getElementById('stAvg').textContent = '—';
    document.getElementById('stTop').textContent = '—';
    document.getElementById('gapCard').style.display = 'none';
    document.getElementById('stackList').innerHTML = '<div class="emp"><div class="emp-i">&#128230;</div><div class="emp-t">Stack is empty</div><div class="emp-s">Analyze a supplement and save it.</div></div>';
    return;
  }
  const avg = Math.round(stack.reduce((s,i) => s+i.score,0)/stack.length);
  const top = Math.max(...stack.map(s => s.score));
  document.getElementById('stAvg').textContent = avg;
  document.getElementById('stTop').textContent = top;
  const goals = getP().supGoals || [];
  const gaps = [];
  if (goals.includes('hydration') && !stack.some(s => /hydra|electrolyte/i.test(s.name))) gaps.push('No electrolyte supplement in stack');
  if (goals.includes('sleep') && !stack.some(s => /sleep|magnesium|melatonin/i.test(s.name))) gaps.push('Sleep goal set — no sleep supplement found');
  if (goals.includes('recovery') && !stack.some(s => /recover|replenish/i.test(s.name))) gaps.push('Recovery goal — stack may be missing support');
  if (goals.includes('digestion') && !stack.some(s => /bloat|digest/i.test(s.name))) gaps.push('Digestion goal — no digestive supplement found');
  if (gaps.length) { document.getElementById('gapCard').style.display = 'block'; document.getElementById('gapItems').innerHTML = gaps.map(g => '<div class="gap-item"><div class="gap-dot"></div>' + g + '</div>').join(''); }
  else { document.getElementById('gapCard').style.display = 'none'; }
  document.getElementById('stackList').innerHTML = [...stack].reverse().map((item, ri) => {
    const idx = stack.length - 1 - ri;
    const c = scCls(item.score);
    return '<div class="li"><div class="li-l"><div class="li-n">' + item.name + '</div><div class="li-s">Score: ' + item.score + ' &middot; ' + item.date + '</div></div><div class="li-r"><div><div class="score-cls ' + c + '">' + item.score + '</div><div class="score-ctx ' + c + '">' + scoreContext(item.score) + '</div></div><button class="stack-del" onclick="event.stopPropagation();deleteStackItem(' + idx + ')" title="Remove">&#10005;</button></div></div>';
  }).join('');
}

function deleteStackItem(idx) {
  const pd = getPD();
  pd.stack.splice(idx, 1);
  save();
  refreshStack();
  refreshHome();
  toast('Removed from stack');
}

function toggleAudit() { document.getElementById('auditBody').classList.toggle('open'); }

async function runAudit() {
  const pd = getPD(); const stack = pd.stack || [];
  if (stack.length < 2) { alert('Add at least 2 products to your stack to run an audit.'); return; }
  document.getElementById('auditBtn').style.display = 'none';
  document.getElementById('auditLoading').style.display = 'block';
  document.getElementById('auditResult').innerHTML = '';
  document.getElementById('auditSt').textContent = 'Running...';
  const p = getP();
  try {
    const res = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: 'You are Baseline. Audit this supplement stack for interactions, overlaps, and redundancies. Be specific and honest. User: ' + (p.age||'adult') + ', ' + (p.meds?'takes medications':'no medications') + '. Return ONLY JSON: {"findings":[{"type":"good|warn|bad","title":"string","description":"string"}]}. Max 6 findings. No markdown.', messages: [{ role: 'user', content: 'Audit this stack: ' + stack.map(s => s.name).join(', ') }] }) });
    const data = await res.json();
    const raw = data.content[0].text.trim();
    let parsed; try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { findings: [] }; }
    document.getElementById('auditResult').innerHTML = (parsed.findings||[]).map(f => '<div class="af ' + f.type + '"><div class="af-t">' + f.title + '</div><div class="af-d">' + f.description + '</div></div>').join('');
    document.getElementById('auditSt').textContent = (parsed.findings||[]).length + ' findings';
  } catch(e) {
    document.getElementById('auditResult').innerHTML = '<div class="af-d">Audit failed. Try again.</div>';
    document.getElementById('auditBtn').style.display = 'block';
  } finally { document.getElementById('auditLoading').style.display = 'none'; }
}

// ══════════════════════════════════════
// PROFILE
// ══════════════════════════════════════
function refreshProfile() {
  refreshProfileUI();
  const p = getP();
  const nameInput = document.getElementById('p-name');
  if (p.name) nameInput.value = p.name;
  const needsName = !p.name || p.name === 'Friend';
  nameInput.style.borderColor = needsName ? 'rgba(212,240,0,0.45)' : '';
  nameInput.placeholder = needsName ? 'Add your name to personalize Baseline' : '';
  if (p.age) document.getElementById('p-age').value = p.age;
  if (p.sex) document.getElementById('p-sex').value = p.sex;
  if (p.weight) document.getElementById('p-weight').value = p.weight;
  if (p.activity) document.getElementById('p-activity').value = p.activity;
  if (p.goal) document.getElementById('p-goal').value = p.goal;
  if (p.conditions) document.getElementById('p-cond').value = p.conditions;
  if (p.waterGoal) document.getElementById('p-water').value = p.waterGoal;
  if (p.glp1) document.getElementById('p-glp1').value = p.glp1;
  if (p.whoopClientId) document.getElementById('whoopClientId').value = p.whoopClientId;
  document.getElementById('p-meds').classList.toggle('on', p.meds || false);
  document.getElementById('p-theme').classList.toggle('on', !S.isDark);
  if (p.supGoals) { document.querySelectorAll('#p-chips .chip').forEach(c => c.classList.toggle('sel', (p.supGoals||[]).includes(c.dataset.v))); }
  // Targets
  if (p.targets) {
    if (p.targets.calFloor) document.getElementById('t-calfloor').value = p.targets.calFloor;
    if (p.targets.calCeil) document.getElementById('t-calceil').value = p.targets.calCeil;
    if (p.targets.protein) document.getElementById('t-protein').value = p.targets.protein;
    if (p.targets.water) document.getElementById('t-water2').value = p.targets.water;
    if (p.targets.bedtime) document.getElementById('t-bedtime').value = p.targets.bedtime;
    if (p.targets.wake) document.getElementById('t-wake').value = p.targets.wake;
  }
  // Tone
  setToneUI(p.briefTone || 'direct');
  // Quick foods
  refreshQfList();
  refreshFamList();
}

// ══════════════════════════════════════
// MY QUICK FOODS
// ══════════════════════════════════════
const DEFAULT_QUICK_FOODS = [
  { name: 'Protein shake', icon: '🥤', portion: '16 oz', calories: 150, protein: 30 },
  { name: 'Greek yogurt', icon: '🫙', portion: '1 cup', calories: 130, protein: 17 },
  { name: 'Greek yogurt with honey and berries', icon: '🫙', portion: '1 cup', calories: 200, protein: 17 },
  { name: 'Tuna packet', icon: '🐟', portion: '1 packet', calories: 100, protein: 22 },
  { name: 'Hard boiled eggs', icon: '🥚', portion: '2 eggs', calories: 140, protein: 12 },
  { name: 'Cottage cheese', icon: '🥣', portion: '1 cup', calories: 200, protein: 28 },
  { name: 'Beef jerky', icon: '🥩', portion: '1 oz', calories: 80, protein: 13 },
  { name: 'Protein bar', icon: '🍫', portion: '1 bar', calories: 200, protein: 20 },
  { name: 'Electrolyte drink', icon: '⚡', portion: '16 oz', calories: 20, protein: 0 },
  { name: 'Banana + peanut butter', icon: '🍌', portion: '1 banana + 1 tbsp', calories: 200, protein: 5 },
  { name: 'Edamame', icon: '🫛', portion: '1 cup', calories: 190, protein: 17 },
  { name: 'Smoked salmon', icon: '🐟', portion: '3 oz', calories: 130, protein: 19 },
];

function refreshQfList() {
  const p = getP();
  const foods = p.quickFoods || [];
  const el = document.getElementById('qfList');
  if (!el) return;
  el.innerHTML = foods.length === 0
    ? '<div style="font-size:12px;color:var(--cream-muted);font-style:italic;padding:8px 0;">No quick foods set yet. Add from the options below.</div>'
    : foods.map((f, i) => `
      <div class="qf-item">
        <div class="qf-item-icon">${f.icon || '🍽️'}</div>
        <div class="qf-item-info">
          <div class="qf-item-name">${f.name}</div>
          <div class="qf-item-macros">${f.portion} &middot; ${f.calories} cal &middot; ${f.protein}g protein</div>
        </div>
        <button class="qf-item-remove" onclick="removeQuickFood(${i})">&#10005;</button>
      </div>`).join('');

  // Render default suggestions (not already added)
  const addedNames = foods.map(f => f.name.toLowerCase());
  const el2 = document.getElementById('qfDefaults');
  if (!el2) return;
  el2.innerHTML = DEFAULT_QUICK_FOODS
    .filter(f => !addedNames.includes(f.name.toLowerCase()))
    .map(f => `<div class="qf-default" onclick="addDefaultFood('${f.name.replace(/'/g,"\\'")}')"><div class="qf-default-icon">${f.icon}</div>${f.name}</div>`)
    .join('');
}

function addDefaultFood(name) {
  const df = DEFAULT_QUICK_FOODS.find(f => f.name === name);
  if (!df) return;
  const p = S.profiles[S.activeId];
  if (!p.quickFoods) p.quickFoods = [];
  if (p.quickFoods.find(f => f.name.toLowerCase() === name.toLowerCase())) return;
  p.quickFoods.push({ ...df });
  save(); refreshQfList(); refreshDnfle();
  toast(name + ' added');
}

function addQuickFood() {
  const name = document.getElementById('qf-name').value.trim();
  if (!name) { alert('Enter a food name.'); return; }
  const p = S.profiles[S.activeId];
  if (!p.quickFoods) p.quickFoods = [];
  p.quickFoods.push({
    name,
    icon: '🍽️',
    portion: document.getElementById('qf-portion').value.trim() || '1 serving',
    calories: parseInt(document.getElementById('qf-cal').value) || 0,
    protein: parseInt(document.getElementById('qf-pro').value) || 0,
  });
  save();
  document.getElementById('qf-name').value = '';
  document.getElementById('qf-cal').value = '';
  document.getElementById('qf-pro').value = '';
  document.getElementById('qf-portion').value = '';
  refreshQfList(); refreshDnfle();
  toast(name + ' added');
}

function removeQuickFood(idx) {
  const p = S.profiles[S.activeId];
  const name = (p.quickFoods || [])[idx]?.name || 'Food';
  (p.quickFoods || []).splice(idx, 1);
  save(); refreshQfList(); refreshDnfle();
  toast(name + ' removed', 'warn');
}

function refreshDnfle() {
  const el = document.getElementById('dnfleOpts');
  if (!el) return;
  const p = getP();
  const foods = (p.quickFoods && p.quickFoods.length)
    ? p.quickFoods
    : DEFAULT_QUICK_FOODS.slice(0, 5);

  el.innerHTML = foods.map(f => {
    const isElec = f.name.toLowerCase().includes('electrolyte');
    const onclick = isElec
      ? `logQuick('${f.name.replace(/'/g,"\\'")}','${f.portion}',${f.calories},${f.protein||0},0,0,0);addWater(16)`
      : `logQuick('${f.name.replace(/'/g,"\\'")}','${f.portion}',${f.calories},${f.protein||0},0,0,0)`;
    return `<div class="dnfle-opt" onclick="${onclick}"><div class="dnfle-opt-icon">${f.icon || '🍽️'}</div><div><div class="dnfle-opt-name">${f.name}</div><div class="dnfle-opt-desc">${f.portion} &middot; ${f.calories} cal &middot; ${f.protein||0}g protein</div></div></div>`;
  }).join('');
}

// ══════════════════════════════════════
// TARGETS
// ══════════════════════════════════════
function saveTargets() {
  const p = S.profiles[S.activeId];
  p.targets = {
    calFloor: parseInt(document.getElementById('t-calfloor').value) || null,
    calCeil: parseInt(document.getElementById('t-calceil').value) || null,
    protein: parseInt(document.getElementById('t-protein').value) || null,
    water: parseInt(document.getElementById('t-water2').value) || null,
    bedtime: document.getElementById('t-bedtime').value || null,
    wake: document.getElementById('t-wake').value || null,
  };
  if (p.targets.water) p.waterGoal = p.targets.water;
  save();
  document.querySelectorAll('.p-sec-body').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.psh-arr').forEach(a => a.classList.remove('open'));
  toast('Targets saved');
}

// ══════════════════════════════════════
// BRIEF TONE
// ══════════════════════════════════════
function setTone(tone) {
  setToneUI(tone);
}

function setToneUI(tone) {
  document.getElementById('tone-direct').classList.toggle('active', tone === 'direct');
  document.getElementById('tone-gentle').classList.toggle('active', tone === 'gentle');
}

function saveTone() {
  const tone = document.getElementById('tone-direct').classList.contains('active') ? 'direct' : 'gentle';
  S.profiles[S.activeId].briefTone = tone;
  save();
  document.querySelectorAll('.p-sec-body').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.psh-arr').forEach(a => a.classList.remove('open'));
  toast('Tone saved — ' + (tone === 'direct' ? 'Direct' : 'Gentle'));
}

function refreshFamList() {
  document.getElementById('famList').innerHTML = S.profiles.map((prof, i) => {
    const init = (prof.name||'?').charAt(0).toUpperCase();
    const gm = { 'weight-loss': 'Weight', 'muscle': 'Muscle', 'energy': 'Energy', 'sleep': 'Sleep', 'glp1': 'GLP-1', 'performance': 'Performance', 'recovery': 'Recovery', 'wellness': 'Wellness' };
    return '<div class="fam-item"><div class="fam-av">' + init + '</div><div class="fam-info"><div class="fam-n">' + (prof.name||'Profile') + '</div><div class="fam-g">' + (gm[prof.goal]||'General wellness') + '</div></div><button class="fam-sw ' + (i===S.activeId?'cur':'') + '" onclick="switchProfile(' + i + ')">' + (i===S.activeId?'Active':'Switch') + '</button></div>';
  }).join('');
}

function toggleSec(id) {
  const body = document.getElementById('pb-'+id); const arrow = document.getElementById('pa-'+id);
  const open = body.classList.contains('open');
  document.querySelectorAll('.p-sec-body').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.psh-arr').forEach(a => a.classList.remove('open'));
  if (!open) { body.classList.add('open'); arrow.classList.add('open'); }
}

function toggleWhoopSetup() {
  document.getElementById('pb-whoop').classList.toggle('open');
  document.getElementById('pa-whoop').classList.toggle('open');
}

function saveProfile() {
  const idx = S.activeId;
  S.profiles[idx] = {
    ...S.profiles[idx],
    name: document.getElementById('p-name').value.trim() || S.profiles[idx].name,
    age: document.getElementById('p-age').value,
    sex: document.getElementById('p-sex').value,
    weight: document.getElementById('p-weight').value,
    activity: document.getElementById('p-activity').value,
    goal: document.getElementById('p-goal').value,
    conditions: document.getElementById('p-cond').value,
    waterGoal: parseInt(document.getElementById('p-water').value)||80,
    glp1: document.getElementById('p-glp1').value,
    meds: document.getElementById('p-meds').classList.contains('on'),
    supGoals: Array.from(document.querySelectorAll('#p-chips .chip.sel')).map(c => c.dataset.v),
    onboarded: true,
  };
  save(); refreshProfileUI(); refreshPsSwitcher();
  document.querySelectorAll('.p-sec-body').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.psh-arr').forEach(a => a.classList.remove('open'));
  toast('Profile saved');
}

function saveWhoopCreds() {
  const clientId = document.getElementById('whoopClientId')?.value?.trim();
  if (clientId) { S.profiles[S.activeId].whoopClientId = clientId; save(); toast('Client ID saved'); }
}

// ══════════════════════════════════════
// WHOOP OAUTH
// ══════════════════════════════════════

let _whoopData = null; // { connected, latest, history } — loaded on init

async function loadWhoopData() {
  try {
    const res = await fetch('/api/whoop-data');
    if (!res.ok) return;
    _whoopData = await res.json();
    refreshWhoopUI();
  } catch { /* non-fatal — app works without Whoop */ }
}

function refreshWhoopUI() {
  if (!_whoopData) return;
  const { connected, latest } = _whoopData;
  const dot = document.getElementById('wDot');
  const label = document.getElementById('whoopConnectLabel');
  const disc = document.getElementById('whoopDisconnected');
  const conn = document.getElementById('whoopConnected');
  const metricsEl = document.getElementById('whoopLatestMetrics');
  const briefRow = document.getElementById('briefWhoopRow');

  if (connected) {
    if (dot) { dot.style.background = 'var(--green-bright)'; dot.style.boxShadow = '0 0 6px var(--green-bright)'; }
    if (label) label.textContent = 'Whoop — Connected';
    if (disc) disc.style.display = 'none';
    if (conn) conn.style.display = 'block';
    if (briefRow) briefRow.style.display = 'flex';
  } else {
    if (dot) { dot.style.background = ''; dot.style.boxShadow = ''; }
    if (label) label.textContent = 'Whoop';
    if (disc) disc.style.display = 'block';
    if (conn) conn.style.display = 'none';
    if (briefRow) briefRow.style.display = 'none';
    return;
  }

  if (!latest) return;

  // ── Brief header row ──────────────────────────────────
  const bwR = document.getElementById('bwR');
  const bwH = document.getElementById('bwH');
  const bwS = document.getElementById('bwS');
  if (bwR) bwR.textContent = latest.recovery_score != null ? latest.recovery_score + '%' : '—';
  if (bwH) bwH.textContent = latest.hrv_ms != null ? Math.round(latest.hrv_ms) + '' : '—';
  if (bwS) bwS.textContent = latest.sleep_hours != null ? latest.sleep_hours + 'h' : '—';

  // ── Home health card ──────────────────────────────────
  const healthCard = document.getElementById('whoopHealthCard');
  if (healthCard) {
    healthCard.style.display = 'block';
    const score = latest.recovery_score;
    const color = recoveryColor(score);
    const label = score != null ? (score >= 67 ? 'Green — Push' : score >= 34 ? 'Yellow — Baseline' : 'Red — Recovery') : '';

    const whCardDate = document.getElementById('whCardDate');
    const whCardBadge = document.getElementById('whCardBadge');
    const whCardRecov = document.getElementById('whCardRecov');
    const whCardHrv = document.getElementById('whCardHrv');
    const whCardSleep = document.getElementById('whCardSleep');
    const whCardStrain = document.getElementById('whCardStrain');
    const whCardSummary = document.getElementById('whCardSummary');

    if (whCardDate) whCardDate.textContent = latest.date || '';
    if (whCardBadge) {
      whCardBadge.textContent = label;
      whCardBadge.style.background = score >= 67 ? 'rgba(109,184,127,0.15)' : score >= 34 ? 'rgba(217,119,6,0.15)' : 'rgba(185,28,28,0.15)';
      whCardBadge.style.color = color;
    }
    if (whCardRecov) { whCardRecov.textContent = score != null ? score + '%' : '—'; whCardRecov.style.color = color; }
    if (whCardHrv) whCardHrv.textContent = latest.hrv_ms != null ? Math.round(latest.hrv_ms) + '' : '—';
    if (whCardSleep) whCardSleep.textContent = latest.sleep_performance != null ? latest.sleep_performance + '' : '—';
    if (whCardStrain) whCardStrain.textContent = latest.day_strain != null ? latest.day_strain.toFixed(1) : '—';
    if (whCardSummary) whCardSummary.textContent = latest.health_summary || '';
  }

  // ── Profile card metrics ──────────────────────────────
  if (metricsEl) { metricsEl.style.display = 'block'; }
  const wR = document.getElementById('wMetRecov');
  const wH = document.getElementById('wMetHrv');
  const wSl = document.getElementById('wMetSleep');
  if (wR) { wR.textContent = latest.recovery_score != null ? latest.recovery_score + '%' : '—'; wR.style.color = recoveryColor(latest.recovery_score); }
  if (wH) wH.textContent = latest.hrv_ms != null ? Math.round(latest.hrv_ms) + '' : '—';
  if (wSl) wSl.textContent = latest.sleep_hours != null ? latest.sleep_hours + '' : '—';
}

function recoveryColor(score) {
  if (score == null) return 'var(--cream)';
  if (score >= 67) return 'var(--green-bright)';
  if (score >= 34) return 'var(--amber)';
  return 'var(--red)';
}

function connectWhoop() {
  window.location.href = '/api/whoop-auth';
}

function disconnectWhoop() {
  _whoopData = null;
  refreshWhoopUI();
  toast('Whoop disconnected');
}

// ══════════════════════════════════════
// EXPORT
// ══════════════════════════════════════
function get7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().split('T')[0]); }
  return days;
}
function exportWeekly() {
  const pd = getPD(); const p = getP(); const days = get7Days();
  let txt = 'BASELINE WEEKLY SUMMARY\n' + (p.name||'Profile') + ' | ' + new Date().toLocaleDateString() + '\n\n';
  txt += 'STACK (' + (pd.stack||[]).length + ' products)\n';
  (pd.stack||[]).forEach(s => { txt += '  ' + s.name + ' — ' + s.score + '/100\n'; });
  txt += '\nDAILY LOG\n';
  days.forEach(d => { const l = getLog(d); const cal = (l.foods||[]).reduce((s,f)=>s+(f.calories||0),0); txt += d + ': ' + cal + ' cal | ' + (l.water||0) + ' oz water\n'; });
  dl(txt, 'baseline-weekly.txt', 'text/plain');
}
function exportStack() {
  const pd = getPD(); const p = getP();
  let txt = 'BASELINE STACK REPORT\n' + (p.name||'Profile') + ' | ' + new Date().toLocaleDateString() + '\n\n';
  (pd.stack||[]).forEach(s => { txt += s.name + '\nScore: ' + s.score + '/100 | ' + s.date + '\n\n'; });
  dl(txt, 'baseline-stack.txt', 'text/plain');
}
function exportNutrition() {
  const p = getP(); const days = get7Days();
  let csv = 'Date,Calories,Protein,Carbs,Fat,Water\n';
  days.forEach(d => { const l = getLog(d); const cal=(l.foods||[]).reduce((s,f)=>s+(f.calories||0),0); const pro=(l.foods||[]).reduce((s,f)=>s+(f.protein||0),0); const carb=(l.foods||[]).reduce((s,f)=>s+(f.carbs||0),0); const fat=(l.foods||[]).reduce((s,f)=>s+(f.fat||0),0); csv += d + ',' + cal + ',' + pro + ',' + carb + ',' + fat + ',' + (l.water||0) + '\n'; });
  dl(csv, 'baseline-nutrition.csv', 'text/csv');
}
function dl(content, filename, type) {
  const blob = new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

// ══════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════
let toastTimer = null;
function toast(msg, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'warn' ? ' warn' : type === 'err' ? ' err' : '');
  el.textContent = (type === 'err' ? '' : '&#10003; ') + msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => { if (el.parentNode) el.remove(); }, 300); }, 1800);
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-wrap').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
function initApp() {
  S.logDate = today();
  applyTheme();
  refreshPsSwitcher();
  refreshHome();
  refreshLog();
  refreshProfile();
  // Load Whoop health data from Supabase (non-blocking)
  loadWhoopData();
  // Handle OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  const whoopStatus = params.get('whoop');
  if (whoopStatus === 'connected') {
    toast('Whoop connected. First sync at 5:30am.');
    window.history.replaceState({}, '', '/');
    // Reload Whoop data immediately to show connected state
    setTimeout(loadWhoopData, 500);
  } else if (whoopStatus === 'error') {
    toast('Whoop connection failed. Check credentials in Netlify.', 'error');
    window.history.replaceState({}, '', '/');
  }
}

load();
applyTheme();

if (!S.hasOnboarded || !S.profiles.length) {
  // .ob { display: flex } in CSS already makes it visible — no inline style needed
} else {
  document.getElementById('ob').classList.add('hidden');
  initApp();
}

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ══════════════════════════════════════
// CARLOS CHAT
// ══════════════════════════════════════

const CARLOS = {
  thread: [],           // {role, content, actions, intent}
  threadId: null,
  isFirstMessage: true,
  isBusy: false,
  recognition: null,
  isListening: false,
  pendingReply: null,   // awaiting voice preview acceptance
  pendingMsgEl: null,
  speechSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  synthSupported: !!window.speechSynthesis,
};

const CARLOS_STARTERS = [
  'How is my recovery trending this week?',
  'Just had a protein shake and eggs',
  'How did Thryve do this week?',
  'What needs attention today?',
  'Draft a response to the organic salt thread',
];

function carlosInit() {
  CARLOS.thread = [];
  CARLOS.threadId = 'th_' + Date.now();
  CARLOS.isFirstMessage = true;
  CARLOS.pendingReply = null;
  CARLOS.pendingMsgEl = null;

  const msgs = document.getElementById('carlosMessages');
  msgs.innerHTML = `
    <div class="carlos-welcome">
      <div class="carlos-welcome-av">C</div>
      <div class="carlos-welcome-text">Morning. Ask me anything — recovery, food log, business numbers, or what needs attention today.</div>
      <div class="carlos-starters" id="carlosStarters"></div>
    </div>`;

  const starters = document.getElementById('carlosStarters');
  starters.innerHTML = CARLOS_STARTERS.map(s =>
    `<button class="carlos-starter" onclick="carlosUseStarter(this.textContent)">${s}</button>`
  ).join('');

  document.getElementById('carlosPreviewGate').classList.remove('visible');
  document.getElementById('carlosStatusRow').innerHTML = '';
  carlosSetStatus('Ready');
  document.getElementById('carlosInput').value = '';
  carlosInputResize(document.getElementById('carlosInput'));
}

function carlosClearThread() { carlosInit(); }

function carlosUseStarter(text) {
  document.getElementById('carlosInput').value = text;
  carlosInputResize(document.getElementById('carlosInput'));
  document.getElementById('carlosInput').focus();
}

function carlosSetStatus(text) {
  document.getElementById('carlosStatus').textContent = text;
}

function carlosShowChip(label, cls) {
  const row = document.getElementById('carlosStatusRow');
  row.innerHTML = `<div class="carlos-status-chip ${cls}"><div class="carlos-status-chip-dot"></div>${label}</div>`;
}

function carlosClearChip() {
  document.getElementById('carlosStatusRow').innerHTML = '';
}

function carlosInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); carlosSend(); }
}

function carlosInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function carlosScrollBottom() {
  const el = document.getElementById('carlosMessages');
  el.scrollTop = el.scrollHeight;
}

// ── Render a message bubble ───────────────────────────────────────────────────

function carlosRenderUser(text) {
  const el = document.createElement('div');
  el.className = 'cmsg cmsg-user';
  el.innerHTML = `<div class="cmsg-bubble">${escHtml(text)}</div>`;
  document.getElementById('carlosMessages').appendChild(el);
  carlosScrollBottom();
}

function carlosRenderTyping() {
  const el = document.createElement('div');
  el.className = 'carlos-typing';
  el.id = 'carlosTyping';
  el.innerHTML = `<div class="cmsg-carlos-av">C</div><div class="carlos-typing-dots"><span></span><span></span><span></span></div>`;
  document.getElementById('carlosMessages').appendChild(el);
  carlosScrollBottom();
  return el;
}

function carlosRemoveTyping() {
  const el = document.getElementById('carlosTyping');
  if (el) el.remove();
}

function carlosRenderCarlos(text, actions, intent) {
  const el = document.createElement('div');
  el.className = 'cmsg cmsg-carlos';

  const actionChips = (actions || []).map(a => {
    const ok = a.status === 'completed' || a.status === 'triggered';
    const label = {
      food_log: 'food logged',
      agent_feedback: 'feedback sent',
      label_check: 'compliance running',
      health_query: 'whoop data',
      business_query: 'weekly snapshot',
    }[a.type] || a.type;
    const icon = ok
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="9" height="9"><polyline points="20 6 9 17 4 12"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="9" height="9"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    return `<div class="cmsg-action-chip ${ok ? 'ok' : 'fail'}">${icon} ${label}</div>`;
  }).join('');

  el.innerHTML = `
    <div class="cmsg-carlos-av">C</div>
    <div class="cmsg-carlos-body">
      <div class="cmsg-bubble-carlos">${escHtml(text)}</div>
      <div class="cmsg-actions">
        ${actionChips}
        <button class="cmsg-copy" onclick="carlosCopyMsg(this)" data-text="${escAttr(text)}">copy</button>
      </div>
    </div>`;
  document.getElementById('carlosMessages').appendChild(el);
  carlosScrollBottom();
  return el;
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;'); }

function carlosCopyMsg(btn) {
  const text = btn.dataset.text;
  navigator.clipboard?.writeText(text).then(() => { btn.textContent = 'copied'; setTimeout(() => { btn.textContent = 'copy'; }, 1500); }).catch(() => {});
}

// ── Voice preview gate ────────────────────────────────────────────────────────

function carlosShowPreview(preview, fullReply, actions, intent) {
  CARLOS.pendingReply = { fullReply, actions, intent };
  document.getElementById('cpgText').textContent = preview;
  document.getElementById('carlosPreviewGate').classList.add('visible');
  carlosScrollBottom();
  carlosSpeak(preview);
}

function carlosAcceptPreview() {
  document.getElementById('carlosPreviewGate').classList.remove('visible');
  window.speechSynthesis?.cancel();
  if (!CARLOS.pendingReply) return;
  const { fullReply, actions, intent } = CARLOS.pendingReply;
  CARLOS.pendingReply = null;
  carlosRenderCarlos(fullReply, actions, intent);
  CARLOS.thread.push({ role: 'assistant', content: fullReply });
}

function carlosRegenTone() {
  window.speechSynthesis?.cancel();
  document.getElementById('carlosPreviewGate').classList.remove('visible');
  if (!CARLOS.pendingReply) return;
  const { fullReply, actions, intent } = CARLOS.pendingReply;
  CARLOS.pendingReply = null;
  // Re-send with tone instruction
  const input = document.getElementById('carlosInput');
  const orig = CARLOS.thread.length > 0 ? CARLOS.thread[CARLOS.thread.length - 1]?.content : '';
  carlosSendRaw((orig || 'previous message') + ' [respond more conversationally]');
}

// ── Speech synthesis ──────────────────────────────────────────────────────────

function carlosSpeak(text) {
  if (!CARLOS.synthSupported) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.0;
  utt.pitch = 0.95;
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

// ── Speech recognition ────────────────────────────────────────────────────────

function carlosToggleMic() {
  if (!CARLOS.speechSupported) { toast('Voice input not supported in this browser', 'warn'); return; }
  if (CARLOS.isListening) { carlosStopMic(); } else { carlosStartMic(); }
}

function carlosStartMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  CARLOS.recognition = rec;
  CARLOS.isListening = true;

  const mic = document.getElementById('carlosMic');
  mic.classList.add('listening');
  carlosShowChip('Listening', 'listening');
  carlosSetStatus('Listening…');

  const input = document.getElementById('carlosInput');
  let finalTranscript = '';

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    input.value = finalTranscript + interim;
    carlosInputResize(input);
  };

  rec.onend = () => {
    CARLOS.isListening = false;
    mic.classList.remove('listening');
    carlosClearChip();
    carlosSetStatus('Ready');
    if (finalTranscript.trim()) {
      input.value = finalTranscript.trim();
      carlosInputResize(input);
    }
  };

  rec.onerror = () => { CARLOS.isListening = false; mic.classList.remove('listening'); carlosClearChip(); carlosSetStatus('Ready'); };
  rec.start();
}

function carlosStopMic() {
  CARLOS.recognition?.stop();
  CARLOS.isListening = false;
  document.getElementById('carlosMic').classList.remove('listening');
  carlosClearChip();
  carlosSetStatus('Ready');
}

// ── Send message ──────────────────────────────────────────────────────────────

async function carlosSend() {
  const input = document.getElementById('carlosInput');
  const text = input.value.trim();
  if (!text || CARLOS.isBusy) return;
  input.value = '';
  carlosInputResize(input);
  carlosSendRaw(text);
}

async function carlosSendRaw(text) {
  if (CARLOS.isBusy) return;
  CARLOS.isBusy = true;
  document.getElementById('carlosSend').disabled = true;

  // Remove welcome screen on first message
  const welcome = document.querySelector('.carlos-welcome');
  if (welcome) welcome.remove();

  carlosRenderUser(text);
  CARLOS.thread.push({ role: 'user', content: text });

  carlosShowChip('Thinking', 'thinking');
  carlosSetStatus('Thinking…');
  const typingEl = carlosRenderTyping();

  try {
    const p = getP();
    const profile = {
      name: p.name, goal: p.goal, activity: p.activity,
      glp1: p.glp1, conditions: p.conditions, weight: p.weight,
      briefTone: p.briefTone,
    };

    // Build conversation history for context (last 10 messages, exclude latest user msg)
    const history = CARLOS.thread.slice(0, -1).slice(-10).map(m => ({ role: m.role, content: m.content }));

    const res = await fetch('/api/carlos-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'primary',
        threadId: CARLOS.threadId,
        message: text,
        profile,
        conversationHistory: history,
        isFirstMessage: CARLOS.isFirstMessage,
        brandContext: 'Thryve',
      }),
    });

    CARLOS.isFirstMessage = false;
    carlosRemoveTyping();
    carlosClearChip();

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const { reply, spokenPreview, actions, intent } = data;

    // Show voice preview gate if speech is available
    if (CARLOS.synthSupported && spokenPreview) {
      carlosSetStatus('Speaking preview…');
      carlosShowPreview(spokenPreview, reply, actions, intent);
    } else {
      carlosRenderCarlos(reply, actions, intent);
      CARLOS.thread.push({ role: 'assistant', content: reply });
    }

    carlosSetStatus('Ready');
  } catch (err) {
    carlosRemoveTyping();
    carlosClearChip();
    carlosSetStatus('Ready');
    carlosRenderCarlos('Something went wrong — ' + (err.message || 'please try again.'), [], 'error');
    CARLOS.thread.push({ role: 'assistant', content: 'Error: ' + err.message });
  } finally {
    CARLOS.isBusy = false;
    document.getElementById('carlosSend').disabled = false;
  }
}
