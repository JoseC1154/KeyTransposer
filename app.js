// FILE: app.js
const NOTES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const IS_BLACK = new Set([1,3,6,8,10]); // C#, D#, F#, G#, A#

// Full 88-key piano: A0 (21) to C8 (108)
const PIANO_START_MIDI = 21; // A0
const PIANO_END_MIDI = 109; // C8 (exclusive)
const TOTAL_KEYS = 88;

// Octaves controls viewport/visible area sizing
let octaves = 2;

const MIN_OCTAVES = 2;
const MAX_OCTAVES = 7;

let selectedMidis = new Set();

const elPiano = document.getElementById("piano");
const elPianoScroll = document.getElementById("pianoScroll");
const elRangeText = document.getElementById("rangeText");
const elChordNameText = document.getElementById("chordNameText");
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
const elBtnHowTo = document.getElementById("btnHowTo");

const elScaleSelect = document.getElementById("scaleSelect");
const elBtnScaleAdd = document.getElementById("btnScaleAdd");
const elBtnScaleRemove = document.getElementById("btnScaleRemove");
const elSlotHint = document.getElementById("slotHint");
const elBtnSlotLoad = document.getElementById("btnSlotLoad");
const elBtnSlotClear = document.getElementById("btnSlotClear");

// ===== Bank Selector =====
const elBankSelector = document.getElementById("bankSelector");
const elBtnBankPrev = document.getElementById("btnBankPrev");
const elBtnBankCurrent = document.getElementById("btnBankCurrent");
const elBtnBankNext = document.getElementById("btnBankNext");

// ===== Alternates =====
const elBtnAlternates = document.getElementById("btnAlternates");
const elAlternatesModal = document.getElementById("alternatesModal");
const elAlternatesList = document.getElementById("alternatesList");

const STORAGE_KEY = "pct_state_v1";

let appMode = "free"; // free | chordScale

// Fixed 12 scale banks (C..B)
let scales = Array.from({ length: 12 }, (_, pc) => pc);
let currentScalePc = 0; // bank index 0..11

// 12 scale banks × 12 chord slots
// bankChords[bankPc][slotIndex] = { midis:number[], name:string } | null
let bankChords = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => null));

let activeSlot = -1;
let activeBankPc = -1; // Track which bank the active slot belongs to
let activeChordName = "";

// Last detected chord root (pitch class) for roman-numeral labeling in Chord→Scale mode
let lastDetectedRootPc = null;
let lastDetectedSuffix = "";



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
  activeSlot = -1;
  activeBankPc = -1;
  setChordName("");
  updateSelectionUI();
  updateHint();
});

// ===== Custom Prompt Modal =====
const elPromptModal = document.getElementById("promptModal");
const elPromptInput = document.getElementById("promptInput");
const elPromptOk = document.getElementById("promptOk");

function customPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    const promptTitle = document.getElementById("promptTitle");
    if (promptTitle) promptTitle.textContent = message;
    if (elPromptInput) elPromptInput.value = defaultValue;
    
    openModal(elPromptModal);
    
    // Focus and select the input
    if (elPromptInput) {
      setTimeout(() => {
        elPromptInput.focus();
        elPromptInput.select();
      }, 100);
    }

    const handleOk = () => {
      const value = elPromptInput ? elPromptInput.value : "";
      closeModal(elPromptModal);
      cleanup();
      resolve(value);
    };

    const handleCancel = () => {
      closeModal(elPromptModal);
      cleanup();
      resolve(null);
    };

    const handleKeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleOk();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };

    const cleanup = () => {
      if (elPromptOk) elPromptOk.removeEventListener("click", handleOk);
      if (elPromptInput) elPromptInput.removeEventListener("keydown", handleKeydown);
    };

    if (elPromptOk) elPromptOk.addEventListener("click", handleOk);
    if (elPromptInput) elPromptInput.addEventListener("keydown", handleKeydown);
  });
}

// ===== How To Use (first-run modal) =====
const HOWTO_HIDE_KEY = "pct_hide_howto_v1";

let elHowToModal = null;
let elHowToNever = null;

