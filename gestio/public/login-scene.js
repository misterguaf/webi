// Access screen scene «Capvespre al prat» (docs/design/screens/LOGIN.md): a herd of red deer hinds
// galloping across a Mediterranean meadow at golden hour. Pure decoration: the card in index.html and
// the session logic in app.js work without this module. It only runs while the access screen is visible.

const $ = (id) => document.getElementById(id);
const stage = $('loginStage');
const SVG = 'http://www.w3.org/2000/svg';
const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => reduceQuery.matches;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const rand = (min, max) => min + Math.random() * (max - min);
const svgEl = (tag, attrs = {}) => { const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node; };

// ------------------------------------------------------------ landscape
// Seeded random: the landscape is the same on every visit.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SUN = [1120, 610];
// A ridge line from layered sines. `rocky` folds the waves into sharp peaks; `gap` opens a saddle around
// the sun so it sets into the range instead of disappearing behind it.
function ridge({ base, amp, rng, rocky = false, octaves = 4, gap = 0 }) {
  const waves = Array.from({ length: octaves }, (_, i) => ({ f: (0.0022 + rng() * 0.0016) * (i + 1) ** 1.6, p: rng() * Math.PI * 2, a: 1 / (i + 1) ** 1.2 }));
  const norm = waves.reduce((sum, w) => sum + w.a, 0);
  return (x) => {
    let v = 0;
    for (const w of waves) { const sw = Math.sin(x * w.f + w.p); v += w.a * (rocky ? 1 - Math.abs(sw) : (sw + 1) / 2); }
    const saddle = 1 - gap * Math.exp(-(((x - SUN[0]) / 240) ** 2));
    return base - amp * (v / norm) * saddle;
  };
}
const linePath = (fn, step = 12) => { let d = `M-40 ${fn(-40).toFixed(1)}`; for (let x = -40 + step; x <= 1640; x += step) d += ` L${x} ${fn(x).toFixed(1)}`; return d; };
const areaPath = (fn, step = 12) => `${linePath(fn, step)} L1640 905 L-40 905 Z`;
const f1 = (n) => n.toFixed(1);
// Clockwise, like the ridge outlines, so overlapping shapes add up under the nonzero fill rule.
const ellipsePath = (cx, cy, rx, ry) => `M${f1(cx - rx)} ${f1(cy)} a${f1(rx)} ${f1(ry)} 0 1 1 ${f1(rx * 2)} 0 a${f1(rx)} ${f1(ry)} 0 1 1 ${f1(-rx * 2)} 0 Z`;

