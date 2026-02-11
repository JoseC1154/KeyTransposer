// FILE: js/main.js
// Main application logic for Piano Chord Transposer
// Note: Utilities, chord detection, and alternates are in separate modules

// Constants from utils.js are available globally
// MIN/MAX octaves for viewport control
const MIN_OCTAVES = 2;
const MAX_OCTAVES = 7;

// Octaves controls viewport/visible area sizing
let octaves = 2;

let selectedMidis = new Set();

let elPiano;
let elPianoScroll;
let elRangeText;
let elChordNameText;
let elOctaveText;
let elStatus;
let elTransposeKeyText;
let elTransposeHint;

let elTopbar;
let elCommandDeck;
let elFooter;

// ===== Chord Memory & Controls =====
let elBtnMenu;
let elMenuModal;
let elMemoryMeta;
let elBtnMemory;
let elMemoryModal;
let elMemoryGrid;
let elMemoryGridModal;

let elBtnOpenMemory;
let elBtnPickScale;

let elScaleSelect;
let elBtnScaleAdd;
let elBtnScaleRemove;
let elSlotHint;
let elBtnSlotLoad;
let elBtnSlotClear;

let elBankSelector;
let elBtnBankPrev;
let elBtnBankCurrent;
let elBtnBankNext;

let elBtnAlternates;
let elAlternatesModal;
let elAlternatesList;
let elBtnUndo;

let elBtnHelp;
let elHelpModal;

let elBtnExport;
let elBtnImport;
let elFileInput;

let elPromptModal;
let elPromptInput;
let elPromptOk;

function cacheDomRefs() {
  elPiano = document.getElementById("piano");
  elPianoScroll = document.getElementById("pianoScroll");
  elRangeText = document.getElementById("rangeText");
  elChordNameText = document.getElementById("chordNameText");
  elOctaveText = document.getElementById("octaveText");
  elStatus = document.getElementById("status");
  elTransposeKeyText = document.getElementById("transposeKeyText");
  elTransposeHint = document.getElementById("transposeHint");

  elTopbar = document.getElementById("topbar");
  elCommandDeck = document.getElementById("commandDeck");
  elFooter = document.getElementById("footer");

  elBtnMenu = document.getElementById("btnMenu");
  elMenuModal = document.getElementById("menuModal");
  elMemoryMeta = document.getElementById("memoryMeta");
  elBtnMemory = document.getElementById("btnMemory");
  elMemoryModal = document.getElementById("memoryModal");
  elMemoryGrid = document.getElementById("memoryGrid");
  elMemoryGridModal = document.getElementById("memoryGridModal");

  elBtnOpenMemory = document.getElementById("btnOpenMemory");
  elBtnPickScale = document.getElementById("btnPickScale");

  elScaleSelect = document.getElementById("scaleSelect");
  elBtnScaleAdd = document.getElementById("btnScaleAdd");
  elBtnScaleRemove = document.getElementById("btnScaleRemove");
  elSlotHint = document.getElementById("slotHint");
  elBtnSlotLoad = document.getElementById("btnSlotLoad");
  elBtnSlotClear = document.getElementById("btnSlotClear");

  elBankSelector = document.getElementById("bankSelector");
  elBtnBankPrev = document.getElementById("btnBankPrev");
  elBtnBankCurrent = document.getElementById("btnBankCurrent");
  elBtnBankNext = document.getElementById("btnBankNext");

  elBtnAlternates = document.getElementById("btnAlternates");
  elAlternatesModal = document.getElementById("alternatesModal");
  elAlternatesList = document.getElementById("alternatesList");
  elBtnUndo = document.getElementById("btnUndo");

  elBtnHelp = document.getElementById("btnHelp");
  elHelpModal = document.getElementById("helpModal");

  elBtnExport = document.getElementById("btnExport");
  elBtnImport = document.getElementById("btnImport");
  elFileInput = document.getElementById("fileInput");

  elPromptModal = document.getElementById("promptModal");
  elPromptInput = document.getElementById("promptInput");
  elPromptOk = document.getElementById("promptOk");
}