function ensureHowToModal() {
  if (elHowToModal) return;

  const wrap = document.createElement("div");
  wrap.id = "howToModal";
  wrap.className = "modal";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="modalBackdrop" data-close="howToModal"></div>
    <div class="modalCard" role="dialog" aria-modal="true" aria-label="How to use">
      <div class="modalHeader">
        <div class="modalTitle">How to use</div>
        <button class="ghost" type="button" data-close="howToModal" aria-label="Close">✕</button>
      </div>
      <div class="modalBody">
        <div class="modalHint" style="margin-bottom:10px;">Quick start (tap anywhere outside to close)</div>

        <div class="howto">
          <div class="howtoRow"><b>1) Select notes</b><div>Tap keys on the piano to build a chord.</div></div>
          <div class="howtoRow"><b>2) Transpose</b><div>Use <b>▼</b> / <b>▲</b> to move by semitones.</div></div>
          <div class="howtoRow"><b>3) Octaves</b><div>Use <b>−</b> / <b>+</b> to change the visible octave span.</div></div>
          <div class="howtoRow"><b>4) Alternates</b><div>Tap <b>≈</b> to see inversions, extensions, sus/6, and related chords.</div></div>
          <div class="howtoRow"><b>5) Chord → Scale mode</b><div>Open the menu (☰) → switch to <b>Chord → Scale</b> to use banks + memory.</div></div>
          <div class="howtoRow"><b>6) Save / recall</b><div>In Chord → Scale, use slots <b>1–12</b> to save chords for the current scale bank.</div></div>
        </div>
      </div>
      <div class="modalFooter">
        <button id="btnHowToNever" class="ghost" type="button">Never show again</button>
        <button class="primary" type="button" data-close="howToModal">Got it</button>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);
  elHowToModal = wrap;
  elHowToNever = wrap.querySelector("#btnHowToNever");

  if (elHowToNever) {
    elHowToNever.addEventListener("click", () => {
      try { localStorage.setItem(HOWTO_HIDE_KEY, "1"); } catch {}
      closeModal(elHowToModal);
    });
  }
}

function openHowTo() {
  ensureHowToModal();
  openModal(elHowToModal);
}

function maybeShowHowToOnFirstRun() {
  let hide = false;
  try { hide = localStorage.getItem(HOWTO_HIDE_KEY) === "1"; } catch {}
  if (hide) return;
  // Show after initial layout settles
  setTimeout(() => {
    // Don’t interrupt the chord naming prompt
    if (elPromptModal && !elPromptModal.hidden) return;
    openHowTo();
  }, 200);
}

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
  if (elPromptModal && !elPromptModal.hidden) return; // Let customPrompt handle it
  if (elHowToModal && !elHowToModal.hidden) return closeModal(elHowToModal);
  if (elAlternatesModal && !elAlternatesModal.hidden) return closeModal(elAlternatesModal);
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

// Menu -> How to use (HTML-defined button)
if (elBtnHowTo) {
  elBtnHowTo.addEventListener("click", () => {
    closeModal(elMenuModal);
    openHowTo();
  });
}

// ===== Bank Selector Event Handlers =====
function updateBankDisplay() {
  if (elBtnBankCurrent) {
    elBtnBankCurrent.textContent = NOTES_SHARP[currentScalePc];
  }
  updateMemoryMeta();
  renderMemoryButtons();
  syncMemoryModalGrid();
}

function changeBank(direction) {
  currentScalePc = normalizePc(currentScalePc + direction);
  activeSlot = -1;
  activeBankPc = -1;
  setChordName("");
  updateBankDisplay();
  saveState();
}

if (elBtnBankPrev) {
  elBtnBankPrev.addEventListener("click", () => changeBank(-1));
}

if (elBtnBankNext) {
  elBtnBankNext.addEventListener("click", () => changeBank(1));
}

