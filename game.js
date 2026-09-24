(() => {
  "use strict";

  const MODES = {
    signal: {
      title: "신호 정원", eyebrow: "01 / POSITION IS POWER", color: "#66e6d0", shadow: "#235d66",
      intro: "전도체를 심어 전류선을 만들고, 적을 그 선으로 유인하세요.",
      action: "전도체 배치", ability: "전도체 배치", tip: "첫 전도체는 이미 놓여 있습니다. Space로 두 번째를 심으면 전류선이 완성됩니다.",
      upgrades: [
        ["강한 전류", "전류선 피해 +1", "lineDamage"],
        ["넓은 연결", "전류선 판정 폭 +6", "lineWidth"],
        ["빠른 재배치", "배치 대기 시간 -0.45초", "abilityRate"],
      ],
    },
    heat: {
      title: "열핵 배달", eyebrow: "02 / RISK MAKES POWER", color: "#ffac73", shadow: "#74494a",
      intro: "열핵이 자동 발사합니다. 열을 모을수록 배출이 강해지고, 과열되면 발사가 멈춥니다.",
      action: "열 배출", ability: "열 배출", tip: "열 12%부터 Space로 배출합니다. 55%부터 이동이 느려지지만, 70% 이상에서 배출하면 생명 1을 회복합니다.",
      upgrades: [
        ["강한 열파", "탄환 피해 +1 · 발사 열 +3", "shotDamage"],
        ["넓은 배출", "배출 반경 +28", "ventRadius"],
        ["안정 냉각", "자연 냉각 +3/초", "cooling"],
      ],
    },
    echo: {
      title: "잔상 지도사", eyebrow: "03 / YOUR PATH FIGHTS BACK", color: "#b2aaff", shadow: "#4b4c78",
      intro: "지나온 길이 잠시 후 공격합니다. 적을 잔상 경로로 끌어들이세요.",
      action: "짧은 대시", ability: "짧은 대시", tip: "이동 후 1초쯤 지나면 지나온 길이 밝아지고 적을 공격합니다. Space로 위기를 벗어나세요.",
      upgrades: [
        ["날카로운 잔상", "잔상 피해 +1", "echoDamage"],
        ["긴 기록", "잔상 지속 시간 +0.7초", "echoLife"],
        ["빠른 대시", "대시 대기 시간 -0.45초", "abilityRate"],
      ],
    },
  };
  const query = new URLSearchParams(location.search);
  const modeKey = MODES[query.get("game")] ? query.get("game") : "signal";
  const mode = MODES[modeKey];
  document.body.dataset.mode = modeKey;
  document.title = `${mode.title} | 심다 일일 게임 제작`;
  for (const link of document.querySelectorAll("[data-game-link]")) {
    if (link.dataset.gameLink === modeKey) link.classList.add("active");
  }
  const $ = (id) => document.getElementById(id);
  $("modeEyebrow").textContent = mode.eyebrow;
  $("modeTitle").textContent = mode.title;
  $("modeIntro").textContent = mode.intro;
  $("actionLabel").textContent = mode.action;
  $("abilityLabel").textContent = mode.ability;
  $("touchAction").textContent = mode.action;
  $("heatMeterBlock").hidden = modeKey !== "heat";

  const canvas = $("arena"), ctx = canvas.getContext("2d", { alpha: false });
  const arena = document.querySelector(".arena-wrap");
  let W = 900, H = 550, dpr = 1, scale = 1;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const random = (a, b) => a + Math.random() * (b - a);
  const keys = new Set();
  let sound = false, audio = null, state = null, lastFrame = performance.now();

  function resize() {
    const box = arena.getBoundingClientRect();
    W = box.width; H = box.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = clamp(Math.min(W / 900, H / 550), 0.55, 1.2);
    if (state) { state.p.x = clamp(state.p.x, 22, W - 22); state.p.y = clamp(state.p.y, 22, H - 22); }
  }
  new ResizeObserver(resize).observe(arena);
  resize();

  function beep(freq = 520, duration = 0.045, gain = 0.035) {
    if (!sound) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator(), vol = audio.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      vol.gain.value = gain;
      vol.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      osc.connect(vol); vol.connect(audio.destination);
      osc.start(); osc.stop(audio.currentTime + duration);
    } catch { /* 소리 사용이 차단돼도 게임은 계속된다. */ }
  }

  function showOverlay(kicker, title, text, button, hint) {
    $("overlayKicker").textContent = kicker;
    $("overlayTitle").textContent = title;
    $("overlayText").textContent = text;
    $("primaryButton").textContent = button;
    $("overlayHint").textContent = hint;
    $("overlay").hidden = false;
    $("liveStatus").textContent = `${title}. ${text}`;
    $("primaryButton").focus();
  }
  showOverlay(mode.eyebrow, mode.title, `${mode.intro}\n${mode.tip}`, "시작하기", "이동: WASD/방향키/화면 클릭 · 능력: Space · 터치 버튼 지원");
  $("soundButton").addEventListener("click", () => {
    sound = !sound;
    $("soundButton").textContent = sound ? "소리 켬" : "소리 끔";
    $("soundButton").setAttribute("aria-pressed", String(sound));
    if (sound) beep(640, 0.07);
  });

  function makeState() {
    const p = { x: W / 2, y: H / 2, hp: 6, maxHp: 6, invuln: 0, dx: 1, dy: 0 };
    return {
      status: "play", p, t: 0, kills: 0, xp: 0, xpNeed: 5, level: 1,
      enemies: [], shots: [], drops: [], nodes: modeKey === "signal" ? [{ x: p.x - 48 * scale, y: p.y, life: 35 }] : [],
      trail: [], effects: [], moveTarget: null, spawnIn: 0.6, fireIn: 0.5, abilityCd: 0, heat: 0, overheated: false,
      trailIn: 0, notice: "", noticeTime: 0, hotWarning: false,
      upgrade: { lineDamage: 2, lineWidth: 12, shotDamage: 2, ventRadius: 105, cooling: 10, echoDamage: 1, echoLife: 3.1, abilityRate: 0 },
    };
  }
  function startGame() {
    state = makeState(); keys.clear();
    $("overlay").hidden = true; $("upgradePanel").hidden = true;
    $("liveStatus").textContent = `${mode.title} 시작. 60초 동안 생존하세요.`;
    canvas.focus();
    lastFrame = performance.now(); beep(750, 0.08);
  }
  $("primaryButton").addEventListener("click", () => {
    if (state?.status === "paused") { state.status = "play"; $("overlay").hidden = true; lastFrame = performance.now(); }
    else startGame();
  });

  function announce(message, seconds = 1.4) {
    state.notice = message; state.noticeTime = seconds;
    $("liveStatus").textContent = `${Math.ceil(60 - state.t)}초 남음. ${message}`;
  }
  function doAbility() {
    if (!state || state.status !== "play") return;
    const s = state, p = s.p;
    if (s.abilityCd > 0) return;
    if (modeKey === "signal") {
      s.nodes.push({ x: p.x, y: p.y, life: 35 });
      if (s.nodes.length > 4) s.nodes.shift();
      s.abilityCd = Math.max(1.05, 2.7 - s.upgrade.abilityRate);
      announce("전류선 연결", 0.8); beep(620, 0.08);
    } else if (modeKey === "heat") {
      if (s.heat < 12) { announce("열이 12% 이상일 때 배출할 수 있습니다."); return; }
      const r = (s.upgrade.ventRadius + Math.min(s.heat, 100) * 0.35) * scale;
      s.effects.push({ type: "ring", x: p.x, y: p.y, r, life: 0.35, max: 0.35, color: "#ffb079" });
      for (const e of s.enemies) if (distance(e, p) <= r) hitEnemy(e, 2 + Math.floor(s.heat / 32));
      const recovered = s.heat >= 70 && p.hp < p.maxHp;
      if (recovered) p.hp++;
      s.heat = 0; s.overheated = false;
      s.abilityCd = Math.max(1.4, 5.2 - s.upgrade.abilityRate);
      announce(recovered ? "초고열 배출 · 생명 1 회복" : "열 배출!", 0.8); beep(180, 0.18, 0.07);
    } else {
      const len = 92 * scale;
      p.x = clamp(p.x + p.dx * len, 16, W - 16);
      p.y = clamp(p.y + p.dy * len, 16, H - 16);
      p.invuln = Math.max(p.invuln, 0.55);
      s.effects.push({ type: "ring", x: p.x, y: p.y, r: 38 * scale, life: 0.22, max: 0.22, color: "#b2aaff" });
      s.abilityCd = Math.max(1.1, 3.1 - s.upgrade.abilityRate);
      announce("대시", 0.6); beep(840, 0.09);
    }
  }

  function chooseUpgrade(i) {
    if (!state || state.status !== "upgrade") return;
    const choice = mode.upgrades[i]; if (!choice) return;
    const key = choice[2], s = state;
    if (key === "lineDamage" || key === "shotDamage" || key === "echoDamage") s.upgrade[key] += 1;
    else if (key === "lineWidth") s.upgrade[key] += 6;
    else if (key === "ventRadius") s.upgrade[key] += 28;
    else if (key === "cooling") s.upgrade[key] += 3;
    else if (key === "echoLife") s.upgrade[key] += 0.7;
    else if (key === "abilityRate") s.upgrade[key] += 0.45;
    s.status = "play"; $("upgradePanel").hidden = true; canvas.focus(); lastFrame = performance.now();
    announce(`${choice[0]} 강화!`, 1.3); beep(880, 0.11);
  }
  function levelUp() {
    const s = state; s.level++; s.xp -= s.xpNeed; s.xpNeed = 5 + s.level * 4;
    s.status = "upgrade";
    $("upgradeChoices").innerHTML = "";
    mode.upgrades.forEach((choice, i) => {
      const button = document.createElement("button");
      button.type = "button";
      const kbd = document.createElement("kbd"), strong = document.createElement("strong"), span = document.createElement("span");
      kbd.textContent = String(i + 1); strong.textContent = choice[0]; span.textContent = choice[1];
      button.append(kbd, strong, span); button.addEventListener("click", () => chooseUpgrade(i));
      $("upgradeChoices").append(button);
    });
    $("upgradePanel").hidden = false;
    $("liveStatus").textContent = `레벨 ${s.level}. 다음 성장을 선택하세요. 숫자 1부터 3까지 또는 버튼을 누르세요.`;
    $("upgradeChoices").querySelector("button")?.focus();
    beep(940, 0.12);
  }
  function gainXP(amount = 1) { state.xp += amount; if (state.xp >= state.xpNeed && state.status === "play") levelUp(); }

  function spawnEnemy() {
    const s = state, side = Math.floor(Math.random() * 4), margin = 22;
    let x = random(0, W), y = random(0, H);
    if (side === 0) x = -margin;
    if (side === 1) x = W + margin;
    if (side === 2) y = -margin;
    if (side === 3) y = H + margin;
    const fast = Math.random() < 0.27 + s.t / 420;
    const modePressure = modeKey === "heat" ? 1.3 : 1;
    s.enemies.push({ x, y, r: (fast ? 9 : 13) * scale, speed: (fast ? 64 : 43) * scale * modePressure * (1 + s.t / 180), hp: fast ? 1 : 2, maxHp: fast ? 1 : 2, hitCd: 0, type: fast ? "runner" : "brute", dead: false });
  }
  function hitEnemy(e, amount) {
    if (e.dead) return;
    e.hp -= amount;
    state.effects.push({ type: "spark", x: e.x, y: e.y, life: 0.19, max: 0.19, color: mode.color });
    if (e.hp <= 0) {
      e.dead = true; state.kills++;
      state.drops.push({ x: e.x, y: e.y, r: 5 * scale });
      if (state.kills % (modeKey === "heat" ? 16 : 8) === 0 && state.p.hp < state.p.maxHp) {
        state.p.hp++;
        announce("생명 1 회복", 1.1);
      }
      if (state.kills % 4 === 0) beep(380 + Math.min(state.kills * 4, 220), 0.035, 0.017);
    }
  }
  function nearestEnemy(radius) {
    let best = null, bestD = radius;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const d = distance(e, state.p);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  function fireAtEnemy(speed, damage) {
    const target = nearestEnemy(270 * scale); if (!target) return;
    const p = state.p, dx = target.x - p.x, dy = target.y - p.y, length = Math.hypot(dx, dy) || 1;
    state.shots.push({ x: p.x, y: p.y, vx: dx / length * speed * scale, vy: dy / length * speed * scale, damage, life: 1.1 });
    beep(modeKey === "heat" ? 300 : 480, 0.022, 0.012);
  }
  function pointSegmentDistance(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / length2, 0, 1);
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }
  function endGame(win) {
    const s = state; s.status = win ? "won" : "lost";
    beep(win ? 920 : 160, 0.22, 0.06);
    showOverlay(win ? "RUN COMPLETE" : "RUN ENDED", win ? "60초 생존 성공" : "생존 실패", `${mode.title} · 처치 ${s.kills} · 레벨 ${s.level}\n${win ? "다른 성장 선택으로 다시 도전할 수 있습니다." : "움직임과 능력 타이밍을 바꿔 다시 시도하세요."}`, "다시 플레이", "R 키로도 바로 재시작할 수 있습니다.");
  }

  function update(dt) {
    const s = state, p = s.p;
    s.t += dt;
    if (s.t >= 60) { s.t = 60; endGame(true); return; }
    s.abilityCd = Math.max(0, s.abilityCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    s.noticeTime = Math.max(0, s.noticeTime - dt);
    let x = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
    let y = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup"));
    if (x || y) s.moveTarget = null;
    else if (s.moveTarget) {
      const dx = s.moveTarget.x - p.x, dy = s.moveTarget.y - p.y;
      if (Math.hypot(dx, dy) < 8 * scale) s.moveTarget = null;
      else { x = dx; y = dy; }
    }
    const length = Math.hypot(x, y) || 1;
    if (x || y) {
      p.dx = x / length; p.dy = y / length;
      const heatSlow = modeKey === "heat" ? Math.max(0, s.heat - 55) / 45 * 0.3 : 0;
      const speed = 230 * scale * (1 - heatSlow);
      p.x = clamp(p.x + p.dx * speed * dt, 16 * scale, W - 16 * scale);
      p.y = clamp(p.y + p.dy * speed * dt, 16 * scale, H - 16 * scale);
    }

    s.spawnIn -= dt;
    if (s.spawnIn <= 0 && s.enemies.length < 95) {
      spawnEnemy();
      s.spawnIn = Math.max(0.43, 1.35 - s.t * 0.011) * (modeKey === "heat" ? 0.78 : 1) * random(0.85, 1.16);
    }
    for (const e of s.enemies) {
      if (e.dead) continue;
      e.hitCd = Math.max(0, e.hitCd - dt);
      const dx = p.x - e.x, dy = p.y - e.y, length = Math.hypot(dx, dy) || 1;
      e.x += dx / length * e.speed * dt; e.y += dy / length * e.speed * dt;
      if (length < e.r + 10 * scale && p.invuln <= 0) {
        p.hp--; p.invuln = 1.5;
        e.x -= dx / length * 58 * scale;
        e.y -= dy / length * 58 * scale;
        s.effects.push({ type: "ring", x: p.x, y: p.y, r: 34 * scale, life: 0.28, max: 0.28, color: "#ff738a" });
        announce("피격! 적과 거리를 벌리세요."); beep(140, 0.16, 0.06);
        if (p.hp <= 0) { endGame(false); return; }
      }
    }

    if (modeKey === "signal") {
      for (const n of s.nodes) n.life -= dt;
      s.nodes = s.nodes.filter((n) => n.life > 0);
      for (let i = 1; i < s.nodes.length; i++) {
        const a = s.nodes[i - 1], b = s.nodes[i];
        for (const e of s.enemies) {
          if (!e.dead && e.hitCd <= 0 && pointSegmentDistance(e.x, e.y, a, b) < e.r + s.upgrade.lineWidth * scale * 0.5) {
            hitEnemy(e, s.upgrade.lineDamage); e.hitCd = 0.42;
          }
        }
      }
      s.fireIn -= dt;
      if (s.fireIn <= 0) { fireAtEnemy(390, 1); s.fireIn = 0.9; }
    } else if (modeKey === "heat") {
      s.heat = Math.max(0, s.heat - s.upgrade.cooling * dt);
      if (s.overheated && s.heat <= 35) { s.overheated = false; announce("열핵 복구", 0.9); }
      s.fireIn -= dt;
      if (s.fireIn <= 0 && !s.overheated) {
        fireAtEnemy(440, s.upgrade.shotDamage);
        s.heat = Math.min(100, s.heat + 10 + (s.upgrade.shotDamage - 2) * 3);
        if (s.heat >= 55 && !s.hotWarning) { s.hotWarning = true; announce("고열 · 이동 속도가 느려집니다. 배출 시점을 정하세요.", 1.8); }
        if (s.heat >= 100) { s.overheated = true; announce("과열! 냉각을 기다리거나 열을 배출하세요.", 2); beep(120, 0.14); }
        s.fireIn = 0.46;
      }
      if (s.heat < 45) s.hotWarning = false;
    } else {
      s.trailIn -= dt;
      if (s.trailIn <= 0 && (x || y)) { s.trail.push({ x: p.x, y: p.y, age: 0 }); s.trailIn = 0.10; }
      for (const t of s.trail) t.age += dt;
      s.trail = s.trail.filter((t) => t.age < s.upgrade.echoLife + 1.1);
      for (const e of s.enemies) {
        if (e.dead || e.hitCd > 0) continue;
        for (const t of s.trail) {
          if (t.age >= 1.0 && t.age <= s.upgrade.echoLife && distance(e, t) < e.r + 11 * scale) {
            hitEnemy(e, s.upgrade.echoDamage); e.hitCd = 0.58; break;
          }
        }
      }
      s.fireIn -= dt;
      if (s.fireIn <= 0) { fireAtEnemy(340, 1); s.fireIn = 1.25; }
    }

    for (const shot of s.shots) {
      shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.life -= dt;
      for (const e of s.enemies) {
        if (!e.dead && distance(shot, e) < e.r + 5 * scale) { hitEnemy(e, shot.damage); shot.life = 0; break; }
      }
    }
    s.shots = s.shots.filter((shot) => shot.life > 0 && shot.x > -20 && shot.x < W + 20 && shot.y > -20 && shot.y < H + 20);
    s.enemies = s.enemies.filter((e) => !e.dead);
    for (const drop of s.drops) {
      const dx = p.x - drop.x, dy = p.y - drop.y, d = Math.hypot(dx, dy) || 1;
      if (d < 175 * scale) { drop.x += dx / d * 260 * scale * dt; drop.y += dy / d * 260 * scale * dt; }
      if (d < 16 * scale) { drop.taken = true; gainXP(1); }
    }
    s.drops = s.drops.filter((d) => !d.taken);
    for (const e of s.effects) e.life -= dt;
    s.effects = s.effects.filter((e) => e.life > 0);
  }

  function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function render() {
    ctx.fillStyle = "#081a29"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#173447"; ctx.lineWidth = 1;
    const grid = 44 * scale;
    for (let x = (W / 2) % grid; x < W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = (H / 2) % grid; y < H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    if (!state) return;
    const s = state, p = s.p;
    if (s.moveTarget) { ctx.beginPath(); ctx.arc(s.moveTarget.x, s.moveTarget.y, 11 * scale, 0, Math.PI * 2); ctx.strokeStyle = mode.color + "99"; ctx.lineWidth = 2 * scale; ctx.stroke(); }
    if (modeKey === "signal") {
      for (let i = 1; i < s.nodes.length; i++) {
        const a = s.nodes[i - 1], b = s.nodes[i];
        ctx.strokeStyle = "#2bb9b888"; ctx.lineWidth = (s.upgrade.lineWidth + 10) * scale;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = "#8bf9d7"; ctx.lineWidth = 3 * scale; ctx.stroke();
      }
      for (const n of s.nodes) { circle(n.x, n.y, 13 * scale, "#4ddcc7"); circle(n.x, n.y, 6 * scale, "#e1fff2"); }
    }
    if (modeKey === "echo") {
      for (const t of s.trail) {
        const active = t.age >= 1 && t.age <= s.upgrade.echoLife;
        circle(t.x, t.y, (active ? 12 : 5) * scale, active ? "#b5adff9c" : "#7b86d957");
      }
    }
    for (const d of s.drops) { circle(d.x, d.y, 7 * scale, "#1f6276"); circle(d.x, d.y, 4 * scale, "#a6f7fe"); }
    for (const shot of s.shots) circle(shot.x, shot.y, 4.6 * scale, mode.color);
    for (const e of s.enemies) {
      circle(e.x, e.y, e.r + 3 * scale, e.type === "runner" ? "#86475b" : "#793b60");
      circle(e.x, e.y, e.r, e.type === "runner" ? "#ff8294" : "#e65f88");
      circle(e.x, e.y, e.r * 0.34, "#ffd1da");
    }
    for (const fx of s.effects) {
      ctx.globalAlpha = clamp(fx.life / fx.max, 0, 1);
      if (fx.type === "ring") { ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r * (1 - fx.life / fx.max * 0.45), 0, Math.PI * 2); ctx.strokeStyle = fx.color; ctx.lineWidth = 4 * scale; ctx.stroke(); }
      else circle(fx.x, fx.y, (1 - fx.life / fx.max) * 17 * scale, fx.color);
      ctx.globalAlpha = 1;
    }
    if (modeKey === "heat") { ctx.beginPath(); ctx.arc(p.x, p.y, (23 + s.heat * 0.12) * scale, 0, Math.PI * 2); ctx.strokeStyle = s.overheated ? "#ff5e75" : "#ffb07788"; ctx.lineWidth = 2.5 * scale; ctx.stroke(); }
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) ctx.globalAlpha = 0.45;
    circle(p.x, p.y, 15 * scale, "#113543"); circle(p.x, p.y, 12 * scale, mode.color);
    circle(p.x + p.dx * 4 * scale, p.y + p.dy * 4 * scale, 4 * scale, "#f5fff9"); ctx.globalAlpha = 1;
    if (s.noticeTime > 0) {
      ctx.fillStyle = "#071927dd"; ctx.fillRect(W / 2 - Math.min(W / 2 - 12, 250), 17, Math.min(W - 24, 500), 33);
      ctx.fillStyle = "#e7faff"; ctx.textAlign = "center"; ctx.font = `700 ${14 * scale + 3}px system-ui`;
      ctx.fillText(s.notice, W / 2, 39, W - 40);
    }
  }
  function updateHUD() {
    const s = state; if (!s) return;
    const remaining = Math.max(0, Math.ceil(60 - s.t));
    $("timeValue").textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    $("healthValue").textContent = `${s.p.hp} / ${s.p.maxHp}`;
    $("levelValue").textContent = String(s.level);
    $("killValue").textContent = String(s.kills);
    $("xpText").textContent = `${s.xp} / ${s.xpNeed}`;
    $("xpFill").style.width = `${clamp(s.xp / s.xpNeed * 100, 0, 100)}%`;
    $("heatText").textContent = `${Math.round(s.heat)}%`;
    $("heatFill").style.width = `${s.heat}%`;
    const cooldown = s.abilityCd > 0 ? `${s.abilityCd.toFixed(1)}초 후` : modeKey === "heat" && s.heat < 12 ? "열 12% 필요" : "준비됨";
    $("abilityValue").textContent = cooldown;
    const mobileLabel = modeKey === "heat"
      ? `열 ${Math.round(s.heat)}%\n${s.abilityCd > 0 ? s.abilityCd.toFixed(1) + "초" : s.heat < 12 ? "충전 중" : "배출"}`
      : `${mode.action}\n${s.abilityCd > 0 ? s.abilityCd.toFixed(1) + "초" : "준비"}`;
    if ($("touchAction").textContent !== mobileLabel) $("touchAction").textContent = mobileLabel;
  }
  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.05); lastFrame = now;
    if (state?.status === "play") update(dt);
    render(); updateHUD(); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function togglePause() {
    if (!state) return;
    if (state.status === "play") { state.status = "paused"; showOverlay("PAUSED", "잠시 멈춤", "준비되면 이어서 플레이하세요.", "계속하기", "P 키로도 이어서 플레이할 수 있습니다."); }
    else if (state.status === "paused") { state.status = "play"; $("overlay").hidden = true; lastFrame = performance.now(); }
  }
  window.addEventListener("keydown", (event) => {
    const k = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) event.preventDefault();
    if (state?.status === "upgrade" && ["1", "2", "3"].includes(k)) { chooseUpgrade(Number(k) - 1); return; }
    if (k === "p") { togglePause(); return; }
    if (k === "r" && ["lost", "won"].includes(state?.status)) { startGame(); return; }
    if (k === " " || k === "space") { if (!event.repeat) doAbility(); return; }
    keys.add(k);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => { keys.clear(); if (state?.status === "play") togglePause(); });
  canvas.addEventListener("pointerdown", (event) => {
    if (state?.status !== "play") return;
    const box = canvas.getBoundingClientRect();
    state.moveTarget = { x: clamp(event.clientX - box.left, 16 * scale, W - 16 * scale), y: clamp(event.clientY - box.top, 16 * scale, H - 16 * scale) };
  });
  for (const button of document.querySelectorAll("[data-dir]")) {
    const dir = { up: "w", down: "s", left: "a", right: "d" }[button.dataset.dir];
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(dir); });
    button.addEventListener("pointerup", () => keys.delete(dir));
    button.addEventListener("pointercancel", () => keys.delete(dir));
    button.addEventListener("lostpointercapture", () => keys.delete(dir));
  }
  $("touchAction").addEventListener("click", doAbility);
})();
