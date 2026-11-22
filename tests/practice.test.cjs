const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makePlan, score, uniqueNotes, midiMessage } = require('../js/practice.js');
const triad = [60,64,67];
test('One 4/4 count-in precedes beat 1, and beat 1 repeats once a bar', () => {
  const p = makePlan(500, 120, '1');
  assert.equal(p.targets[0].time, 2500);
  assert.equal(p.targets[1].time, 4500);
  assert.equal(p.targets.length, 8);
});
for(let beat=2;beat<=4;beat++) test('Selected beat ' + beat + ' stays in the correct bar', () => {
  const p = makePlan(500, 120, String(beat));
  assert.equal(p.targets[0].time, 2500 + (beat-1)*500);
  assert.equal(p.targets[1].time, 4500 + (beat-1)*500);
});
test('Rotate gives each beat a bar, including a one-beat gap from 4 back to 1', () => {
  const p = makePlan(0,120,'rotate');
  assert.deepEqual(p.targets.map(t=>t.beat), [1,2,3,4,1,2,3,4]);
  assert.equal(p.targets[4].time-p.targets[3].time, 500);
});
test('Beat tolerance distinguishes on time, early and late', () => {
  const p = makePlan(0, 120, '1'), t = p.targets[0].time;
  assert.equal(score(p,triad,triad,t-55,t+10).result,'on');
  assert.equal(score(p,triad,triad,t+55,t+65).result,'on');
  assert.equal(score(p,triad,triad,t-56,t).result,'early');
  assert.equal(score(p,triad,triad,t+56,t+60).result,'late');
});
test('Count-in or a different beat does not count', () => {
  const p = makePlan(0, 120, '1');
  for (const offset of [0,1000,1500,2500,3000,3500]) assert.equal(score(p,triad,triad,offset),null);
});
test('Ignore accidental repeat after a graded bar', () => {
  const p = makePlan(0,120,'1');
  const first = score(p,triad,triad,2000);
  first.target.result=first.result;
  assert.equal(score(p,triad,triad,2020),null);
  assert.equal(score(p,triad,triad,4000).result,'on');
});
test('Exact notes and octaves, including extra or missing notes, and excessive spread', () => {
  const p = makePlan(0,120,'1');
  for(const notes of [[60,64],[60,64,67,72],[48,52,55]]) assert.equal(score(p,notes,triad,2000).result,'wrong');
  assert.equal(score(p,[67,60,64],triad,2000,2095).result,'on');
  assert.equal(score(p,triad,triad,2000,2096).result,'wrong');
});
test('MIDI decodes channels, note-off and zero velocity; ignores CC', () => {
  assert.deepEqual(midiMessage([0x94,60,72]),{key:'4:60',note:60,down:true});
  assert.deepEqual(midiMessage([0x94,60,0]),{key:'4:60',note:60,down:false});
  assert.equal(midiMessage([0x84,60,70]).down,false);
  assert.equal(midiMessage([0xb0,64,127]),null);
  assert.equal(midiMessage([0x90,128,9]),null);
});
test('Only valid piano notes retained and normalized', () => {
  assert.deepEqual(uniqueNotes([108,60,60,0,109,64.5,21]),[21,60,108]);
});
