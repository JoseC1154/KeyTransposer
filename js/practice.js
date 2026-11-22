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
  const pedalDown = new Set(), sustained = new Map();
  const sustainFadeMs = 2400;
  const liveVoices = new Map();
  const pianoSwitch = $("PianoSound");
  let pianoSound = false, soundRequest = 0;

  // Live MIDI sound is separate from the example and metronome transport.
  function startLiveVoice(id, note, velocity) {
    if (!pianoSound || audio?.state !== "running") return;
    releaseLiveVoice(id, .055);
    const when = audio.currentTime, gain = audio.createGain();
    const peak = Math.max(.0002, .115 * (velocity / 127) ** 1.35);
    const partials = [["triangle", 1, .7], ["sine", 2, .2], ["sine", 3, .1]];
    const nodes = [];
    for (const [type, multiplier, volume] of partials) {
      const hz = 440 * 2 ** ((note - 69) / 12) * multiplier;
      if (hz > 16000) continue;
      const osc = audio.createOscillator(), partial = audio.createGain();
      osc.type = type;
      osc.frequency.value = hz;
      partial.gain.setValueAtTime(volume, when);
      osc.connect(partial); partial.connect(gain);
      nodes.push({ osc, partial });
      osc.start(when);
    }
    gain.connect(audio.destination);
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + .008);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001, peak * .13), when + 3.5);
    const voice = { gain, nodes, when, peak, tail: null };
    liveVoices.set(id, voice);
    // Release is normally scheduled by the controller, not by the practice clock.
  }

  function releaseLiveVoice(id, seconds) {
    const voice = liveVoices.get(id);
    if (!voice) return;
    const time = audio.currentTime, { gain, when, peak, nodes, tail } = voice;
    const elapsed = Math.max(0, time - when);
    const value = tail
      ? tail.value * (.0001 / tail.value) ** clamp((time - tail.time) / tail.seconds, 0, 1)
      : elapsed < .008
        ? .0001 * (peak / .0001) ** (elapsed / .008)
        : peak * (Math.max(.0001, peak * .13) / peak) ** clamp((elapsed - .008) / 3.492, 0, 1);
    const level = Math.max(.0001, value);
    gain.gain.cancelScheduledValues(time);
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(.0001, time + seconds);
    voice.tail = { time, value: level, seconds };
    for (const node of nodes) {
      node.osc.onended = () => {
        node.ended = true;
        node.osc.disconnect(); node.partial.disconnect();
        if (nodes.every(n => n.ended)) {
          gain.disconnect();
          if (liveVoices.get(id) === voice) liveVoices.delete(id);
        }
      };
      if (!node.ended) node.osc.stop(time + seconds + .015);
    }
  }

  function stopLiveVoices() {
    for (const id of liveVoices.keys()) releaseLiveVoice(id, .045);
    liveVoices.clear();
  }
  function clearSustain() {
    pedalDown.clear();
    sustained.clear();
  }
  function processPedal(data) {
    if (data?.length !== 3 || (data[0] & 240) !== 176 || data[1] !== 64) return;
    if (document.hidden) return;
    const channel = data[0] & 15;
    if (data[2] >= 64) pedalDown.add(channel);
    else {
      pedalDown.delete(channel);
      for (const [id, entry] of sustained) if (entry.channel === channel) {
        releaseLiveVoice(id, .10);
        sustained.delete(id);
      }
      paintKeys();
    }
  }
  let access = null, port = null, desired = "", failedPort = null, midiEpoch = 0, portEpoch = 0;
  const midiSize = $("Size"), midiSizePref = "kt_midi_keyboard_size_v1";
  try {
    const saved = localStorage.getItem(midiSizePref);
    if ([...midiSize.options].some(option => option.value === saved)) midiSize.value = saved;
  } catch {}
  function syncMidiLayout() {
    $("PianoSoundLabel").hidden = $("SizeLabel").hidden = !port;
    api.setMidiLayout(port ? Number(midiSize.value) : null);
  }
  let sequence = [], picked = new Set(), displayed = -1, glowBeat = -1, glowUntil = 0, demoNotes = [], guideNotes = [], touchNotes = [], touchUntil = 0;
  let lastVisual = "", lastFeedback = "";
  // A round has its own touch selection, separate from the loaded/editor chord.
  let roundMode = null;
  const playingPicks = () => roundMode ? active?.roundPicks : picked;
  function setRoundMode(mode) {
    roundMode = mode;
    document.body.classList.toggle("kt-running-round", !!mode);
  }
  const lockedControls = new Set();
  const open = () => !practice.hidden;
  const memoryGrid = document.getElementById("memoryGrid");
  const skippedBanks = new Map();
  let drag = null, suppressClick = null;
  const canSkip = () => open() && !active && !launchPending && !memoryGrid.classList.contains("is-editing");
  const skipSet = () => skippedBanks.get(api.bank());
  const memoryButton = event => event.target.closest?.("button.memBtn[data-slot]");
  function paintSkipped(chords = api.chords()) {
    const skipped = skipSet();
    for (const button of memoryGrid.querySelectorAll(".memBtn")) {
      const index = Number(button.dataset.slot), slot = index + 1;
      const eligible = open() && !!chords[index];
      const off = eligible && (skipped?.has(slot) ?? false);
      button.classList.toggle("kt-skipped", off);
      button.setAttribute("aria-label", "Memory slot " + slot + (off ? ", skipped in practice" : ""));
      if (eligible) button.setAttribute("aria-keyshortcuts", "ArrowDown ArrowUp");
      else button.removeAttribute("aria-keyshortcuts");
    }
  }
  function setSkipped(button, off) {
    if (!canSkip() || !button.classList.contains("filled")) return;
    const slot = Number(button.dataset.slot) + 1;
    let bank = skipSet();
    if (off === !!bank?.has(slot)) return;
    if (off) {
      if (!bank) skippedBanks.set(api.bank(), bank = new Set());
      bank.add(slot);
    } else bank.delete(slot);
    refreshBank();
    if (sequence.length) feedback("Slot " + slot + (off ? " skipped" : " included"));
  }
  function endSlotDrag(event, canceled = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const { button, y, bank, skipped, moved } = drag;
    drag = null;
    button.classList.remove("kt-slot-drag");
    button.style.removeProperty("--kt-slot-y");
    if (!moved || canceled) return;
    suppressClick = button;
    if (canSkip() && bank === api.bank()) {
      const dy = event.clientY - y;
      if (!skipped && dy >= 24) setSkipped(button, true);
      if (skipped && dy <= -24) setSkipped(button, false);
    }
  }
  memoryGrid.addEventListener("pointerdown", event => {
    const button = memoryButton(event);
    if (drag || event.isPrimary === false || event.button !== 0) return;
    suppressClick = null;
    if (!canSkip() || !button?.classList.contains("filled")) return;
    drag = { id: event.pointerId, button, y: event.clientY, x: event.clientX,
      bank: api.bank(), skipped: button.classList.contains("kt-skipped"), moved: false };
    button.setPointerCapture?.(event.pointerId);
  });
  memoryGrid.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dy = event.clientY - drag.y, dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) drag.moved = true;
    if (!drag.moved) return;
    drag.button.classList.add("kt-slot-drag");
    drag.button.style.setProperty("--kt-slot-y", (drag.skipped ? clamp(dy + 5, -20, 8) : clamp(dy, 0, 26)) + "px");
  });
  memoryGrid.addEventListener("pointerup", event => endSlotDrag(event));
  for (const name of ["pointercancel", "lostpointercapture"]) {
    memoryGrid.addEventListener(name, event => endSlotDrag(event, true));
  }
  memoryGrid.addEventListener("click", event => {
    if (!suppressClick || event.detail === 0) return;
    const button = suppressClick;
    suppressClick = null;
    if (memoryButton(event) === button) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  memoryGrid.addEventListener("keydown", event => {
    const button = memoryButton(event);
    if (!canSkip() || !button?.classList.contains("filled") || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    setSkipped(button, event.key === "ArrowDown");
  });
  const hitMode = () => $("Target").value;
  const heldNotes = () => [...new Set(held.values())];
  const midiHeld = n => heldNotes().includes(n);
  window.KTPractice = {
    isHeld: midiHeld,
    isOpen: open,
    hideEditorSelection: () => !!roundMode || (open() && picked.size > 0),
    hideLiveHighlights: () => roundMode === "demo",
    notesForSlot() {
      if (!open()) return null;
      const heldPiano = uniqueNotes(heldNotes());
      return picked.size ? uniqueNotes([...picked]) : heldPiano.length ? heldPiano : null;
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
      const selection = playingPicks();
      if (selection) {
        if (selection.has(n)) selection.delete(n); else selection.add(n);
        paintKeys();
      }
      return true;
    },
    paintKey(key, n) {
      let releasedAt = -Infinity;
      if (!midiHeld(n)) {
        for (const tail of sustained.values()) if (tail.note === n) releasedAt = Math.max(releasedAt, tail.time);
      }
      const elapsed = performance.now() - releasedAt;
      const showTail = roundMode !== "demo" && Number.isFinite(releasedAt);
      if (showTail && key.dataset.ktRelease !== String(releasedAt)) {
        key.style.setProperty("--kt-sustain-delay", `-${clamp(elapsed, 0, sustainFadeMs)}ms`);
        key.dataset.ktRelease = String(releasedAt);
      }
      if (!showTail) delete key.dataset.ktRelease;
      key.classList.toggle("kt-midi-sustain", showTail);
      key.classList.toggle("kt-pick", open() && !!playingPicks()?.has(n));
      key.classList.toggle("kt-example", open() && demoNotes.includes(n));
      key.classList.toggle("kt-guide", roundMode === "practice" && guideNotes.includes(n));
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
    $("Play").disabled = !playingPicks()?.size || !sequence.length;
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
    setRoundMode(null);
    for (const button of lockedControls) button.disabled = false;
    lockedControls.clear();
    stopSound();
    resetAttempt();
    demoNotes = []; guideNotes = []; touchNotes = []; touchUntil = 0;
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
    paintSkipped();
    syncHeld();
    $("Open").focus({ preventScroll: true });
  }
  function refreshBank() {
    if (!open() || active || launchPending) return;
    const chords = api.chords();
    const skipped = skipSet();
    if (skipped) for (const slot of skipped) if (!chords[slot - 1]) skipped.delete(slot);
    paintSkipped(chords);
    const next = chords.filter(c => c && !skipped?.has(c.slot))
      .map(c => ({ ...c, notes: uniqueNotes(c.notes) })).filter(c => c.notes.length);
    if (JSON.stringify(next) === JSON.stringify(sequence) && displayed >= 0) return;
    sequence = next;
    displayed = -1;
    displaySlot(0);
    renderResults();
    $("Demo").disabled = $("Start").disabled = !sequence.length;
    feedback(sequence.length ? "Choose Example or Start" : skipped?.size ? "Drag a red slot up to include it." : "Save a chord in a memory slot first.");
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
  let lastTap = null;
  let tapIntervals = [];
  function resetTempoTaps() {
    lastTap = null;
    tapIntervals = [];
  }
  function setTempo(value) {
    const bpm = clamp(Math.round(Number(value) || 72), 40, 160);
    const button = $("Tempo");
    button.value = bpm;
    button.textContent = "Tap · " + bpm;
    button.setAttribute("aria-label", "Tap tempo, " + bpm + " BPM");
    return bpm;
  }
  function practiceTempo() {
    resetTempoTaps();
    return setTempo($("Tempo").value);
  }
  $("Tempo").addEventListener("click", () => {
    const now = performance.now();
    const gap = lastTap === null ? Infinity : now - lastTap;
    if (gap < 200) return; // Ignore bounce without shifting the actual beat.
    lastTap = now;
    if (gap > 2000) {
      tapIntervals = [];
      return;
    }
    tapIntervals.push(gap);
    if (tapIntervals.length > 5) tapIntervals.shift();
    const ordered = [...tapIntervals].sort((a, b) => a - b);
    const median = (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2;
    setTempo(60000 / median);
  });
  $("Tempo").addEventListener("keydown", event => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    resetTempoTaps();
    setTempo(Number($("Tempo").value) + (event.key === "ArrowUp" ? 1 : -1));
  });
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
    const label = statusText[result] + (result === "early" || result === "late" ? " · " + Math.round(Math.abs(delta)) + " ms" : "");
    if (result !== "on") {
      startRound(false, label, result);
      return true;
    }
    glowBeat = target.beat - 1;
    glowUntil = Math.max(performance.now(), target.time) + 340;
    feedback(label, result);
    renderResults(active.plan);
    return false;
  }
  function submit(notes, first, last) {
    if (!active || active.demo || active.listen) return;
    const scored = score(active.plan, notes, [], first, last);
    if (scored) return result(scored);
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
  function processNote(msg, clock, velocity) {
    if (!msg.down) {
      const channel = Number(msg.key.split(":")[0]);
      const wasHeld = held.has(msg.key);
      if (wasHeld && pedalDown.has(channel)) {
        sustained.set(msg.key, { note: msg.note, channel, time: performance.now() });
        releaseLiveVoice(msg.key, sustainFadeMs / 1000);
      } else if (wasHeld) releaseLiveVoice(msg.key, .13);
      held.delete(msg.key);
      if (!held.size) {
        waitRelease = false;
        flushAttempt();
      }
      syncHeld();
      return;
    }
    if (held.has(msg.key) || document.hidden) return;
    sustained.delete(msg.key);
    held.set(msg.key, msg.note);
    startLiveVoice(msg.key, msg.note, velocity);
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
    let position = clamp(bar, 0, plan.targets.length - 1);
    if (!demo) {
      const unresolved = plan.targets.findIndex(t => !t.result);
      if (unresolved >= 0) {
        const next = plan.targets[unresolved];
        if (now > next.time + plan.window + NOTE_SPREAD + 18) {
          startRound(false, "Missed", "miss");
          return;
        }
        // A late target near the end of the bar can still be awaiting a score.
        position = Math.min(position, unresolved);
      }
    }
    const state = plan.targets[position];
    if (!demo && guideNotes !== state.notes) {
      if (guideNotes.length) {
        active.roundPicks.clear();
        touchNotes = []; touchUntil = 0;
      }
      guideNotes = state.notes;
      paintKeys();
    }
    displaySlot(position);
    const pulse = index >= 0 && index < (plan.targets.length + 1) * plan.count ? index % plan.count : -1;
    if (index >= plan.count && !active.go) {
      active.go = true;
      if (demo || lastFeedback.includes("Count in")) feedback(demo ? "Example playing" : "Your turn");
    }
    const showingDemo = demo && bar >= 0 && bar < plan.targets.length && now >= state.time && now < state.time + Math.min(460, plan.step * .72);
    const highlighted = showingDemo ? state.notes : [];
    if (demoNotes !== highlighted && (demoNotes.length || highlighted.length)) {
      demoNotes = highlighted;
      paintKeys();
    }
    renderBeats(state.beat - 1, pulse, showingDemo, now < glowUntil ? glowBeat : -1);
    if (now >= plan.end) {
      const good = plan.targets.filter(t => t.result === "on").length;
      stop(demo ? "Ready to try?" : good + " of " + plan.targets.length + " on time");
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  function startRound(demo, reason = "", kind = "") {
    cancelAnimationFrame(frame);
    resetAttempt();
    stopSound();
    glowBeat = -1; glowUntil = 0;
    guideNotes = []; demoNotes = []; touchNotes = []; touchUntil = 0;
    const { audioStart, start } = clocks();
    const plan = makePlan(start, practiceTempo(), hitMode(), sequence.length, $("Meter").value);
    plan.targets.forEach((t, i) => Object.assign(t, sequence[i]));
    active = { demo, plan, go: false, roundPicks: demo ? null : new Set() };
    renderResults(demo ? null : plan);
    for (let i = 0; i < (plan.targets.length + 1) * plan.count; i++) {
      scheduleClick(plan, i, audioStart + i * plan.step / 1000);
    }
    if (demo) for (const t of plan.targets) soundChord(t.notes, audioStart + (t.time - start) / 1000, Math.min(.46, plan.step * .72 / 1000));
    feedback(reason ? reason + " · Count in again" : "Count in · 1 bar", kind);
    tick();
  }
  async function launch(demo) {
    refreshBank();
    if (active || launchPending || !sequence.length) return;
    const token = ++runId;
    launchPending = true;
    setRoundMode(demo ? "demo" : "practice");
    paintKeys();
    lockExistingControls();
    $("Click").disabled = true;
    $("Demo").disabled = $("Start").disabled = true;
    $("Stop").hidden = false;
    try {
      await unlockAudio();
      if (token !== runId || !open()) return;
      for (const id of ["Tempo", "Target", "Meter"]) $(id).disabled = true;
      startRound(demo);
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
    stopLiveVoices();
    held.clear(); clearSustain(); resetAttempt(); syncHeld();
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
      syncMidiLayout();
      announceMidi(next ? "Could not open input. Reconnect to try again." : desired ? "Input disconnected" : "No MIDI keyboard found");
      return;
    }
    port = next;
    syncMidiLayout();
    const epoch = midiEpoch, binding = portEpoch;
    const stillCurrent = () => epoch === midiEpoch && binding === portEpoch && port === next;
    next.onmidimessage = event => {
      if (!stillCurrent() || next.state !== "connected") return;
      const msg = midiMessage(event.data);
      const now = performance.now(), stamp = event.timeStamp;
      if (msg) processNote(msg, Number.isFinite(stamp) && stamp > 0 && Math.abs(stamp - now) < 1000 ? stamp : now, event.data[2]);
      else processPedal(event.data);
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
    pianoSound = pianoSwitch.checked = false;
    soundRequest++;
    if (active && !active.demo && !active.listen) stop("MIDI disconnected");
    detach();
    syncMidiLayout();
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
  pianoSwitch.addEventListener("change", async () => {
    const request = ++soundRequest;
    if (!pianoSwitch.checked) {
      pianoSound = false;
      stopLiveVoices();
      return;
    }
    try {
      await unlockAudio();
      if (request === soundRequest && port) pianoSound = true;
    } catch {
      if (request !== soundRequest) return;
      pianoSwitch.checked = false;
      announceMidi("Piano sound unavailable. Try turning it on again.");
    }
  });
  midiSize.addEventListener("change", () => {
    if (!port || !midiSize.value) return;
    try { localStorage.setItem(midiSizePref, midiSize.value); } catch {}
    syncMidiLayout();
  });
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
  $("Meter").addEventListener("change", () => { resetTempoTaps(); refreshMeter(); renderResults(); });
  $("Target").addEventListener("change", () => { refreshIdle(); renderResults(); });
  $("Play").addEventListener("click", async event => {
    const notes = uniqueNotes([...(playingPicks() || [])]);
    if (!notes.length) return;
    const now = performance.now(), token = runId, session = active, stamp = event.timeStamp;
    if (submit(notes, Number.isFinite(stamp) && stamp > 0 && Math.abs(stamp - now) < 1000 ? stamp : now, now)) return;
    touchNotes = notes; touchUntil = now + 340;
    paintKeys();
    setTimeout(() => paintKeys(), 350);
    try {
      await unlockAudio();
      if (open() && token === runId && session === active) soundChord(notes, audio.currentTime + .005, .30);
    } catch {}
  });
  refreshMeter();
  announceMidi("Not connected");
  window.addEventListener("pagehide", () => { stop(); disconnect(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    if (active || launchPending) stop("Paused when you left the tab");
    else stopSound();
    stopLiveVoices();
    held.clear(); clearSustain(); resetAttempt(); syncHeld();
  });
})();
