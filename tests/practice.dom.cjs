// Optional DOM integration suite: install jsdom in a test environment or set NODE_PATH.
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const base = join(__dirname, '..');
const calm = () => new Promise(resolve => setImmediate(resolve));
const slots = [
  { slot: 1, name: 'C major', midis: [60,64,67] },
  { slot: 4, name: 'G major', midis: [55,59,62] },
  { slot: 11, name: 'F major', midis: [53,57,60] }
];
async function setup(t, entries = slots) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(readFileSync(join(base,'index.html'),'utf8'), {
    runScripts:'outside-only', pretendToBeVisual:true, url:'https://practice.invalid/', virtualConsole,
  });
  const w = dom.window, d = w.document;
  const bankChords = Array.from({length:12}, () => Array(12).fill(null));
  for (const {slot, name, midis} of entries) bankChords[0][slot-1] = {name, midis};
  bankChords[1][0] = {name:'Different bank', midis:[61,65,68]};
  w.localStorage.setItem('pct_state_v1', JSON.stringify({currentScalePc:0, bankChords}));
  w.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open',''); };
  w.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); };
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  let clock = 1000, frames = new Map(), frameId = 0, played = [], audioClock = 3;
  Object.defineProperty(w.performance,'now',{value:()=> clock});
  w.requestAnimationFrame = f => { frames.set(++frameId, f); return frameId; };
  w.cancelAnimationFrame = n => frames.delete(n);
  Object.defineProperty(w,'isSecureContext',{value:true});
  class Audio {
    state = 'running';
    get currentTime() { return audioClock; }
    createGain() { return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){}},connect(){},disconnect(){}}; }
    createOscillator() {
      return {frequency:{value:0},connect(){},disconnect(){},end:Infinity,
        start(at){this.at=at; played.push(this);},
        stop(at){this.end=at ?? 0;},
      };
    }
  }
  w.AudioContext = Audio;
  const port = { id:'yc', name:'YC Series Port 1', state:'connected', open(){}, close(){} };
  const usb = { inputs:new Map([['yc',port]]) };
  let asked = 0, pending = null;
  w.navigator.requestMIDIAccess = async options => { assert.equal(options.sysex,false); asked++; return pending || usb; };
  for (const path of ['utils','chordDetection','chordAlternates','main','practice','memory-editor']) vm.runInContext(readFileSync(join(base,'js',path+'.js'),'utf8'),dom.getInternalVMContext());
  await calm();
  const id = id => d.getElementById('kt'+id);
  const set = (key,value) => {id(key).value = value; id(key).dispatchEvent(new w.Event('change'));};
  const click = key => id(key).click();
  const piano = d.getElementById('piano');
  const tap = n => piano.querySelector('[data-midi="'+n+'"]').dispatchEvent(new w.Event('pointerup', {bubbles:true}));
  const at = time => { clock=time; const queued=[...frames.values()]; frames.clear(); queued.forEach(f=>f(time)); };
  const send = (status,note,velocity,time=clock) => port.onmidimessage({ data:[status,note,velocity], timeStamp:time });
  const midi = async () => { click('Midi'); click('Connect'); await calm(); id('MidiDialog').close(); };
  const round = async (beat='1') => { set('Tempo','120'); set('Target',beat); click('Start'); await calm(); };
  return {w,d,piano,tap,setAudio:time=>{audioClock=time;},usb,port,id,set,click,at,send,midi,round,played,asked:()=>asked,pending:p=>{pending=p;}};
}
test('Shows the demo in amber on beat 2; stopping clears scheduled sound and restores transposer', async t => {
  const x = await setup(t);
  assert.equal(x.asked(),0);
  x.click('Open'); x.set('Tempo','120'); x.set('Target','2'); x.click('Demo'); await calm();
  assert.match(x.id('Feedback').textContent,/Count in/);
  assert.equal(x.played.length,25);
  x.at(3140);
  assert.equal(x.piano.querySelectorAll('.kt-example').length,0);
  x.at(3645);
  assert.equal(x.d.querySelector('.kt-beats .example').textContent,'2');
  assert.equal(x.piano.querySelectorAll('.kt-example').length,3);
  x.at(5645);
  assert.deepEqual([...x.piano.querySelectorAll('.kt-example')].map(k=>Number(k.dataset.midi)).sort((a,b)=>a-b),slots[1].midis);
  x.at(7645);
  assert.deepEqual([...x.piano.querySelectorAll('.kt-example')].map(k=>Number(k.dataset.midi)).sort((a,b)=>a-b),slots[2].midis);
  x.click('Stop');
  assert.equal(x.played.every(o=>o.end===0),true);
  assert.equal(x.piano.querySelectorAll('.kt-example').length,0);
  x.click('Open');
  assert.equal(x.id('Practice').hidden,true);
  assert.equal(x.d.body.classList.contains('kt-practicing'),false);
});
test('MIDI input scores a chord, distinguishes release, and never changes the transposer selection', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round('1');
  assert.equal(x.asked(),1);
  x.at(3140);
  x.send(0x90,60,90,3140); x.send(0x90,64,90,3150); x.send(0x90,67,90,3160);
  assert.equal(x.piano.querySelectorAll('.kt-midi-held').length,3);
  x.send(0x90,60,0); x.send(0x80,64,0); x.send(0x80,67,0);
  assert.equal(x.id('Feedback').textContent,'On time');
  x.at(3180);
  assert.equal(x.d.querySelector('.kt-beats .played').textContent,'1');
  assert.equal(x.id('Results').children[0].getAttribute('aria-label'),'Slot 1: On time');
  x.at(7130);
  assert.match(x.id('Chord').textContent,/Slot 4 ·/);
  x.at(7140);
  assert.equal(x.id('Feedback').textContent,'Missed · Count in again');
  assert.match(x.id('Chord').textContent,/Slot 1 ·/);
  x.click('Open');
  assert.equal(x.w.KTTransposer.selection().notes.length,0);
});
test('Unplugging before release stops practice and clears held notes', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round('3');
  x.at(4140);
  x.send(0x90,60,80);
  x.port.state='disconnected'; x.usb.onstatechange();
  assert.match(x.id('Feedback').textContent,/MIDI input changed/);
  assert.equal(x.id('Stop').hidden,true);
  assert.equal(x.piano.querySelectorAll('.kt-midi-held').length,0);
});
test('Canceling a permission request ignores its late resolution', async t => {
  const x=await setup(t);
  let allow;
  x.pending(new Promise(r=>{allow=r;}));
  x.click('Midi'); x.click('Connect'); x.click('Disconnect'); allow(x.usb); await calm();
  assert.equal(x.id('MidiStatus').textContent,'Not connected');
  assert.equal(x.port.onmidimessage,undefined);
});
test('On-screen play from selected keys scores without a controller', async t => {
  const x=await setup(t);
  x.click('Open'); await x.round('4');
  for(const note of [60,64,67]) x.tap(note);
  x.at(4640); x.click('Play'); await calm();
  assert.equal(x.id('Feedback').textContent,'On time');
  assert.equal(x.asked(),0);
});

