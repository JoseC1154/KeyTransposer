(() => {
  "use strict";
  const NOTE_SPREAD = 420;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const uniqueNotes = notes => [...new Set(notes.filter(n => Number.isInteger(n) && n >= 21 && n <= 108))].sort((a, b) => a - b);
  function sameVoicing(a, b) {
    if (!a.length || a.length !== b.length) return false;
    const shift = a[0] - b[0];
    return shift % 12 === 0 && a.every((note, i) => note - b[i] === shift);
  }
  function canCompleteVoicing(notes, expected) {
    const actual = uniqueNotes([...notes]), target = uniqueNotes(expected);
    if (!actual.length || actual.length >= target.length) return false;
    return target.some(anchor => {
      const shift = actual[0] - anchor;
      return shift % 12 === 0 && actual.every(n => target.includes(n - shift));
    });
  }
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
    const tolerance = clamp(step * .16, 70, 140);
    const window = Math.min(step * .45, tolerance * 2.4, 280);
    const targets = Array.from({ length: bars }, (_, i) => {
      const hit = beat === "rotate" ? i % count + 1 : clamp(Number(beat) || 1, 1, count);
      return { time: start + ((i + 1) * count + hit - 1) * step, beat: hit, result: null };
    });
    const end = start + (bars + 1) * count * step;
    targets.forEach((target, i) => { target.deadline = targets[i + 1]?.time ?? end; });
    return { start, step, count, accents, tolerance, window, targets, end };
  }
  function score(plan, notes, expected, first, last = first) {
    // Stay on the current chord until it passes, or the next chord's beat arrives.
    const target = plan.targets.find(t => !t.result);
    if (!target || first < target.time - plan.window || last >= target.deadline) return null;
    const delta = first - target.time;
    const result = !sameVoicing(uniqueNotes(notes), uniqueNotes(target.notes || expected)) || last - first > NOTE_SPREAD ? "wrong"
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
  const statusText = { on: "On time", wrong: "Wrong chord", miss: "Missed" };
  let audio, audioNodes = new Set(), active = null, runId = 0, frame = 0, launchPending = false;
  let held = new Map(), waitRelease = false, attempt = null, flushTimer = 0;
  const pedalDown = new Set(), sustained = new Map(), heldAttacks = new Map();
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
  let sequence = [], picked = new Set(), displayed = -1, glowBeat = -1, glowUntil = 0, glowSlot = -1, demoNotes = [], guideNotes = [], touchNotes = [], touchUntil = 0;
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
  const resonatingSlots = new Map();
  function syncSlotResonance() {
    if (!resonatingSlots.size) return;
    const live = new Set(heldAttacks.values());
    const tails = new Map([...sustained.values()].map(note => [note.attack, note.time]));
    for (const [slot, chord] of resonatingSlots) {
      const down = [...chord.attacks].some(attack => live.has(attack));
      const last = Math.max(-Infinity, ...[...chord.attacks].map(attack => tails.get(attack) ?? -Infinity));
      const state = open() && chord.bank === api.bank() ? down ? "held" : Number.isFinite(last) ? "sustain" : "" : "";
      const button = chord.button;
      if (!state) {
        if (button.dataset.ktResonance && glowSlot === slot) {
          glowSlot = -1;
          paintPlayingSlot(-1);
        }
        delete button.dataset.ktResonance;
        button.style.removeProperty("--kt-slot-decay-delay");
        resonatingSlots.delete(slot);
      } else if (button.dataset.ktResonance !== state || (state === "sustain" && last !== chord.last)) {
        button.dataset.ktResonance = state;
        chord.last = last;
        if (state === "sustain") button.style.setProperty("--kt-slot-decay-delay",
          `-${clamp(performance.now() - last, 0, sustainFadeMs)}ms`);
      }
    }
  }
  function clearSlotResonance() {
    for (const {button} of resonatingSlots.values()) {
      delete button.dataset.ktResonance;
      button.style.removeProperty("--kt-slot-decay-delay");
    }
    resonatingSlots.clear();
  }
  let drag = null, suppressClick = null, litSlot = null;
  function paintPlayingSlot(slot, kind) {
    const next = slot > 0 ? memoryGrid.querySelector('[data-slot="' + (slot - 1) + '"]') : null;
    if (litSlot === next && (!next || next.dataset.ktPlaying === kind)) return;
    if (litSlot) {
      delete litSlot.dataset.ktPlaying;
      litSlot.setAttribute("aria-label", "Memory slot " + (Number(litSlot.dataset.slot) + 1));
    }
    litSlot = next;
    if (!next) return;
    next.dataset.ktPlaying = kind;
    next.setAttribute("aria-label", "Memory slot " + slot + (kind === "example" ? ", playing example" : ", played correctly"));
  }
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
      key.classList.toggle("kt-guide", roundMode === "practice" && !!guideNotes?.includes(n));
      key.classList.toggle("kt-player", open() && performance.now() < touchUntil && touchNotes.includes(n));
    },
  };

  // Opt-in, in-memory trace. No audio, device name, account data, or uploads.
  const traceLimit = 3000;
  const recordSwitch = $("TimingRecord"), downloadTrace = $("TimingDownload");
  let trace = null, recording = false;
  const relativeMs = value => value == null ? null : value - trace.origin;
  const practiceRunning = () => active && !active.demo && !active.listen;
  const pendingTarget = () => active.plan.targets.find(t => !t.result);
  const validStamp = (stamp, now) => Number.isFinite(stamp) && stamp > 0 && Math.abs(stamp - now) < 1000;
  function traceEvent(type, fields, time = performance.now()) {
    if (!recording) return;
    if (trace.events.length === traceLimit) {
      trace.events.shift();
      trace.dropped++;
    }
    trace.events.push({ type, atMs: relativeMs(time), ...fields });
    if (downloadTrace.disabled) downloadTrace.disabled = false;
  }
  function targetTimes(target) {
    return target ? {
      slot: target.slot, beat: target.beat, expectedMidi: [...target.notes],
      targetMs: relativeMs(target.time), opensMs: relativeMs(target.time - active.plan.window),
      deadlineMs: relativeMs(target.deadline),
    } : null;
  }
  function tracePlan(reason) {
    if (!recording || !practiceRunning()) return;
    const { plan, audioStart, bpm, beat, meter, loop } = active;
    const output = audio.getOutputTimestamp?.();
    traceEvent("plan", {
      reason, bpm, hitOn: beat, meter, loop, beatLengthMs: plan.step,
      onTimeToleranceMs: plan.tolerance, maxChordSpreadMs: NOTE_SPREAD,
      countInStartMs: relativeMs(plan.start),
      metronomeStartAudioSec: audioStart,
      audioOutputSample: output?.performanceTime > 0 ? {
        audioSec: output.contextTime, clockMs: relativeMs(output.performanceTime),
      } : null,
      baseLatencyMs: Number.isFinite(audio.baseLatency) ? audio.baseLatency * 1000 : null,
      outputLatencyMs: Number.isFinite(audio.outputLatency) ? audio.outputLatency * 1000 : null,
      targets: plan.targets.map(targetTimes),
    });
  }
  function traceDecision(target, outcome, reason, notes = [], first, last, source = null) {
    if (!recording) return;
    traceEvent("decision", {
      target: targetTimes(target), source, outcome, reason, playedMidi: uniqueNotes(notes),
      firstMs: relativeMs(first), lastMs: relativeMs(last),
      firstOffsetMs: target && first != null ? first - target.time : null,
      lastOffsetMs: target && last != null ? last - target.time : null,
      spreadMs: first != null && last != null ? last - first : null,
    });
  }
  recordSwitch.checked = false;
  // A mouse tap on Record is usually followed by the Practice shortcut.
  recordSwitch.addEventListener("click", event => {
    if (event.detail > 0) practice.focus({ preventScroll: true });
  });
  recordSwitch.addEventListener("change", () => {
    recording = recordSwitch.checked;
    if (recording) {
      trace = { origin: performance.now(), events: [], dropped: 0 };
      downloadTrace.disabled = true;
      tracePlan("recording enabled during practice");
    }
  });
  downloadTrace.addEventListener("click", () => {
    if (!trace?.events.length) return;
    const data = { format: "keytransposer-practice-timing-v1", droppedEvents: trace.dropped, events: trace.events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "keytransposer-timing.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function feedback(message, kind = "") {
    if (lastFeedback === message && $("Feedback").dataset.kind === kind) return;
    lastFeedback = message;
    $("Feedback").textContent = message;
    $("Feedback").dataset.kind = kind;
  }
  function announceMidi(message) { $("MidiStatus").textContent = message; }
  function paintKeys() {
    api.refresh();
    syncSlotResonance();
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
      const status = t.timing && t.timing !== "on" ? "Correct, " + t.timing : statusText[t.result] || "pending";
      el.setAttribute("aria-label", "Slot " + t.slot + ": " + status);
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
  function stop(message = "", keepResonance = false) {
    if (!keepResonance) clearSlotResonance();
    runId++;
    launchPending = false;
    cancelAnimationFrame(frame);
    if (recording && practiceRunning()) traceEvent("stop", { reason: message || "practice closed" });
    active = null;
    setRoundMode(null);
    for (const button of lockedControls) button.disabled = false;
    lockedControls.clear();
    stopSound();
    resetAttempt();
    demoNotes = []; guideNotes = []; touchNotes = []; touchUntil = 0;
    glowBeat = -1; glowUntil = 0; glowSlot = -1;
    paintPlayingSlot(-1);
    for (const id of ["Tempo", "Target", "Meter"]) $(id).disabled = false;
    $("Demo").disabled = $("Start").disabled = !sequence.length;
    $("Stop").hidden = true;
    $("Click").disabled = false;
    $("Loop").disabled = false;
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
    syncSlotResonance();
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
  function playRetryCue(kind) {
    const when = audio.currentTime + .012;
    if (kind === "wrong") {
      // A low, descending double buzz contrasts with the high metronome click.
      tone(494, when, .13, .38, "triangle");
      tone(330, when + .16, .16, .38, "triangle");
    } else if (kind === "miss") {
      // Two equal pulses signal that the window ran out.
      tone(660, when, .095, .39, "triangle");
      tone(660, when + .17, .095, .39, "triangle");
    } else {
      return 0;
    }
    return .38; // Let the cue finish before the new count-in.
  }
  function clocks(lead = .14) {
    const audioStart = audio.currentTime + lead;
    const out = audio.getOutputTimestamp?.();
    const offset = out?.performanceTime > 0 ? out.performanceTime + (audioStart - out.contextTime) * 1000 - performance.now() : lead * 1000;
    const start = performance.now() + (offset > 0 && offset < (lead + .36) * 1000 ? offset : lead * 1000);
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
  function updatePracticeGuide(plan) {
    const next = plan.targets.findIndex(t => !t.result);
    const notes = next < 0 ? null : plan.targets[next].notes;
    if (guideNotes !== notes) {
      active.roundPicks.clear();
      touchNotes = []; touchUntil = 0;
      guideNotes = notes;
      paintKeys();
    }
    displaySlot(next < 0 ? plan.targets.length - 1 : next);
    return next;
  }
  function result(data, attacks) {
    const { target, result, delta } = data;
    if (result === "wrong") {
      startRound(false, statusText.wrong, "wrong");
      return true;
    }
    target.result = "on";
    target.timing = result;
    const label = result === "on" ? statusText.on
      : "Correct · " + Math.round(Math.abs(delta)) + " ms " + result;
    glowBeat = target.beat - 1;
    glowSlot = target.slot;
    paintPlayingSlot(glowSlot, "played");
    if (attacks?.size && litSlot) {
      resonatingSlots.set(glowSlot, { button: litSlot, attacks, bank: api.bank(), last: null });
      syncSlotResonance();
    }
    glowUntil = Math.max(performance.now(), target.time) + 340;
    feedback(label, "on");
    if (active.loop && active.plan.targets.every(t => t.result)) advancePass(active);
    renderResults(active.plan);
    const next = updatePracticeGuide(active.plan);
    const index = Math.floor((performance.now() - active.plan.start) / active.plan.step);
    const pulse = index < 0 ? -1 : index % active.plan.count;
    renderBeats(next < 0 ? -1 : active.plan.targets[next].beat - 1, pulse, false, glowBeat);
    return false;
  }
  function submit(notes, first, last, attacks, source = "midi") {
    if (!practiceRunning()) return;
    const scored = score(active.plan, notes, [], first, last);
    if (scored) {
      if (recording) traceDecision(scored.target, scored.result,
        scored.result !== "wrong" ? "matched"
          : !sameVoicing(uniqueNotes(notes), scored.target.notes) ? "notes or voicing differ" : "notes spread too far apart",
        notes, first, last, source);
      return result(scored, attacks);
    }
    const target = pendingTarget();
    const expired = target && last >= target.deadline;
    if (recording) traceDecision(target, expired ? "miss" : "ignored",
      !target ? "no pending chord" : expired ? "chord reached cutoff" : "started before window",
      notes, first, last, source);
    if (expired) {
      startRound(false, statusText.miss, "miss");
      return true;
    }
    if (target && first >= active.plan.start + (active.plan.count - .5) * active.plan.step
      && !active.plan.targets.some(t => t.result && Math.abs(first - t.time) < active.plan.step * .5)) {
      feedback("Aim for the outlined beat");
    }
  }
  function flushAttempt() {
    if (!attempt) return;
    const batch = attempt;
    attempt = null;
    clearTimeout(flushTimer);
    submit([...batch.notes], batch.first, batch.last, batch.attacks);
  }
  function processNote(msg, clock, velocity, receivedAt, stamp) {
    const traceNote = recording && practiceRunning();
    const logNote = reason => {
      if (!traceNote) return;
      const target = pendingTarget();
      traceEvent(msg.down ? "note-on" : "note-off", {
        midi: msg.note, channel: Number(msg.key.split(":")[0]) + 1, velocity, reason,
        inputMs: relativeMs(clock), receivedMs: relativeMs(receivedAt),
        timestampSource: validStamp(stamp, receivedAt) ? "MIDI event" : "handler clock",
        receiveDelayMs: receivedAt - clock, slot: target?.slot ?? null,
        targetMs: relativeMs(target?.time), offsetMs: target ? clock - target.time : null,
      }, receivedAt);
    };
    if (!msg.down) {
      logNote(held.has(msg.key) ? "released" : "not held");
      const channel = Number(msg.key.split(":")[0]);
      const wasHeld = held.has(msg.key);
      if (wasHeld && pedalDown.has(channel)) {
        sustained.set(msg.key, { note: msg.note, channel, time: performance.now(), attack: heldAttacks.get(msg.key) });
        releaseLiveVoice(msg.key, sustainFadeMs / 1000);
      } else if (wasHeld) releaseLiveVoice(msg.key, .13);
      held.delete(msg.key);
      heldAttacks.delete(msg.key);
      if (!held.size) {
        waitRelease = false;
        const target = active?.plan.targets.find(t => !t.result);
        const canRoll = attempt && target && clock < target.deadline
          && clock - attempt.first < NOTE_SPREAD && canCompleteVoicing(attempt.notes, target.notes);
        if (!canRoll) flushAttempt();
      }
      syncHeld();
      return;
    }
    if (held.has(msg.key) || document.hidden) {
      logNote(document.hidden ? "tab hidden" : "duplicate note-on");
      return;
    }
    sustained.delete(msg.key);
    held.set(msg.key, msg.note);
    const attack = Symbol();
    heldAttacks.set(msg.key, attack);
    startLiveVoice(msg.key, msg.note, velocity);
    syncHeld();
    if (!practiceRunning() || waitRelease) {
      logNote("waiting for keys to release");
      return;
    }
    if (attempt && clock - attempt.first > NOTE_SPREAD) {
      logNote("outside chord collection window");
      flushAttempt();
      waitRelease = true;
      return;
    }
    if (!attempt) {
      // Previously held keys don't count as a fresh attack.
      if (held.size > 1) {
        logNote("another key already held");
        waitRelease = true;
        return;
      }
      attempt = { first: clock, last: clock, notes: new Set(), attacks: new Set() };
      flushTimer = setTimeout(() => { flushAttempt(); waitRelease = held.size > 0; }, NOTE_SPREAD + 12);
    }
    logNote("collected");
    attempt.last = Math.max(clock, attempt.last);
    attempt.notes.add(msg.note);
    attempt.attacks.add(attack);
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
    const position = demo ? clamp(bar, 0, plan.targets.length - 1) : updatePracticeGuide(plan);
    const state = position < 0 ? null : plan.targets[position];
    if (demo) displaySlot(position);
    if (!demo && state && now >= state.deadline) {
      // Give an in-window attack time to finish grading, but never accept a note past the cutoff.
      if (!attempt || attempt.first >= state.deadline || now > attempt.first + NOTE_SPREAD + 18) {
        if (recording) traceDecision(state, "miss", attempt ? "cutoff with ungraded notes" : "cutoff without a graded chord",
          attempt ? [...attempt.notes] : [], attempt?.first, attempt?.last, attempt ? "midi" : null);
        startRound(false, statusText.miss, "miss");
        return;
      }
    }
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
    const lit = now < glowUntil;
    paintPlayingSlot(demo ? (showingDemo ? state.slot : -1) : lit ? glowSlot : -1, demo ? "example" : "played");
    renderBeats(state ? state.beat - 1 : -1, pulse, showingDemo, lit ? glowBeat : -1);
    if (now >= plan.end && (demo || !state)) {
      const good = plan.targets.filter(t => t.result === "on").length;
      const label = plan.targets.every(t => t.timing === "on") ? " on time" : " correct";
      stop(demo ? "Ready to try?" : good + " of " + plan.targets.length + label, !demo);
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  function buildPass(start, bpm, beat, meter, loop) {
    const plan = makePlan(start, bpm, beat, sequence.length, meter);
    plan.targets.forEach((t, i) => Object.assign(t, sequence[i]));
    if (loop) {
      const firstBeatOffset = (plan.targets[0].beat - 1) * plan.step;
      plan.targets.at(-1).deadline = plan.end + firstBeatOffset;
    }
    return plan;
  }
  function queuePassClicks(plan, audioStart, first = 0) {
    const total = (plan.targets.length + 1) * plan.count;
    for (let i = first; i < total; i++) scheduleClick(plan, i, audioStart + i * plan.step / 1000);
  }
  function queueFollowingPass(session) {
    const {plan, audioStart, bpm, beat, meter} = session;
    const duration = plan.targets.length * plan.count * plan.step;
    const next = buildPass(plan.start + duration, bpm, beat, meter, true);
    const nextAudio = audioStart + duration / 1000;
    queuePassClicks(next, nextAudio, next.count); // No extra count-in between successful passes.
    session.following = {plan:next, audioStart:nextAudio};
  }
  function advancePass(session) {
    Object.assign(session, session.following);
    session.go = true;
    tracePlan("loop");
    queueFollowingPass(session);
  }
  function startRound(demo, reason = "", kind = "") {
    clearSlotResonance();
    cancelAnimationFrame(frame);
    resetAttempt();
    stopSound();
    glowBeat = -1; glowUntil = 0; glowSlot = -1;
    paintPlayingSlot(-1);
    guideNotes = []; demoNotes = []; touchNotes = []; touchUntil = 0;
    const cueLead = playRetryCue(kind);
    const { audioStart, start } = clocks(cueLead || undefined);
    const bpm = practiceTempo(), beat = hitMode(), meter = $("Meter").value;
    const loop = !demo && $("Loop").getAttribute("aria-pressed") === "true";
    const plan = buildPass(start, bpm, beat, meter, loop);
    active = { demo, loop, plan, audioStart, bpm, beat, meter, go: false, roundPicks: demo ? null : new Set() };
    tracePlan(kind ? "retry: " + kind : "start");
    renderResults(demo ? null : plan);
    queuePassClicks(plan, audioStart);
    if (loop) queueFollowingPass(active);
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
    $("Loop").disabled = true;
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
    held.clear(); heldAttacks.clear(); clearSustain(); resetAttempt(); syncHeld();
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
      const clock = validStamp(stamp, now) ? stamp : now;
      if (msg) processNote(msg, clock, event.data[2], now, stamp);
      else {
        if (recording && practiceRunning() && event.data?.length === 3
          && (event.data[0] & 240) === 176 && event.data[1] === 64) {
          traceEvent("sustain", { channel: (event.data[0] & 15) + 1, down: event.data[2] >= 64,
            inputMs: relativeMs(clock), receivedMs: relativeMs(now) }, now);
        }
        processPedal(event.data);
      }
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
  dismissOnBackdrop(dialog, () => dialog.close());
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
  $("Loop").addEventListener("click", () => {
    const button = $("Loop");
    button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });
  $("Demo").addEventListener("click", () => launch(true));
  $("Start").addEventListener("click", () => launch(false));
  $("Stop").addEventListener("click", () => stop("Stopped"));
  document.addEventListener("keydown", event => {
    if (!(event.code === "Space" || event.key === " ") || !open() || event.defaultPrevented
      || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (document.querySelector("dialog[open], .modal:not([hidden])")) return;
    const target = event.target;
    if (target?.isContentEditable || target?.closest?.("input:not([type='checkbox']):not([type='radio']), textarea, select, [role='textbox']")) return;
    // Keep native Space activation for keyboard-focused controls other than the transport.
    if (target?.closest?.("button:focus-visible:not(#ktStart):not(#ktStop):not(#ktOpen), summary:focus-visible, input:focus-visible, [role='button']:focus-visible")) return;
    const running = roundMode === "practice" && (active || launchPending);
    if (!running && (active || launchPending || $("Start").disabled)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (running) stop("Stopped");
    else launch(false);
  });
  $("Meter").addEventListener("change", () => { resetTempoTaps(); refreshMeter(); renderResults(); });
  $("Target").addEventListener("change", () => { refreshIdle(); renderResults(); });
  $("Play").addEventListener("click", async event => {
    const notes = uniqueNotes([...(playingPicks() || [])]);
    if (!notes.length) return;
    const now = performance.now(), token = runId, session = active, stamp = event.timeStamp;
    if (submit(notes, validStamp(stamp, now) ? stamp : now, now, undefined, "on-screen")) return;
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
    held.clear(); heldAttacks.clear(); clearSustain(); resetAttempt(); syncHeld();
  });
})();