// Mediterranean trees as single sub-paths (merged into the ridge fill, so they share its colour).
// Umbrella pine: curved trunk, a few branches and a flat, clumpy canopy made of overlapping masses.
function umbrellaPine(x, y, h, rng, lean = 0) {
  const w = h * (1.15 + rng() * 0.45);
  const cx = x + lean;
  const cy = y - h * 0.8;
  const t = Math.max(0.8, h * 0.032);
  let d = `M${f1(x - t)} ${f1(y)} Q${f1(x + lean * 0.35 - t)} ${f1(y - h * 0.45)} ${f1(cx - t * 0.7)} ${f1(cy + h * 0.05)} L${f1(cx + t * 0.7)} ${f1(cy + h * 0.05)} Q${f1(x + lean * 0.35 + t)} ${f1(y - h * 0.45)} ${f1(x + t)} ${f1(y)} Z`;
  // Branches from the top of the trunk to the canopy masses.
  const masses = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < masses; i++) {
    const u = (i + 0.5) / masses - 0.5;
    const mx = cx + u * w * 0.86 + (rng() - 0.5) * w * 0.06;
    const dome = 1 - (2 * u) ** 2;
    const my = cy - h * (0.02 + 0.09 * dome) + (rng() - 0.5) * h * 0.04;
    const rx = w * (0.11 + rng() * 0.08);
    const ry = h * (0.055 + rng() * 0.05) * (0.8 + 0.4 * dome);
    if (h > 30 && Math.abs(u) > 0.12) {
      const bt = t * 0.45;
      d += ` M${f1(cx - bt)} ${f1(cy + h * 0.06)} Q${f1((cx + mx) / 2)} ${f1(my + ry * 1.6)} ${f1(mx)} ${f1(my + ry * 0.4)} L${f1(mx + bt * 2)} ${f1(my + ry * 0.4)} Q${f1((cx + mx) / 2 + bt)} ${f1(my + ry * 1.6 + bt)} ${f1(cx + bt)} ${f1(cy + h * 0.06)} Z`;
    }
    d += ` ${ellipsePath(mx, my, rx, ry)}`;
    // Small satellite tufts break the outline.
    if (h > 24) d += ` ${ellipsePath(mx + (rng() - 0.5) * rx * 1.6, my - ry * (0.4 + rng() * 0.5), rx * (0.35 + rng() * 0.25), ry * (0.5 + rng() * 0.3))}`;
  }
  return d;
}
const cypress = (x, y, h) => { const w = h * 0.2; return `M${f1(x)} ${f1(y)} C${f1(x - w)} ${f1(y - h * 0.3)} ${f1(x - w * 0.55)} ${f1(y - h * 0.85)} ${f1(x)} ${f1(y - h)} C${f1(x + w * 0.55)} ${f1(y - h * 0.85)} ${f1(x + w)} ${f1(y - h * 0.3)} ${f1(x)} ${f1(y)} Z`; };
function holmOak(x, y, h, rng) {
  const w = h * 1.1;
  let d = `M${f1(x - 1.4)} ${f1(y)} L${f1(x - 1)} ${f1(y - h * 0.4)} L${f1(x + 1)} ${f1(y - h * 0.4)} L${f1(x + 1.4)} ${f1(y)} Z`;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng();
    d += ` ${ellipsePath(x + Math.cos(a) * w * 0.22, y - h * 0.62 + Math.sin(a) * h * 0.16, w * (0.2 + rng() * 0.1), h * (0.2 + rng() * 0.08))}`;
  }
  return d;
}
function treeLine(fn, rng, { min, max, gapChance = 0.25, from = -20, to = 1620, spacing = [14, 46] }) {
  let d = '';
  for (let x = from; x < to; x += spacing[0] + rng() * spacing[1]) {
    if (rng() < gapChance) { x += 60 + rng() * 140; continue; }
    const h = min + rng() * (max - min);
    const y = fn(x) + h * 0.08;
    const kind = rng();
    d += ` ${kind < 0.3 ? umbrellaPine(x, y, h, rng, (rng() - 0.5) * h * 0.3) : kind < 0.82 ? holmOak(x, y, h * 0.8, rng) : cypress(x, y, h * 1.2)}`;
  }
  return d;
}
function ridgeLayer(fn, { fill, opacity, trees = '', crest = 0.6 }) {
  const g = svgEl('g');
  g.append(svgEl('path', { d: `${areaPath(fn)}${trees}`, fill, opacity }));
  if (crest) g.append(svgEl('path', { d: linePath(fn), class: 'lg-crest', opacity: crest }));
  return g;
}