test('One existing keyboard is reused and practice leaves the transposer selection and chord bank intact', async t => {
  const x=await setup(t);
  x.tap(70);
  const saved = x.w.localStorage.getItem('pct_state_v1');
  const original = x.piano.querySelector('[data-midi="60"]');
  x.click('Open'); x.tap(60);
  assert.equal(x.d.querySelectorAll('#piano').length,1);
  assert.equal(x.piano.querySelector('[data-midi="60"]'),original);
  assert.equal(original.classList.contains('kt-pick'),true);
  assert.deepEqual([...x.w.KTTransposer.selection().notes],[70]);
  x.click('Open');
  assert.equal(original.classList.contains('kt-pick'),false);
  assert.equal(x.piano.querySelector('[data-midi="70"]').classList.contains('selected'),true);
  assert.equal(x.w.localStorage.getItem('pct_state_v1'), saved);
});
test('Sparse slots run in order, grade against their own chords, then finish after three', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round();
  assert.deepEqual([...x.id('Results').children].map(e => e.textContent),['1','4','11']);
  for (const [i, notes] of slots.map(x=>x.midis).entries()) {
    const at = 3140 + i * 2000;
    x.at(at);
    assert.match(x.id('Chord').textContent,new RegExp('Slot '+slots[i].slot+' ·'));
    for(const n of notes) x.send(0x90,n,90);
    for(const n of notes) x.send(0x80,n,0);
    assert.equal(x.id('Feedback').textContent,'On time');
  }
  x.at(9200);
  assert.equal(x.id('Feedback').textContent,'3 of 3 on time');
  assert.equal(x.id('Stop').hidden,true);
});
test('Empty current bank shows no demo or start rather than defaults or another bank', async t => {
  const x=await setup(t,[]);
  x.click('Open');
  assert.equal(x.id('Start').disabled,true);
  assert.equal(x.id('Demo').disabled,true);
  assert.equal(x.id('Chord').textContent,'No saved chords');
  x.click('Start');
  assert.equal(x.played.length,0);
});

