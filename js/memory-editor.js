(() => {
  "use strict";
  const api = window.KTChordMemory;
  const $ = id => document.getElementById(id);
  const edit = $("slotEdit"), dialog = $("slotEditor"), actions = dialog.querySelector(".slot-editor-actions");
  const form = $("slotEditorConfirm"), name = $("slotEditorName"), message = $("slotEditorMessage");
  const buttons = Object.fromEntries([...actions.querySelectorAll("button")].map(b => [b.dataset.slotAction, b]));
  let enabled = false, current = null, clipboard = null, pending = null, invoker = null;
  const validNotes = notes => [...new Set(notes.filter(n => Number.isInteger(n) && n >= 21 && n <= 108))].sort((a,b)=>a-b);
  const label = loc => api.bankName(loc.bank) + " · Slot " + (loc.slot + 1);
  const get = loc => api.get(loc.bank, loc.slot);
  const sameSlot = (a, b) => a.bank === b.bank && a.slot === b.slot;
  const say = text => { message.textContent = text; };
  const recommendTarget = () => clipboard
    ? (clipboard.kind === "cut" ? "Cut " : "Copied ") + label(clipboard.location) + ". Choose a slot to paste."
    : "";
  function resetForm() {
    pending = null;
    form.hidden = true;
    actions.hidden = false;
  }
  function close(status) {
    if (typeof status === "string") $("slotActionStatus").textContent = status;
    dialog.close();
    resetForm();
    current = null;
    if (invoker?.isConnected) invoker.focus({preventScroll:true});
  }
  function update() {
    const chord = get(current);
    $("slotEditorTitle").textContent = label(current);
    $("slotEditorCurrent").textContent = chord ? (chord.name || "Unnamed chord") + " · " + api.noteNames(chord.midis) : "Empty";
    for (const key of ["load", "rename", "copy", "cut", "clear"]) buttons[key].disabled = !chord;
    buttons.save.disabled = !current.notes.length;
    buttons.paste.disabled = !clipboard || (clipboard.kind === "cut" && sameSlot(clipboard.location, current));
    say(clipboard ? recommendTarget() : "");
  }
  function begin(kind, value, prompt, actionLabel) {
    pending = { kind, value, existing: get(current) };
    actions.hidden = true;
    form.hidden = false;
    const naming = kind === "save" || kind === "rename";
    $("slotEditorNameLabel").hidden = !naming;
    name.disabled = !naming;
    name.value = naming ? value.name : "";
    $("slotEditorSubmit").textContent = actionLabel;
    say(prompt);
    if (naming) { name.focus(); name.select(); } else $("slotEditorSubmit").focus();
  }
  function apply(changes, status, after) {
    if (!api.commit(changes)) {
      say("Couldn’t save to this browser. No slots were changed.");
      return;
    }
    after?.();
    close(status);
  }
  function paste() {
    if (!clipboard) return;
    const { kind, location, value, source } = clipboard;
    const changes = [{...current, value }];
    if (kind === "cut") {
      if (sameSlot(location, current)) return;
      if (get(location) !== source) {
        clipboard = null;
        $("slotActionStatus").textContent = "";
        resetForm(); update();
        say("The source changed. Cut it again before moving it.");
        return;
      }
      changes.push({...location, value: null});
    }
    apply(changes, (kind === "cut" ? "Moved to " : "Pasted into ") + label(current),
      kind === "cut" ? () => { clipboard = null; } : undefined);
  }
  edit.addEventListener("click", () => {
    enabled = !enabled;
    edit.setAttribute("aria-pressed", String(enabled));
    edit.textContent = enabled ? "Done" : "Edit";
    const grid = $("memoryGrid");
    grid.classList.toggle("is-editing", enabled);
    for (const button of grid.querySelectorAll("button[data-slot]")) {
      if (enabled) button.setAttribute("aria-haspopup", "dialog");
      else button.removeAttribute("aria-haspopup");
    }
    if (!enabled) clipboard = null;
    $("slotActionStatus").textContent = enabled ? "Choose a slot." : "";
  });
  $("slotEditorClose").addEventListener("click", () => close());
  $("slotEditorBack").addEventListener("click", () => { resetForm(); update(); actions.querySelector("button:enabled")?.focus(); });
  dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
  dismissOnBackdrop(dialog, close);
  actions.addEventListener("click", e => {
    const button = e.target.closest("[data-slot-action]");
    if (!button || button.disabled || !current) return;
    const {slotAction: kind} = button.dataset;
    const stored = get(current);
    if (kind === "load") {
      if (api.load(current.bank, current.slot)) close("Loaded " + label(current) + ". Edit the notes, then save.");
      else say("Could not load this slot.");
    } else if (kind === "copy" || kind === "cut") {
      clipboard = {
        kind, location: {bank:current.bank, slot:current.slot},
        source: stored, value: {midis:stored.midis.slice(), name:stored.name},
      };
      close(recommendTarget());
    } else if (kind === "save") {
      const text = stored ? "Replace this saved chord with the selected notes?" : "Save the selected notes here.";
      begin(kind,{midis:current.notes,name:stored?.name || api.nameFor(current.notes)}, text, stored ? "Replace" : "Save");
    } else if (kind === "rename") {
      begin(kind,{midis:stored.midis.slice(),name:stored.name},"", "Save name");
    } else if (kind === "clear") {
      begin(kind,null,"Clear this saved chord?", "Clear slot");
    } else if (kind === "paste") {
      if (stored) begin(kind,null,"Replace the chord in this slot?", "Replace");
      else paste();
    }
  });
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!current || !pending) return;
    const { kind, value, existing } = pending;
    if (get(current) !== existing) { resetForm(); update(); say("This slot changed. Choose the action again."); return; }
    if (kind === "paste") { paste(); return; }
    const saved = kind === "clear" ? null : {...value, name: name.value.trim() || value.name};
    apply([{...current, value:saved}], (kind === "clear" ? "Cleared " : kind === "rename" ? "Renamed " : "Saved ") + label(current));
  });
  window.KTSlotEditor = {
    openSlot(bank, slot) {
      if (!enabled) return false;
      if (dialog.open) return true;
      invoker = $("memoryGrid").querySelector('[data-slot="' + slot + '"]');
      current = { bank, slot, notes: validNotes(api.notesToSave()) };
      api.prepareEdit();
      resetForm(); update();
      dialog.showModal();
      (actions.querySelector("button:enabled") || $("slotEditorClose")).focus();
      return true;
    },
  };
})();
