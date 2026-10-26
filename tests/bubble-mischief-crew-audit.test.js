import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, COLS, ROWS } from '../games/bubble-mischief-crew/game.js';
import { BOMB, kickDestination, simulationFrame } from '../games/bubble-mischief-crew/bomb-rules.js';
import { movePlayer } from '../games/bubble-mischief-crew/movement.js';
import { createRuntime } from '../scripts/lua-runtime.mjs';
const array = v => Array.isArray(v) ? v : [];
function game() {
  const s=createGame({humans:4,seed:1234});s.phase='playing';s.tick=31;
  s.players.forEach(p=>p.immune=10000);return s;
}
function snapshot(s) {
  return {tick:s.tick,substep:s.substep,phase:s.phase,seed:s.seed,lastWaveAt:s.lastWaveAt,
    balls:array(s.balls),blasts:array(s.blasts),drops:array(s.drops),items:array(s.items),
    players:s.players.map(({x,y,dir,status,until,immune,inventory})=>({x,y,dir,status,until,immune,inventory:array(inventory)}))};
}
async function advanceBoth(runtime,s,ms=100) {
  const before=structuredClone(s);before.lastStepAt=10000;
  before.players.forEach(p=>Object.assign(p,{ready:true,lastSeen:10000+ms,seq:0}));
  const result=await runtime.call('on_action',before,{type:'input',round:1,seq:1,dir:before.players[0].input},
    {actor:{id:'local-0',role:'player'},actionAt:10000+ms});
  assert.equal(result.accepted,true);stepGame(s,ms);
  assert.deepEqual(snapshot(result.state),snapshot(s));
}
const bomb=(id,x,y,kind='normal',fuse=9999)=>({id,x,y,kind,fuse,dir:-1,range:kind==='football'?4:1});

test('all 444 kick rays match the native 15x13 terrain and descending eight-to-one probe order',()=>{
  // Derived from bomb02_8.map and 0060d0e7–0060d13f, independently of inside().
  const solid=(col,row)=>col===0||col===14||row<4||row>12||((col===1||col===13)&&row>=7&&row<=9);
  let checked=0;
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++) {
    if(solid(x+1,y+4))continue;
    for(const [dir,dx,dy] of [[0,1,0],[1,0,1],[2,-1,0],[3,0,-1]]) {
      let expected;
      for(let distance=8;distance>=1;distance--) {
        const col=(x+1+dx*distance+15)%15,row=(y+4+dy*distance+13)%13;
        if(!solid(col,row)) {expected={x:col-1,y:row-4,distance};break;}
      }
      assert.deepEqual(kickDestination(x,y,dir),expected,`${x},${y},${dir}`);checked++;
    }
  }
  assert.equal(checked,444);
  assert.deepEqual(kickDestination(3,4,0),{x:11,y:4,distance:8});
  assert.deepEqual(kickDestination(3,4,1),{x:3,y:8,distance:4});
});

test('native 22-pixel contact probes kick before moving, but do not reach into an aliased edge cell',()=>{
  const s=game(),p=s.players[0];s.balls=[bomb(1,3,3)];Object.assign(p,{x:1.94,y:3});
  movePlayer(s,p,0);assert.equal(s.balls[0].flight,undefined);assert.equal(p.x,2.025);
  movePlayer(s,p,0);assert.ok(s.balls[0].flight);assert.equal(s.balls[0].x,11);
  const t=game(),q=t.players[0];Object.assign(q,{x:12,y:7});t.balls=[bomb(1,0,8)];
  movePlayer(t,q,0);assert.equal(t.balls[0].flight,undefined);
});

test('fresh bubbles retain a 3000 ms fuse and detonate on the next 20 ms frame, identically in Lua',async()=>{
  const r=await createRuntime('bubble-mischief-crew');
  try {
    const s=game();s.drops=[{id:1,x:6,y:4,kind:'normal',at:32,start:24,fromX:2}];s.nextId=2;
    await advanceBoth(r,s);assert.equal(s.balls[0].fuseFrame,simulationFrame(s)+151);
    for(let i=0;i<6;i++)await advanceBoth(r,s,500);
    assert.ok(s.balls.some(b=>b.id===1),'fuse remains armed at exactly 3000 ms');
    await advanceBoth(r,s);assert.ok(!s.balls.some(b=>b.id===1));
    assert.equal(s.blasts.find(b=>b.id===1).atFrame,32*5+BOMB.fuseFrames);
  } finally {r.close();}
});

test('a short bubble stops a football arm and chains with its own range instead of transmitting the long arm',async()=>{
  const r=await createRuntime('bubble-mischief-crew');
  try {
    const s=game();s.balls=[bomb(1,6,4,'football',32),bomb(2,7,4)];s.nextId=3;
    await advanceBoth(r,s);assert.equal(s.balls.length,0);
    assert.ok(s.blasts.some(b=>b.x===8&&b.y===4));
    assert.ok(!s.blasts.some(b=>b.x===9&&b.y===4));
    assert.ok(!s.blasts.some(b=>b.id===1&&b.x>7&&b.y===4));
  } finally {r.close();}
});

test('flames hit only on impact; entering visible foam or landing a later bubble does not cause a new hit',async()=>{
  const r=await createRuntime('bubble-mischief-crew');
  try {
    const s=game(),p=s.players[0];Object.assign(p,{x:5,y:5,immune:0});
    s.balls=[bomb(1,6,4,'football',32)];s.nextId=3;
    await advanceBoth(r,s);assert.equal(p.status,'alive');
    Object.assign(p,{x:6,y:5});s.drops=[{x:6,y:4,kind:'normal',id:2,at:33,start:25,fromX:2}];
    await advanceBoth(r,s);assert.equal(p.status,'alive');assert.equal(s.balls.length,1);
    assert.ok(s.blasts.length>0,'foam is still visible');
    const t=game();Object.assign(t.players[0],{x:6,y:5,immune:0,dir:2});
    t.balls=[bomb(1,6,4,'football',32)];await advanceBoth(r,t);
    assert.equal(t.players[0].status,'bubble');assert.equal(t.players[0].dir,1);
  } finally {r.close();}
});

test('an airborne bubble can still be explicitly chain-triggered at its registered destination',async()=>{
  const r=await createRuntime('bubble-mischief-crew');
  try {
    const s=game();s.balls=[bomb(1,5,4,'football',32),{
      ...bomb(2,9,4),flight:{x:1,y:4,start:155,end:175,distance:8}}];
    await advanceBoth(r,s);assert.equal(s.balls.length,0);
    assert.ok(s.blasts.some(b=>b.id===2&&b.x===9&&b.y===4));
  } finally {r.close();}
});

test('native round deadline is four scene-clock minutes and inventory quantities saturate at 255',async()=>{
  const r=await createRuntime('bubble-mischief-crew');
  try {
    const s=game(),p=s.players[0];p.inventory=[{kind:'glue',count:254}];
    s.items=[{x:p.x,y:p.y,kind:'glue',id:1}];await advanceBoth(r,s);
    assert.equal(p.inventory[0].count,255);
    s.tick=2399;await advanceBoth(r,s);assert.equal(s.phase,'ended');assert.equal(s.tick,2400);
  } finally {r.close();}
});