test('Practice is a toggle in the existing deck; layout, key references and horizontal scroll are preserved', async t => {
  const x=await setup(t);
  const scroll = x.d.getElementById('pianoScroll');
  scroll.scrollLeft = 210;
  const key = x.piano.querySelector('[data-midi="60"]');
  const native = x.d.getElementById('btnUp');
  x.click('Open');
  assert.equal(x.id('Practice').parentElement.id, 'commandDeck');
  assert.equal(x.id('Open').getAttribute('aria-expanded'),'true');
  assert.equal(x.piano.querySelector('[data-midi="60"]'), key);
  assert.equal(scroll.scrollLeft,210);
  assert.equal(native.disabled,false);
  await x.round();
  assert.equal(native.disabled,true);
  x.click('Open');
  assert.equal(native.disabled,false);
  assert.equal(x.id('Open').getAttribute('aria-expanded'),'false');
  assert.equal(scroll.scrollLeft,210);
  assert.equal(x.played.every(o=>o.end===0),true);
});
test('Switching banks with the tray open updates the next round', async t => {
  const x=await setup(t);
  x.click('Open');
  x.d.getElementById('btnBankNext').click();
  assert.match(x.id('Chord').textContent,/Different bank/);
  await x.round();
  assert.deepEqual([...x.id('Results').children].map(el=>el.textContent),['1']);
});
test('Practice is first in the deck immediately below the original piano; changing meter updates target counts', async t => {
  const x=await setup(t);
  x.click('Open');
  const deck=x.d.getElementById('commandDeck');
  assert.equal(deck.previousElementSibling.className,'pianoContainer');
  assert.equal(deck.firstElementChild,x.id('Practice'));
  x.set('Meter','6/8'); x.set('Target','6');
  assert.equal(x.id('Practice').querySelectorAll('.kt-beats span').length,6);
  assert.equal(x.id('TempoLabel').textContent,'BPM (♩.)');
  x.set('Meter','3/4');
  assert.equal(x.id('Target').value,'3');
  assert.equal(x.id('Practice').querySelectorAll('.kt-beats span').length,3);
  await x.round('3');
  assert.equal(x.played.length,12);
  x.at(3640);
  assert.equal(x.d.querySelector('.kt-beats .pulse').textContent,'3');
});
test('First chord can be selected and saved from an empty Practice bank, with cancel and retry', async t => {
  const x=await setup(t,[]);
  x.click('Open');
  for(const n of [60,64,67]) x.tap(n);
  const slot=x.d.querySelector('#memoryGrid button[data-slot="2"]');
  const prompt=x.d.getElementById('promptModal');
  slot.click();
  assert.equal(prompt.hidden,false);
  prompt.querySelector('button[data-close]').click();
  await calm();
  assert.equal(prompt.hidden,true);
  assert.equal(x.id('Start').disabled,true);
  slot.click();
  x.d.getElementById('promptInput').value='Saved from Practice';
  x.d.getElementById('promptOk').click();
  await calm();
  assert.equal(prompt.hidden,true);
  assert.equal(x.id('Start').disabled,false);
  assert.match(x.id('Chord').textContent,/Slot 3 · Saved from Practice/);
  assert.deepEqual(JSON.parse(x.w.localStorage.getItem('pct_state_v1')).bankChords[0][2].midis,[60,64,67]);
});
test('An empty memory slot stays enabled during a round and can save a held MIDI chord', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round();
  const slot=x.d.querySelector('#memoryGrid button[data-slot="7"]');
  assert.equal(slot.disabled,false);
  for(const n of [62,65,69]) x.send(0x90,n,90);
  slot.click();
  assert.equal(x.id('Stop').hidden,true);
  assert.equal(x.played.every(o=>o.end===0),true);
  x.d.getElementById('promptOk').click();
  await calm();
  assert.deepEqual(JSON.parse(x.w.localStorage.getItem('pct_state_v1')).bankChords[0][7].midis,[62,65,69]);
  for(const n of [62,65,69]) x.send(0x80,n,0);
  await x.round();
  assert.deepEqual([...x.id('Results').children].map(e=>e.textContent),['1','4','8','11']);
});

const editHarness = x => {
  const $ = id => x.d.getElementById(id);
  const button = name => x.d.querySelector('[data-slot-action="' + name + '"]');
  return { $, button, act: name => button(name).click(), toggle: () => $('slotEdit').click(),
    slot: n => x.d.querySelector('#memoryGrid [data-slot="' + (n-1) + '"]').click(),
    submit: () => $('slotEditorConfirm').dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true})),
    saved: (n, bank = 0) => JSON.parse(x.w.localStorage.getItem('pct_state_v1')).bankChords[bank][n-1] };
};
test('Edit is opt-in and Save stores selected notes; Rename leaves their voicing intact', async t => {
  const x=await setup(t), e=editHarness(x);
  e.slot(1);
  assert.equal(e.$('slotEditor').open,false);
  e.toggle();
  for (const note of [60,64,67]) { if (!x.w.KTTransposer.selection().notes.includes(note)) x.tap(note); }
  e.slot(2); e.act('save');
  e.$('slotEditorName').value='New name'; e.submit();
  assert.deepEqual(e.saved(2),{name:'New name',midis:[60,64,67]});
  e.slot(2); e.act('rename');
  e.$('slotEditorName').value='Renamed'; e.submit();
  assert.deepEqual(e.saved(2),{name:'Renamed',midis:[60,64,67]});
  e.toggle(); e.slot(2);
  assert.equal(e.$('slotEditor').open,false);
});
test('Copy can paste to an empty slot in another bank without changing the original', async t => {
  const x=await setup(t), e=editHarness(x);
  e.toggle(); e.slot(1); e.act('copy');
  e.$('btnBankNext').click();
  e.slot(2); e.act('paste');
  assert.deepEqual(e.saved(2,1),e.saved(1));
});
test('Cut preserves the source on cancel, and clears only after confirmed replacement', async t => {
  const x=await setup(t), e=editHarness(x);
  e.toggle(); e.slot(1); e.act('cut');
  assert.equal(e.saved(1).name,'C major');
  e.slot(1);
  assert.equal(e.button('paste').disabled,true);
  e.$('slotEditorClose').click();
  e.slot(4); e.act('paste');
  assert.equal(e.saved(1).name,'C major');
  e.$('slotEditorBack').click();
  e.$('slotEditorClose').click();
  assert.equal(e.saved(4).name,'G major');
  e.slot(4); e.act('paste'); e.submit();
  assert.equal(e.saved(1),null);
  assert.deepEqual(e.saved(4),{name:'C major',midis:[60,64,67]});
  e.slot(5); assert.equal(e.button('paste').disabled,true);
});
test('Failed cut-paste does not clear the source or fill the destination', async t => {
  const x=await setup(t), e=editHarness(x);
  e.toggle(); e.slot(1); e.act('cut'); e.slot(5);
  const original = x.w.Storage.prototype.setItem;
  x.w.Storage.prototype.setItem = () => { throw new Error('Quota'); };
  e.act('paste');
  x.w.Storage.prototype.setItem = original;
  assert.match(e.$('slotEditorMessage').textContent,/No slots were changed/);
  assert.equal(e.saved(1).name,'C major');
  assert.equal(e.saved(5),null);
  e.act('paste');
  assert.equal(e.saved(1),null);
  assert.equal(e.saved(5).name,'C major');
});
test('Practice selections can be saved in Edit; Clear requires confirmation', async t => {
  const x=await setup(t,[]), e=editHarness(x);
  x.click('Open'); e.toggle();
  for (const note of [62,65,69]) x.tap(note);
  e.slot(1); e.act('save'); e.submit();
  assert.deepEqual(e.saved(1).midis,[62,65,69]);
  assert.equal(x.id('Start').disabled,false);
  e.slot(1); e.act('clear');
  assert.ok(e.saved(1));
  e.submit();
  assert.equal(e.saved(1),null);
  assert.equal(x.id('Start').disabled,true);
});

