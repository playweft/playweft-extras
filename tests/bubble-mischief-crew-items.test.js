import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, useItem, blastCells, inside } from '../games/bubble-mischief-crew/game.js';
import { ITEM_POOL, chooseItem, playerSpeed } from '../games/bubble-mischief-crew/item-rules.js';
import { collectAndTriggerItems, clearBlastedItems, dispatchRecycledItems } from '../games/bubble-mischief-crew/items.js';
import { createRuntime } from '../scripts/lua-runtime.mjs';

function game() {
  const s = createGame({ players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, bot: false })), seed: 31 });
  s.phase = 'playing'; s.tick = 31;
  return s;
}
const previous = s => new Map(s.players.map(p => [p.id, { x: Math.round(p.x), y: Math.round(p.y) }]));
const array = value => Array.isArray(value) ? value : [];
function mechanics(s) {
  return {
    tick: s.tick, substep: s.substep, seed: s.seed, nextId: s.nextId, phase: s.phase,
    lastWaveAt: s.lastWaveAt, lastRecycleAt: s.lastRecycleAt, itemStock: s.itemStock,
    balls: array(s.balls), drops: array(s.drops), blasts: array(s.blasts),
    items: array(s.items), itemDrops: array(s.itemDrops), recycled: array(s.recycled),
    traps: array(s.traps).map(t => ({ ...t, passableBy: array(t.passableBy) })),
    players: s.players.map(({ x,y,dir,status,immune,until,shoes,slowUntil,slideDir,inventory,moving }) =>
      ({ x,y,dir,status,immune,until,shoes,slowUntil,slideDir,moving,inventory:array(inventory) })),
  };
}
async function advanceBoth(runtime, s, ms = 100) {
  const before = structuredClone(s);
  before.lastStepAt = 10000;
  before.players.forEach(p => Object.assign(p, { lastSeen: 10000 + ms, ready: true, seq: 0 }));
  const result = await runtime.call('on_action', before, { type:'input',round:1,seq:1,dir:before.players[0].input },
    { actor:{ id:'p0',role:'player' },actionAt:10000 + ms });
  stepGame(s, ms);
  assert.equal(result.accepted, true);
  assert.deepEqual(mechanics(result.state), mechanics(s));
  return result.state;
}

test('weighted finite original item pool omits coins, and exhausted types stop spawning', () => {
  assert.deepEqual(ITEM_POOL.map(i => [i.kind,i.weight,i.stock]),
    [['shoe',5,50],['banana',2,50],['glue',2,50],['fork',1,4]]);
  for (const [roll,kind] of [[0,'shoe'],[4,'shoe'],[5,'banana'],[6,'banana'],[7,'glue'],[8,'glue'],[9,'fork']]) {
    const s = game();
    assert.equal(chooseItem(s,0,(_s,n) => { assert.equal(n,10);return roll; }),kind);
    assert.equal(s.itemStock[ITEM_POOL.findIndex(i => i.kind===kind)],kind==='fork'?3:49);
  }
  const s=game(); s.itemStock=[0,0,0,1];
  assert.equal(chooseItem(s,90000,()=>0),'fork');
  assert.equal(chooseItem(s,90000,()=>{ throw Error('empty pool must not roll'); }),null);
});

test('shoes apply immediately up to three levels, glue pickups grant three uses, and banana one', () => {
  const s=game(),p=s.players[0];
  for (const kind of ['shoe','shoe','shoe','shoe','glue','banana','fork','glue']) {
    s.items.push({ x:p.x,y:p.y,kind,id:s.nextId++ });
    collectAndTriggerItems(s,previous(s));
  }
  assert.equal(p.shoes,3);
  assert.equal(playerSpeed(p,s.tick),8000);
  assert.deepEqual(p.inventory,[{kind:'glue',count:6},{kind:'banana',count:1},{kind:'fork',count:1}]);
  assert.equal(s.items.length,0);
});

test('placed traps spare overlapping players until they leave, then affect the owner on re-entry', () => {
  const s=game(),p=s.players[0];
  p.inventory=[{kind:'glue',count:3},{kind:'banana',count:1}];
  assert.equal(useItem(s,0,1),true);
  collectAndTriggerItems(s,previous(s));
  assert.equal(p.slowUntil,0);
  assert.equal(s.traps.length,1);
  let prev=previous(s);p.x+=1;collectAndTriggerItems(s,prev);
  assert.deepEqual(s.traps[0].passableBy,[]);
  prev=previous(s);p.x-=1;collectAndTriggerItems(s,prev);
  assert.equal(p.slowUntil,s.tick+100);
  assert.equal(playerSpeed(p,s.tick),1800);
  assert.equal(playerSpeed(p,s.tick+100),5100);
  assert.equal(s.traps.length,0);
  assert.equal(p.inventory[0].count,2);
  assert.equal(useItem(s,0,2),true);
  prev=previous(s);p.x+=1;collectAndTriggerItems(s,prev);
  prev=previous(s);p.x-=1;p.dir=2;collectAndTriggerItems(s,prev);
  assert.equal(p.slowUntil,0);
  assert.equal(p.slideDir,2);
  assert.equal(playerSpeed(p,s.tick),13000);
});

