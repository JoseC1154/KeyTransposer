// FILE: js/chordDetection.js
// Chord detection and naming logic

// Track last detected chord information for roman numeral labeling
let lastDetectedRootPc = null;
let lastDetectedSuffix = "";

function getLastDetectedRoot() {
  return lastDetectedRootPc;
}

function getLastDetectedSuffix() {
  return lastDetectedSuffix;
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
      suffix = suffix + String(highest);
    } else {
      suffix = suffix + "add" + String(highest);
    }
  }

  // Slash chords / inversions
  const needsSlash = bassPc !== best.root;
  const slash = needsSlash ? ("/" + NOTES_SHARP[bassPc]) : "";

  // If there are still extra notes beyond our naming, add a light hint.
  const baseName = rootName + suffix + slash;
  // keep suffix updated if we appended extensions
  lastDetectedSuffix = suffix;
  const expectedCount = 1 + (rel.has(3) || rel.has(4) ? 1 : 0) + (rel.has(6) || rel.has(7) || rel.has(8) ? 1 : 0);
  const extraHint = pcs.length > Math.max(3, expectedCount + 1) ? " (add)" : "";

  return baseName + extraHint;
}

function chordLabelFromMidis(midis) {
  const pcs = [...new Set(midis.map(midiToPitchClassName))];
  return pcs.join("-");
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectChordNameFromMidis,
    chordLabelFromMidis,
    getLastDetectedRoot,
    getLastDetectedSuffix
  };
}