test('Standalone click works in an empty bank, accents the meter, and cancels scheduled audio', async t => {
  const x=await setup(t,[]);
  x.click('Open'); x.set('Meter','3/4'); x.set('Tempo','120');
  assert.equal(x.id('Start').disabled,true);
  x.click('Click'); await calm();
  assert.equal(x.id('Click').getAttribute('aria-pressed'),'true');
  assert.equal(x.id('Click').textContent,'Stop click');
  assert.equal(x.played.length,1);
  assert.equal(x.played[0].frequency.value,1400);
  for(const [time,at] of [[3.5,1500],[4,2000],[4.5,2500]]) {
    x.setAudio(time); x.at(at);
  }
  assert.deepEqual(x.played.map(n=>n.frequency.value),[1400,900,900,1400]);
  x.at(2641);
  assert.equal(x.d.querySelector('.kt-beats .pulse').textContent,'1');
  assert.equal(x.id('Results').children.length,0);
  x.click('Click');
  assert.equal(x.played.every(o=>o.end===0),true);
  assert.equal(x.id('Click').textContent,'Metronome');
  assert.equal(x.id('Meter').disabled,false);
});
test('Listening does not burst after a delayed frame and closing Practice stops it', async t => {
  const x=await setup(t);
  x.click('Open'); x.set('Tempo','120'); x.click('Click'); await calm();
  x.setAudio(8.08); x.at(6080);
  const last=x.played.at(-1);
  assert.equal(x.played.length,2);
  assert.ok(last.at>=8.08);
  x.click('Open');
  assert.equal(x.played.every(o=>o.end===0),true);
  assert.equal(x.id('Practice').hidden,true);
  x.click('Open'); await x.round();
  assert.equal(x.id('Click').disabled,true);
});
test('Load notes, edit a saved voicing and replace it without leaving Edit mode', async t => {
  const x=await setup(t), e=editHarness(x);
  x.click('Open');
  e.toggle(); e.slot(1); e.act('load');
  assert.equal(e.$('slotEditor').open,false);
  assert.equal(e.$('slotEdit').getAttribute('aria-pressed'),'true');
  assert.equal(e.$('memoryGrid').classList.contains('is-editing'),true);
  const picked = () => [...x.piano.querySelectorAll('.kt-pick')].map(el=>Number(el.dataset.midi)).sort((a,b)=>a-b);
  assert.deepEqual(picked(),[60,64,67]);
  x.tap(64); x.tap(63);
  e.slot(1); e.act('save');
  assert.equal(e.$('slotEditorName').value,'C major');
  e.submit();
  assert.deepEqual(e.saved(1).midis,[60,63,67]);
  e.$('btnClear').click();
  assert.deepEqual(picked(),[]);
  e.toggle();
  assert.equal(e.$('memoryGrid').classList.contains('is-editing'),false);
});
test('Save, transpose up, save again and reload: both slots stay in the same bank', async t => {
  const x=await setup(t,[]), e=editHarness(x);
  for (const note of [60,64,67]) x.tap(note);
  e.toggle(); e.slot(1); e.act('save'); e.submit();
  const before=x.w.localStorage.getItem('pct_state_v1');
  e.$('btnUp').click();
  assert.equal(x.w.localStorage.getItem('pct_state_v1'),before);
  assert.equal(e.$('btnBankCurrent').textContent,'C');
  assert.deepEqual([...x.w.KTTransposer.selection().notes],[61,65,68]);
  e.slot(2); e.act('save'); e.submit();
  assert.deepEqual(e.saved(1).midis,[60,64,67]);
  assert.deepEqual(e.saved(2).midis,[61,65,68]);
  assert.equal(e.saved(1,1).name,'Different bank');
  e.slot(2);
  assert.match(e.$('slotEditorCurrent').textContent,/C#4 · F4 · G#4/);
  e.$('slotEditorClose').click();
  e.toggle();
  e.slot(1);
  assert.deepEqual([...x.w.KTTransposer.selection().notes],[60,64,67]);
  e.slot(2);
  assert.deepEqual([...x.w.KTTransposer.selection().notes],[61,65,68]);
});
test('Transpose changes the actual Practice selection and save uses the shifted notes', async t => {
  const x=await setup(t,[]), e=editHarness(x);
  x.click('Open');
  for (const note of [60,64,67]) x.tap(note);
  e.toggle(); e.slot(1); e.act('save'); e.submit();
  e.$('btnUp').click();
  const keys = [...x.piano.querySelectorAll('.kt-pick')].map(el=>Number(el.dataset.midi)).sort((a,b)=>a-b);
  assert.deepEqual(keys,[61,65,68]);
  e.slot(2); e.act('save'); e.submit();
  assert.deepEqual(e.saved(1).midis,[60,64,67]);
  assert.deepEqual(e.saved(2).midis,[61,65,68]);
  e.toggle();
  e.slot(2);
  assert.deepEqual([...x.w.KTTransposer.selection().notes],[61,65,68]);
});

test('MIDI keyboard sizes resize the same piano without changing stored chords or octaves', async t => {
  const x = await setup(t);
  const bank = x.w.localStorage.getItem('pct_state_v1');
  function range(first, last) {
    assert.deepEqual([...x.piano.querySelectorAll('.key')].map(k => Number(k.dataset.midi)).sort((a,b)=>a-b),
      Array.from({length:last-first+1}, (_,i)=>first+i));
  }
  assert.equal(x.id('SizeLabel').hidden,true);
  range(21,108);
  await x.midi();
  assert.equal(x.id('SizeLabel').hidden,false);
  for (const [size, first, last] of [[25,48,72],[32,41,72],[37,48,84],[49,36,84],[73,28,100],[76,28,103],[88,21,108],[61,36,96]]) {
    x.set('Size',String(size));
    range(first,last);
  }
  assert.match(x.piano.getAttribute('aria-label'),/61 keys/);
  x.send(0x90,36,90); x.send(0x90,96,90);
  assert.deepEqual([...x.piano.querySelectorAll('.kt-midi-held')].map(k=>Number(k.dataset.midi)),[36,96]);
  x.click('Disconnect');
  range(21,108);
  assert.equal(x.id('SizeLabel').hidden,true);
  await x.midi();
  range(36,96);
  assert.equal(x.w.localStorage.getItem('kt_midi_keyboard_size_v1'),'61');
  assert.equal(x.w.localStorage.getItem('pct_state_v1'),bank);
});
test('Sustain fades released keys without adding them to capture, and pedal-off clears the tail', async t => {
  const x=await setup(t);
  await x.midi();
  const key=n=>x.piano.querySelector('[data-midi="'+n+'"]');
  x.send(0xb0,64,127);
  x.send(0x90,61,92);
  assert.equal(key(61).classList.contains('kt-midi-held'),true);
  assert.equal(key(61).classList.contains('kt-midi-sustain'),false);
  x.send(0x90,61,0);
  assert.equal(key(61).classList.contains('kt-midi-held'),false);
  assert.equal(key(61).classList.contains('kt-midi-sustain'),true);
  assert.equal(x.id('Capture').disabled,true);
  x.at(1300);
  x.w.dispatchEvent(new x.w.Event('resize'));
  assert.equal(key(61).style.getPropertyValue('--kt-sustain-delay'),'-300ms');
  x.at(6500);
  x.w.dispatchEvent(new x.w.Event('resize'));
  assert.equal(key(61).classList.contains('kt-midi-sustain'),true);
  assert.equal(key(61).style.getPropertyValue('--kt-sustain-delay'),'-2400ms');

  x.send(0x91,63,92); x.send(0x81,63,64);
  assert.equal(key(63).classList.contains('kt-midi-sustain'),false);
  x.send(0xb1,64,0);
  assert.equal(key(61).classList.contains('kt-midi-sustain'),true);
  x.send(0xb0,64,0);
  assert.equal(key(61).classList.contains('kt-midi-sustain'),false);
  x.send(0xb0,64,127); x.send(0x90,61,90); x.send(0x80,61,64);
  x.send(0x90,61,90);
  assert.equal(key(61).classList.contains('kt-midi-sustain'),false);
  assert.equal(key(61).classList.contains('kt-midi-held'),true);
  x.send(0x80,61,64);
  x.click('Disconnect');
  assert.equal(key(61).classList.contains('kt-midi-sustain'),false);
});
test('Sustained previous chord does not prevent matching the next attack', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round();
  x.send(0xb0,64,127);
  for (const [time, {midis}] of [[3140,slots[0]],[5140,slots[1]]]) {
    x.at(time);
    for (const n of midis) x.send(0x90,n,90);
    for (const n of midis) x.send(0x80,n,60);
  }
  assert.equal(x.id('Results').children[0].getAttribute('aria-label'),'Slot 1: On time');
  assert.equal(x.id('Results').children[1].getAttribute('aria-label'),'Slot 4: On time');
});

