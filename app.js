// FILE: app.js
const NOTES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const IS_BLACK = new Set([1,3,6,8,10]); // C#, D#, F#, G#, A#

// Start on a real C so labeling is correct: C3 = MIDI 48
let startMidi = 48; // C3
let octaves = 2;

const MIN_OCTAVES = 2; // ✅ minimum 2 octaves
const MAX_OCTAVES = 7;

let selectedMidis = new Set();

const elPiano = document.getElementById("piano");
const elPianoScroll = document.getElementById("pianoScroll");
const elRangeText = document.getElementById("rangeText");
const elOctaveText = document.getElementById("octaveText");
const elStatus = document.getElementById("status");
const elTransposeHint = document.getElementById("transposeHint");

const elTopbar = document.getElementById("topbar");
const elControls = document.getElementById("controls");
const elFooter = document.getElementById("footer");

// ===== Chord Memory + Modes =====
const elBtnMenu = document.getElementById("btnMenu");
const elMenuModal = document.getElementById("menuModal");
const elMemoryCard = document.getElementById("memoryCard");
const elMemoryMeta = document.getElementById("memoryMeta");
const elBtnMemory = document.getElementById("btnMemory");
const elMemoryModal = document.getElementById("memoryModal");
const elMemoryGrid = document.getElementById("memoryGrid");
const elMemoryGridModal = document.getElementById("memoryGridModal");

const elModeFree = document.getElementById("modeFree");
const elModeChordScale = document.getElementById("modeChordScale");
const elModeHint = document.getElementById("modeHint");
const elBtnOpenMemory = document.getElementById("btnOpenMemory");
const elBtnPickScale = document.getElementById("btnPickScale");

const elScaleSelect = document.getElementById("scaleSelect");
const elBtnScaleAdd = document.getElementById("btnScaleAdd");
const elBtnScaleRemove = document.getElementById("btnScaleRemove");
const elSlotHint = document.getElementById("slotHint");
const elBtnSlotLoad = document.getElementById("btnSlotLoad");
const elBtnSlotClear = document.getElementById("btnSlotClear");

const STORAGE_KEY = "pct_state_v1";

let appMode = "free"; // free | chordScale
let scales = Array.from({ length: 12 }, (_, pc) => pc);
let currentScalePc = 0; // C
let memorySlots = Array.from({ length: 12 }, () => null); // { midis:number[], scalePc:number } | null
let activeSlot = -1;


document.getElementById("btnPlus").addEventListener("click", () => {
  if (octaves < MAX_OCTAVES) {
    octaves += 1;
    applyResponsiveSizing();
    rebuild();
  }
});

document.getElementById("btnMinus").addEventListener("click", () => {
  if (octaves > MIN_OCTAVES) {
    octaves -= 1;
    applyResponsiveSizing();
    rebuild();
  }
});

// Semitone transpose (±1 MIDI)
document.getElementById("btnUp").addEventListener("click", () => transposeSelection(+1));
document.getElementById("btnDown").addEventListener("click", () => transposeSelection(-1));

document.getElementById("btnClear").addEventListener("click", () => {
  selectedMidis.clear();
  updateSelectionUI();
  updateHint();
});

// ===== Modal wiring =====
function openModal(el) {
  if (!el) return;
  el.hidden = false;
  const focusable = el.querySelector(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  );
  if (focusable) focusable.focus({ preventScroll: true });
}

function closeModal(el) {
  if (!el) return;
  el.hidden = true;
}

function closeFromTarget(t) {
  if (!t || !t.getAttribute) return false;
  const id = t.getAttribute("data-close");
  if (!id) return false;
  const el = document.getElementById(id);
  if (el) closeModal(el);
  return true;
}

document.addEventListener("pointerdown", (e) => {
  if (closeFromTarget(e.target)) return;
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (elMemoryModal && !elMemoryModal.hidden) return closeModal(elMemoryModal);
  if (elMenuModal && !elMenuModal.hidden) return closeModal(elMenuModal);
});

if (elBtnMenu) elBtnMenu.addEventListener("click", () => openModal(elMenuModal));
if (elBtnMemory) {
  elBtnMemory.addEventListener("click", () => {
    syncMemoryModalGrid();
    openModal(elMemoryModal);
  });
}
if (elBtnOpenMemory) {
  elBtnOpenMemory.addEventListener("click", () => {
    closeModal(elMenuModal);
    syncMemoryModalGrid();
    openModal(elMemoryModal);
  });
}
if (elBtnPickScale) {
  elBtnPickScale.addEventListener("click", () => {
    closeModal(elMenuModal);
    syncMemoryModalGrid();
    openModal(elMemoryModal);
    if (elScaleSelect) elScaleSelect.focus({ preventScroll: true });
  });
}

