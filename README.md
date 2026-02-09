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
   * Explains controls, modes, and workflows
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
* Slots update correctly when transposing

### Modes

**Free Transpose**

* Select and transpose notes freely

**Chord → Scale Mode**

* Practice chords through different keys
* Roman numeral analysis shown relative to scale

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
| Menu         | Modes, scales, backup, help      |

---

## Mobile Design Goals

* All primary controls visible without scrolling
* Safe‑area aware layout (notch and home bar)
* Large tap targets for performance use

---

## File Structure

```
index.html          Main UI layout
styles.css          Layout and responsive styling
app.js              Piano logic, transposition, memory, detection
manifest.json       PWA manifest
service-worker.js   Offline caching
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

* In **Chord → Scale** mode, make ▲/▼ transpose the **selected chord starting point** and update the **scale bank label** accordingly (example: if you're in **F#** major and transpose down 1 step, it should show **F** major).
* Fix note letter positioning so the letters sit correctly centered on the key circles.
* Menu: "Scale" and "Chord Memory" currently route to the same modal — separate these into the correct destinations.
* Fix logic, check the reasoning for alternate chord "I created an f# maj chord , saved it then used the alternative button and what it suggested was a Db Maj,"

---

## Future Ideas

* Root note highlighting
* Minor key roman numeral analysis
* MIDI input support
* Cloud sync integration

---

## License

Personal or educational use. Modify freely.