test('Optional live piano is silent by default, releases with pedal, and disconnect cuts sound', async t => {
  const x=await setup(t);
  await x.midi();
  x.send(0x90,60,94); x.send(0x80,60,64);
  assert.equal(x.played.length,0);
  x.click('Midi');
  x.click('PianoSound'); await calm();
  // Can listen immediately while the settings are open.
  x.send(0xb0,64,127); x.send(0x90,60,94);
  assert.equal(x.played.length,3);
  assert.ok(Math.abs(x.played[0].frequency.value - 261.626) < .01);
  assert.equal(x.played[0].end,Infinity);
  x.send(0x80,60,64);
  assert.ok(Math.abs(x.played[0].end-5.415) < .001);
  assert.equal(x.piano.querySelectorAll('.kt-midi-sustain').length,1);
  x.setAudio(4); x.send(0xb0,64,0);
  assert.ok(Math.abs(x.played[0].end-4.115) < .001);
  assert.equal(x.piano.querySelectorAll('.kt-midi-sustain').length,0);
  x.send(0x90,61,80);
  x.click('Disconnect');
  assert.equal(x.id('PianoSound').checked,false);
  assert.ok(x.played.slice(3).every(o=>o.end<4.1));
});

test('Example hides a loaded chord and MIDI highlights during count-in, playback and between chords', async t => {
  const x=await setup(t);
  await x.midi();
  x.d.querySelector('#memoryGrid [data-slot="3"]').click();
  x.click('Open');
  const saved=x.w.localStorage.getItem('pct_state_v1');
  const notes=sel=>[...x.piano.querySelectorAll(sel)].map(k=>Number(k.dataset.midi)).sort((a,b)=>a-b);
  assert.deepEqual(notes('.selected'),slots[1].midis);
  x.send(0x90,69,90);
  x.set('Tempo','120'); x.click('Demo');
  assert.deepEqual(notes('.selected,.kt-pick,.kt-midi-held'),[]);
  await calm();
  x.at(3140);
  assert.deepEqual(notes('.kt-example'),slots[0].midis);
  assert.deepEqual(notes('.selected,.kt-pick,.kt-midi-held'),[]);
  x.at(4000);
  assert.deepEqual(notes('.kt-example,.selected,.kt-pick'),[]);
  x.at(5140);
  assert.deepEqual(notes('.kt-example'),slots[1].midis);
  x.at(9500);
  assert.deepEqual(notes('.selected'),slots[1].midis);
  assert.deepEqual(notes('.kt-midi-held'),[69]);
  assert.equal(x.w.localStorage.getItem('pct_state_v1'),saved);
});
test('Start ignores the loaded chord, allows fresh touch notes, and restores the selection on Stop', async t => {
  const x=await setup(t);
  x.click('Open');
  x.d.querySelector('#memoryGrid [data-slot="3"]').click();
  const notes=sel=>[...x.piano.querySelectorAll(sel)].map(k=>Number(k.dataset.midi)).sort((a,b)=>a-b);
  assert.deepEqual(notes('.kt-pick'),slots[1].midis);
  await x.round();
  assert.equal(x.id('Play').disabled,true);
  assert.deepEqual(notes('.kt-pick,.selected'),[]);
  for (const note of slots[0].midis) x.tap(note);
  assert.deepEqual(notes('.kt-pick'),slots[0].midis);
  x.at(3140); x.click('Play'); await calm();
  assert.equal(x.id('Feedback').textContent,'On time');
  x.click('Stop');
  assert.deepEqual(notes('.kt-pick'),slots[1].midis);
});

