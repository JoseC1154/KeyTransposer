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

  renderPiano();
  updateSelectionUI();
  updateHeader();
  updateHint();
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
applyResponsiveSizing();
renderPiano();
updateHeader();
updateHint();