function buildLandscape() {
  const rng = seeded(20026);
  // Distant sierra (Mondúver-like), sharper and hazier, with a saddle where the sun sets.
  const farA = ridge({ base: 616, amp: 270, rng, rocky: true, octaves: 4, gap: 0.84 });
  const farB = ridge({ base: 640, amp: 120, rng, rocky: true, octaves: 5, gap: 0.55 });
  const mid = ridge({ base: 648, amp: 50, rng, octaves: 4 });
  const meadow = ridge({ base: 704, amp: 14, rng, octaves: 3 });
  $('lgRidgeFar').replaceChildren(
    ridgeLayer(farA, { fill: '#8A4A63', opacity: 0.6, crest: 0.6 }),
    ridgeLayer(farB, { fill: '#673456', opacity: 0.8, trees: treeLine(farB, rng, { min: 5, max: 10, gapChance: 0.2, spacing: [5, 12] }), crest: 0.7 }),
  );
  $('lgRidgeMid').replaceChildren(ridgeLayer(mid, { fill: '#3D1F37', opacity: 0.96, trees: treeLine(mid, rng, { min: 18, max: 42, gapChance: 0.08, spacing: [8, 22] }), crest: 0.8 }));
  $('lgMeadow').replaceChildren(ridgeLayer(meadow, { fill: '#1E1120', opacity: 1, trees: treeLine(meadow, rng, { min: 10, max: 22, gapChance: 0.7 }), crest: 0.5 }));

  // Long, thin clouds lit from below; each drifts very slowly.
  $('lgClouds').replaceChildren(...[[300, 250, 1], [760, 190, 0.8], [1260, 300, 1.1], [520, 395, 0.7], [1450, 165, 0.6]].map(([x, y, s]) => {
    let d = '';
    for (let i = 0; i < 6; i++) d += ellipsePath(x + (rng() - 0.5) * 260 * s, y + (rng() - 0.5) * 18 * s, (70 + rng() * 120) * s, (6 + rng() * 9) * s);
    const cloud = svgEl('path', { d, fill: 'url(#lgCloud)', class: 'lg-cloud' });
    cloud.style.setProperty('--t', `${rand(90, 150)}s`);
    cloud.style.setProperty('--dx', `${rand(-90, -40)}px`);
    return cloud;
  }));

  // Soft sun rays fanning upwards.
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const angle = (-160 + i * 20 + (rng() - 0.5) * 8) * (Math.PI / 180);
    const half = (2 + rng() * 3) * (Math.PI / 180);
    const len = 900 + rng() * 300;
    rays += `M${SUN[0]} ${SUN[1]} L${f1(SUN[0] + len * Math.cos(angle - half))} ${f1(SUN[1] + len * Math.sin(angle - half))} L${f1(SUN[0] + len * Math.cos(angle + half))} ${f1(SUN[1] + len * Math.sin(angle + half))} Z `;
  }
  $('lgRays').replaceChildren(svgEl('path', { d: rays, fill: 'url(#lgRay)' }));

  // A few birds far away, crossing the sky.
  $('lgBirds').replaceChildren(...[[220, 46, -8], [300, 58, -30], [260, 70, -44], [180, 95, -70]].map(([y, t, delay], i) => {
    const bird = svgEl('g', { class: 'lg-bird' });
    bird.style.setProperty('--y', `${y}px`);
    bird.style.setProperty('--t', `${t}s`);
    bird.style.setProperty('--d', `${delay}s`);
    const wings = svgEl('path', { d: 'M-7 0 Q-3.5 -3.5 0 0 Q3.5 -3.5 7 0' });
    wings.style.setProperty('animation-delay', `${-i * 0.17}s`);
    bird.append(wings);
    return bird;
  }));

  // The big umbrella pine framing the right side; the herd runs behind its trunk.
  const pine = umbrellaPine(1585, 905, 470, seeded(11), -70);
  const branches = '';
  $('lgFrame').replaceChildren(
    svgEl('path', { d: `${pine} ${branches}`, class: 'lg-frame-rim' }),
    svgEl('path', { d: `${pine} ${branches}`, class: 'lg-frame' }),
  );
}

