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

2. ✅ **Custom Modal System** — All browser prompts/alerts replaced with custom modals:

   * Themed prompt dialog for naming chords
   * Keyboard support (Enter to confirm, Escape to cancel)
   * Touch-friendly on mobile devices

3. ✅ **iPhone Safe Area Support** — Fixed layout for devices with notches/dynamic islands:

   * Proper padding for status bar, camera notch, and home indicator
   * Hamburger menu is fully accessible
   * Uses `env(safe-area-inset-*)` for all edges

4. ✅ **Removed “$1” Bug** — Clean header display

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
| Memory slots | Save and recall chords           |
| Menu         | Modes, scales, and settings      |

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

* Add a quick way to return to the previous chord after applying an alternate chord suggestion.
* In **Chord → Scale** mode, make ▲/▼ transpose the **selected chord starting point** and update the **scale bank label** accordingly (example: if you’re in **F#** major and transpose down 1 step, it should show **F** major).
* Add Share button for **export / import** (backup and restore chord banks).
* Keep the **≈ alternate** button on the **same line** as the transpose buttons.
* Fix note letter positioning so the letters sit correctly centered on the key circles.
* Landscape: reduce modal footprint (button-sized launcher or more compact modal layout).
* Menu: “Scale” and “Chord Memory” currently route to the same modal — separate these into the correct destinations.
* Fix logic, check the reasoning for alterante chord "I created an f# maj chord , saved it then used the alternative button and what it sugested was a Db Maj,"

---

## Future Ideas

* Root note highlighting
* Minor key roman numeral analysis
* MIDI input support
* Export / import chord banks

---

## License

Personal or educational use. Modify freely.
