// Optional DOM integration suite: install jsdom in a test environment or set NODE_PATH.
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const base = join(__dirname, '..');
const calm = () => new Promise(resolve => setImmediate(resolve));
async function setup(t) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(readFileSync(join(base,'index.html'),'utf8'), {
    runScripts:'outside-only', pretendToBeVisual:true, url:'https://practice.invalid/', virtualConsole,
  });
  const w = dom.window, d = w.document;
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
  for (const path of ['utils','chordDetection','chordAlternates','main','practice']) vm.runInContext(readFileSync(join(base,'js',path+'.js'),'utf8'),dom.getInternalVMContext());
  await calm();
  const id = id => d.getElementById('kt'+id);
  const set = (key,value) => {id(key).value = value; id(key).dispatchEvent(new w.Event('change'));};
  const click = key => id(key).click();
  const at = time => { clock=time; const queued=[...frames.values()]; frames.clear(); queued.forEach(f=>f(time)); };
  const send = (status,note,velocity,time=clock) => port.onmidimessage({ data:[status,note,velocity], timeStamp:time });
  const midi = async () => { click('PracticeMidi'); click('Connect'); await calm(); id('MidiDialog').close(); };
  const round = async (beat='1') => { set('Tempo','120'); set('Target',beat); click('Start'); await calm(); };
  return {w,d,usb,port,id,set,click,at,send,midi,round,played,asked:()=>asked,pending:p=>{pending=p;}};
}
test('Shows the demo in amber on beat 2; stopping clears scheduled sound and restores transposer', async t => {
  const x = await setup(t);
  assert.equal(x.asked(),0);
  x.click('Open'); x.set('Tempo','120'); x.set('Target','2'); x.click('Demo'); await calm();
  assert.match(x.id('Feedback').textContent,/Count in/);
  assert.equal(x.played.length,18);
  x.at(3140);
  assert.equal(x.id('Keyboard').querySelectorAll('.example').length,0);
  x.at(3645);
  assert.equal(x.d.querySelector('.kt-beats .example').textContent,'2');
  assert.equal(x.id('Keyboard').querySelectorAll('.example').length,3);
  x.click('Stop');
  assert.equal(x.played.every(o=>o.end===0),true);
  assert.equal(x.id('Keyboard').querySelectorAll('.example').length,0);
  x.click('Back');
  assert.equal(x.id('Practice').hidden,true);
  assert.equal(x.d.body.classList.contains('kt-practicing'),false);
});
test('MIDI input scores a chord, distinguishes release, and never changes the transposer selection', async t => {
  const x=await setup(t);
  x.click('Open'); await x.midi(); await x.round('1');
  assert.equal(x.asked(),1);
  x.at(3140);
  x.send(0x90,60,90,3140); x.send(0x90,64,90,3150); x.send(0x90,67,90,3160);
  assert.equal(x.id('Keyboard').querySelectorAll('.player').length,3);
  x.send(0x90,60,0); x.send(0x80,64,0); x.send(0x80,67,0);
  assert.equal(x.id('Feedback').textContent,'On time');
  x.at(3180);
  assert.equal(x.d.querySelector('.kt-beats .played').textContent,'1');
  assert.equal(x.id('Results').children[0].getAttribute('aria-label'),'Bar 1: On time');
  x.at(5700);
  assert.equal(x.id('Results').children[1].getAttribute('aria-label'),'Bar 2: Missed');
  x.click('Back');
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
  assert.equal(x.id('Keyboard').querySelectorAll('.player').length,0);
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
  for(const name of ['C4','E4','G4']) x.id('Keyboard').querySelector('[aria-label="'+name+'"]').click();
  x.at(4640); x.click('Play'); await calm();
  assert.equal(x.id('Feedback').textContent,'On time');
  assert.equal(x.asked(),0);
});