test('moving players place glue and banana at their current cell without interrupting held movement, identically in Lua', async () => {
  const runtime = await createRuntime('bubble-mischief-crew');
  try {
    const s = game(), p = s.players[0];
    p.input = 0;
    p.inventory = [{ kind:'glue', count:3 }, { kind:'banana', count:1 }];
    s.lastStepAt = 10000;
    s.players.forEach(q => Object.assign(q, { lastSeen:11000, ready:true, seq:0 }));
    let room = structuredClone(s);
    for (const [i, slot, itemSeq] of [[1, 1, 1], [2, 1, 1], [3, 2, 2]]) {
      const result = await runtime.call('on_action', room,
        { type:'input', round:1, seq:i, dir:0, itemSlot:slot, itemSeq },
        { actor:{ id:'p0', role:'player' }, actionAt:10000 + i * 100 });
      stepGame(s, 100);
      if (i !== 2) assert.equal(useItem(s, 0, slot), true);
      assert.equal(result.accepted, true);
      room = result.state;
      assert.deepEqual(mechanics(room), mechanics(s));
      assert.equal(room.players[0].input, 0);
      assert.equal(room.players[0].moving, true);
      assert.equal(p.slowUntil, 0);
      assert.equal(p.slideDir, -1);
    }
    assert.equal(s.traps.length, 2);
    assert.deepEqual(s.traps.map(t => [t.x,t.y]), [[3,2], [4,2]]);
    assert.equal(p.inventory[0].count, 2, 'an input retry must not place another glue');
  } finally { runtime.close(); }
});

test('fork only self-rescues a trapped player, consumes once, and does not leave a ground trap', async () => {
  const runtime=await createRuntime('bubble-mischief-crew');
  try {
    const s=game(),p=s.players[0];p.inventory=[{kind:'fork',count:2}];
    assert.equal(useItem(s,0,1),false);
    Object.assign(p,{status:'bubble',until:100,slowUntil:80,slideDir:0});
    const before=structuredClone(s);before.lastStepAt=10000;
    before.players.forEach(p=>Object.assign(p,{ready:true,lastSeen:10000,seq:0}));
    const action={type:'input',round:1,seq:1,dir:-1,itemSlot:1,itemSeq:1};
    const context={actor:{id:'p0',role:'player'},actionAt:10000};
    const r=await runtime.call('on_action',before,action,context);
    assert.equal(useItem(s,0,1),true);
    assert.deepEqual(mechanics(r.state),mechanics(s));
    assert.equal(p.immune,s.tick+12);assert.equal(p.slowUntil,0);assert.equal(p.slideDir,-1);
    assert.equal(p.inventory[0].count,1);assert.equal(s.traps.length,0);
    r.state.players[0].status='bubble';
    const replay=await runtime.call('on_action',r.state,{...action,seq:2},context);
    assert.equal(replay.state.players[0].status,'bubble');
    assert.equal(replay.state.players[0].inventory[0].count,1);
    for (const invalid of [{itemSlot:0},{itemSlot:8},{itemSlot:1.5},{itemSeq:0},{itemSeq:null}]) {
      const bad=await runtime.call('on_action',before,{...action,...invalid},context);
      assert.equal(bad.error.code,'INVALID_INPUT');
    }
  } finally { runtime.close(); }
});

test('glue, forced banana sliding, blocked slide and stacked traps match Lua', async () => {
  const runtime=await createRuntime('bubble-mischief-crew');
  try {
    for (const kind of ['glue','banana']) {
      const s=game(),p=s.players[0];
      Object.assign(p,{x:4.4,y:2,input:0,slowUntil:kind==='banana'?100:0});
      s.traps=[{x:5,y:2,id:1,kind,owner:'p3',passableBy:[]}];s.nextId=2;
      for (let i=0;i<4;i++) await advanceBoth(runtime,s);
      assert.equal(s.traps.length,0);
      if(kind==='glue') assert.ok(p.slowUntil>s.tick);
      else assert.equal(p.slowUntil,0);
    }
    const s=game(),p=s.players[0];Object.assign(p,{x:11,y:4,slideDir:0,input:-1});
    await advanceBoth(runtime,s);assert.equal(p.slideDir,-1);assert.equal(p.x,11.025);
    const t=game();Object.assign(t.players[0],{x:4.4,y:2,input:0});
    t.traps=['glue','banana'].map((kind,i)=>({x:5,y:2,kind,id:i+1,owner:'p3',passableBy:[]}));
    await advanceBoth(runtime,t);assert.equal(t.players[0].slowUntil,0);assert.equal(t.players[0].slideDir,0);
  } finally { runtime.close(); }
});