// ===== Modes =====
function normalizePc(pc) {
  return (pc % 12 + 12) % 12;
}

function updateMemoryMeta() {
  if (!elMemoryMeta) return;
  if (appMode === "free") {
    elMemoryMeta.textContent = "Mode: Free";
  } else {
    elMemoryMeta.textContent = "Mode: Chord→Scale (" + NOTES_SHARP[currentScalePc] + ")";
  }
}

function setMode(nextMode) {
  appMode = nextMode;
  if (elModeFree) elModeFree.classList.toggle("active", appMode === "free");
  if (elModeChordScale) elModeChordScale.classList.toggle("active", appMode === "chordScale");
  if (elModeHint) {
    elModeHint.textContent =
      appMode === "free"
        ? "Free Transpose: select any notes and transpose by semitones."
        : "Chord → Scale: store chords with a key. Slots update as you transpose.";
  }

  // Hide memory UI in Free mode
  if (elMemoryCard) elMemoryCard.hidden = (appMode === "free");
  if (appMode === "free" && elMemoryModal && !elMemoryModal.hidden) {
    closeModal(elMemoryModal);
  }

  updateMemoryMeta();
  saveState();
  renderMemoryButtons();
}

if (elModeFree) elModeFree.addEventListener("click", () => setMode("free"));
if (elModeChordScale) elModeChordScale.addEventListener("click", () => setMode("chordScale"));

// ===== Scales =====
function rebuildScaleSelect() {
  if (!elScaleSelect) return;
  elScaleSelect.innerHTML = "";
  if (!Array.isArray(scales) || scales.length === 0) {
    scales = Array.from({ length: 12 }, (_, pc) => pc);
  }
  for (const pc of scales) {
    const opt = document.createElement("option");
    opt.value = String(pc);
    opt.textContent = NOTES_SHARP[pc];
    elScaleSelect.appendChild(opt);
  }
  if (!scales.includes(currentScalePc)) currentScalePc = scales[0];
  elScaleSelect.value = String(currentScalePc);
}

function setCurrentScalePc(pc) {
  currentScalePc = normalizePc(pc);
  updateMemoryMeta();
  saveState();
  renderMemoryButtons();
}

if (elScaleSelect) {
  elScaleSelect.addEventListener("change", () => {
    setCurrentScalePc(Number(elScaleSelect.value));
  });
}

if (elBtnScaleAdd) {
  elBtnScaleAdd.addEventListener("click", () => {
    const raw = prompt(
      "Add a key (e.g., C, F#, Bb). Use sharps (#) or flats (b):",
      NOTES_SHARP[currentScalePc]
    );
    if (!raw) return;
    const txt = raw.trim().toUpperCase().split(" ").join("");

    const flatMap = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#" };
    const normalized = flatMap[txt] || txt;
    const pc = NOTES_SHARP.indexOf(normalized);
    if (pc < 0) return alert("Key not recognized. Try: C, C#, D, Eb, F#, Bb, etc.");

    if (!scales.includes(pc)) scales.push(pc);
    scales.sort((a, b) => a - b);
    setCurrentScalePc(pc);
    rebuildScaleSelect();
    saveState();
  });
}

if (elBtnScaleRemove) {
  elBtnScaleRemove.addEventListener("click", () => {
    const pc = currentScalePc;
    scales = scales.filter((x) => x !== pc);
    if (scales.length === 0) scales = Array.from({ length: 12 }, (_, p) => p);
    currentScalePc = scales[0];
    rebuildScaleSelect();
    setCurrentScalePc(currentScalePc);
    saveState();
  });
}

// ===== Memory =====
function chordLabelFromMidis(midis) {
  const pcs = [...new Set(midis.map(midiToPitchClassName))];
  return pcs.join("-");
}

function slotText(i) {
  const slot = memorySlots[i];
  if (!slot) return String(i + 1);
  const keyName = NOTES_SHARP[normalizePc(slot.scalePc ?? 0)];
  const chord = chordLabelFromMidis(slot.midis || []);
  return keyName + "\n" + chord;
}