function onReady(callback) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
}

function initApp() {
  cacheDomRefs();

  const btnPlus = document.getElementById("btnPlus");
  if (btnPlus) {
    btnPlus.addEventListener("click", () => {
      if (octaves < MAX_OCTAVES) {
        octaves += 1;
        applyResponsiveSizing();
        rebuild();
      }
    });
  }

  const btnMinus = document.getElementById("btnMinus");
  if (btnMinus) {
    btnMinus.addEventListener("click", () => {
      if (octaves > MIN_OCTAVES) {
        octaves -= 1;
        applyResponsiveSizing();
        rebuild();
      }
    });
  }

  const btnUp = document.getElementById("btnUp");
  if (btnUp) btnUp.addEventListener("click", () => transposeSelection(+1));

  const btnDown = document.getElementById("btnDown");
  if (btnDown) btnDown.addEventListener("click", () => transposeSelection(-1));

  const btnClear = document.getElementById("btnClear");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      selectedMidis.clear();
      activeSlot = -1;
      activeBankPc = -1;
      setChordName("");
      undoHistory = [];
      updateUndoButton();
      updateSelectionUI();
      updateHint();
    });
  }

  if (elBtnUndo) {
    elBtnUndo.addEventListener("click", undoAlternateChord);
  }

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
  if (elBtnHelp) {
    elBtnHelp.addEventListener("click", () => {
      closeModal(elMenuModal);
      openModal(elHelpModal);
    });
  }

  if (elBtnExport) {
    elBtnExport.addEventListener("click", () => {
      exportChordBanks();
    });
  }

  if (elBtnImport && elFileInput) {
    elBtnImport.addEventListener("click", () => {
      elFileInput.click();
    });

    elFileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result;
        if (typeof content === "string") {
          importChordBanks(content);
        }
        // Reset input so same file can be imported again
        elFileInput.value = "";
      };
      reader.onerror = () => {
        if (elStatus) {
          elStatus.textContent = "Failed to read file";
          setTimeout(() => {
            elStatus.textContent = "Offline-ready.";
          }, 3000);
        }
        elFileInput.value = "";
      };
      reader.readAsText(file);
    });
  }

  if (elPianoScroll) {
    elPianoScroll.addEventListener("pointermove", (e) => {
      if (pointerDownPos.x !== 0 || pointerDownPos.y !== 0) {
        const deltaX = Math.abs(e.clientX - pointerDownPos.x);
        const deltaY = Math.abs(e.clientY - pointerDownPos.y);
        // If moved more than 5px, consider it scrolling
        if (deltaX > 5 || deltaY > 5) {
          isScrolling = true;
        }
      }
    });

    elPianoScroll.addEventListener("pointerup", () => {
      pointerDownPos = { x: 0, y: 0 };
    });

    elPianoScroll.addEventListener("pointercancel", () => {
      pointerDownPos = { x: 0, y: 0 };
    });
  }

  loadState();
  rebuildScaleSelect();
  setCurrentScalePc(currentScalePc);
  updateBankDisplay();
  renderMemoryButtons();
  syncMemoryModalGrid();
  setChordName("");

  applyResponsiveSizing();
  renderPiano();
  updateHeader();
  updateTransposeKeyDisplay();
  updateHint();
}

// Cache references once immediately (scripts load after DOM in index.html)
cacheDomRefs();

onReady(initApp);

const STORAGE_KEY = "pct_state_v1";

// Fixed 12 scale banks (C..B)
let scales = Array.from({ length: 12 }, (_, pc) => pc);
let currentScalePc = 0; // bank index 0..11

// 12 scale banks × 12 chord slots
// bankChords[bankPc][slotIndex] = { midis:number[], name:string } | null
let bankChords = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => null));