test('Practice shows the target, keeps pedal tails distinct, and restarts on a wrong later chord', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round();
  const notes=sel=>[...x.piano.querySelectorAll(sel)].map(k=>Number(k.dataset.midi)).sort((a,b)=>a-b);
  assert.deepEqual(notes('.kt-guide'),slots[0].midis);
  x.at(3140); x.send(0xb0,64,127);
  for (const n of slots[0].midis) x.send(0x90,n,90);
  assert.deepEqual(notes('.kt-midi-held'),slots[0].midis);
  for (const n of slots[0].midis) x.send(0x80,n,64);
  assert.deepEqual(notes('.kt-midi-sustain'),slots[0].midis);
  x.at(5140);
  assert.deepEqual(notes('.kt-guide'),slots[1].midis);
  assert.deepEqual(notes('.kt-midi-sustain'),slots[0].midis);
  x.send(0x90,73,90); x.send(0x80,73,64);
  assert.equal(x.id('Feedback').textContent,'Wrong chord · Count in again');
  assert.deepEqual(notes('.kt-guide'),slots[0].midis);
  assert.match(x.id('Chord').textContent,/Slot 1 ·/);
  assert.equal(x.id('Results').children[0].getAttribute('aria-label'),'Slot 1: pending');
  x.send(0xb0,64,0);
  assert.deepEqual(notes('.kt-midi-sustain'),[]);
  x.at(7280);
  for (const n of slots[0].midis) x.send(0x90,n,90);
  for (const n of slots[0].midis) x.send(0x80,n,64);
  assert.equal(x.id('Feedback').textContent,'On time');
});
test('A correct chord with loose timing still advances; wrong notes still restart', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round();
  x.at(3060);
  for (const n of slots[0].midis) x.send(0x90,n,90);
  for (const n of slots[0].midis) x.send(0x80,n,64);
  assert.equal(x.id('Feedback').textContent,'Correct · 80 ms early');
  assert.match(x.id('Chord').textContent,/Slot 4 ·/);
  x.at(6980);
  slots[1].midis.forEach((n,i)=>x.send(0x90,n,90,6980+i*65));
  x.at(7110);
  for (const n of slots[1].midis) x.send(0x80,n,64);
  assert.equal(x.id('Feedback').textContent,'Correct · 1840 ms late');
  assert.match(x.id('Chord').textContent,/Slot 11 ·/);
  x.at(7200);
  x.send(0x90,73,90); x.send(0x80,73,64);
  assert.equal(x.id('Feedback').textContent,'Wrong chord · Count in again');
  assert.match(x.id('Chord').textContent,/Slot 1 ·/);
});

