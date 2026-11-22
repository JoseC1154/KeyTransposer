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
  let clock = 1000, frames = new Map(), frameId = 0, played = [];
  Object.defineProperty(w.performance,'now',{value:()=> clock});
  w.requestAnimationFrame = f => { frames.set(++frameId, f); return frameId; };
  w.cancelAnimationFrame = n => frames.delete(n);
  Object.defineProperty(w,'isSecureContext',{value:true});
  class Audio {
    state = 'running';
    currentTime = 3;
    createGain() { return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}; }
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
  return {w,d,piano,tap,usb,port,id,set,click,at,send,midi,round,played,asked:()=>asked,pending:p=>{pending=p;}};
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
  x.at(5700);
  assert.equal(x.id('Results').children[1].getAttribute('aria-label'),'Slot 4: Missed');
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
  assert.equal(x.d.querySelectorAll('[aria-label="Piano keyboard"]').length,1);
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
  prompt.querySelector('button[data-close]').dispatchEvent(new x.w.Event('pointerdown',{bubbles:true}));
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