function renderMemoryButtons() {
  if (!elMemoryGrid) return;
  const btns = elMemoryGrid.querySelectorAll(".memBtn");
  btns.forEach((btn) => {
    const i = Number(btn.dataset.slot);
    const slot = memorySlots[i];
    btn.classList.toggle("filled", !!slot);
    btn.classList.toggle("active", i === activeSlot && activeSlot !== -1);
    btn.textContent = slot ? slotText(i) : String(i + 1);
  });
}

function syncMemoryModalGrid() {
  if (!elMemoryGridModal) return;

  if (elMemoryGridModal.childElementCount !== 12) {
    elMemoryGridModal.innerHTML = "";
    for (let i = 0; i < 12; i++) {
      const b = document.createElement("button");
      b.className = "memBtn";
      b.type = "button";
      b.dataset.slot = String(i);
      b.addEventListener("click", () => {
        activeSlot = i;

        if (selectedMidis.size === 0) {
          if (elSlotHint) elSlotHint.textContent = "Select some keys first, then tap a slot to save.";
          renderMemoryButtons();
          syncMemoryModalGrid();
          return;
        }

        const { min, max } = rangeMidis();
        const midis = [...selectedMidis]
          .map((m) => wrapIntoRange(m, min, max))
          .sort((a, b) => a - b);

        memorySlots[i] = { midis, scalePc: currentScalePc };

        if (elSlotHint) elSlotHint.textContent = "Saved to slot " + (i + 1) + ".";
        saveState();
        renderMemoryButtons();
        syncMemoryModalGrid();
      });
      elMemoryGridModal.appendChild(b);
    }
  }

  const btns = elMemoryGridModal.querySelectorAll(".memBtn");
  btns.forEach((btn) => {
    const i = Number(btn.dataset.slot);
    const slot = memorySlots[i];
    btn.classList.toggle("filled", !!slot);
    btn.classList.toggle("active", i === activeSlot && activeSlot !== -1);
    btn.textContent = slot ? slotText(i) : String(i + 1);
  });

  rebuildScaleSelect();
}

function loadSlot(i) {
  const slot = memorySlots[i];
  if (!slot) return;
  const { min, max } = rangeMidis();
  selectedMidis = new Set((slot.midis || []).map((m) => wrapIntoRange(m, min, max)));
  if (typeof slot.scalePc === "number") setCurrentScalePc(slot.scalePc);
  updateSelectionUI();
  updateHint();
}

function clearSlot(i) {
  if (!memorySlots[i]) return;
  memorySlots[i] = null;
  saveState();
  renderMemoryButtons();
  syncMemoryModalGrid();
}

function transposeMemory(deltaSemitone) {
  if (!Array.isArray(memorySlots)) return;
  const { min, max } = rangeMidis();
  let changed = false;

  for (let i = 0; i < memorySlots.length; i++) {
    const slot = memorySlots[i];
    if (!slot || !Array.isArray(slot.midis)) continue;

    slot.midis = slot.midis
      .map((m) => wrapIntoRange(m + deltaSemitone, min, max))
      .sort((a, b) => a - b);

    if (typeof slot.scalePc === "number") slot.scalePc = normalizePc(slot.scalePc + deltaSemitone);
    changed = true;
  }

  if (changed) {
    saveState();
    renderMemoryButtons();
    syncMemoryModalGrid();
  }
}

if (elMemoryGrid) {
  elMemoryGrid.querySelectorAll(".memBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.slot);
      activeSlot = i;

      if (!memorySlots[i]) {
        syncMemoryModalGrid();
        openModal(elMemoryModal);
        if (elSlotHint) {
          elSlotHint.textContent =
            "Slot " + (i + 1) + " is empty. Select keys, pick scale, then tap slot to save.";
        }
        renderMemoryButtons();
        return;
      }

      loadSlot(i);
      renderMemoryButtons();
    });
  });
}

if (elBtnSlotLoad) {
  elBtnSlotLoad.addEventListener("click", () => {
    if (activeSlot < 0) return;
    loadSlot(activeSlot);
    if (elSlotHint) elSlotHint.textContent = "Loaded slot " + (activeSlot + 1) + ".";
  });
}

if (elBtnSlotClear) {
  elBtnSlotClear.addEventListener("click", () => {
    if (activeSlot < 0) return;
    clearSlot(activeSlot);
    if (elSlotHint) elSlotHint.textContent = "Cleared slot " + (activeSlot + 1) + ".";
  });
}