function dragMemory(x, element, dy, end = 'pointerup') {
  const fire = (type, y) => {
    const event = new x.w.MouseEvent(type,{bubbles:true,button:0,clientX:20,clientY:y,detail:1});
    Object.defineProperty(event,'pointerId',{value:42});
    element.dispatchEvent(event);
  };
  fire('pointerdown',60);
  fire('pointermove',60+dy);
  assert.equal(element.classList.contains('kt-slot-drag'),true);
  assert.match(element.style.getPropertyValue('--kt-slot-y'),/px$/);
  fire(end,60+dy);
  assert.equal(element.classList.contains('kt-slot-drag'),false);
  if (end==='pointerup') element.dispatchEvent(new x.w.MouseEvent('click',{bubbles:true,detail:1}));
}
test('Downward drag marks a filled slot skipped without loading it or changing memory; upward drag restores its place', async t => {
  const x=await setup(t);
  const btn=x.d.querySelector('#memoryGrid [data-slot="3"]');
  const contents=x.w.localStorage.getItem('pct_state_v1');
  x.click('Open');
  dragMemory(x,btn,13);
  assert.equal(btn.classList.contains('kt-skipped'),false);
  assert.equal(x.w.KTTransposer.selection().notes.length,0);
  dragMemory(x,btn,40,'pointercancel');
  assert.equal(btn.classList.contains('kt-skipped'),false);
  dragMemory(x,btn,40);
  assert.equal(btn.classList.contains('kt-skipped'),true);
  assert.match(btn.getAttribute('aria-label'),/skipped/);
  assert.equal(x.w.KTTransposer.selection().notes.length,0);
  x.set('Tempo','120'); x.click('Demo'); await calm();
  x.at(5140);
  assert.match(x.id('Chord').textContent,/Slot 11 ·/);
  x.click('Stop');
  await x.round();
  assert.deepEqual([...x.id('Results').children].map(el=>el.textContent),['1','11']);
  x.click('Stop');
  dragMemory(x,btn,-40);
  assert.equal(btn.classList.contains('kt-skipped'),false);
  await x.round();
  assert.deepEqual([...x.id('Results').children].map(el=>el.textContent),['1','4','11']);
  assert.equal(x.w.localStorage.getItem('pct_state_v1'),contents);
});
test('Practice exclusions are scoped by bank and all skipped disables run buttons until restored', async t => {
  const x=await setup(t);
  const key=(slot,name)=>x.d.querySelector('#memoryGrid [data-slot="'+(slot-1)+'"]').dispatchEvent(
    new x.w.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));
  x.click('Open');
  for (const {slot} of slots) key(slot,'ArrowDown');
  assert.equal(x.id('Start').disabled,true);
  assert.equal(x.id('Demo').disabled,true);
  assert.equal(x.d.querySelectorAll('#memoryGrid .kt-skipped').length,3);
  x.d.getElementById('btnBankNext').click();
  assert.equal(x.d.querySelectorAll('#memoryGrid .kt-skipped').length,0);
  assert.equal(x.id('Start').disabled,false);
  x.d.getElementById('btnBankPrev').click();
  assert.equal(x.d.querySelectorAll('#memoryGrid .kt-skipped').length,3);
  key(4,'ArrowUp');
  assert.equal(x.id('Start').disabled,false);
  x.click('Open');
  assert.equal(x.d.querySelectorAll('#memoryGrid .kt-skipped').length,0);
  x.click('Open');
  assert.equal(x.d.querySelectorAll('#memoryGrid .kt-skipped').length,2);
});