// ------------------------------------------------------------ ambience: motes, stars, grass
function buildAmbience() {
  $('lgMotes').replaceChildren(...Array.from({ length: 18 }, () => {
    const mote = document.createElement('span');
    mote.className = 'lg-mote';
    const props = { '--x': `${rand(48, 96)}%`, '--y': `${rand(18, 80)}%`, '--s': `${rand(3, 7)}px`, '--t': `${rand(11, 20)}s`, '--d': `${rand(-20, 0)}s`, '--dx': `${rand(-30, 70)}px`, '--dy': `${rand(-160, -60)}px` };
    for (const [k, v] of Object.entries(props)) mote.style.setProperty(k, v);
    return mote;
  }));
  $('lgStars').replaceChildren(...Array.from({ length: 30 }, () => {
    const star = svgEl('circle', { cx: rand(0, 1600), cy: rand(10, 230), r: rand(0.6, 1.6), class: 'lg-star' });
    star.style.setProperty('--t', `${rand(4, 9)}s`);
    star.style.setProperty('--d', `${rand(-9, 0)}s`);
    return star;
  }));
  // Foreground meadow: grass clumps with seed heads and a few fennel umbels; some tips catch the light.
  const rng = seeded(311);
  const clumps = [];
  for (let c = 0; c < 10; c++) {
    const clump = svgEl('g', { class: 'lg-blades' });
    clump.style.setProperty('--t', `${3.2 + rng() * 2.2}s`);
    clump.style.setProperty('--d', `${-rng() * 5}s`);
    let dark = '';
    let lit = '';
    let heads = '';
    for (let i = 0; i < 18; i++) {
      const x = c * 165 - 20 + rng() * 190;
      const h = 40 + rng() * (c % 3 === 0 ? 190 : 120);
      const lean = (rng() - 0.5) * 54;
      const blade = `M${f1(x)} 905 Q${f1(x + lean * 0.35)} ${f1(905 - h * 0.6)} ${f1(x + lean)} ${f1(905 - h)}`;
      if (rng() < 0.3) lit += ` ${blade}`; else dark += ` ${blade}`;
      const tipX = x + lean;
      const tipY = 905 - h;
      const roll = rng();
      if (roll < 0.22) heads += ` ${ellipsePath(tipX, tipY - 5, 2.2, 6.5)}`;
      else if (roll < 0.3 && h > 120) for (let k = -2; k <= 2; k++) heads += ` ${ellipsePath(tipX + k * 5, tipY - 4 + Math.abs(k) * 2.2, 2.1, 2.1)}`;
    }
    clump.append(svgEl('path', { d: dark, 'stroke-width': 2.4 }), svgEl('path', { d: lit, class: 'lg-lit', 'stroke-width': 2 }), svgEl('path', { d: heads, class: 'lg-heads' }));
    clumps.push(clump);
  }
  $('lgGrass').replaceChildren(...clumps);
}

// ------------------------------------------------------------ the hind: anatomy
// Local space: facing right, hooves on y = 200 when standing. Red deer hind proportions: deep chest,
// long slender legs, long neck, large leaf-shaped ears, short tail.
const TORSO = 'M34 84 C46 74 70 72 94 76 C112 79 128 78 142 72 L150 74 C158 82 162 94 160 106 C158 116 152 122 146 126 C136 130 128 128 118 126 C100 124 84 126 70 128 C62 130 56 130 52 126 C40 120 30 108 28 96 C27 90 29 86 34 84 Z';
const TAIL = 'M34 85 C28 85 25 89 26 95 C29 93 32 91 35 90 Z';
const NECK = 'M138 78 C150 64 159 48 166 36 L184 46 C178 58 169 76 163 92 C161 98 160 102 160 104 L146 100 Z';
const HEAD = 'M166 35 C167 28 172 22 179 21 C187 22 195 28 204 36 C210 40 214 44 214 48 C212 52 206 53 200 52 C194 51 190 50 186 52 C181 54 176 51 172 47 C168 43 165 39 166 35 Z';
const EARS = ['M175 24 C166 18 158 11 151 6 C152 13 160 22 171 30 Z', 'M180 22 C177 13 179 5 184 0 C188 8 188 17 184 25 Z'];
const NECK_PIVOT = [148, 92];
const HEAD_PIVOT = [174, 38];
const EAR_PIVOT = [178, 25];
const TAIL_PIVOT = [34, 87];
// Each leg: joints [top (inside the body), knee/hock, fetlock, hoof tip] and widths at those joints.
const LEGS = {
  frontNear: { joints: [[146, 104], [147, 150], [148, 186], [153, 199]], widths: [17, 8.5, 6, 7] },
  frontFar: { joints: [[140, 102], [141, 150], [142, 186], [147, 199]], widths: [15, 8, 5.5, 6.5] },
  hindNear: { joints: [[54, 102], [44, 146], [48, 186], [53, 199]], widths: [28, 9, 6, 7] },
  hindFar: { joints: [[60, 100], [50, 146], [54, 186], [59, 199]], widths: [24, 8.5, 5.5, 6.5] },
};