// ===== Persistence =====
function saveState() {
  try {
    const payload = { appMode, scales, currentScalePc, memorySlots };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return;

    if (p.appMode === "free" || p.appMode === "chordScale") appMode = p.appMode;

    if (Array.isArray(p.scales) && p.scales.length) {
      scales = p.scales.map((x) => normalizePc(Number(x))).filter((x) => Number.isFinite(x));
    }

    if (typeof p.currentScalePc === "number") currentScalePc = normalizePc(p.currentScalePc);

    if (Array.isArray(p.memorySlots) && p.memorySlots.length === 12) {
      memorySlots = p.memorySlots.map((s) => {
        if (!s) return null;
        const midis = Array.isArray(s.midis)
          ? s.midis.map((m) => Number(m)).filter((m) => Number.isFinite(m))
          : [];
        const scalePc = typeof s.scalePc === "number" ? normalizePc(s.scalePc) : currentScalePc;
        return { midis, scalePc };
      });
    }
  } catch {
    // ignore
  }
}


function midiToPitchClass(midi) {
  return (midi % 12 + 12) % 12;
}

function midiToPitchClassName(midi) {
  return NOTES_SHARP[midiToPitchClass(midi)];
}

function midiToNote(midi) {
  const pc = midiToPitchClass(midi);
  const octaveNum = Math.floor(midi / 12) - 1; // 60 = C4
  return `${NOTES_SHARP[pc]}${octaveNum}`;
}

function rangeMidis() {
  const endExclusive = startMidi + (octaves * 12);
  return { min: startMidi, max: endExclusive - 1, endExclusive };
}

function wrapIntoRange(midi, min, max) {
  const span = (max - min) + 1;
  let x = midi;
  while (x < min) x += span;
  while (x > max) x -= span;
  return x;
}

function transposeSelection(deltaSemitone) {
  if (selectedMidis.size === 0) return;

  const { min, max } = rangeMidis();
  const next = new Set();

  for (const m of selectedMidis) {
    const shifted = m + deltaSemitone; // ✅ true semitone
    next.add(wrapIntoRange(shifted, min, max));
  }

selectedMidis = next;

// Keep stored chords + their key in sync with transposition
transposeMemory(deltaSemitone);

updateSelectionUI();
updateHint();

}

function updateHint() {
  if (selectedMidis.size === 0) {
    elTransposeHint.textContent = "Select keys";
    return;
  }
  const ordered = [...selectedMidis].sort((a, b) => a - b);
  const pcs = ordered.map(midiToPitchClassName);
  const uniq = [...new Set(pcs)];
  elTransposeHint.textContent = uniq.join(" - ");
}

function handleKeyToggle(midi) {
  if (selectedMidis.has(midi)) selectedMidis.delete(midi);
  else selectedMidis.add(midi);
  updateSelectionUI();
  updateHint();
}

function rebuild() {
  const { min, max } = rangeMidis();
  selectedMidis = new Set([...selectedMidis].map((m) => wrapIntoRange(m, min, max)));

  // Keep memory wrapped if range changes (octave +/-)
  if (Array.isArray(memorySlots) && memorySlots.some(Boolean)) {
    for (const slot of memorySlots) {
      if (!slot || !Array.isArray(slot.midis)) continue;
      slot.midis = slot.midis.map((m) => wrapIntoRange(m, min, max)).sort((a, b) => a - b);
    }
  }

  renderPiano();
  updateSelectionUI();
  updateHeader();
  updateHint();
  renderMemoryButtons();
  syncMemoryModalGrid();
}


function updateHeader() {
  const { min, max } = rangeMidis();
  elRangeText.textContent = `Range: ${midiToNote(min)} → ${midiToNote(max)}`;
  elOctaveText.textContent = `${octaves}`;
}