test('pickups fall one per bomb wave, never into goals, with matching Lua stock and timing', async () => {
  const runtime=await createRuntime('bubble-mischief-crew');
  try {
    const s=game();s.players.forEach(p=>p.immune=10000);s.tick=49;
    await advanceBoth(runtime,s);
    assert.equal(s.drops.length,10);assert.equal(s.itemDrops.length,1);
    const item=s.itemDrops[0];
    assert.equal(item.start,s.drops[0].start);assert.equal(item.at,s.drops[0].at);
    assert.equal(inside(item.x,item.y),true);
    assert.ok(!s.drops.some(d=>d.x===item.x&&d.y===item.y));
    for(let i=0;i<8;i++) await advanceBoth(runtime,s);
    assert.equal(s.itemDrops.length,0);
    assert.equal(s.items.length,1);
    const initialStock=s.itemStock.reduce((a,b)=>a+b,0);
    s.tick=124;s.lastWaveAt=5000;s.balls=[];
    await advanceBoth(runtime,s,500);
    assert.equal(s.itemStock.reduce((a,b)=>a+b,0),initialStock-1);
    assert.equal(s.lastWaveAt,12460);
  } finally { runtime.close(); }
});

test('blasted pickups and placed hazards recycle on the 30-second gate without changing type', async () => {
  const s=game();s.tick=299;s.lastWaveAt=29000;
  s.items=[{x:3,y:2,kind:'shoe',id:1}];
  s.traps=[{x:4,y:2,kind:'banana',id:2,owner:'p0',passableBy:[]}];s.nextId=3;
  clearBlastedItems(s,new Set([2*13+3,2*13+4]));
  assert.deepEqual(s.recycled,[{kind:'shoe',placed:false},{kind:'banana',placed:true}]);
  dispatchRecycledItems(s,()=>0);assert.equal(s.itemDrops.length,0);
  const runtime=await createRuntime('bubble-mischief-crew');
  try {
    await advanceBoth(runtime,s);
    assert.equal(s.itemDrops.length,2);assert.equal(s.recycled.length,0);
    assert.ok(s.itemDrops.every(d=>inside(d.x,d.y)));
    for(let i=0;i<8;i++) await advanceBoth(runtime,s);
    assert.equal(s.items[0].kind,'shoe');assert.equal(s.traps[0].kind,'banana');
    assert.equal(s.traps[0].owner,'');
  } finally { runtime.close(); }
});

test('goal bodies stop players and blasts while the three-cell upper and lower lanes remain open', async () => {
  const runtime=await createRuntime('bubble-mischief-crew');
  try {
    for(const [x,y,dir,expected] of [[1,4,2,[0.975,4]],[11,4,0,[11.025,4]],
      [0,2,1,[0,2.025]],[0,6,3,[0,5.975]],[12,2,1,[12,2.025]],[12,6,3,[12,5.975]],
      [1,1,2,[0,1]],[11,7,0,[12,7]]]) {
      const s=game();Object.assign(s.players[0],{x,y,input:dir});
      await advanceBoth(runtime,s,400);
      assert.deepEqual([s.players[0].x,s.players[0].y],expected);
    }
    for(const x of [0,12]) for(const y of [3,4,5]) assert.equal(inside(x,y),false);
    assert.ok(!blastCells({x:1,y:4,range:4}).some(c=>c.x===0));
    assert.ok(!blastCells({x:0,y:2,range:4}).some(c=>c.y>=3&&c.x===0));
  } finally { runtime.close(); }
});

test('800 ms room catch-up with four moving players, bombs and placed items stays within the instruction budget', async () => {
  const runtime=await createRuntime('bubble-mischief-crew');
  try {
    const s=game();s.tick=1700;s.nextId=30;
    s.players.forEach(p=>p.input=0);
    s.balls=Array.from({length:12},(_,i)=>({x:(i%6)*2,y:4+Math.floor(i/6)*3,id:i+1,dir:-1,range:3,fuse:10000}));
    s.traps=Array.from({length:4},(_,i)=>({x:3+i,y:3,id:20+i,kind:'glue',owner:'p1',passableBy:[]}));
    await advanceBoth(runtime,s,800);
  } finally {runtime.close();}
});
