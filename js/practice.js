(() => {
  "use strict";
  const NOTE_SPREAD = 95;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const uniqueNotes = notes => [...new Set(notes.filter(n => Number.isInteger(n) && n >= 21 && n <= 108))].sort((a, b) => a - b);
  const same = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
  function makePlan(start, bpm, beat, bars = 8) {
    const step = 60000 / bpm;
    const tolerance = clamp(step * .11, 55, 100);
    const window = Math.min(step * .45, tolerance * 2.4);
    const targets = Array.from({ length: bars }, (_, i) => {
      const hit = beat === "rotate" ? i % 4 + 1 : Number(beat);
      return { time: start + ((i + 1) * 4 + hit - 1) * step, beat: hit, result: null };
    });
    return { start, step, tolerance, window, targets, end: Math.max(start + (bars + 1) * 4 * step, targets.at(-1).time + window + NOTE_SPREAD + 30) };
  }
  function score(plan, notes, expected, first, last = first) {
    // Closest target overall, not closest remaining target: extra presses cannot fill a different bar.
    const target = plan.targets.reduce((nearest, t) => Math.abs(first - t.time) < Math.abs(first - nearest.time) ? t : nearest);
    const delta = first - target.time;
    if (target.result || Math.abs(delta) > plan.window) return null;
    const result = !same(uniqueNotes(notes), expected) || last - first > NOTE_SPREAD ? "wrong"
      : delta < -plan.tolerance ? "early" : delta > plan.tolerance ? "late" : "on";
    return { target, delta, result };
  }
  function midiMessage(data) {
    if (data?.length !== 3) return null;
    const [status, note, velocity] = data;
    const kind = status & 240;
    if (kind !== 128 && kind !== 144) return null;
    if (note > 127 || velocity > 127) return null;
    return { key: (status & 15) + ":" + note, note, down: kind === 144 && velocity > 0 };
  }
  if (typeof module === "object" && module.exports) {
    module.exports = { makePlan, score, uniqueNotes, midiMessage, NOTE_SPREAD };
    return;
  }

  const $ = id => document.getElementById("kt" + id);
  const practice = $("Practice"), dialog = $("MidiDialog");
  const beats = [...practice.querySelectorAll(".kt-beats span")];
  const api = window.KTTransposer;
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const defaultChords = [
    { name: "C major", notes: [60, 64, 67] },
    { name: "G major", notes: [55, 59, 62] },
    { name: "A minor", notes: [57, 60, 64] },
    { name: "F major", notes: [53, 57, 60] },
  ];
  const statusText = { on: "On time", early: "Early", late: "Late", wrong: "Wrong chord", miss: "Missed" };
  let audio, audioNodes = new Set(), active = null, runId = 0, frame = 0, launchPending = false;
  let held = new Map(), waitRelease = false, attempt = null, flushTimer = 0;
  let access = null, port = null, desired = "", failedPort = null, midiEpoch = 0, portEpoch = 0;
  let chordOptions = [], picked = new Set(), keys = new Map(), glowBeat = -1, glowUntil = 0, demoNotes = [], touchNotes = [], touchUntil = 0;
  let lastVisual = "", lastFeedback = "";
  const open = () => !practice.hidden;
  const chord = () => chordOptions[Number($("Chord").value)] || defaultChords[0];
  const hitMode = () => $("Target").value;
  const heldNotes = () => [...new Set(held.values())];
  const midiHeld = n => heldNotes().includes(n);
  window.KTPractice = { isHeld: midiHeld };

  function feedback(message, kind = "") {
    if (lastFeedback === message && $("Feedback").dataset.kind === kind) return;
    lastFeedback = message;
    $("Feedback").textContent = message;
    $("Feedback").dataset.kind = kind;
  }
  function announceMidi(message) { $("MidiStatus").textContent = message; }
  function paintKeys(now = performance.now()) {
    const live = new Set([...heldNotes(), ...(now < touchUntil ? touchNotes : [])]);
    const sample = new Set(demoNotes);
    for (const [n, key] of keys) {
      key.classList.toggle("pick", picked.has(n));
      key.classList.toggle("example", sample.has(n));
      key.classList.toggle("player", live.has(n));
      const pressed = String(picked.has(n));
      if (key.getAttribute("aria-pressed") !== pressed) key.setAttribute("aria-pressed", pressed);
    }
    $("Play").disabled = !picked.size || active?.demo === true;
  }
  function syncHeld() {
    if (open()) paintKeys();
    else api.refresh();
    $("Capture").disabled = !heldNotes().some(n => n >= 21 && n <= 108);
  }

  function drawKeyboard() {
    const notes = chord().notes;
    const center = Math.round((notes[0] + notes.at(-1)) / 2);
    const white = n => ![1, 3, 6, 8, 10].includes(n % 12);
    let lo = Math.max(21, Math.min(center - 8, notes[0] - 1)), hi = Math.min(108, Math.max(center + 8, notes.at(-1) + 1));
    if (!white(lo)) lo--;
    if (!white(hi)) hi++;
    const piano = $("Keyboard");
    const numWhite = Array.from({length: hi-lo+1}, (_, i) => lo+i).filter(white).length;
    piano.style.setProperty("--kt-min", Math.max(280, 21 * numWhite) + "px");
    piano.replaceChildren();
    keys.clear();
    let left = 0;
    for (let n = lo; n <= hi; n++) {
      const key = document.createElement("button");
      const w = white(n), name = names[n % 12] + (Math.floor(n / 12) - 1);
      key.type = "button";
      key.classList.toggle("black", !w);
      key.style.left = 100 * (w ? left : left - .30) / numWhite + "%";
      key.style.width = 100 * (w ? 1 : .60) / numWhite + "%";
      key.setAttribute("aria-label", name);
      if (w) key.textContent = n % 12 === 0 ? name : names[n % 12];
      key.addEventListener("click", () => {
        if (active?.demo) return;
        if (picked.has(n)) picked.delete(n); else picked.add(n);
        paintKeys();
      });
      keys.set(n, key);
      piano.append(key);
      if (w) left++;
    }
    piano.parentElement.scrollLeft = Math.max(0, (piano.scrollWidth - piano.parentElement.clientWidth) * .5);
    paintKeys();
  }
  function renderBeats(target, pulse = -1, demo = false, played = -1) {
    const state = [target, pulse, demo, played].join();
    if (state === lastVisual) return;
    lastVisual = state;
    beats.forEach((el, i) => {
      el.classList.toggle("target", i === target);
      el.classList.toggle("pulse", i === pulse);
      el.classList.toggle("example", demo && i === target);
      el.classList.toggle("played", i === played);
      el.setAttribute("aria-label", "Beat " + (i + 1) + (i === target ? ", target" : ""));
    });
  }
  function renderResults(plan) {
    $("Results").replaceChildren(...(plan?.targets || []).map((t, i) => {
      const el = document.createElement("span");
      el.className = t.result || "";
      el.textContent = ({on:"✓",early:"‹",late:"›",wrong:"×",miss:"·"})[t.result] || i + 1;
      el.setAttribute("aria-label", "Bar " + (i + 1) + ": " + (statusText[t.result] || "pending"));
      return el;
    }));
  }
  function refreshIdle() {
    renderBeats(hitMode() === "rotate" ? 0 : Number(hitMode()) - 1);
  }
  function resetAttempt() {
    attempt = null;
    clearTimeout(flushTimer);
    waitRelease = held.size > 0;
  }
  function stopSound() {
    for (const oscillator of audioNodes) {
      try { oscillator.stop(); oscillator.disconnect(); } catch {}
    }
    audioNodes.clear();
  }
  function stop(message = "") {
    runId++;
    launchPending = false;
    cancelAnimationFrame(frame);
    active = null;
    stopSound();
    resetAttempt();
    demoNotes = []; touchNotes = []; touchUntil = 0;
    glowBeat = -1; glowUntil = 0;
    for (const id of ["Chord", "Tempo", "Target", "Demo", "Start"]) $(id).disabled = false;
    $("Stop").hidden = true;
    refreshIdle();
    paintKeys();
    if (message) feedback(message);
  }
  function closePractice() {
    stop();
    practice.hidden = true;
    document.body.classList.remove("kt-practicing");
    syncHeld();
    $("Open").focus();
  }
  function openPractice() {
    const s = api.selection();
    const presets = [
      { ...s, name: s.name || "Selected voicing" },
      ...api.chords().filter(Boolean).map(c => ({ ...c, name: "Slot " + c.slot + ": " + (c.name || "Saved chord") })),
      ...defaultChords,
    ].map(c => ({ ...c, notes: uniqueNotes(c.notes) })).filter(c => c.notes.length >= 2);
    chordOptions = presets;
    $("Chord").replaceChildren(...presets.map((c, i) => new Option(c.name, String(i))));
    $("Chord").value = "0";
    practice.hidden = false;
    document.body.classList.add("kt-practicing");
    picked.clear();
    drawKeyboard();
    renderResults();
    refreshIdle();
    feedback("Choose Example or Start");
    $("Start").focus();
  }
  async function unlockAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error("Audio unavailable");
    audio ||= new Audio();
    if (audio.state !== "running") await audio.resume();
    if (audio.state !== "running") throw new Error("Audio not running");
  }
  function tone(hz, when, duration, volume, type = "sine") {
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = type; osc.frequency.value = hz;
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + .009);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    osc.connect(gain); gain.connect(audio.destination);
    audioNodes.add(osc);
    osc.onended = () => { audioNodes.delete(osc); osc.disconnect(); gain.disconnect(); };
    osc.start(when); osc.stop(when + duration + .01);
  }
  function soundChord(notes, when, length) {
    for (const n of notes) tone(440 * 2 ** ((n - 69) / 12), when, length, .21 / notes.length, "triangle");
  }
  function result(data) {
    const { target, result, delta } = data;
    target.result = result;
    if (result !== "wrong") {
      glowBeat = target.beat - 1;
      glowUntil = Math.max(performance.now(), target.time) + 340;
    }
    feedback(statusText[result] + (result === "early" || result === "late" ? " · " + Math.round(Math.abs(delta)) + " ms" : ""), result);
    renderResults(active.plan);
  }
  function submit(notes, first, last) {
    if (!active || active.demo) return;
    const scored = score(active.plan, notes, active.notes, first, last);
    if (scored) result(scored);
    else if (first >= active.plan.start + 3.5 * active.plan.step && !active.plan.targets.some(t => t.result && Math.abs(first - t.time) < active.plan.step * .5)) {
      feedback("Aim for the outlined beat");
    }
  }
  function flushAttempt() {
    if (!attempt) return;
    const batch = attempt;
    attempt = null;
    clearTimeout(flushTimer);
    submit([...batch.notes], batch.first, batch.last);
  }
  function processNote(msg, clock) {
    if (!msg.down) {
      held.delete(msg.key);
      if (!held.size) {
        waitRelease = false;
        flushAttempt();
      }
      syncHeld();
      return;
    }
    if (held.has(msg.key) || document.hidden || dialog.open) return;
    held.set(msg.key, msg.note);
    syncHeld();
    if (!active || active.demo || waitRelease) return;
    if (attempt && clock - attempt.first > NOTE_SPREAD) {
      flushAttempt();
      waitRelease = true;
      return;
    }
    if (!attempt) {
      // Previously held keys don't count as a fresh attack.
      if (held.size > 1) { waitRelease = true; return; }
      attempt = { first: clock, last: clock, notes: new Set() };
      flushTimer = setTimeout(() => { flushAttempt(); waitRelease = held.size > 0; }, NOTE_SPREAD + 12);
    }
    attempt.last = Math.max(clock, attempt.last);
    attempt.notes.add(msg.note);
    // Let the short window finish so an unintended extra note cannot be ignored.
  }
  function tick() {
    if (!active) return;
    const { plan, demo, notes } = active;
    const now = performance.now();
    const index = Math.floor((now - plan.start) / plan.step);
    const bar = Math.floor(index / 4) - 1;
    const state = plan.targets[clamp(bar, 0, plan.targets.length - 1)];
    const pulse = index >= 0 && index < (plan.targets.length + 1) * 4 ? index % 4 : -1;
    if (index >= 4 && !active.go) {
      active.go = true;
      if (demo || lastFeedback.startsWith("Count")) feedback(demo ? "Example playing" : "Your turn");
    }
    const showingDemo = demo && bar >= 0 && bar < plan.targets.length && now >= state.time && now < state.time + Math.min(460, plan.step * .72);
    demoNotes = showingDemo ? notes : [];
    renderBeats(state.beat - 1, pulse, showingDemo, now < glowUntil ? glowBeat : -1);
    paintKeys(now);
    if (!demo) {
      for (const t of plan.targets) {
        if (!t.result && now > t.time + plan.window + NOTE_SPREAD + 18) {
          t.result = "miss";
          feedback("Missed", "miss");
          renderResults(plan);
        }
      }
    }
    if (now >= plan.end) {
      const good = plan.targets.filter(t => t.result === "on").length;
      stop(demo ? "Ready to try?" : good + " of " + plan.targets.length + " on time");
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  async function launch(demo) {
    if (active || launchPending) return;
    const token = ++runId;
    launchPending = true;
    $("Demo").disabled = $("Start").disabled = true;
    $("Stop").hidden = false;
    try {
      await unlockAudio();
      if (token !== runId || !open()) return;
      const bpm = clamp(Math.round(Number($("Tempo").value) || 72), 40, 160);
      $("Tempo").value = bpm;
      for (const id of ["Chord", "Tempo", "Target"]) $(id).disabled = true;
      resetAttempt();
      stopSound();
      const audioStart = audio.currentTime + .14;
      const out = audio.getOutputTimestamp?.();
      const offset = out?.performanceTime > 0 ? out.performanceTime + (audioStart - out.contextTime) * 1000 - performance.now() : 140;
      const start = performance.now() + (offset > 0 && offset < 500 ? offset : 140);
      const plan = makePlan(start, bpm, hitMode(), demo ? (hitMode() === "rotate" ? 4 : 2) : 8);
      const notes = [...chord().notes];
      active = { demo, plan, notes, go: false };
      renderResults(demo ? null : plan);
      for (let i = 0; i < (plan.targets.length + 1) * 4; i++) {
        tone(i % 4 === 0 ? 1400 : 900, audioStart + i * plan.step / 1000, .045, i % 4 === 0 ? .14 : .09);
      }
      if (demo) for (const t of plan.targets) soundChord(notes, audioStart + (t.time - start) / 1000, Math.min(.46, plan.step * .72 / 1000));
      feedback("Count in · 1 bar");
      tick();
    } catch {
      if (token === runId) stop("Audio unavailable. Tap Start to try again.");
    } finally {
      if (token === runId) launchPending = false;
    }
  }

  function detach() {
    portEpoch++;
    if (port) {
      port.onmidimessage = null;
      try { Promise.resolve(port.close()).catch(() => {}); } catch {}
    }
    port = null;
    held.clear(); resetAttempt(); syncHeld();
  }
  function refreshPorts() {
    if (!access) return;
    const ports = [...access.inputs.values()].filter(p => p.state === "connected");
    if (failedPort && !ports.includes(failedPort)) failedPort = null;
    if (!desired) desired = (ports.find(p => /YC.*(?:Port\s*1\b|MIDI\s*1\b)/i.test(p.name || "")) || ports[0])?.id || "";
    const next = ports.find(p => p.id === desired);
    $("Port").replaceChildren(...ports.map(p => new Option(p.name || "MIDI input", p.id)));
    if (!next && desired) $("Port").prepend(new Option("Disconnected", desired));
    $("Port").value = desired;
    $("PortLabel").hidden = !ports.length;
    if (next === port && port) return;
    const previous = port;
    detach();
    if (previous && active && !active.demo) stop("MIDI input changed");
    if (!next || next === failedPort) {
      announceMidi(next ? "Could not open input. Reconnect to try again." : desired ? "Input disconnected" : "No MIDI keyboard found");
      return;
    }
    port = next;
    const epoch = midiEpoch, binding = portEpoch;
    const stillCurrent = () => epoch === midiEpoch && binding === portEpoch && port === next;
    next.onmidimessage = event => {
      if (!stillCurrent() || next.state !== "connected") return;
      const msg = midiMessage(event.data);
      const now = performance.now(), stamp = event.timeStamp;
      if (msg) processNote(msg, Number.isFinite(stamp) && stamp > 0 && Math.abs(stamp - now) < 1000 ? stamp : now);
    };
    announceMidi("Connected: " + (next.name || "MIDI keyboard"));
    Promise.resolve().then(() => stillCurrent() && next.open()).catch(() => {
      if (!stillCurrent()) return;
      failedPort = next;
      refreshPorts();
    });
  }
  function disconnect() {
    midiEpoch++;
    if (access) access.onstatechange = null;
    access = null; desired = ""; failedPort = null;
    if (active && !active.demo) stop("MIDI disconnected");
    detach();
    $("PortLabel").hidden = $("Disconnect").hidden = true;
    $("Connect").disabled = false;
    announceMidi("Not connected");
  }
  async function connect() {
    if (access || $("Connect").disabled) return;
    if (!window.isSecureContext || !navigator.requestMIDIAccess) {
      announceMidi("Web MIDI unavailable here. Try Chrome or Edge over HTTPS.");
      return;
    }
    const epoch = ++midiEpoch;
    $("Connect").disabled = true; $("Disconnect").hidden = false;
    announceMidi("Waiting for MIDI permission…");
    try {
      const result = await navigator.requestMIDIAccess({ sysex: false });
      if (epoch !== midiEpoch) return;
      access = result;
      access.onstatechange = () => { if (epoch === midiEpoch) refreshPorts(); };
      refreshPorts();
    } catch (e) {
      if (epoch !== midiEpoch) return;
      disconnect();
      announceMidi(e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "MIDI permission denied" : "Could not connect MIDI");
    }
  }
  $("Open").addEventListener("click", openPractice);
  $("Back").addEventListener("click", closePractice);
  for (const id of ["Midi", "PracticeMidi"]) $(id).addEventListener("click", () => {
    if (active || launchPending) stop("Stopped");
    dialog.showModal();
  });
  $("Connect").addEventListener("click", connect);
  $("Disconnect").addEventListener("click", disconnect);
  $("Port").addEventListener("change", () => { desired = $("Port").value; failedPort = null; refreshPorts(); });
  $("Capture").addEventListener("click", () => api.capture(heldNotes()));
  $("Demo").addEventListener("click", () => launch(true));
  $("Start").addEventListener("click", () => launch(false));
  $("Stop").addEventListener("click", () => stop("Stopped"));
  $("Chord").addEventListener("change", () => { picked.clear(); drawKeyboard(); renderResults(); feedback("Choose Example or Start"); });
  $("Target").addEventListener("change", () => { refreshIdle(); renderResults(); });
  $("Play").addEventListener("click", async event => {
    const notes = uniqueNotes([...picked]);
    if (!notes.length || active?.demo) return;
    const now = performance.now(), token = runId, stamp = event.timeStamp;
    submit(notes, Number.isFinite(stamp) && stamp > 0 && Math.abs(stamp - now) < 1000 ? stamp : now, now);
    touchNotes = notes; touchUntil = now + 340;
    paintKeys();
    setTimeout(() => paintKeys(), 350);
    try {
      await unlockAudio();
      if (open() && token === runId) soundChord(notes, audio.currentTime + .005, .30);
    } catch {}
  });
  announceMidi("Not connected");
  window.addEventListener("pagehide", () => { stop(); disconnect(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    if (active || launchPending) stop("Paused when you left the tab");
    else stopSound();
    held.clear(); resetAttempt(); syncHeld();
  });
})();
