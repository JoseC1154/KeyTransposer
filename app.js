/* Piano Chord Transposer (PWA-ready)
   - Select keys
   - Transpose selection by semitone up/down
   - Grow/shrink keyboard by octaves
*/

const NOTES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const IS_BLACK = new Set([1,3,6,8,10]);

// Reasonable default range: C3..(octaves*12)
let startMidi = 48;     // C3
let octaves = 2;        // grows/shrinks by 1 octave
const MIN_OCTAVES = 1;
const MAX_OCTAVES = 7;

let selectedMidis = new Set();

const elPiano = document.getElementById("piano");
const elRangeText = document.getElementById("rangeText");
const elOctaveText = document.getElementById("octaveText");
const elStatus = document.getElementById("status");
const elTransposeHint = document.getElementById("transposeHint");

document.getElementById("btnPlus").addEventListener("click", () => {
  if (octaves < MAX_OCTAVES) {
    octaves += 1;
    rebuild();
  }
});

document.getElementById("btnMinus").addEventListener("click", () => {
  if (octaves > MIN_OCTAVES) {
    octaves -= 1;
    rebuild();
  }
});

document.getElementById("btnUp").addEventListener("click", () => transposeSelection(+1));
document.getElementById("btnDown").addEventListener("click", () => transposeSelection(-1));

document.getElementById("btnClear").addEventListener("click", () => {
  selectedMidis.clear();
  updateSelectionUI();
  updateHint();
});

function midiToNote(midi){
  const pc = (midi % 12 + 12) % 12;
  const octaveNum = Math.floor(midi / 12) - 1; // MIDI: 60 = C4
  return `${NOTES_SHARP[pc]}${octaveNum}`;
}

function midiToPitchClassName(midi){
  const pc = (midi % 12 + 12) % 12;
  return NOTES_SHARP[pc];
}

function rangeMidis(){
  const endMidiExclusive = startMidi + (octaves * 12);
  // include last note B of last octave: we build 12*octaves notes from start
  return { min: startMidi, max: endMidiExclusive - 1, endExclusive: endMidiExclusive };
}

function transposeSelection(delta){
  if (selectedMidis.size === 0) return;

  const { min, max } = rangeMidis();

  const next = new Set();
  for (const m of selectedMidis){
    const shifted = m + delta;
    if (shifted >= min && shifted <= max) next.add(shifted);
    // if out of range, ignore it (keeps behavior predictable)
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
  const names = [...selectedMidis].sort((a,b)=>a-b).map(midiToPitchClassName);
  // de-dupe pitch classes for a chord-y view
  const uniq = [...new Set(names)];
  elTransposeHint.textContent = `Selected: ${uniq.join(" - ")} (${selectedMidis.size})`;
}

function handleKeyToggle(midi){
  if (selectedMidis.has(midi)) selectedMidis.delete(midi);
  else selectedMidis.add(midi);
  updateSelectionUI();
  updateHint();
}

function rebuild(){
  // keep only selected notes that still exist after resizing (range changed)
  const { min, max } = rangeMidis();
  selectedMidis = new Set([...selectedMidis].filter(m => m >= min && m <= max));

  renderPiano();
  updateSelectionUI();
  updateHeader();
  updateHint();
}

function updateHeader(){
  const { min, max } = rangeMidis();
  elRangeText.textContent = `Range: ${midiToNote(min)} → ${midiToNote(max)}`;
  elOctaveText.textContent = `${octaves} octave${octaves === 1 ? "" : "s"}`;
}

function renderPiano(){
  elPiano.innerHTML = "";

  // Build a list of keys (midi, isBlack, whiteIndex)
  const { endExclusive } = rangeMidis();
  const keys = [];
  let whiteIndex = 0;

  for (let midi = startMidi; midi < endExclusive; midi++){
    const pc = (midi % 12 + 12) % 12;
    const isBlack = IS_BLACK.has(pc);

    if (!isBlack) {
      keys.push({ midi, isBlack: false, whiteIndex });
      whiteIndex++;
    } else {
      keys.push({ midi, isBlack: true, whiteIndex: null });
    }
  }

  // white keys first as flex children
  const whiteKeys = keys.filter(k => !k.isBlack);
  document.documentElement.style.setProperty("--white-count", String(whiteKeys.length));

  for (const k of whiteKeys){
    const div = document.createElement("div");
    div.className = "key white";
    div.dataset.midi = String(k.midi);
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", `Key ${midiToNote(k.midi)}`);

    const lbl = document.createElement("div");
    lbl.className = "noteLabel";
    lbl.textContent = midiToPitchClassName(k.midi);
    div.appendChild(lbl);

    // click/tap
    div.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handleKeyToggle(k.midi);
    });

    elPiano.appendChild(div);
  }

  // Black keys overlay: position relative to white keys
  // For each black pitch class, it sits between two whites:
  // C# between C(0) and D(1)
  // D# between D(1) and E(2)
  // F# between F(3) and G(4)
  // G# between G(4) and A(5)
  // A# between A(5) and B(6)
  //
  // We'll compute whiteIndex within each octave of whites (7 whites).
  // Then convert to absolute white index across whole keyboard.
  const blackOffsetsInWhites = {
    1: 0,  // C# after C
    3: 1,  // D# after D
    6: 3,  // F# after F
    8: 4,  // G# after G
    10: 5, // A# after A
  };

  // Need a helper to compute absolute white index at a midi
  function whiteIndexAtMidi(midi){
    // count whites from startMidi up to this midi (exclusive), then add current if white
    let count = 0;
    for (let m = startMidi; m < midi; m++){
      const pc = (m % 12 + 12) % 12;
      if (!IS_BLACK.has(pc)) count++;
    }
    return count;
  }

  // Now place black keys
  for (let midi = startMidi; midi < endExclusive; midi++){
    const pc = (midi % 12 + 12) % 12;
    if (!IS_BLACK.has(pc)) continue;

    const div = document.createElement("div");
    div.className = "key black";
    div.dataset.midi = String(midi);
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", `Key ${midiToNote(midi)}`);

    const lbl = document.createElement("div");
    lbl.className = "noteLabel";
    lbl.textContent = midiToPitchClassName(midi);
    div.appendChild(lbl);

    div.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handleKeyToggle(midi);
    });

    // Position:
    // left = (whiteIndexAfterWhich / whiteCount)*100% + halfWhite - halfBlack
    const whiteIdx = whiteIndexAtMidi(midi); // how many whites before this black
    // This black sits "after" a white; place it centered between this and next white:
    // so start at this white's left + 1 white width, then pull back half black width.
    // i.e. left = ((whiteIdx + 1) / whiteCount) * 100% - (blackWidth/2)
    // We'll do this with calc in CSS to stay responsive.
    div.style.left = `calc( (100% / var(--white-count)) * ${whiteIdx + 1} - (var(--black-w) / 2) )`;

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
    } catch (e) {
      elStatus.textContent = "Offline not available (SW failed).";
    }
  });
}

// Initial render
renderPiano();
updateHeader();
updateHint();
