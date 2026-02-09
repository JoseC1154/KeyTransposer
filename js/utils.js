// FILE: js/utils.js
// Utility functions for the Piano Chord Transposer

// Constants
const NOTES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const IS_BLACK = new Set([1,3,6,8,10]); // C#, D#, F#, G#, A#

// Full 88-key piano: A0 (21) to C8 (108)
const PIANO_START_MIDI = 21; // A0
const PIANO_END_MIDI = 109; // C8 (exclusive)
const TOTAL_KEYS = 88;

// Helper functions
function midiToPitchClass(midi) {
  return ((midi % 12) + 12) % 12;
}

function normalizePc(pc) {
  return ((pc % 12) + 12) % 12;
}

function midiToNote(midi) {
  const pc = midiToPitchClass(midi);
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTES_SHARP[pc]}${octave}`;
}

function midiToPitchClassName(midi) {
  return NOTES_SHARP[midiToPitchClass(midi)];
}

function wrapIntoRange(midi, min, max) {
  let m = midi;
  while (m < min) m += 12;
  while (m > max) m -= 12;
  return m;
}

function rangeMidis() {
  return { min: PIANO_START_MIDI, max: PIANO_END_MIDI - 1 };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NOTES_SHARP,
    IS_BLACK,
    PIANO_START_MIDI,
    PIANO_END_MIDI,
    TOTAL_KEYS,
    midiToPitchClass,
    normalizePc,
    midiToNote,
    midiToPitchClassName,
    wrapIntoRange,
    rangeMidis
  };
}
