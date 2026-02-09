// FILE: js/chordAlternates.js
// Generate alternate chord suggestions with proper voicings

/**
 * Generate alternate chord suggestions based on selected notes
 * @param {Set<number>} selectedMidis - Set of selected MIDI note numbers
 * @param {number|null} lastDetectedRootPc - Pitch class of detected root (0-11)
 * @returns {Array} Array of alternate chord objects {midis, name, description}
 */
function generateAlternateChords(selectedMidis, lastDetectedRootPc) {
  if (selectedMidis.size === 0) return [];

  const orderedMidis = [...selectedMidis].sort((a, b) => a - b);
  const pcs = [...new Set(orderedMidis.map(midiToPitchClass))].sort((a, b) => a - b);
  
  if (pcs.length < 2) return [];

  const bassMidi = orderedMidis[0];
  const { min, max } = rangeMidis();
  
  const alternates = [];

  // Helper to create chord from root note and intervals
  const makeChord = (rootMidi, intervals, name, description) => {
    const midis = intervals.map(i => {
      let midi = rootMidi + i;
      // Keep within current range
      while (midi < min) midi += 12;
      while (midi > max) midi -= 12;
      return midi;
    }).sort((a, b) => a - b);
    
    return { midis, name, description };
  };

  // Use detected root or fall back to lowest note
  const rootPc = lastDetectedRootPc !== null ? lastDetectedRootPc : midiToPitchClass(bassMidi);
  
  // Find the MIDI note in the selected notes that matches our root pitch class
  // Prefer the lowest occurrence
  let rootMidi = null;
  for (const midi of orderedMidis) {
    if (midiToPitchClass(midi) === rootPc) {
      rootMidi = midi;
      break;
    }
  }
  
  // If no match found, calculate from bass note
  if (rootMidi === null) {
    const bassPc = midiToPitchClass(bassMidi);
    const pcDiff = normalizePc(rootPc - bassPc);
    rootMidi = bassMidi + pcDiff;
  }
  
  const rootName = NOTES_SHARP[rootPc];

  // Analyze current chord structure
  const intervalsFromRoot = pcs.map(pc => normalizePc(pc - rootPc)).sort((a, b) => a - b);
  const hasThird = intervalsFromRoot.includes(3) || intervalsFromRoot.includes(4);
  const isMajor = intervalsFromRoot.includes(4);
  const isMinor = intervalsFromRoot.includes(3);
  const hasFifth = intervalsFromRoot.includes(7);
  const hasSeventh = intervalsFromRoot.includes(10) || intervalsFromRoot.includes(11);

  // === INVERSIONS ===
  // Only suggest inversions if we have a triad or more
  if (pcs.length >= 3 && hasThird && hasFifth) {
    const thirdInterval = isMajor ? 4 : 3;
    const quality = isMajor ? '' : 'm';
    
    // First inversion: 3rd in bass, then 5th, then root
    alternates.push(makeChord(
      rootMidi + thirdInterval,  // Start from 3rd
      [0, 3, thirdInterval + 5],  // 3rd, 5th (3 semitones up), root (another thirdInterval+5 = 8 or 9)
      `${rootName}${quality}/1st`,
      "First inversion (3rd in bass)"
    ));

    // Second inversion: 5th in bass, then root, then 3rd
    alternates.push(makeChord(
      rootMidi + 7,  // Start from 5th
      [0, 5, 5 + thirdInterval],  // 5th, root (5 semitones up), 3rd
      `${rootName}${quality}/2nd`,
      "Second inversion (5th in bass)"
    ));
  }

  // === 7TH CHORD VARIATIONS ===
  // Only suggest if not already a 7th chord
  if (isMajor && !hasSeventh) {
    alternates.push(makeChord(rootMidi, [0, 4, 7, 11], `${rootName}maj7`, "Add major 7th"));
    alternates.push(makeChord(rootMidi, [0, 4, 7, 10], `${rootName}7`, "Add dominant 7th"));
    alternates.push(makeChord(rootMidi, [0, 4, 7, 9], `${rootName}6`, "Add major 6th"));
  }

  if (isMinor && !hasSeventh) {
    alternates.push(makeChord(rootMidi, [0, 3, 7, 10], `${rootName}m7`, "Add minor 7th"));
    alternates.push(makeChord(rootMidi, [0, 3, 7, 11], `${rootName}mMaj7`, "Add major 7th"));
    alternates.push(makeChord(rootMidi, [0, 3, 7, 9], `${rootName}m6`, "Add major 6th"));
  }

  // === SUSPENDED CHORDS ===
  // Only suggest if chord currently has a third
  if (hasThird && hasFifth) {
    alternates.push(makeChord(rootMidi, [0, 5, 7], `${rootName}sus4`, "Replace 3rd with 4th"));
    alternates.push(makeChord(rootMidi, [0, 2, 7], `${rootName}sus2`, "Replace 3rd with 2nd"));
  }

  // === 9TH AND 11TH EXTENSIONS ===
  // Only suggest if we already have a 7th
  if (hasSeventh) {
    const seventhInterval = intervalsFromRoot.includes(11) ? 11 : 10;
    const thirdInterval = isMajor ? 4 : isMinor ? 3 : 4;
    const quality = isMinor ? 'm' : '';
    
    // 9th chord needs 7th + 9th (which is 2 semitones = whole step above root)
    alternates.push(makeChord(
      rootMidi,
      [0, thirdInterval, 7, seventhInterval, 14],  // 14 = octave + 2
      `${rootName}${quality}9`,
      "Add 9th extension"
    ));
    
    // 11th chord
    alternates.push(makeChord(
      rootMidi,
      [0, thirdInterval, 7, seventhInterval, 17],  // 17 = octave + 5
      `${rootName}${quality}11`,
      "Add 11th extension"
    ));
  }

  // === RELATIVE MAJOR/MINOR ===
  // Relative minor is 3 semitones (minor 3rd) below major
  // Relative major is 3 semitones above minor
  if (isMajor && hasFifth) {
    const relativeMinorPc = normalizePc(rootPc - 3);
    const relativeMinorName = NOTES_SHARP[relativeMinorPc];
    
    // Find appropriate MIDI note for relative minor
    let relMinorMidi = rootMidi - 3;
    while (relMinorMidi < min) relMinorMidi += 12;
    while (relMinorMidi > max) relMinorMidi -= 12;
    
    alternates.push(makeChord(
      relMinorMidi,
      [0, 3, 7],
      `${relativeMinorName}m`,
      "Relative minor (shares notes)"
    ));
  } else if (isMinor && hasFifth) {
    const relativeMajorPc = normalizePc(rootPc + 3);
    const relativeMajorName = NOTES_SHARP[relativeMajorPc];
    
    // Find appropriate MIDI note for relative major
    let relMajorMidi = rootMidi + 3;
    while (relMajorMidi < min) relMajorMidi += 12;
    while (relMajorMidi > max) relMajorMidi -= 12;
    
    alternates.push(makeChord(
      relMajorMidi,
      [0, 4, 7],
      `${relativeMajorName}`,
      "Relative major (shares notes)"
    ));
  }

  // === PARALLEL MAJOR/MINOR ===
  // Same root, different quality
  if (isMajor && hasFifth) {
    alternates.push(makeChord(
      rootMidi,
      [0, 3, 7],
      `${rootName}m`,
      "Parallel minor (same root)"
    ));
  } else if (isMinor && hasFifth) {
    alternates.push(makeChord(
      rootMidi,
      [0, 4, 7],
      `${rootName}`,
      "Parallel major (same root)"
    ));
  }

  return alternates;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateAlternateChords
  };
}