if (elBtnBankCurrent) {
  elBtnBankCurrent.addEventListener("click", () => {
    // Show a quick picker for all 12 scales
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

function romanForPcInMajorKey(rootPc, keyPc) {
  const d = normalizePc(rootPc - keyPc);
  // Major scale degrees by semitone distance
  const DEG = {
    0: "I",
    2: "II",
    4: "III",
    5: "IV",
    7: "V",
    9: "VI",
    11: "VII",
    // chromatic common spellings
    1: "bII",
    3: "bIII",
    6: "bV",
    8: "bVI",
    10: "bVII"
  };
  return DEG[d] || "?";
}

function applyQualityToRoman(roman, suffix) {
  const s = (suffix || "").toLowerCase();
  let r = roman;

  // Lowercase for minor-quality chords (avoid lowering maj7)
  const isMinor = (s.startsWith("m") && !s.startsWith("maj")) || s.includes("m7") || s.includes("m6");
  if (isMinor && r !== "?") r = r.toLowerCase();

  // Diminished marker
  if (s.includes("dim") || s.includes("m7b5")) {
    if (r !== "?") r = r + "°";
  }

  // Augmented marker
  if (s.includes("aug")) {
    if (r !== "?") r = r + "+";
  }

  return r;
}

function formatChordDisplay(autoName) {
  // Only add roman numerals in Chord→Scale mode
  if (appMode !== "chordScale") return autoName;
  if (lastDetectedRootPc === null) return autoName;

  const baseRoman = romanForPcInMajorKey(lastDetectedRootPc, currentScalePc);
  const roman = applyQualityToRoman(baseRoman, lastDetectedSuffix);
  if (roman === "?") return autoName;
  return roman + " — " + autoName;
}

function setChordName(name) {
  activeChordName = (name || "").trim();
  if (elChordNameText) {
    elChordNameText.textContent = activeChordName ? ("Chord: " + activeChordName) : "Chord: —";
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
  if (elBankSelector) elBankSelector.style.display = (appMode === "chordScale" ? "flex" : "none");
  if (appMode === "free" && elMemoryModal && !elMemoryModal.hidden) {
    closeModal(elMemoryModal);
  }
  if (appMode === "free") {
    activeSlot = -1;
    activeBankPc = -1;
    setChordName("");
  }

  updateMemoryMeta();
  updateBankDisplay();
  saveState();
  renderMemoryButtons();
}

if (elModeFree) elModeFree.addEventListener("click", () => setMode("free"));
if (elModeChordScale) elModeChordScale.addEventListener("click", () => setMode("chordScale"));

// ===== Scales =====
function rebuildScaleSelect() {
  if (!elScaleSelect) return;
  elScaleSelect.innerHTML = "";

  // Fixed 12 scale banks (no adding/removing)
  scales = Array.from({ length: 12 }, (_, pc) => pc);

  for (const pc of scales) {
    const opt = document.createElement("option");
    opt.value = String(pc);
    opt.textContent = NOTES_SHARP[pc];
    elScaleSelect.appendChild(opt);
  }

  elScaleSelect.value = String(currentScalePc);

  // Disable scale add/remove controls if present
  if (elBtnScaleAdd) {
    elBtnScaleAdd.disabled = true;
    elBtnScaleAdd.hidden = true;
  }
  if (elBtnScaleRemove) {
    elBtnScaleRemove.disabled = true;
    elBtnScaleRemove.hidden = true;
  }
}


function setCurrentScalePc(pc) {
  currentScalePc = normalizePc(pc);
  if (elScaleSelect) elScaleSelect.value = String(currentScalePc);
  activeSlot = -1;
  activeBankPc = -1;
  setChordName("");
  updateMemoryMeta();
  saveState();
  renderMemoryButtons();
  syncMemoryModalGrid();
}

// Change scale bank when dropdown changes
if (elScaleSelect) {
  elScaleSelect.addEventListener("change", () => {
    setCurrentScalePc(Number(elScaleSelect.value));
  });
}

// ===== Memory =====
function chordLabelFromMidis(midis) {
  const pcs = [...new Set(midis.map(midiToPitchClassName))];
  return pcs.join("-");
}

function detectChordNameFromMidis(midis) {
  if (!midis || midis.length === 0) return "";

  // Keep original order for bass detection, but compute pitch-class set for naming.
  const orderedMidis = [...midis].filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (orderedMidis.length === 0) return "";

  const bassPc = midiToPitchClass(orderedMidis[0]);

  // Unique pitch classes
  const pcs = [...new Set(orderedMidis.map(midiToPitchClass))].sort((a, b) => a - b);
  if (pcs.length === 0) return "";

  // Single note
  if (pcs.length === 1) {
    lastDetectedRootPc = pcs[0];
    lastDetectedSuffix = "";
    return NOTES_SHARP[pcs[0]];
  }

  // Interval patterns (relative to root)
  // Higher score = prefer.
  const PATTERNS = [
    { name: "maj7", ints: [0, 4, 7, 11], score: 90 },
    { name: "7", ints: [0, 4, 7, 10], score: 88 },
    { name: "m7", ints: [0, 3, 7, 10], score: 87 },
    { name: "mMaj7", ints: [0, 3, 7, 11], score: 86 },
    { name: "dim7", ints: [0, 3, 6, 9], score: 85 },
    { name: "m7b5", ints: [0, 3, 6, 10], score: 84 },
    { name: "6", ints: [0, 4, 7, 9], score: 82 },
    { name: "m6", ints: [0, 3, 7, 9], score: 81 },

    { name: "", ints: [0, 4, 7], score: 75 },        // major triad
    { name: "m", ints: [0, 3, 7], score: 74 },       // minor triad
    { name: "dim", ints: [0, 3, 6], score: 73 },     // diminished triad
    { name: "aug", ints: [0, 4, 8], score: 72 },     // augmented triad
    { name: "sus2", ints: [0, 2, 7], score: 71 },
    { name: "sus4", ints: [0, 5, 7], score: 70 },

    { name: "5", ints: [0, 7], score: 45 }           // power chord
  ];

  let best = null;

  for (const root of pcs) {
    const rel = new Set(pcs.map((p) => normalizePc(p - root)));

    for (const pat of PATTERNS) {
      // Require all needed intervals exist
      let ok = true;
      for (const i of pat.ints) {
        if (!rel.has(i)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Penalize extra notes (unknown extensions)
      const extras = pcs.length - pat.ints.length;
      const score = pat.score - extras * 2;

      if (!best || score > best.score) {
        best = { root, suffix: pat.name, score, rel };
      }
    }
  }

  // If nothing matched, fallback to pitch classes.
  if (!best) {
    const names = pcs.map((pc) => NOTES_SHARP[pc]);
    // Unknown chord: still track root as bass
    lastDetectedRootPc = bassPc;
    lastDetectedSuffix = "";
    return names.join("-");
  }

  const rootName = NOTES_SHARP[best.root];
  let suffix = best.suffix;
  lastDetectedRootPc = best.root;
  lastDetectedSuffix = best.suffix;

  // Extensions: treat 9/11/13 as pitch classes 2/5/9 relative to root.
  // If a 7th is present, prefer 9/11/13 naming. Otherwise, use add9/add11/add13.
  const rel = best.rel;
  const has7th = rel.has(10) || rel.has(11);

  const has9 = rel.has(2);
  const has11 = rel.has(5);
  const has13 = rel.has(9);

  // Choose highest extension present (common chord notation)
  const highest = has13 ? 13 : has11 ? 11 : has9 ? 9 : 0;

  // Some patterns already use 6/m6/dim7 etc; we still allow add9/add11/add13.
  if (highest) {
    if (has7th) {
      // ex: Cmaj7 + D => Cmaj9 (we’ll keep maj7 suffix and append 9/11/13)
      // Commonly: Cmaj9, C9, Cm11, C13
      // If suffix is "" (triad) but has7th due to extra notes, it will still work.
      suffix = suffix + String(highest);
    } else {
      suffix = suffix + "add" + String(highest);
    }
  }

  // Slash chords / inversions
  const needsSlash = bassPc !== best.root;
  const slash = needsSlash ? ("/" + NOTES_SHARP[bassPc]) : "";

  // If there are still extra notes beyond our naming, add a light hint.
  // (We avoid listing every extension to keep it readable.)
  const baseName = rootName + suffix + slash;
  // keep suffix updated if we appended extensions
  lastDetectedSuffix = suffix;
  const expectedCount = 1 + (rel.has(3) || rel.has(4) ? 1 : 0) + (rel.has(6) || rel.has(7) || rel.has(8) ? 1 : 0);
  const extraHint = pcs.length > Math.max(3, expectedCount + 1) ? " (add)" : "";

  return baseName + extraHint;
}

function detectChordNameFromSelected() {
  return detectChordNameFromMidis([...selectedMidis]);
}

// ===== Alternate Chord Suggestions =====
function generateAlternateChords() {
  if (selectedMidis.size === 0) return [];

  const orderedMidis = [...selectedMidis].sort((a, b) => a - b);
  const pcs = [...new Set(orderedMidis.map(midiToPitchClass))].sort((a, b) => a - b);
  
  if (pcs.length < 2) return [];

  const bassMidi = orderedMidis[0];
  const { min, max } = rangeMidis();
  
  const alternates = [];

  // Helper to create chord from intervals
  const makeChord = (root, intervals, name, description) => {
    const midis = intervals.map(i => {
      let midi = root + i;
      // Keep within current range
      while (midi < min) midi += 12;
      while (midi > max) midi -= 12;
      return midi;
    }).sort((a, b) => a - b);
    
    return { midis, name, description };
  };

  const rootPc = lastDetectedRootPc !== null ? lastDetectedRootPc : pcs[0];
  const rootMidi = bassMidi;
  const rootName = NOTES_SHARP[rootPc];

  // Current chord type detection
  const hasThird = pcs.some(pc => normalizePc(pc - rootPc) === 3 || normalizePc(pc - rootPc) === 4);
  const isMajor = pcs.some(pc => normalizePc(pc - rootPc) === 4);
  const isMinor = pcs.some(pc => normalizePc(pc - rootPc) === 3);
  const hasSeventh = pcs.some(pc => [10, 11].includes(normalizePc(pc - rootPc)));

  // Suggest inversions
  if (pcs.length >= 3) {
    // First inversion (3rd in bass)
    const thirdInterval = isMajor ? 4 : isMinor ? 3 : 4;
    alternates.push(makeChord(
      rootMidi,
      [thirdInterval, 7, 12],
      `${rootName}${isMinor ? 'm' : ''}/1st inv`,
      "First inversion (3rd in bass)"
    ));

    // Second inversion (5th in bass)
    alternates.push(makeChord(
      rootMidi,
      [7, 12, 12 + thirdInterval],
      `${rootName}${isMinor ? 'm' : ''}/2nd inv`,
      "Second inversion (5th in bass)"
    ));
  }

  // Suggest related chords
  if (isMajor && !hasSeventh) {
    // Add 7th variations
    alternates.push(makeChord(rootMidi, [0, 4, 7, 11], `${rootName}maj7`, "Add major 7th"));
    alternates.push(makeChord(rootMidi, [0, 4, 7, 10], `${rootName}7`, "Add dominant 7th"));
    alternates.push(makeChord(rootMidi, [0, 4, 7, 9], `${rootName}6`, "Add major 6th"));
  }

  if (isMinor && !hasSeventh) {
    // Minor 7th variations
    alternates.push(makeChord(rootMidi, [0, 3, 7, 10], `${rootName}m7`, "Add minor 7th"));
    alternates.push(makeChord(rootMidi, [0, 3, 7, 11], `${rootName}mMaj7`, "Add major 7th"));
    alternates.push(makeChord(rootMidi, [0, 3, 7, 9], `${rootName}m6`, "Add major 6th"));
  }

  // Suggest sus chords
  if (hasThird) {
    alternates.push(makeChord(rootMidi, [0, 5, 7], `${rootName}sus4`, "Suspended 4th"));
    alternates.push(makeChord(rootMidi, [0, 2, 7], `${rootName}sus2`, "Suspended 2nd"));
  }

  // Suggest extensions
  if (hasSeventh) {
    const seventhInterval = pcs.some(pc => normalizePc(pc - rootPc) === 11) ? 11 : 10;
    const thirdInterval = isMajor ? 4 : 3;
    
    alternates.push(makeChord(
      rootMidi,
      [0, thirdInterval, 7, seventhInterval, 14],
      `${rootName}${isMinor ? 'm' : ''}9`,
      "Add 9th extension"
    ));
    
    alternates.push(makeChord(
      rootMidi,
      [0, thirdInterval, 7, seventhInterval, 14, 17],
      `${rootName}${isMinor ? 'm' : ''}11`,
      "Add 11th extension"
    ));
  }

  // Relative major/minor
  if (isMajor) {
    const relativeMidiRoot = rootMidi - 3;
    alternates.push(makeChord(
      relativeMidiRoot,
      [0, 3, 7],
      `${NOTES_SHARP[normalizePc(rootPc - 3)]}m`,
      "Relative minor"
    ));
  } else if (isMinor) {
    const relativeMidiRoot = rootMidi + 3;
    alternates.push(makeChord(
      relativeMidiRoot,
      [0, 4, 7],
      `${NOTES_SHARP[normalizePc(rootPc + 3)]}`,
      "Relative major"
    ));
  }

  return alternates;
}

function showAlternateChords() {
  if (selectedMidis.size === 0) {
    if (elAlternatesList) {
      elAlternatesList.innerHTML = '<div class="modalHint">Select some keys first to see alternate chord suggestions.</div>';
    }
    openModal(elAlternatesModal);
    return;
  }

  const alternates = generateAlternateChords();
  
  if (!elAlternatesList) return;
  elAlternatesList.innerHTML = "";

  if (alternates.length === 0) {
    elAlternatesList.innerHTML = '<div class="modalHint">No alternate suggestions available for this selection.</div>';
  } else {
    alternates.forEach((alt, idx) => {
      const item = document.createElement("div");
      item.className = "alternateItem";
      
      const info = document.createElement("div");
      const nameDiv = document.createElement("div");
      nameDiv.className = "alternateChordName";
      nameDiv.textContent = alt.name;
      
      const descDiv = document.createElement("div");
      descDiv.className = "alternateChordDesc";
      descDiv.textContent = alt.description;
      
      info.appendChild(nameDiv);
      info.appendChild(descDiv);
      
      const btn = document.createElement("button");
      btn.className = "alternateBtn";
      btn.textContent = "Apply";
      btn.type = "button";
      btn.addEventListener("click", () => {
        selectedMidis.clear();
        alt.midis.forEach(m => selectedMidis.add(m));
        setChordName(alt.name);
        updateSelectionUI();
        updateHint();
        closeModal(elAlternatesModal);
      });
      
      item.appendChild(info);
      item.appendChild(btn);
      elAlternatesList.appendChild(item);
    });
  }

  openModal(elAlternatesModal);
}

if (elBtnAlternates) {
  elBtnAlternates.addEventListener("click", showAlternateChords);
}


function maybeAutoSetChordName() {
  // Don't overwrite a loaded slot name in chordScale mode
  if (appMode === "chordScale" && activeSlot >= 0) {
    const slot = getSlot(currentScalePc, activeSlot);
    if (slot && slot.name) return;
  }

  if (selectedMidis.size === 0) {
    if (!activeChordName) setChordName("");
    return;
  }

  const auto = detectChordNameFromSelected();
  if (auto) setChordName(formatChordDisplay(auto));
}


function getSlot(bankPc, slotIndex) {
  return bankChords?.[bankPc]?.[slotIndex] || null;
}

function renderMemoryButtons() {
  if (!elMemoryGrid) return;
  const btns = elMemoryGrid.querySelectorAll(".memBtn");
  btns.forEach((btn) => {
    const i = Number(btn.dataset.slot);
    const slot = getSlot(currentScalePc, i);
    btn.classList.toggle("filled", !!slot);
    btn.classList.toggle("active", i === activeSlot && activeBankPc === currentScalePc && activeSlot !== -1);
    btn.textContent = String(i + 1); // always numbered
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
      b.addEventListener("click", async () => {
        activeSlot = i;
        activeBankPc = currentScalePc;

        if (selectedMidis.size === 0) {
          if (elSlotHint) elSlotHint.textContent = "Select some keys first, then tap a slot to save.";
          renderMemoryButtons();
          syncMemoryModalGrid();
          return;
        }

        const autoName = detectChordNameFromSelected();
        const defaultName = (activeChordName || autoName || "").trim();
        const name = await customPrompt("Name chord", defaultName);
        if (name === null) return;

        const { min, max } = rangeMidis();
        const midis = [...selectedMidis]
          .map((m) => wrapIntoRange(m, min, max))
          .sort((a, b) => a - b);

        const finalName = (name || "").trim() || autoName || "";
        bankChords[currentScalePc][i] = { midis, name: finalName };
        setChordName(finalName);

        if (elSlotHint) {
          elSlotHint.textContent =
            "Saved slot " + (i + 1) + " for " + NOTES_SHARP[currentScalePc] + ".";
        }
        saveState();
        renderMemoryButtons();
        syncMemoryModalGrid();
        closeModal(elMemoryModal);
      });
      elMemoryGridModal.appendChild(b);
    }
  }

  const btns = elMemoryGridModal.querySelectorAll(".memBtn");
  btns.forEach((btn) => {
    const i = Number(btn.dataset.slot);
    const slot = getSlot(currentScalePc, i);
    btn.classList.toggle("filled", !!slot);
    btn.classList.toggle("active", i === activeSlot && activeSlot !== -1);
    btn.textContent = String(i + 1);
  });

  rebuildScaleSelect();
}


function loadSlot(i) {
  const slot = getSlot(currentScalePc, i);
  if (!slot) return;

  const { min, max } = rangeMidis();
  selectedMidis = new Set((slot.midis || []).map((m) => wrapIntoRange(m, min, max)));

  setChordName(slot.name || "");
  updateSelectionUI();
  updateHint();
}


function clearSlot(i) {
  if (!getSlot(currentScalePc, i)) return;
  bankChords[currentScalePc][i] = null;

  if (activeSlot === i && activeBankPc === currentScalePc) {
    activeSlot = -1;
    activeBankPc = -1;
    setChordName("");
  }

  saveState();
  renderMemoryButtons();
  syncMemoryModalGrid();
}


function transposeBanksAndChords(deltaSemitone) {
  if (appMode !== "chordScale") return;

  const { min, max } = rangeMidis();

  // Rotate banks and transpose all stored chords by the same semitone amount
  const nextBanks = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => null));
  for (let bank = 0; bank < 12; bank++) {
    const toBank = normalizePc(bank + deltaSemitone);
    for (let i = 0; i < 12; i++) {
      const slot = bankChords[bank][i];
      if (!slot) continue;
      const midis = (slot.midis || [])
        .map((m) => wrapIntoRange(m + deltaSemitone, min, max))
        .sort((a, b) => a - b);
      nextBanks[toBank][i] = { midis, name: slot.name || "" };
    }
  }
  bankChords = nextBanks;

  // Advance current bank
  setCurrentScalePc(currentScalePc + deltaSemitone);
}

if (elMemoryGrid) {
  elMemoryGrid.querySelectorAll(".memBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.slot);
      activeSlot = i;
      activeBankPc = currentScalePc;

      const slot = getSlot(currentScalePc, i);
      if (!slot) {
        syncMemoryModalGrid();
        openModal(elMemoryModal);
        if (elSlotHint) {
          elSlotHint.textContent =
            "Slot " + (i + 1) + " is empty. Select keys, name the chord, then tap slot to save.";
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
    const payload = { appMode, currentScalePc, bankChords };
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
    if (typeof p.currentScalePc === "number") currentScalePc = normalizePc(p.currentScalePc);

    if (Array.isArray(p.bankChords) && p.bankChords.length === 12) {
      const next = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => null));
      for (let bank = 0; bank < 12; bank++) {
        const row = p.bankChords[bank];
        if (!Array.isArray(row) || row.length !== 12) continue;
        for (let i = 0; i < 12; i++) {
          const s = row[i];
          if (!s) continue;
          const midis = Array.isArray(s.midis)
            ? s.midis.map((m) => Number(m)).filter((m) => Number.isFinite(m))
            : [];
          const name = typeof s.name === "string" ? s.name : "";
          next[bank][i] = { midis, name };
        }
      }
      bankChords = next;
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
  // Always return full 88-key range
  return { min: PIANO_START_MIDI, max: PIANO_END_MIDI - 1, endExclusive: PIANO_END_MIDI };
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
    const shifted = m + deltaSemitone; // true semitone
    next.add(wrapIntoRange(shifted, min, max));
  }

  selectedMidis = next;

  // In Chord→Scale mode, transposing also advances the scale bank and transposes all stored chords.
  transposeBanksAndChords(deltaSemitone);

  updateSelectionUI();
  updateHint();
}


function updateHint() {
  if (selectedMidis.size === 0) {
    if (elTransposeHint) elTransposeHint.textContent = "Select keys";
    maybeAutoSetChordName();
    return;
  }
  const ordered = [...selectedMidis].sort((a, b) => a - b);
  const pcs = ordered.map(midiToPitchClassName);
  const uniq = [...new Set(pcs)];
  if (elTransposeHint) elTransposeHint.textContent = uniq.join(" - ");

  // Auto-label (unless a loaded slot name should stay)
  maybeAutoSetChordName();
}

function handleKeyToggle(midi) {
  // Manual selection breaks the association with a loaded slot
  activeSlot = -1;
  activeBankPc = -1;

  if (selectedMidis.has(midi)) selectedMidis.delete(midi);
  else selectedMidis.add(midi);

  updateSelectionUI();
  updateHint();
}

function rebuild() {
  const { min, max } = rangeMidis();
  selectedMidis = new Set([...selectedMidis].map((m) => wrapIntoRange(m, min, max)));

  // Keep stored chords wrapped if range changes (octave +/-)
  if (Array.isArray(bankChords) && bankChords.length === 12) {
    for (let bank = 0; bank < 12; bank++) {
      for (let i = 0; i < 12; i++) {
        const slot = bankChords[bank][i];
        if (!slot || !Array.isArray(slot.midis)) continue;
        slot.midis = slot.midis.map((m) => wrapIntoRange(m, min, max)).sort((a, b) => a - b);
      }
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
  if (elRangeText) elRangeText.textContent = `Range: ${midiToNote(min)} → ${midiToNote(max)} (88 keys)`;
  if (elOctaveText) elOctaveText.textContent = `${octaves}`;
}

function applyResponsiveSizing() {
  // Strategy:
  // - Keys are sized based on the viewport octave count for comfortable viewing
  // - All 88 keys are always rendered and can be scrolled through
  // - Viewport shows the selected number of octaves at a comfortable size

  const viewportWhiteCount = octaves * 7; // 7 white keys per octave
  const rs = getComputedStyle(document.documentElement);
  const gap = parseFloat(rs.getPropertyValue("--gap")) || 2;

  const containerW = elPianoScroll ? elPianoScroll.clientWidth : window.innerWidth;
  const paddingAllowance = 20; // .piano padding L+R (10 + 10)
  const availableW = Math.max(240, containerW - paddingAllowance);

  const totalGap = (viewportWhiteCount - 1) * gap;
  const whiteW = Math.max(16, (availableW - totalGap) / viewportWhiteCount);

  // Remaining height budget after topbar + controlBar + footer
  const topH = elTopbar ? elTopbar.offsetHeight : 0;
  const controlsH = elControls ? elControls.offsetHeight : 0;
  const footerH = elFooter ? elFooter.offsetHeight : 0;
  const safe = 28; // wrap padding + gaps buffer
  const availableH = Math.max(160, window.innerHeight - topH - controlsH - footerH - safe);

  // Set top padding to match header height + buffer to prevent overlap
  const elWrap = document.querySelector(".wrap");
  if (topH > 0 && elWrap) {
    const buffer = 20; // Extra spacing for clearance
    elWrap.style.paddingTop = `${topH + buffer}px`;
  }

  // More realistic piano key ratio (6:1 instead of 11:1)
  const baseRatio = 6;
  const whiteH = Math.max(140, Math.min(availableH, whiteW * baseRatio));

  // Calculate responsive border radius (capped between 3px and 10px)
  const whiteBorderRadius = Math.max(3, Math.min(10, whiteW * 0.15));
  const blackBorderRadius = Math.max(2, Math.min(8, whiteW * 0.12));

  document.documentElement.style.setProperty("--white-w", `${whiteW.toFixed(3)}px`);
  document.documentElement.style.setProperty("--white-h", `${whiteH.toFixed(3)}px`);
  document.documentElement.style.setProperty("--black-w", `${(whiteW * 0.65).toFixed(3)}px`);
  document.documentElement.style.setProperty("--black-h", `${(whiteH * 0.62).toFixed(3)}px`);
  document.documentElement.style.setProperty("--key-radius", `${whiteBorderRadius.toFixed(2)}px`);
  document.documentElement.style.setProperty("--black-radius", `${blackBorderRadius.toFixed(2)}px`);
}

// Track scroll vs tap for touch devices
let pointerDownPos = { x: 0, y: 0 };
let isScrolling = false;

function renderPiano() {
  elPiano.innerHTML = "";

  // Always render all 88 keys
  const keys = [];
  let whiteIndex = 0;

  for (let midi = PIANO_START_MIDI; midi < PIANO_END_MIDI; midi++) {
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
      pointerDownPos = { x: e.clientX, y: e.clientY };
      isScrolling = false;
    });

    div.addEventListener("pointerup", (e) => {
      if (!isScrolling) {
        handleKeyToggle(k.midi);
      }
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
      pointerDownPos = { x: e.clientX, y: e.clientY };
      isScrolling = false;
    });

    div.addEventListener("pointerup", (e) => {
      if (!isScrolling) {
        handleKeyTogg
