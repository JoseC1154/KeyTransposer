<!-- FILE: README.md -->

# Piano Chord Transposer (PWA)

A mobile‑first Progressive Web App for selecting piano notes, transposing chords, and practicing chord movement across scales.

The app is designed to feel like a native tool:

* No scrolling required for core controls
* Touch‑friendly piano keyboard
* Clean modal‑based interface
* Works offline when installed as a PWA

---

## Live Demo

* [https://josec1154.github.io/KeyTransposer/](https://josec1154.github.io/KeyTransposer/)

---
<!-- FILE: README.md -->

# Piano Chord Transposer (PWA)

A mobile‑first Progressive Web App for selecting piano notes, transposing chords, and practicing chord movement across scales.

The app is designed to feel like a native tool:

* No scrolling required for core controls
* Touch‑friendly piano keyboard
* Clean modal‑based interface
* Works offline when installed as a PWA

---

## Live Demo

* [https://josec1154.github.io/KeyTransposer/](https://josec1154.github.io/KeyTransposer/)

---

## Editing chord memory

Turn on **Edit**, then tap a numbered slot. **Load notes** brings a saved voicing to the keyboard without leaving Edit. Change the green notes, tap the slot again, and **Save**; **Rename** keeps the voicing, and **Clear** asks before removing it. **Copy** or **Cut**, then open the destination slot and choose **Paste**. Paste keeps the same notes, even in a different scale bank. Cut only clears its original slot once the destination saves. Turn off Edit to go back to normal slot taps.

## MIDI and Practice

- Plug in your USB MIDI keyboard, open the app in Chrome or Edge, and choose **MIDI → Connect MIDI**. If your keyboard exposes several ports, pick its keyboard-note input. Choose **Keyboard size** after connecting to display the matching range on the same piano. This is a display setting; it does not change saved chords. Held notes light up mint. Press the sustain pedal (CC64) and release a key to see its highlight dim and stay lit until you lift the pedal; this does not change scoring. Enable **Piano sound** for an optional synthesized piano if your controller does not make sound on its own. The app’s sustain sound decays with the initial visual fade; the remaining glow shows the pedal is still down, not the volume of the note. External audio is not measured. **Use held notes** copies them to the transposer without saving over a memory slot.
- Toggle **Practice** to show the practice controls in the existing transposer deck, without moving the piano. **Example** plays its saved chords on the same piano in amber. **Start** gives you a one-bar count-in, then one bar per filled slot in slot order. Empty slots are skipped. Drag a filled memory slot down to skip it (red) or up to include it, or focus it and press the Down or Up arrow. This only changes the Practice queue for the current page session, not the saved chord. The metronome accents beat 1; the beat strip marks the beat to play on. During Start, amber outlines show the target chord and your notes are mint. A wrong, early, late, or missed chord restarts from the first slot with a fresh count-in. Choose a meter (2/4, 3/4, 4/4, 5/4, 6/8, or 7/8) and a target count or Rotate. In 6/8, BPM counts dotted quarters and each bar shows six eighth-note counts.
- Tap the **Tap · BPM** button a few times in time before starting to set your tempo. Use the Up and Down arrows while focused on the button for 1 BPM changes. In 6/8, tap the two main pulses, not all six subdivisions.
- **Metronome** plays a standalone audible click at your chosen BPM and meter, even with no saved chords. **Stop click** ends it. Example and Start also play the click.
- While Practice is open, select or hold a chord and tap an empty memory slot to save it. If a round is running, opening chord memory stops the metronome; start again to include the new slot.
- Match the whole voicing, either in the saved octave or shifted by full octaves together. The next chord lights up as soon as you play the current one on time. A normal slight spread between fingers counts as one attack. Early/late timing, wrong chords, and missed bars are shown separately. Release the keys between attempts. Without a controller, select notes on the screen and tap **Play selected** on the target beat.
- Local preview: run `python3 -m http.server 8780 --bind 127.0.0.1` and visit `http://localhost:8780`. Tests: `node --test tests/practice.test.cjs`.

## Recent Updates ✅

All requested improvements have been implemented:

1. ✅ **Alternate Chord Suggestions** — New button (≈) in the control bar opens a modal with:

   * Chord inversions (1st and 2nd)
   * 7th, 9th, and 11th extensions
   * Suspended chords (sus2, sus4)
   * 6th chord variations
   * Relative major/minor chords
   * One-tap application of any suggestion
1. ✅ **Alternate Chord Suggestions** — New button (≈) in the control bar opens a modal with:

   * Chord inversions (1st and 2nd)
   * 7th, 9th, and 11th extensions
   * Suspended chords (sus2, sus4)
   * 6th chord variations
   * Relative major/minor chords
   * One-tap application of any suggestion

2. ✅ **Custom Modal System** — All browser prompts/alerts replaced with custom modals:

   * Themed prompt dialog for naming chords
   * Keyboard support (Enter to confirm, Escape to cancel)
   * Touch-friendly on mobile devices
2. ✅ **Custom Modal System** — All browser prompts/alerts replaced with custom modals:

   * Themed prompt dialog for naming chords
   * Keyboard support (Enter to confirm, Escape to cancel)
   * Touch-friendly on mobile devices

3. ✅ **iPhone Safe Area Support** — Fixed layout for devices with notches/dynamic islands:

   * Proper padding for status bar, camera notch, and home indicator
   * Hamburger menu is fully accessible
   * Uses `env(safe-area-inset-*)` for all edges
3. ✅ **iPhone Safe Area Support** — Fixed layout for devices with notches/dynamic islands:

   * Proper padding for status bar, camera notch, and home indicator
   * Hamburger menu is fully accessible
   * Uses `env(safe-area-inset-*)` for all edges

4. ✅ **5-Step Undo System** — Quick way to return to previous chords:

   * Undo button (↶) appears after applying alternate chords
   * Maintains history of up to 5 chord changes
   * Shows number of available undo steps (↶2, ↶3, etc.)
   * Click repeatedly to step back through history

5. ✅ **Export / Import Backup** — Share and backup your chord banks:

   * Export all 12 scale banks to JSON file
   * Import from previous backups
   * Perfect for syncing across devices or sharing with others
   * Includes validation to prevent corrupted data

6. ✅ **Help Modal** — Built-in "How to Use" guide:

   * Accessible from the menu
   * Comprehensive instructions for all features
   * Explains controls, workflows, and tips
   * Mobile-friendly scrollable interface

7. ✅ **Landscape Mode Optimizations** — Reduced modal footprint in landscape orientation:

   * Modals use 30% less vertical space
   * Wider layout (680px) for better horizontal space usage
   * Compact padding and fonts for density
   * All elements remain touch-friendly
   * Automatically activates when height ≤ 600px

8. ✅ **Removed "$1" Bug** — Clean header display

---

## Features

### Piano Interaction

* Select notes directly on a visual piano keyboard
* Multiple octaves supported
* Keyboard dynamically resizes to fit the screen

### Transposition

* Transpose up or down by semitone
* Selected notes remain selected after transpose
* Notes wrap within the visible keyboard range

### Chord Detection

* Automatic chord naming
* Supports common triads and extended chords
* Optional custom naming via modal input

### Chord Memory System

* 12 scale banks
* 12 chord slots per bank
* Chords stored with their associated scale
* Transpose changes only the working notes; saved slots and the active scale bank stay unchanged.

### Alternate Chords

* Suggests related chords and voicings based on selected notes
* 5-step undo history (↶ button)
* Quick experimentation with different voicings

### Backup & Share

* Export all chord banks to JSON file
* Import from previous backups
* Sync data across multiple devices
* Share chord collections with others

### Help System

* Built-in "How to Use" guide
* Comprehensive feature documentation
* Quick reference for all controls

### PWA Support

* Installable on mobile and desktop
* Offline capable using service worker

---

## Controls Overview

| Control      | Function                         |
| ------------ | -------------------------------- |
| − / +        | Change number of octaves         |
| ▼ / ▲        | Transpose down or up             |
| ≈            | Show alternate chord suggestions |
| ↶            | Undo alternate chord (5 steps)   |
| Memory slots | Save and recall chords           |
| Menu         | Scale banks, memory tools, backup, help |

---

## Mobile Design Goals

* All primary controls visible without scrolling
* Safe‑area aware layout (notch and home bar)
* Large tap targets for performance use

---

## File Structure

```
index.html              Main UI layout
styles.css              Layout and responsive styling
js/utils.js             Shared helpers and constants
js/chordDetection.js    Chord naming logic
js/chordAlternates.js   Alternate chord generation
js/main.js              Piano logic, transposition, memory, detection
manifest.json           PWA manifest
service-worker.js       Offline caching
```

---

## Local Development

Because this is a PWA, run it through a local server rather than opening the file directly.

Example:

```
python -m http.server
```

Then open:

```
http://localhost:8000
```

---

## To Do

* Fix note letter positioning so the letters sit correctly centered on the key circles.
* Menu: "Scale" and "Chord Memory" currently route to the same modal — separate these into the correct destinations.
* Fix logic, check the reasoning for alternate chord "I created an f# maj chord , saved it then used the alternative button and what it suggested was a Db Maj,"
* Change  to --key-radius: 2px;--
* Change .key.selected .noteLabel {
    opacity: 1;
    /* transform: translateY(0); */
}
*Change to 
    opacity: 0;
    transform: translateY(3px);
    transition: opacity 0.12s ease, transform 0.12s ease;
    padding: 2px 2px;
    border-radius: 999px;
    background: rgba(0,0,0,0.18);
    /* max-width: 92%; */
    /* overflow: hidden; */
    text-overflow: ellipsis;
    white-space: nowrap;
  *I want the gap between buttons to be 4px
  *the transposeCluster and bankSelector buttons don't appear the same.
  * the memoryGrid button should take up the width of the space.

## Future Ideas

* Root note highlighting
* Minor key roman numeral analysis
* MIDI input support
* Cloud sync integration

---

## License

Personal or educational use. Modify freely.