test('Tap Tempo uses steady taps, ignores bounce, and resets after a pause', async t => {
  const x=await setup(t);
  x.click('Open');
  const tempo=x.id('Tempo');
  for (const time of [1000,1500,1540,2000,2500]) {
    x.at(time); x.click('Tempo');
  }
  assert.equal(tempo.value,'120');
  assert.equal(tempo.textContent,'Tap · 120');
  x.at(5090); x.click('Tempo');
  assert.equal(tempo.value,'120');
  x.at(5757); x.click('Tempo');
  assert.equal(tempo.value,'90');
  tempo.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  assert.equal(tempo.value,'89');
});
test('Practice uses the tapped tempo rather than default BPM', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi();
  for (const time of [1000,1500,2000]) {
    x.at(time); x.click('Tempo');
  }
  x.click('Start'); await calm();
  assert.equal(x.id('Tempo').disabled,true);
  x.at(4140);
  for (const n of slots[0].midis) x.send(0x90,n,90);
  for (const n of slots[0].midis) x.send(0x80,n,64);
  assert.equal(x.id('Feedback').textContent,'On time');
  x.click('Stop');
  assert.equal(x.id('Tempo').disabled,false);
});

test('An octave-up chord advances the piano guide immediately without moving the scheduled beat', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round('rotate');
  x.at(3140);
  const guide=()=>[...x.piano.querySelectorAll('.kt-guide')].map(k=>Number(k.dataset.midi)).sort((a,b)=>a-b);
  assert.deepEqual(guide(),slots[0].midis);
  x.send(0xb0,64,127);
  for (const n of slots[0].midis) x.send(0x90,n+12,90);
  for (const n of slots[0].midis) x.send(0x80,n+12,64);
  assert.equal(x.id('Feedback').textContent,'On time');
  assert.deepEqual(guide(),slots[1].midis);
  assert.match(x.id('Chord').textContent,/Slot 4 ·/);
  assert.equal(x.d.querySelector('.kt-beats .target').textContent,'2');
  assert.equal(x.d.querySelectorAll('.kt-midi-sustain').length,3);
  x.at(5640);
  for (const n of slots[1].midis) x.send(0x90,n,90);
  for (const n of slots[1].midis) x.send(0x80,n,64);
  assert.equal(x.id('Results').children[1].getAttribute('aria-label'),'Slot 4: On time');
  assert.deepEqual(guide(),slots[2].midis);
});
test('Native dialogs dismiss on a backdrop click, not an internal click or drag out', async t => {
  const x=await setup(t);
  const fire=(dlg, type, pos)=>dlg.dispatchEvent(new x.w.MouseEvent(type,{
    button:0,clientX:pos,clientY:pos,bubbles:true,cancelable:true
  }));
  const saved=x.w.localStorage.getItem('pct_state_v1');
  x.click('Midi');
  const midi=x.id('MidiDialog');
  x.d.getElementById('slotEdit').click();
  const btn=x.d.querySelector('#memoryGrid button[data-slot="0"]');
  for (const [dialog,reopen] of [[midi,()=>x.click('Midi')],[x.d.getElementById('slotEditor'),()=>btn.click()]]) {
    if (!dialog.open) reopen();
    dialog.getBoundingClientRect=()=>({top:50,right:200,bottom:200,left:50});
    for (const [start,end] of [[75,75],[75,20],[20,75]]) {
      fire(dialog,'pointerdown',start); fire(dialog,'click',end);
      assert.equal(dialog.open,true);
    }
    fire(dialog,'pointerdown',20); fire(dialog,'click',20);
    assert.equal(dialog.open,false);
    reopen();
    assert.equal(dialog.open,true);
    fire(dialog,'pointerdown',20); fire(dialog,'click',20);
    assert.equal(dialog.open,false);
  }
  assert.equal(x.w.localStorage.getItem('pct_state_v1'),saved);
});
test('Lightbox backdrops close, and clicking outside chord naming cancels that save', async t => {
  const x=await setup(t,[]);
  for (const id of ['menuModal','memoryModal','alternatesModal','helpModal']) {
    const el=x.d.getElementById(id);
    el.hidden=false;
    el.querySelector('.modalCard').click();
    assert.equal(el.hidden,false);
    el.querySelector('.modalOverlay').click();
    assert.equal(el.hidden,true);
  }
  x.click('Open');
  for (const n of [60,64,67]) x.tap(n);
  x.d.querySelector('#memoryGrid button[data-slot="2"]').click();
  const prompt=x.d.getElementById('promptModal');
  assert.equal(prompt.hidden,false);
  prompt.querySelector('.modalOverlay').click();
  await calm();
  assert.equal(prompt.hidden,true);
  assert.equal(JSON.parse(x.w.localStorage.getItem('pct_state_v1')).bankChords[0][2],null);
});

test('An octave-up descending roll scores even when each key is released before the next', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round();
  for (const [i,n] of [79,76,72].entries()) {
    x.at(3140+i*145); x.send(0x90,n,90); x.send(0x80,n,64);
    if (i<2) assert.match(x.id('Chord').textContent,/Slot 1 ·/);
  }
  assert.equal(x.id('Feedback').textContent,'On time');
  assert.match(x.id('Chord').textContent,/Slot 4 ·/);
});
test('Rolling the right voicing past the next beat does not pass', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round();
  for (const [i,n] of slots[0].midis.entries()) {
    x.at(4950+i*100); x.send(0x90,n,90); x.send(0x80,n,64);
  }
  assert.equal(x.id('Feedback').textContent,'Missed · Count in again');
  assert.equal(x.id('Results').children[0].getAttribute('aria-label'),'Slot 1: pending');
});