let activeSlot = -1;
let activeBankPc = -1; // Track which bank the active slot belongs to
let activeChordName = "";

// Undo history stack for alternate chord changes (max 5 steps)
const MAX_UNDO_STEPS = 5;
let undoHistory = []; // Array of { midis: Set<number>, name: string }
// Removed stray event listener for btnPlus
// ===== Undo Alternate Chord =====
function updateUndoButton() {
  if (elBtnUndo) {
    elBtnUndo.hidden = undoHistory.length === 0;
    // Update button text to show number of undo steps available
    if (undoHistory.length > 1) {
      elBtnUndo.textContent = `↶${undoHistory.length}`;
    } else {
      elBtnUndo.textContent = "↶";
    }
  }
}

function undoAlternateChord() {
  if (undoHistory.length === 0) return;
  
  const previousState = undoHistory.pop();
  
  selectedMidis.clear();
  previousState.midis.forEach(m => selectedMidis.add(m));
  setChordName(previousState.name);
  
  updateUndoButton();
  updateSelectionUI();
  updateHint();
}

// ===== Custom Prompt Modal =====

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
  if (elAlternatesModal && !elAlternatesModal.hidden) return closeModal(elAlternatesModal);
  if (elMemoryModal && !elMemoryModal.hidden) return closeModal(elMemoryModal);
  if (elMenuModal && !elMenuModal.hidden) return closeModal(elMenuModal);
});

// ===== Export / Import Chord Banks =====
function exportChordBanks() {
  const exportData = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    currentScalePc,
    bankChords: bankChords.map(bank => 
      bank.map(slot => 
        slot ? { midis: [...slot.midis], name: slot.name } : null
      )
    )
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);
  
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const filename = `piano-chords-${timestamp}.json`;
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  
  URL.revokeObjectURL(url);
  
  if (elStatus) {
    elStatus.textContent = `Exported: ${filename}`;
    setTimeout(() => {
      elStatus.textContent = "Offline-ready.";
    }, 3000);
  }
}

function importChordBanks(fileContent) {
  try {
    const data = JSON.parse(fileContent);
    
    // Validate structure
    if (!data.bankChords || !Array.isArray(data.bankChords) || data.bankChords.length !== 12) {
      throw new Error("Invalid backup file structure");
    }
    
    // Validate each bank
    for (let bankIdx = 0; bankIdx < 12; bankIdx++) {
      const bank = data.bankChords[bankIdx];
      if (!Array.isArray(bank) || bank.length !== 12) {
        throw new Error(`Invalid bank ${bankIdx} structure`);
      }
      
      // Validate each slot
      for (let slotIdx = 0; slotIdx < 12; slotIdx++) {
        const slot = bank[slotIdx];
        if (slot !== null) {
          if (!slot.midis || !Array.isArray(slot.midis) || typeof slot.name !== "string") {
            throw new Error(`Invalid slot data at bank ${bankIdx}, slot ${slotIdx}`);
          }
        }
      }
    }
    
    // Import data
    bankChords = data.bankChords.map(bank =>
      bank.map(slot =>
        slot ? { midis: slot.midis, name: slot.name } : null
      )
    );
    
    if (typeof data.currentScalePc === "number" && data.currentScalePc >= 0 && data.currentScalePc < 12) {
      currentScalePc = data.currentScalePc;
      updateBankDisplay();
    }
    
    saveState();
    renderMemoryButtons();
    syncMemoryModalGrid();
    
    if (elStatus) {
      elStatus.textContent = "Chord banks imported successfully!";
      setTimeout(() => {
        elStatus.textContent = "Offline-ready.";
      }, 3000);
    }
    
    return true;
  } catch (err) {
    console.error("Import error:", err);
    if (elStatus) {
      elStatus.textContent = `Import failed: ${err.message}`;
      setTimeout(() => {
        elStatus.textContent = "Offline-ready.";
      }, 4000);
    }
    return false;
  }
}

