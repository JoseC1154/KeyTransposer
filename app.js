const NOTES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const IS_BLACK = new Set([1,3,6,8,10]); // C#, D#, F#, G#, A#

// Start on a real C so labeling is correct: C3 = MIDI 48
let startMidi = 48;     // C3
let octaves = 2;

const MIN_OCTAVES = 1;
const MAX_OCTAVES = 7;

let selectedMidis = new Set();

const elPiano = document.getElementById("piano");
const elPianoScroll = document.getElementById("pianoScroll");
const elRangeText = document.getElementById("rangeText");
const elOctaveText = document.getElementById("octaveText");
const elStatus = document.getElementById("status");
const elTransposeHint = document.getElementById("transposeHint");

document.getElementById("btnPlus").addEventListener("click", () => {
  if (octaves < MAX_OCTAVES) { octaves += 1; rebuild(true); }
});
document.getElementById("btnMinus").addEventListener("click", () => {
  if (octaves > MIN_OCTAVES) { octaves -= 1; rebuild(false); }
});

// Semitone transpose (±1 MIDI)
document.getElementById("btnUp").addEventListener("click", () => transposeSelection(+1));
document.getElementById("btnDown").addEventListener("click", () => transposeSelection(-1));

document.getElementById("btnClear").addEventListener("click", () => {
  selectedMidis.clear();
  updateSelectionUI();
  updateHint();
});

function midiToPitchClass(midi){
  return (midi % 12 + 12) % 12;
}
function midiToPitchClassName(midi){
  return NOTES_SHARP[midiToPitchClass(midi)];
}
function midiToNote(midi){
  const pc = midiToPitchClass(midi);
  const octaveNum = Math.floor(midi / 12) - 1; // 60 = C4
  return `${NOTES_SHARP[pc]}${octaveNum}`;
}

function rangeMidis(){
  const endExclusive = startMidi + (octaves * 12);
  return { min: startMidi, max: endExclusive - 1, endExclusive };
}

// Wrap helper so transposed notes never “disappear” outside the current range
function wrapIntoRange(midi, min, max){
  const span = (max - min) + 1;
  let x = midi;
  while (x < min) x += span;
  while (x > max) x -= span;
  return x;
}

function transposeSelection(deltaSemitone){
  if (selectedMidis.size === 0) return;

  const { min, max } = rangeMidis();

  const next = new Set();
  for (const m of selectedMidis){
    const shifted = m + deltaSemitone; // true semitone
    next.add(wrapIntoRange(shifted, min, max));
  }

  selectedMidis = next;
  updateSelectionUI();
  updateHint();
}

function updateHint(){
  if (selectedMidis.size === 0) {
    elTransposeHint.textContent = "Select keys, then shift";
    return;
  }
  const ordered = [...selectedMidis].sort((a,b)=>a-b);
  const pcs = ordered.map(midiToPitchClassName);
  const uniq = [...new Set(pcs)];
  elTransposeHint.textContent = `Selected: ${uniq.join(" - ")} (${selectedMidis.size})`;
}

function handleKeyToggle(midi){
  if (selectedMidis.has(midi)) selectedMidis.delete(midi);
  else selectedMidis.add(midi);
  updateSelectionUI();
  updateHint();
}

function rebuild(added){
  // keep selection in new range (wrap)
  const { min, max } = rangeMidis();
  selectedMidis = new Set([...selectedMidis].map(m => wrapIntoRange(m, min, max)));

  renderPiano();
  updateSelectionUI();
  updateHeader();
  updateHint();

  // UX: if you added octaves, scroll to end; if removed, scroll to start
  if (elPianoScroll){
    elPianoScroll.scrollLeft = added ? elPianoScroll.scrollWidth : 0;
  }
}

function updateHeader(){
  const { min, max } = rangeMidis();
  elRangeText.textContent = `Range: ${midiToNote(min)} → ${midiToNote(max)}`;
  elOctaveText.textContent = `${octaves} octave${octaves === 1 ? "" : "s"}`;
}

function renderPiano(){
  elPiano.innerHTML = "";

  const { endExclusive } = rangeMidis();

  // Build keys while tracking white positions (stable)
  const keys = [];
  let whiteIndex = 0;

  for (let midi = startMidi; midi < endExclusive; midi++){
    const pc = midiToPitchClass(midi);
    const isBlack = IS_BLACK.has(pc);

    if (!isBlack) {
      keys.push({ midi, isBlack: false, whiteIndex });
      whiteIndex++;
    } else {
      // Black key sits after previous white
      keys.push({ midi, isBlack: true, anchorWhiteIndex: whiteIndex - 1 });
    }
  }

  // White row
  const whiteRow = document.createElement("div");
  whiteRow.className = "whiteRow";
  elPiano.appendChild(whiteRow);

  // Render whites
  const whites = keys.filter(k => !k.isBlack);

  for (const k of whites){
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

  // Set bed width in pixels so keys stay proportional
  const rootStyles = getComputedStyle(document.documentElement);
  const whiteW = parseFloat(rootStyles.getPropertyValue("--white-w")) || 46;
  const gap = parseFloat(rootStyles.getPropertyValue("--gap")) || 2;

  const bedWidth = (whites.length * whiteW) + ((whites.length - 1) * gap) + 20; // padding fudge
  elPiano.style.width = `${bedWidth}px`;

  // Render blacks (stable pixel math)
  const blacks = keys.filter(k => k.isBlack);

  for (const k of blacks){
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

    const blackW = parseFloat(rootStyles.getPropertyValue("--black-w")) || 30;

    // anchor white left + white width + half gap - half black width + padding
    const leftPx = (k.anchorWhiteIndex * (whiteW + gap)) + whiteW + (gap / 2) - (blackW / 2) + 10;
    div.style.left = `${leftPx}px`;

    elPiano.appendChild(div);
  }
}

function updateSelectionUI(){
  const keys = elPiano.querySelectorAll(".key");
  for (const k of keys){
    const midi = Number(k.dataset.midi);
    k.classList.toggle("selected", selectedMidis.has(midi));
  }
}

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
renderPiano();
updateHeader();
updateHint();