// A tapered segment from a (width wa) to b (width wb). Joints are drawn as separate round knobs.
function segment(a, b, wa, wb) {
  const [x1, y1] = a; const [x2, y2] = b;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len; const ny = (x2 - x1) / len;
  const p = (x, y, w, s) => `${(x + nx * w / 2 * s).toFixed(1)} ${(y + ny * w / 2 * s).toFixed(1)}`;
  return `M${p(x1, y1, wa, 1)} L${p(x2, y2, wb, 1)} L${p(x2, y2, wb, -1)} L${p(x1, y1, wa, -1)} Z`;
}
const knob = ([x, y], w) => svgEl('circle', { cx: x, cy: y, r: w / 2, class: 'part' });
const part = (d, extra = '') => svgEl('path', { d, class: `part ${extra}`.trim() });
function joint(group, [x, y]) { group.style.setProperty('transform-origin', `${x}px ${y}px`); return group; }

function buildLeg({ joints: [top, knee, fetlock, hoof], widths: [w0, w1, w2, w3] }, far) {
  const hip = joint(svgEl('g', { class: far ? 'limb-far' : 'limb' }), top);
  const kneeG = joint(svgEl('g'), knee);
  const fetG = joint(svgEl('g'), fetlock);
  // Hoof: a small wedge, wider at the ground.
  const [hx, hy] = hoof;
  fetG.append(part(segment(fetlock, [hx - 2, hy - 2], w2, w3)), part(`M${hx - 7} ${hy + 1} L${hx + 3} ${hy + 1} L${hx + 1} ${hy - 6} L${hx - 6} ${hy - 5} Z`), knob(fetlock, w2 + 1.5));
  kneeG.append(part(segment(knee, fetlock, w1, w2)), knob(knee, w1 + 2), fetG);
  hip.append(part(segment(top, knee, w0, w1)), kneeG);
  return { hip, knee: kneeG, fetlock: fetG };
}

function buildDeer(kind) {
  const deer = svgEl('g', { class: `deer deer-${kind}` });
  const shadow = svgEl('ellipse', { class: 'deer-shadow', cx: 104, cy: 200, rx: 74, ry: 5 });
  joint(shadow, [104, 200]);
  const bob = joint(svgEl('g'), [100, 110]);
  // Rim light: a stroked copy underneath, the plain fill on top. Only the outer edge stays lit, so the
  // joins between torso, neck, head and ears never show a seam.
  const ears = joint(svgEl('g', { class: 'ears' }), EAR_PIVOT);
  ears.append(...EARS.map((d) => part(d, 'rim')), ...EARS.map((d) => part(d)));
  const head = joint(svgEl('g'), HEAD_PIVOT);
  head.append(part(HEAD, 'rim'), ears, part(HEAD));
  const neck = joint(svgEl('g'), NECK_PIVOT);
  neck.append(part(NECK, 'rim'), head, part(NECK));
  const tail = joint(svgEl('g', { class: 'tail' }), TAIL_PIVOT);
  tail.append(part(TAIL, 'rim'), part(TAIL));
  const legs = {
    frontFar: buildLeg(LEGS.frontFar, true), hindFar: buildLeg(LEGS.hindFar, true),
    frontNear: buildLeg(LEGS.frontNear, false), hindNear: buildLeg(LEGS.hindNear, false),
  };
  bob.append(legs.frontFar.hip, legs.hindFar.hip, part(TORSO, 'rim'), tail, neck, part(TORSO), legs.frontNear.hip, legs.hindNear.hip);
  deer.append(shadow, bob);
  return { el: deer, shadow, bob, neck, head, legs, anims: [] };
}