// ===== Bank Selector Event Handlers =====
function updateBankDisplay() {
  if (elBtnBankCurrent) {
    elBtnBankCurrent.textContent = NOTES_SHARP[currentScalePc];
  }
  updateMemoryMeta();
  updateTransposeKeyDisplay();
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

// ===== Scale Context =====
function updateMemoryMeta() {
  if (!elMemoryMeta) return;
  elMemoryMeta.textContent = "Bank: " + NOTES_SHARP[currentScalePc];
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
  const lastDetectedRootPc = getLastDetectedRoot();
  if (lastDetectedRootPc === null) return autoName;

  const baseRoman = romanForPcInMajorKey(lastDetectedRootPc, currentScalePc);
  const roman = applyQualityToRoman(baseRoman, getLastDetectedSuffix());
  if (roman === "?") return autoName;
  return roman + " — " + autoName;
}

function setChordName(name) {
  activeChordName = (name || "").trim();
  if (elChordNameText) {
    elChordNameText.textContent = activeChordName ? ("Chord: " + activeChordName) : "Chord: —";
  }
}

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
  updateTransposeKeyDisplay();
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

// Wrapper for chord detection from selected notes
function detectChordNameFromSelected() {
  return detectChordNameFromMidis([...selectedMidis]);
}

function showAlternateChords() {
  if (selectedMidis.size === 0) {
    if (elAlternatesList) {
      elAlternatesList.innerHTML = '<div class="modalHint">Select some keys first to see alternate chord suggestions.</div>';
    }
    openModal(elAlternatesModal);
    return;
  }

  const alternates = generateAlternateChords(selectedMidis, getLastDetectedRoot());
  
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
        // Save current state to undo history
        undoHistory.push({
          midis: new Set(selectedMidis),
          name: activeChordName
        });
        
        // Keep only last MAX_UNDO_STEPS entries
        if (undoHistory.length > MAX_UNDO_STEPS) {
          undoHistory.shift();
        }
        
        updateUndoButton();
        
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
  // Don't overwrite a loaded slot name
  if (activeSlot >= 0) {
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
        const name = await customPrompt("Name this chord (auto-filled, edit if you want):", defaultName);
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
    const payload = { 
      currentScalePc, 
      bankChords
    };
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

function transposeSelection(deltaSemitone) {
  if (selectedMidis.size === 0) return;

  const { min, max } = rangeMidis();
  const next = new Set();

  for (const m of selectedMidis) {
    const shifted = m + deltaSemitone; // true semitone
    next.add(wrapIntoRange(shifted, min, max));
  }

  selectedMidis = next;

  // Transposing also advances the scale bank and keeps stored chords aligned.
  transposeBanksAndChords(deltaSemitone);

  updateSelectionUI();
  updateHint();
}


function updateTransposeKeyDisplay() {
  if (elTransposeKeyText) {
    elTransposeKeyText.textContent = NOTES_SHARP[currentScalePc];
  }
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
  
  // Clear undo history on manual selection
  undoHistory = [];
  updateUndoButton();

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
  const controlsH = elCommandDeck ? elCommandDeck.offsetHeight : 0;
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
  if (!elPiano) {
    cacheDomRefs();
  }
  if (!elPiano) {
    console.warn("Piano element missing; render skipped");
    return;
  }
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
        handleKeyToggle(k.midi);
      }
    });

    // Position black key between the anchor white and the next white
    // Black key is centered at the right edge of the anchor white key
    const leftPx = (k.anchorWhiteIndex * (whiteW + gap)) + whiteW - (blackW / 2) + 10;
    div.style.left = `${leftPx}px`;

    elPiano.appendChild(div);
  }
}

// Detect scrolling on piano container
function updateSelectionUI() {
  if (!elPiano) {
    cacheDomRefs();
  }
  if (!elPiano) return;
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
