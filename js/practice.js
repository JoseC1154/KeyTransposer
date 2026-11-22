(() => {
  "use strict";
  const NOTE_SPREAD = 95;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const uniqueNotes = notes => [...new Set(notes.filter(n => Number.isInteger(n) && n >= 21 && n <= 108))].sort((a, b) => a - b);
  const same = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
  const METERS = {
    "2/4": { count: 2, split: 1, accents: [] },
    "3/4": { count: 3, split: 1, accents: [] },
    "4/4": { count: 4, split: 1, accents: [] },
    "5/4": { count: 5, split: 1, accents: [3] },
    "6/8": { count: 6, split: 3, accents: [3] },
    "7/8": { count: 7, split: 1, accents: [2, 4] },
  };
  const meterFor = name => Object.hasOwn(METERS, name) ? METERS[name] : METERS["4/4"];
  function makePlan(start, bpm, beat, bars = 8, meter = "4/4") {
    const { count, split, accents } = meterFor(meter);
    const step = 60000 / bpm / split;
    const tolerance = clamp(step * .11, 55, 100);
    const window = Math.min(step * .45, tolerance * 2.4);
    const targets = Array.from({ length: bars }, (_, i) => {
      const hit = beat === "rotate" ? i % count + 1 : clamp(Number(beat) || 1, 1, count);
      return { time: start + ((i + 1) * count + hit - 1) * step, beat: hit, result: null };
    });
    return { start, step, count, accents, tolerance, window, targets, end: Math.max(start + (bars + 1) * count * step, targets.at(-1).time + window + NOTE_SPREAD + 30) };
  }
  function score(plan, notes, expected, first, last = first) {
    // Closest target overall, not closest remaining target: extra presses cannot fill a different bar.
    const target = plan.targets.reduce((nearest, t) => Math.abs(first - t.time) < Math.abs(first - nearest.time) ? t : nearest);
    const delta = first - target.time;
    if (target.result || Math.abs(delta) > plan.window) return null;
    const result = !same(uniqueNotes(notes), target.notes || expected) || last - first > NOTE_SPREAD ? "wrong"
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
  const beatStrip = practice.querySelector(".kt-beats");
  let beats = [...beatStrip.children];
  const api = window.KTTransposer;
  const statusText = { on: "On time", early: "Early", late: "Late", wrong: "Wrong chord", miss: "Missed" };
  let audio, audioNodes = new Set(), active = null, runId = 0, frame = 0, launchPending = false;
  let held = new Map(), waitRelease = false, attempt = null, flushTimer = 0;
  let access = null, port = null, desired = "", failedPort = null, midiEpoch = 0, portEpoch = 0;
  let sequence = [], picked = new Set(), displayed = -1, glowBeat = -1, glowUntil = 0, demoNotes = [], touchNotes = [], touchUntil = 0;
  let lastVisual = "", lastFeedback = "";
  const lockedControls = new Set();
  const open = () => !practice.hidden;
  const hitMode = () => $("Target").value;
  const heldNotes = () => [...new Set(held.values())];
  const midiHeld = n => heldNotes().includes(n);
  window.KTPractice = {
    isHeld: midiHeld,
    isOpen: open,
    notesForSlot() {
      if (!open()) return null;
      const heldPiano = uniqueNotes(heldNotes());
      return heldPiano.length ? heldPiano : picked.size ? uniqueNotes([...picked]) : null;
    },
    beforeSlot() {
      if (active || launchPending) stop("Stopped for chord memory");
    },
    slotLoaded(notes) {
      if (!open()) return;
      picked = new Set(uniqueNotes(notes));
      paintKeys();
    },
    pick(n) {
      if (!open()) return false;
      if (!active?.demo) {
        if (picked.has(n)) picked.delete(n); else picked.add(n);
        paintKeys();
      }
      return true;
    },
    paintKey(key, n) {
      key.classList.toggle("kt-pick", open() && picked.has(n));
      key.classList.toggle("kt-example", open() && demoNotes.includes(n));
      key.classList.toggle("kt-player", open() && performance.now() < touchUntil && touchNotes.includes(n));
    },
  };

  function feedback(message, kind = "") {
    if (lastFeedback === message && $("Feedback").dataset.kind === kind) return;
    lastFeedback = message;
    $("Feedback").textContent = message;
    $("Feedback").dataset.kind = kind;
  }
  function announceMidi(message) { $("MidiStatus").textContent = message; }
  function paintKeys() {
    api.refresh();
    $("Play").disabled = !picked.size || !sequence.length || active?.demo === true;
  }
  function syncHeld() {
    paintKeys();
    $("Capture").disabled = !heldNotes().some(n => n >= 21 && n <= 108);
  }

  function displaySlot(index) {
    if (index === displayed) return;
    displayed = index;
    const current = sequence[index], next = sequence[index + 1];
    $("Chord").textContent = current ? "Slot " + current.slot + (current.name ? " · " + current.name : "") : "No saved chords";
    $("Next").textContent = next ? "Next: Slot " + next.slot + (next.name ? " · " + next.name : "") : current ? (index + 1) + " of " + sequence.length : "";
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
      el.setAttribute("aria-label", ($("Meter").value.endsWith("/8") ? "Count " : "Beat ") + (i + 1) + (i === target ? ", target" : ""));
    });
  }
  function renderResults(plan) {
    $("Results").replaceChildren(...(plan?.targets || []).map(t => {
      const el = document.createElement("span");
      el.className = t.result || "";
      el.textContent = ({on:"✓",early:"‹",late:"›",wrong:"×",miss:"·"})[t.result] || t.slot;
      el.setAttribute("aria-label", "Slot " + t.slot + ": " + (statusText[t.result] || "pending"));
      return el;
    }));
  }
  function refreshMeter() {
    const value = $("Meter").value;
    const { count, split } = meterFor(value);
    const eighths = value.endsWith("/8");
    const mode = hitMode();
    const label = eighths ? "Count" : "Beat";
    $("Target").replaceChildren(...Array.from({length:count}, (_, i) => new Option(label + " " + (i + 1), String(i + 1))), new Option("Rotate 1–" + count, "rotate"));
    $("Target").value = mode === "rotate" ? mode : String(Math.min(Number(mode) || 1, count));
    $("TempoLabel").textContent = split === 3 ? "BPM (♩.)" : eighths ? "BPM (♪)" : "BPM";
    beats = Array.from({length:count}, (_, i) => {
      const el = document.createElement("span");
      el.textContent = i + 1;
      return el;
    });
    beatStrip.style.setProperty("--kt-count", count);
    beatStrip.setAttribute("aria-label", count + (eighths ? " counts per bar" : " beats per bar"));
    beatStrip.replaceChildren(...beats);
    lastVisual = "";
    refreshIdle();
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
  function lockExistingControls() {
    for (const button of document.querySelectorAll("#btnClear, #btnMenu, #commandDeck > div button")) {
      if (!button.disabled) {
        button.disabled = true;
        lockedControls.add(button);
      }
    }
  }
  function stop(message = "") {
    runId++;
    launchPending = false;
    cancelAnimationFrame(frame);
    active = null;
    for (const button of lockedControls) button.disabled = false;
    lockedControls.clear();
    stopSound();
    resetAttempt();
    demoNotes = []; touchNotes = []; touchUntil = 0;
    glowBeat = -1; glowUntil = 0;
    for (const id of ["Tempo", "Target", "Meter"]) $(id).disabled = false;
    $("Demo").disabled = $("Start").disabled = !sequence.length;
    $("Stop").hidden = true;
    $("Click").disabled = false;
    $("Click").setAttribute("aria-pressed", "false");
    $("Click").textContent = "Metronome";
    refreshIdle();
    syncHeld();
    if (message) feedback(message);
  }
  function closePractice() {
    stop();
    practice.hidden = true;
    $("Open").setAttribute("aria-expanded", "false");
    document.body.classList.remove("kt-practicing");
    syncHeld();
    $("Open").focus({ preventScroll: true });
  }
  function refreshBank() {
    if (!open() || active || launchPending) return;
    const next = api.chords().filter(Boolean).map(c => ({ ...c, notes: uniqueNotes(c.notes) })).filter(c => c.notes.length);
    if (JSON.stringify(next) === JSON.stringify(sequence) && displayed >= 0) return;
    sequence = next;
    displayed = -1;
    displaySlot(0);
    renderResults();
    $("Demo").disabled = $("Start").disabled = !sequence.length;
    feedback(sequence.length ? "Choose Example or Start" : "Save a chord in a memory slot first.");
    paintKeys();
  }
  window.KTPractice.bankChanged = refreshBank;
  function openPractice() {
    practice.hidden = false;
    $("Open").setAttribute("aria-expanded", "true");
    document.body.classList.add("kt-practicing");
    picked.clear();
    displayed = -1;
    refreshBank();
    refreshIdle();
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
  function scheduleClick(plan, index, when) {
    const position = index % plan.count;
    const accent = plan.accents.includes(position);
    tone(position === 0 ? 1400 : accent ? 1150 : 900, when, .055,
      position === 0 ? .28 : accent ? .22 : .17, "triangle");
  }
  function clocks() {
    const audioStart = audio.currentTime + .14;
    const out = audio.getOutputTimestamp?.();
    const offset = out?.performanceTime > 0 ? out.performanceTime + (audioStart - out.contextTime) * 1000 - performance.now() : 140;
    const start = performance.now() + (offset > 0 && offset < 500 ? offset : 140);
    return { audioStart, start };
  }
  function practiceTempo() {
    const bpm = clamp(Math.round(Number($("Tempo").value) || 72), 40, 160);
    $("Tempo").value = bpm;
    return bpm;
  }
  async function listen() {
    if (active?.listen || $("Click").getAttribute("aria-pressed") === "true") {
      stop("Metronome stopped");
      return;
    }
    if (active || launchPending) return;
    const token = ++runId;
    launchPending = true;
    $("Demo").disabled = $("Start").disabled = true;
    $("Click").setAttribute("aria-pressed", "true");
    $("Click").textContent = "Stop click";
    for (const id of ["Tempo", "Target", "Meter"]) $(id).disabled = true;
    try {
      await unlockAudio();
      if (token !== runId || !open()) return;
      stopSound();
      const bpm = practiceTempo();
      const { audioStart, start } = clocks();
      const plan = makePlan(start, bpm, "1", 1, $("Meter").value);
      active = { listen:true, plan, audioStart, nextClick:0 };
      feedback("Metronome on");
      tick();
    } catch {
      if (token === runId) stop("Audio unavailable. Try Metronome again.");
    } finally {
      if (token === runId) launchPending = false;
    }
  }
  function tickClick(session, now) {
    const {plan, audioStart} = session;
    const index = Math.floor((now - plan.start) / plan.step);
    renderBeats(0, index >= 0 ? index % plan.count : -1);
    // Queue ahead on the audio clock; never play a burst of missed clicks after a stalled frame.
    const elapsed = (audio.currentTime - audioStart) * 1000;
    session.nextClick = Math.max(session.nextClick, Math.ceil(elapsed / plan.step));
    const horizon = elapsed + 230;
    while (session.nextClick * plan.step < horizon) {
      const n = session.nextClick++;
      scheduleClick(plan, n, audioStart + n * plan.step / 1000);
    }
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
    if (!active || active.demo || active.listen) return;
    const scored = score(active.plan, notes, [], first, last);
    if (scored) result(scored);
    else if (first >= active.plan.start + (active.plan.count - .5) * active.plan.step && !active.plan.targets.some(t => t.result && Math.abs(first - t.time) < active.plan.step * .5)) {
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
    if (!active || active.demo || active.listen || waitRelease) return;
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
    const now = performance.now();
    if (active.listen) {
      tickClick(active, now);
      frame = requestAnimationFrame(tick);
      return;
    }
    const { plan, demo } = active;
    const index = Math.floor((now - plan.start) / plan.step);
    const bar = Math.floor(index / plan.count) - 1;
    const position = clamp(bar, 0, plan.targets.length - 1);
    const state = plan.targets[position];
    displaySlot(position);
    const pulse = index >= 0 && index < (plan.targets.length + 1) * plan.count ? index % plan.count : -1;
    if (index >= plan.count && !active.go) {
      active.go = true;
      if (demo || lastFeedback.startsWith("Count")) feedback(demo ? "Example playing" : "Your turn");
    }
    const showingDemo = demo && bar >= 0 && bar < plan.targets.length && now >= state.time && now < state.time + Math.min(460, plan.step * .72);
    const highlighted = showingDemo ? state.notes : [];
    if (demoNotes !== highlighted && (demoNotes.length || highlighted.length)) {
      demoNotes = highlighted;
      paintKeys();
    }
    renderBeats(state.beat - 1, pulse, showingDemo, now < glowUntil ? glowBeat : -1);
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
    refreshBank();
    if (active || launchPending || !sequence.length) return;
    const token = ++runId;
    launchPending = true;
    lockExistingControls();
    $("Click").disabled = true;
    $("Demo").disabled = $("Start").disabled = true;
    $("Stop").hidden = false;
    try {
      await unlockAudio();
      if (token !== runId || !open()) return;
      const bpm = practiceTempo();
      for (const id of ["Tempo", "Target", "Meter"]) $(id).disabled = true;
      resetAttempt();
      stopSound();
      const { audioStart, start } = clocks();
      const plan = makePlan(start, bpm, hitMode(), sequence.length, $("Meter").value);
      plan.targets.forEach((t, i) => Object.assign(t, sequence[i]));
      active = { demo, plan, go: false };
      renderResults(demo ? null : plan);
      for (let i = 0; i < (plan.targets.length + 1) * plan.count; i++) {
        scheduleClick(plan, i, audioStart + i * plan.step / 1000);
      }
      if (demo) for (const t of plan.targets) soundChord(t.notes, audioStart + (t.time - start) / 1000, Math.min(.46, plan.step * .72 / 1000));
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
    if (previous && active && !active.demo && !active.listen) stop("MIDI input changed");
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
    if (active && !active.demo && !active.listen) stop("MIDI disconnected");
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
  $("Open").addEventListener("click", () => open() ? closePractice() : openPractice());
  $("Midi").addEventListener("click", () => {
    if (active || launchPending) stop("Stopped");
    dialog.showModal();
  });
  $("Connect").addEventListener("click", connect);
  $("Disconnect").addEventListener("click", disconnect);
  $("Port").addEventListener("change", () => { desired = $("Port").value; failedPort = null; refreshPorts(); });
  $("Capture").addEventListener("click", () => {
    const notes = uniqueNotes(heldNotes());
    if (!notes.length) return;
    if (open()) window.KTPractice.slotLoaded(notes);
    else api.capture(notes);
  });
  $("Click").addEventListener("click", listen);
  $("Demo").addEventListener("click", () => launch(true));
  $("Start").addEventListener("click", () => launch(false));
  $("Stop").addEventListener("click", () => stop("Stopped"));
  $("Meter").addEventListener("change", () => { refreshMeter(); renderResults(); });
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
  refreshMeter();
  announceMidi("Not connected");
  window.addEventListener("pagehide", () => { stop(); disconnect(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    if (active || launchPending) stop("Paused when you left the tab");
    else stopSound();
    held.clear(); resetAttempt(); syncHeld();
  });
})();