// ------------------------------------------------------------ the hind: gallop model
// Angles in degrees, clockwise positive (a positive angle swings the hoof backwards). t ∈ [0, 1).
// Phase map of one stride: 0–.25 hind stance, .2–.45 extension, .45–.72 front stance, .72–1 gathered
// suspension. Every term is smooth (sines and raised-cosine pulses, no corners), so joints accelerate
// and settle like muscles instead of snapping.
const S = (x) => Math.sin(2 * Math.PI * x);
// Raised-cosine pulse centred on c with half-width w, wrapping around the stride; 0 outside.
const pulse = (t, c, w) => {
  const d = ((((t - c) % 1) + 1.5) % 1) - 0.5;
  return Math.abs(d) < w ? 0.5 * (1 + Math.cos(Math.PI * d / w)) : 0;
};
const GAIT = {
  // Front: reaches forward in the extension, sweeps back in stance, folds the knee during the swing,
  // and the pastern gives a little under load.
  frontHip: (t) => -6 + 36 * S(t - 0.47) + 4 * S(2 * (t - 0.47)),
  frontKnee: (t) => 88 * pulse(t, 0.96, 0.25),
  frontFetlock: (t) => 40 * pulse(t, 0.98, 0.2) - 13 * pulse(t, 0.58, 0.14),
  // Hind: drives back after landing, the hock folds while the leg swings forward under the belly.
  hindHip: (t) => 4 + 35 * S(t - 0.2) + 4 * S(2 * (t - 0.2)),
  hindKnee: (t) => -62 * pulse(t, 0.7, 0.25) + 9 * pulse(t, 0.1, 0.12),
  hindFetlock: (t) => -32 * pulse(t, 0.72, 0.21) + 10 * pulse(t, 0.1, 0.13),
  // Body: lifts in the gathered suspension, a smaller lift in the extension, compresses on landing,
  // surges forward after each push and pitches with the footfalls.
  bodyY: (t) => -16 * pulse(t, 0.86, 0.2) - 6 * pulse(t, 0.32, 0.15) + 3 * pulse(t, 0.58, 0.12),
  surge: (t) => 4 * S(t - 0.3),
  pitch: (t) => 3.6 * S(t - 0.1) + 1 * S(2 * (t - 0.1)),
  // Neck swings against the body; the head counter-rotates so the eyes stay almost level.
  neck: (t) => -7 * S(t - 0.25),
  head: (t) => 5 * S(t - 0.25) - 2.6 * S(t - 0.1),
};
const STEPS = 64;
const frames = (fn) => Array.from({ length: STEPS + 1 }, (_, i) => fn(i / STEPS));
const rot = (deg) => ({ transform: `rotate(${deg.toFixed(2)}deg)` });

function gallop(deer, stride, rate = 1) {
  const timing = { duration: stride, iterations: Infinity, easing: 'linear' };
  const add = (el, list) => deer.anims.push(el.animate(list, timing));
  const leg = (limb, prefix, lag) => {
    add(limb.hip, frames((t) => rot(GAIT[`${prefix}Hip`](t + lag))));
    add(limb.knee, frames((t) => rot(GAIT[`${prefix}Knee`](t + lag))));
    add(limb.fetlock, frames((t) => rot(GAIT[`${prefix}Fetlock`](t + lag))));
  };
  // Footfall order of a transverse gallop: the far legs land a moment after the near ones.
  leg(deer.legs.frontNear, 'front', 0);
  leg(deer.legs.frontFar, 'front', -0.08);
  leg(deer.legs.hindNear, 'hind', 0);
  leg(deer.legs.hindFar, 'hind', -0.07);
  add(deer.bob, frames((t) => ({ transform: `translate(${GAIT.surge(t).toFixed(2)}px, ${GAIT.bodyY(t).toFixed(2)}px) rotate(${GAIT.pitch(t).toFixed(2)}deg)` })));
  add(deer.neck, frames((t) => rot(GAIT.neck(t))));
  add(deer.head, frames((t) => rot(GAIT.head(t))));
  add(deer.shadow, frames((t) => ({ transform: `scaleX(${(1 + GAIT.bodyY(t) / 60).toFixed(3)})`, opacity: (0.32 + GAIT.bodyY(t) / 80).toFixed(3) })));
  const offset = Math.random() * stride;
  deer.anims.forEach((anim) => { anim.currentTime = offset; anim.playbackRate = rate; });
  deer.el.classList.add('is-running');
}
function stopGallop(deer) { deer.anims.forEach((anim) => anim.cancel()); deer.anims = []; deer.el.classList.remove('is-running'); }