function applyResponsiveSizing() {
  // Requirements:
  // - No horizontal scroll: ALL keys always visible.
  // - No vertical scroll on mobile: controls always reachable.
  // Strategy:
  // - Fit white key widths into container width
  // - Compute proportional height, capped to remaining viewport height

  const whiteCount = octaves * 7; // 7 white keys per octave
  const rs = getComputedStyle(document.documentElement);
  const gap = parseFloat(rs.getPropertyValue("--gap")) || 2;

  const containerW = elPianoScroll ? elPianoScroll.clientWidth : window.innerWidth;
  const paddingAllowance = 20; // .piano padding L+R (10 + 10)
  const availableW = Math.max(240, containerW - paddingAllowance);

  const totalGap = (whiteCount - 1) * gap;
  const whiteW = Math.max(16, (availableW - totalGap) / whiteCount);

  // Remaining height budget after topbar + controlBar + footer
  const topH = elTopbar ? elTopbar.offsetHeight : 0;
  const controlsH = elControls ? elControls.offsetHeight : 0;
  const footerH = elFooter ? elFooter.offsetHeight : 0;
  const safe = 28; // wrap padding + gaps buffer
  const availableH = Math.max(160, window.innerHeight - topH - controlsH - footerH - safe);

  // Original visual ratio (~520 / 46)
  const baseRatio = 520 / 46;
  const whiteH = Math.max(140, Math.min(availableH, whiteW * baseRatio));

  document.documentElement.style.setProperty("--white-w", `${whiteW.toFixed(3)}px`);
  document.documentElement.style.setProperty("--white-h", `${whiteH.toFixed(3)}px`);
  document.documentElement.style.setProperty("--black-w", `${(whiteW * 0.65).toFixed(3)}px`);
  document.documentElement.style.setProperty("--black-h", `${(whiteH * 0.62).toFixed(3)}px`);
}

function renderPiano() {
  elPiano.innerHTML = "";

  const { endExclusive } = rangeMidis();

  // Build keys while tracking white positions
  const keys = [];
  let whiteIndex = 0;

  for (let midi = startMidi; midi < endExclusive; midi++) {
    const pc = midiToPitchClass(midi);
    const isBlack = IS_BLACK.has(pc);

    if (!isBlack) {
      keys.push({ midi, isBlack: false, whiteIndex });
      whiteIndex++;
    } else {
      keys.push({ midi, isBlack: true, anchorWhiteIndex: whiteIndex - 1 });
    }
  }

  const whiteRow = document.createElement("div");
  whiteRow.className = "whiteRow";
  elPiano.appendChild(whiteRow);

  const whites = keys.filter((k) => !k.isBlack);
  for (const k of whites) {
    const div = document.createElement("div");
    div.className = "key white";
    div.dataset.midi = String(k.midi);

    const lbl = document.createElement("div");
    lbl.className = "noteLabel";
    lbl.textContent = midiToPitchClassName(k.midi);
    div.appendChild(lbl);

    div.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handleKeyToggle(k.midi);
    });

    whiteRow.appendChild(div);
  }

  // Blacks: pixel positioning based on computed CSS vars
  const rs = getComputedStyle(document.documentElement);
  const whiteW = parseFloat(rs.getPropertyValue("--white-w")) || 46;
  const gap = parseFloat(rs.getPropertyValue("--gap")) || 2;
  const blackW = parseFloat(rs.getPropertyValue("--black-w")) || whiteW * 0.65;

  const blacks = keys.filter((k) => k.isBlack);
  for (const k of blacks) {
    if (k.anchorWhiteIndex < 0) continue;

    const div = document.createElement("div");
    div.className = "key black";
    div.dataset.midi = String(k.midi);

    const lbl = document.createElement("div");
    lbl.className = "noteLabel";
    lbl.textContent = midiToPitchClassName(k.midi);
    div.appendChild(lbl);

    div.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handleKeyToggle(k.midi);
    });

    // anchor white left + white width + half gap - half black width + piano padding
    const leftPx = (k.anchorWhiteIndex * (whiteW + gap)) + whiteW + (gap / 2) - (blackW / 2) + 10;
    div.style.left = `${leftPx}px`;

    elPiano.appendChild(div);
  }
}

function updateSelectionUI() {
  const keys = elPiano.querySelectorAll(".key");
  for (const k of keys) {
    const midi = Number(k.dataset.midi);
    k.classList.toggle("selected", selectedMidis.has(midi));
  }
}

window.addEventListener("resize", () => {
  applyResponsiveSizing();
  renderPiano();
  updateSelectionUI();
  updateHeader();
  updateHint();
});

// Service worker registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./service-worker.js");
      elStatus.textContent = reg.active ? "Offline-ready." : "Service worker installed.";
    } catch {
      elStatus.textContent = "Offline not available (SW failed).";
    }
  });
}

// Init
loadState();
rebuildScaleSelect();
setMode(appMode);
renderMemoryButtons();
syncMemoryModalGrid();

applyResponsiveSizing();
renderPiano();
updateHeader();
updateHint();