// Standing still (reduced motion): one grazes with the head down, the others look around.
function stand(deer, grazing) {
  stopGallop(deer);
  if (grazing) {
    deer.neck.style.setProperty('transform', 'rotate(46deg)');
    deer.head.style.setProperty('transform', 'rotate(18deg)');
  } else {
    deer.neck.style.removeProperty('transform');
    deer.head.style.removeProperty('transform');
  }
}

// ------------------------------------------------------------ the herd crossing the meadow
// Ground speed matches the hooves: during stance a front hoof travels ≈ 2·L·sin(37°) ≈ 115 local units
// in half a stride, so the body moves ≈ 230 units per stride. Matching it keeps the hooves from sliding.
const UNITS_PER_STRIDE = 230;
// The two near deer share one ground speed (they run together); the smaller one takes quicker strides
// so its hooves still match the ground. The far one is slower on screen (perspective).
const NEAR_SPEED = (UNITS_PER_STRIDE * 1.2) / 640; // px per ms
const herd = [
  { kind: 'near', layer: 'lgNearHerd', ground: 714, scale: 1.2, speed: NEAR_SPEED, lead: 0 },
  { kind: 'mid', layer: 'lgNearHerd', ground: 704, scale: 0.95, speed: NEAR_SPEED, lead: -300 },
  { kind: 'far', layer: 'lgFarHerd', ground: 652, scale: 0.5, speed: NEAR_SPEED * 0.55, lead: 200 },
].map((h) => ({ ...h, stride: (UNITS_PER_STRIDE * h.scale) / h.speed }));
const transformAt = (h, x) => `translate(${x}px, ${h.ground - 199 * h.scale}px) scale(${h.scale})`;
const crossings = new Set();
let running = false;
let paused = false;

function puff(x, ground) {
  const dust = svgEl('ellipse', { cx: x, cy: ground - 2, rx: 9, ry: 2.5, class: 'lg-puff' });
  $('lgDust').append(dust);
  dust.animate([{ opacity: 0.16, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.6, 2) translateY(-3px)' }],
    { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' }).finished.then(() => dust.remove(), () => dust.remove());
}

async function crossOnce(h) {
  const from = -340 + h.lead;
  const to = 1800 + h.lead;
  const rate = 0.94 + Math.random() * 0.12; // a little faster or slower each time, never identical
  const duration = (to - from) / (h.speed * rate);
  gallop(h.deer, h.stride, rate);
  const travel = h.deer.el.animate([{ transform: transformAt(h, from) }, { transform: transformAt(h, to) }], { duration, easing: 'linear', fill: 'both' });
  crossings.add(travel);
  let timer = 0;
  if (h.kind === 'near') {
    timer = setInterval(() => {
      if (travel.playState !== 'running') return;
      const x = from + (to - from) * (travel.currentTime / duration);
      puff(x + 60, h.ground);
    }, h.stride / (2 * rate));
  }
  try { await travel.finished; } catch { /* cancelled */ }
  clearInterval(timer);
  crossings.delete(travel);
  travel.cancel(); // the deer is off-screen by now; do not keep a finished animation holding it
  stopGallop(h.deer);
}

async function runLoop() {
  if (running) return;
  running = true;
  await wait(900);
  while (running && !reducedMotion()) {
    await Promise.all(herd.map((h, i) => wait(i * 220).then(() => (running ? crossOnce(h) : null))));
    for (let waited = 0, pause = rand(4500, 8000); running && waited < pause; waited += 250) await wait(250);
  }
  running = false;
}
function stopLoop() {
  running = false;
  crossings.forEach((anim) => anim.cancel());
  crossings.clear();
}
function placeStanding() {
  const spots = { near: 1020, mid: 760, far: 520 };
  herd.forEach((h) => {
    h.deer.el.getAnimations().forEach((anim) => anim.cancel());
    h.deer.el.style.setProperty('transform', transformAt(h, spots[h.kind]));
    stand(h.deer, h.kind === 'mid');
  });
}

// ------------------------------------------------------------ motion settings, pause, parallax
function applyMotion() {
  if (reducedMotion()) { stopLoop(); placeStanding(); return; }
  herd.forEach((h) => { h.deer.el.style.setProperty('transform', transformAt(h, -600)); h.deer.neck.style.removeProperty('transform'); h.deer.head.style.removeProperty('transform'); });
  if (!paused) runLoop();
}

// WCAG 2.2.2: moving content can be paused. A hidden tab pauses too, without touching the user's choice.
let userPaused = false;
function setPaused(value) {
  paused = value;
  stage.classList.toggle('is-paused', value);
  [...crossings, ...herd.flatMap((h) => h.deer?.anims ?? [])].forEach((anim) => (value ? anim.pause() : anim.play()));
}
const pauseButton = $('loginPause');
pauseButton.addEventListener('click', () => {
  userPaused = !userPaused;
  setPaused(userPaused);
  pauseButton.setAttribute('aria-pressed', String(userPaused));
  pauseButton.querySelector('span').textContent = userPaused ? "Reprén l'animació" : "Atura l'animació";
  pauseButton.querySelector('use').setAttribute('href', userPaused ? '#icon-play' : '#icon-pause');
});
document.addEventListener('visibilitychange', () => { if (!userPaused && active) setPaused(document.hidden); });

if (matchMedia('(pointer: fine)').matches) {
  let frame = 0;
  addEventListener('pointermove', (event) => {
    if (frame || !active || reducedMotion()) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      stage.style.setProperty('--px', ((event.clientX / innerWidth) * 2 - 1).toFixed(3));
      stage.style.setProperty('--py', ((event.clientY / innerHeight) * 2 - 1).toFixed(3));
    });
  });
}

// ------------------------------------------------------------ «into the light»
// app.js dispatches `gestio:login-leave` after a successful sign-in and waits for this exit before the
// shell appears. The curtain ends on the shell background, so the hand-off is seamless.
let leaveAnims = [];
function resetLeave() { leaveAnims.forEach((anim) => anim.cancel()); leaveAnims = []; }
document.addEventListener('gestio:login-leave', () => {
  if (!active) return;
  const reduced = reducedMotion();
  const timing = { duration: reduced ? 150 : 700, easing: 'cubic-bezier(.55,0,.85,.35)', fill: 'forwards' };
  if (!reduced) {
    leaveAnims.push(stage.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.22)', filter: 'brightness(1.35)' }], timing));
    leaveAnims.push($('loginCard').animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { ...timing, duration: 380 }));
  }
  leaveAnims.push($('loginCurtain').animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, delay: reduced ? 0 : 260 }));
  // If the session check then fails, the access screen stays: bring it back.
  setTimeout(() => { if (active) resetLeave(); }, 2500);
});

// ------------------------------------------------------------ lifecycle
const login = $('login');
const shell = document.querySelector('.app-shell');
let built = false;
let active = false;

function greet() {
  const hour = new Date().getHours();
  $('loginTitle').textContent = hour >= 6 && hour < 13 ? 'Bon dia.' : hour >= 13 && hour < 20 ? 'Bona vesprada.' : 'Bona nit.';
}
function build() {
  buildLandscape();
  buildAmbience();
  for (const h of herd) {
    h.deer = buildDeer(h.kind);
    // The mid deer runs behind the near one: insert it first.
    if (h.kind === 'mid') $(h.layer).prepend(h.deer.el); else $(h.layer).append(h.deer.el);
  }
  built = true;
}
const visible = () => !login.hidden && !document.body.classList.contains('shell-authenticated') && !document.body.classList.contains('auth-pending');
function sync() {
  const show = visible();
  // The shell behind the access screen must not be reachable with the keyboard.
  if (shell) shell.inert = show;
  if (show === active) return;
  active = show;
  if (show) {
    if (!built) build();
    resetLeave();
    greet();
    applyMotion();
  } else {
    stopLoop();
    herd.forEach((h) => h.deer && stopGallop(h.deer));
  }
}
const observer = new MutationObserver(sync);
observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
observer.observe(login, { attributes: true, attributeFilter: ['hidden'] });
reduceQuery.addEventListener('change', () => { if (active) applyMotion(); });
sync();
