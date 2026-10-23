-- Authoritative room simulation. Time comes only from the server; no client clock or RNG.
local W,H,STEP,LIMIT=13,9,100,2400
-- Native contact kick / fuse and wave rules mirror bomb-rules.js; fall path remains tuning.
local BOMB={kickDistance=8,flightFrames=20,fuseFrames=151,fallTicks=8}
local DX,DY={1,0,-1,0},{0,1,0,-1}
local function frame(s) return s.tick*5+(s.substep or 0) end
local function bomb_range(kind) return kind=='football' and 4 or 1 end
local function inside(x,y) return x>=0 and y>=0 and x<W and y<H and not ((x==0 or x==W-1) and y>=3 and y<=5) end

local FIELD_CELLS={}
for cell=0,W*H-1 do if inside(cell%W,math.floor(cell/W)) then FIELD_CELLS[#FIELD_CELLS+1]=cell end end
local function field_targets()
 local targets={};for i,cell in ipairs(FIELD_CELLS) do targets[i]=cell end;return targets
end
local function rand(s,n) s.seed=(s.seed*48271)%2147483647; return s.seed%n end
local function accept(s) return {accepted=true,state=s,events={}} end
local function reject(code,message) return {accepted=false,error={code=code,message=message}} end
local function reset(s,now)
 s.tick,s.substep,s.phase,s.winner=0,0,'waiting',-1
 s.balls,s.blasts,s.drops,s.items={},{},{},{}
 s.traps,s.itemDrops,s.recycled,s.itemStock={},{},{},{50,50,50,4}
 s.lastRecycleAt=0
 s.nextId,s.lastStepAt,s.lastWaveAt=1,now,-1
 for i,p in ipairs(s.players) do
  p.x,p.y,p.dir=(i%2==1 and 2 or W-3),(i<=2 and 2 or H-3),(i%2==1 and 0 or 2)
  p.status,p["until"],p.immune,p.moving='alive',0,0,false
  p.shield,p.input,p.ready,p.rematch=false,-1,false,false
  p.lastSeen,p.seq=0,0
  p.inventory,p.shoes,p.slowUntil,p.slideDir,p.itemSeq={},0,0,-1,0
 end
end
local function cells(b,blocked)
 local out={{x=b.x,y=b.y}}
 for d=1,4 do for r=1,(b.kind and bomb_range(b.kind) or b.range) do local x,y=b.x+DX[d]*r,b.y+DY[d]*r; if not inside(x,y) then break end;table.insert(out,{x=x,y=y});if blocked[y*W+x] then break end end end
 return out
end
local function explode(s,b,seen,blocked)
 if seen[b.id] then return end
 seen[b.id]=true
 local c=cells(b,blocked)
 -- A capped wave has 25 bubbles. Index this cross once instead of scanning
 -- all its cells again for every candidate in a large chain reaction.
 local hits={}
 for _,v in ipairs(c) do
  hits[v.y*W+v.x]=true
  table.insert(s.blasts,{x=v.x,y=v.y,["until"]=frame(s)/5+5,atFrame=frame(s),id=b.id})
 end
 for _,other in ipairs(s.balls) do if not seen[other.id] and hits[other.y*W+other.x] then explode(s,other,seen,blocked) end end
end
local function filter(list,fn) local out={};for _,v in ipairs(list) do if fn(v) then table.insert(out,v) end end;return out end
-- Native movement probes +/-19 pixels per 40-pixel cell: half-width 0.475.
local UNIT,CLEARANCE,BODY_HALF,MOVE_SPEED,SLIDE_SPEED=1000,975,475,5100,4000
local CONTACT_RADIUS=750 -- 0.75 cells, matching game.js in fixed-point units.
local floor=math.floor
local function grid(v) return floor(v+0.5) end
local function touching(p,q)
 local dx,dy=grid(p.x*UNIT)-grid(q.x*UNIT),grid(p.y*UNIT)-grid(q.y*UNIT)
 return dx*dx+dy*dy<=CONTACT_RADIUS*CONTACT_RADIUS
end
local ITEM_KINDS,ITEM_WEIGHTS={'shoe','banana','glue','fork'},{5,2,2,1}
local SHOE_SPEEDS={5100,5800,6700,8000}
local function speed(p,tick)
 if (p.slideDir or -1)>=0 then return 13000 end
 if (p.slowUntil or 0)>tick then return 1800 end
 return SHOE_SPEEDS[(p.shoes or 0)+1]
end
local function use_item(s,p,slot)
 local item=p.inventory and p.inventory[slot]
 if s.phase~='playing' or not item or item.count<=0 then return false end
 if item.kind=='fork' then
  if p.status~='bubble' then return false end
  p.status,p.immune,p.slowUntil,p.slideDir='alive',s.tick+12,0,-1
 else
  if p.status~='alive' or (item.kind~='glue' and item.kind~='banana') then return false end
  local x,y=grid(p.x),grid(p.y);if not inside(x,y) then return false end
  local pass={}
  for _,q in ipairs(s.players) do if q.status=='alive' and math.abs(q.x-x)*UNIT<CLEARANCE and math.abs(q.y-y)*UNIT<CLEARANCE then table.insert(pass,q.id) end end
  s.traps=s.traps or {};table.insert(s.traps,{x=x,y=y,id=s.nextId,kind=item.kind,owner=p.id,passableBy=pass});s.nextId=s.nextId+1
 end
 item.count=item.count-1;return true
end
local function grant_item(p,item)
 if not item.kind then p.shield=true;return true end
 if item.kind=='shoe' then p.shoes=math.min(3,(p.shoes or 0)+1);return true end
 p.inventory=p.inventory or {}
 local slot=nil
 for _,i in ipairs(p.inventory) do if i.kind==item.kind then slot=i;break end end
 if not slot then for _,i in ipairs(p.inventory) do if i.count==0 then slot=i;break end end end
 if not slot then if #p.inventory>=7 then return false end;slot={kind=item.kind,count=0};table.insert(p.inventory,slot) end
 slot.kind=item.kind;slot.count=math.min(255,slot.count+(item.kind=='glue' and 3 or 1));return true
end
local function collect_items(s,previous,cache)
 if #s.items>0 then
  local indexed=cache.items
  if not indexed then indexed={};for _,item in ipairs(s.items) do local key=item.y*W+item.x;if not indexed[key] then indexed[key]=item end end end
  for _,p in ipairs(s.players) do if p.status=='alive' then
   local key=grid(p.y)*W+grid(p.x);local item=indexed[key]
   if item and grant_item(p,item) then
    for i,v in ipairs(s.items) do if v==item then table.remove(s.items,i);break end end
    indexed[key]=nil
    for _,v in ipairs(s.items) do if v.y*W+v.x==key then indexed[key]=v;break end end
   end
  end end
  cache.items=indexed
 end
 if not previous then return end
 -- Index only the traps a player can enter, and track overlap passes separately.
 -- Both indexes live for one callback, never in serialized game state.
 if not cache.traps then
  cache.traps,cache.passing={},{}
  for _,trap in ipairs(s.traps) do
   local key=trap.y*W+trap.x
   if not cache.traps[key] then cache.traps[key]={} end
   table.insert(cache.traps[key],trap)
   if #trap.passableBy>0 then table.insert(cache.passing,trap) end
  end
 end
 for i=#cache.passing,1,-1 do
  local trap=cache.passing[i]
  trap.passableBy=filter(trap.passableBy,function(id)
   for _,p in ipairs(s.players) do if p.id==id then return p.status=='alive' and math.abs(p.x-trap.x)*UNIT<CLEARANCE and math.abs(p.y-trap.y)*UNIT<CLEARANCE end end;return false
  end)
  if #trap.passableBy==0 then table.remove(cache.passing,i) end
 end
 for n,p in ipairs(s.players) do if p.status=='alive' and p.immune<=s.tick then
  local prev=previous[n]
  if prev and (p.x<prev[1]-0.5 or p.x>=prev[1]+0.5 or p.y<prev[2]-0.5 or p.y>=prev[2]+0.5) then
   local x,y=grid(p.x),grid(p.y);prev[1],prev[2]=x,y
   local traps=cache.traps[y*W+x]
   if traps then
    local i=1
    while i<=#traps do
     local trap=traps[i];local allowed=true
     for _,id in ipairs(trap.passableBy) do if id==p.id then allowed=false;break end end
     if allowed then
      if trap.kind=='glue' then p.slowUntil,p.slideDir=frame(s)/5+100,-1 else p.slowUntil,p.slideDir=0,p.dir end
      for j,t in ipairs(s.traps) do if t==trap then table.remove(s.traps,j);break end end
      table.remove(traps,i)
     else i=i+1 end
    end
   end
  end
 end end
end
local function clear_blasted_items(s,hot,cache)
 if #s.items==0 and (not s.traps or #s.traps==0) then return end
 s.recycled=s.recycled or {}
 for _,key in ipairs({'items','traps'}) do
  s[key]=filter(s[key] or {},function(item)
   if not hot[item.y*W+item.x] then return true end
   if item.kind then table.insert(s.recycled,{kind=item.kind,placed=key=='traps'}) end;return false
  end)
 end
 cache.items,cache.traps=nil,nil
end
local function land_items(s,cache)
 s.itemDrops=s.itemDrops or {};s.traps=s.traps or {}
 if #s.itemDrops==0 then return end
 s.itemDrops=filter(s.itemDrops,function(d)
  if d.at>frame(s)/5 then return true end
  if d.placed then table.insert(s.traps,{x=d.x,y=d.y,id=d.id,kind=d.kind,owner='',passableBy={}});cache.traps=nil
  else table.insert(s.items,{x=d.x,y=d.y,id=d.id,kind=d.kind});cache.items=nil end
  return false
 end)
end
local function drop_item(s,kind,cell,placed)
 local start=frame(s)/5;s.itemDrops=s.itemDrops or {}
 table.insert(s.itemDrops,{id=s.nextId,x=cell%W,y=floor(cell/W),kind=kind,placed=placed,fromX=rand(s,W),start=start,at=start+BOMB.fallTicks});s.nextId=s.nextId+1
end
local function wave_item(s,targets,bombs,elapsed)
 s.itemStock=s.itemStock or {50,50,50,4}
 local total=0;local weights={}
 for i,weight in ipairs(ITEM_WEIGHTS) do if s.itemStock[i]<=0 then weight=0 end;weights[i]=weight;total=total+weight end
 if total==0 then return end
 local roll=rand(s,total)
 for i,weight in ipairs(weights) do
  if roll<weight then
   s.itemStock[i]=s.itemStock[i]-1
   local cell=targets[bombs+1+rand(s,#targets-bombs)];drop_item(s,ITEM_KINDS[i],cell,false);return
  end
  roll=roll-weight
 end
end
local function recycle_items(s)
 local elapsed=math.max(0,frame(s)*20)
 if not s.recycled or #s.recycled==0 or elapsed-(s.lastRecycleAt or 0)<30000 then return end
 s.lastRecycleAt=elapsed
 local targets=field_targets()
 local count=math.min(64,#s.recycled)
 for i=1,count do local item=table.remove(s.recycled,1);local cell=table.remove(targets,rand(s,#targets)+1);drop_item(s,item.kind,cell,item.placed) end
end
local function occupancy(balls)
 local occupied={}
 for _,b in ipairs(balls) do
  local fuse=b.fuseFrame or b.fuse*5
  if not occupied.nextFuse or fuse<occupied.nextFuse then occupied.nextFuse=fuse end
  if not b.flight then
  local key=b.y*W+b.x
  if occupied[key] then occupied[key].count=occupied[key].count+1 else occupied[key]={ball=b,count=1} end
 elseif not occupied.nextLanding or b.flight["end"]<occupied.nextLanding then occupied.nextLanding=b.flight["end"] end end
 return occupied
end
local function travel(occupied,px,py,dir,distance)
 local horizontal,sign=dir%2==0,(dir<2 and 1 or -1)
 local along,across=(horizontal and px or py),(horizontal and py or px)
 local limit=((horizontal and W or H)-1)*UNIT
 local allowed=math.max(0,math.min(distance,sign>0 and limit-along or along))
 local blocker=nil
 if horizontal then
  if py>2025 and py<5975 then
   if sign<0 then allowed=math.min(allowed,math.max(0,px-975)) else allowed=math.min(allowed,math.max(0,11025-px)) end
  end
 elseif px<975 or px>11025 then
  if sign>0 and py<4000 then allowed=math.min(allowed,math.max(0,2025-py))
  elseif sign<0 and py>4000 then allowed=math.min(allowed,math.max(0,py-5975)) end
 end
 local minCross=floor((across-CLEARANCE)/UNIT)+1
 local maxCross=math.ceil((across+CLEARANCE)/UNIT)-1
 local minAlong,maxAlong
 if sign>0 then
  minAlong=floor(along/UNIT)+1;maxAlong=floor((along+CLEARANCE+allowed)/UNIT)
 else
  minAlong=math.ceil((along-CLEARANCE-allowed)/UNIT);maxAlong=math.ceil(along/UNIT)-1
 end
 for cross=minCross,maxCross do for axis=minAlong,maxAlong do
  local x,y=horizontal and axis or cross,horizontal and cross or axis
  local entry=(x>=0 and y>=0 and x<W and y<H) and occupied[y*W+x] or nil
  local b=entry and entry.ball
  if b then
   local offset=sign*(along-axis*UNIT)
   local contact=offset<=-CLEARANCE and -offset-CLEARANCE or 0
   if contact<allowed or (contact==allowed and (not blocker or b.y*W+b.x<blocker.y*W+blocker.x)) then allowed,blocker=contact,b end
  end
 end end
 return allowed,blocker
end
local function launch(s,p,b,dir,occupied)
 local entry=occupied[b.y*W+b.x]
 if b.flight or (entry and entry.count>1) then return false end
 local x,y,distance=nil,nil,nil
 for d=BOMB.kickDistance,1,-1 do
  local tx=(b.x+1+DX[dir+1]*d)%15-1
  local ty=(b.y+4+DY[dir+1]*d)%13-4
  if inside(tx,ty) and (tx~=b.x or ty~=b.y) then x,y,distance=tx,ty,d;break end
 end
 if not distance then return false end
 occupied[b.y*W+b.x]=nil
 b.flight={distance=distance,x=b.x,y=b.y,start=frame(s),["end"]=frame(s)+BOMB.flightFrames}
 occupied.nextLanding=math.min(occupied.nextLanding or math.huge,b.flight["end"])
 b.x,b.y,b.dir,b.owner=x,y,dir,p.id
 return true
end
local function move(s,p,dir,occupied,rate,forced)
 local rate=rate or MOVE_SPEED
 p.moving=false
 if dir<0 or p.status~='alive' then return end
 local px,py=grid(p.x*UNIT),grid(p.y*UNIT)
 local startX,startY=px,py
 local fx,fy=floor((px+DX[dir+1]*550+500)/UNIT),floor((py+DY[dir+1]*550+500)/UNIT)
 local target=occupied[fy*W+fx]
 if target and target.ball.x==fx and target.ball.y==fy and (fx~=floor((px+500)/UNIT) or fy~=floor((py+500)/UNIT)) then launch(s,p,target.ball,dir,occupied) end
 local remaining=20000
 for segment=1,5 do
  local wanted=floor(rate*remaining/1000000)
  if wanted<=0 then break end
  local distance,b=travel(occupied,px,py,dir,wanted)
  px,py=px+DX[dir+1]*distance,py+DY[dir+1]*distance
  remaining=remaining-distance*(1000000/rate)
  if distance==wanted or not b then break end
  local horizontal=dir%2==0
  if forced then break end
  local offset=horizontal and (py-b.y*UNIT) or (px-b.x*UNIT)
  local overlap=CLEARANCE-math.abs(offset)
  if overlap<=0 or overlap>BODY_HALF then break end
  local sideDir
  if horizontal then sideDir=offset<0 and 3 or 1 else sideDir=offset<0 and 2 or 0 end
  local sideDistance=math.min(overlap,floor(SLIDE_SPEED*remaining/1000000))
  local side=travel(occupied,px,py,sideDir,sideDistance)
  if side==0 then break end
  px,py=px+DX[sideDir+1]*side,py+DY[sideDir+1]*side
  remaining=remaining-side*(1000000/SLIDE_SPEED)
  if side<overlap then break end
 end
 p.x,p.y=px/UNIT,py/UNIT
 p.moving=px~=startX or py~=startY
 return forced and math.abs(px-startX)+math.abs(py-startY)<floor(rate*20/1000)
end
local function hot_cells(s)
 local hot,expires={},math.huge
 for _,b in ipairs(s.blasts) do
  if not b.atFrame or b.atFrame==frame(s) then
   hot[b.y*W+b.x]=true
   expires=math.min(expires,b.atFrame and (b.atFrame+1)/5 or b["until"])
  else expires=math.min(expires,b["until"]) end
 end
 return hot,expires
end
local function step(s,cache)
 -- Reuse spatial indexes only within this server callback. They never enter
 -- serialized state, and are rebuilt when balls land / launch / explode.
 local hot,expires=cache.hot,cache.expires
 if not hot then hot,expires=hot_cells(s) end
 local occupied=cache.occupied or occupancy(s.balls)
 for part=1,5 do
  s.substep=((s.substep or 0)+1)%5
  local clocked=s.substep==0
  if clocked then s.tick=s.tick+1 end
  if s.tick>=30 then
   s.phase='playing'
   if occupied.nextLanding and occupied.nextLanding<=frame(s) then
    for _,b in ipairs(s.balls) do if b.flight and b.flight["end"]<=frame(s) then b.flight=nil;b.dir=-1 end end
    occupied=occupancy(s.balls)
   end
   local nowFrame=frame(s);local nowTick=nowFrame/5
   if expires<=nowTick then
    s.blasts=filter(s.blasts,function(b) return b["until"]>nowTick end)
    hot,expires=hot_cells(s)
   end
   if occupied.nextFuse and occupied.nextFuse<=nowFrame then
    local seen,blocked={},{}
    for _,b in ipairs(s.balls) do blocked[b.y*W+b.x]=true end
    local exploded=false
    for _,b in ipairs(s.balls) do
     if not seen[b.id] and not b.flight and (b.fuseFrame or b.fuse*5)<=nowFrame then
      explode(s,b,seen,blocked);exploded=true
     end
    end
    if exploded then
     s.balls=filter(s.balls,function(b) return not seen[b.id] end)
     hot,expires=hot_cells(s);occupied=occupancy(s.balls)
    end
   end
   local hasImpact=next(hot)
   if hasImpact and (#s.items>0 or #s.traps>0) then clear_blasted_items(s,hot,cache) end
   if s.itemDrops[1] and s.itemDrops[1].at<=nowTick then land_items(s,cache) end
   local previous=nil
   if #s.traps>0 then cache.playerCells=cache.playerCells or {};previous=cache.playerCells else cache.playerCells=nil end
   for i,p in ipairs(s.players) do
    if previous then
     if p.status=='alive' and p.immune<=s.tick then if not previous[i] then previous[i]={grid(p.x),grid(p.y)} end
     else previous[i]=nil end
    end
    if s.lastStepAt-p.lastSeen>400 then p.input=-1 end
    local forced=(p.slideDir or -1)>=0;local dir=forced and p.slideDir or p.input
    if dir>=0 then p.dir=dir end
    local blocked=move(s,p,dir,occupied,speed(p,nowTick),forced)
    if forced and blocked then p.slideDir=-1 end
   end
   if hasImpact then for _,p in ipairs(s.players) do
    if p.status=='alive' and p.immune<=s.tick and hot[grid(p.y)*W+grid(p.x)] then
     if p.shield then p.shield,p.immune=false,s.tick+10 else p.status,p["until"],p.input,p.moving,p.slowUntil,p.slideDir,p.dir='bubble',s.tick+40,-1,false,0,-1,1 end
    end
   end end
   local red,blue=0,0
   for _,p in ipairs(s.players) do if p.status=='bubble' then
    local enemy,friend=false,false
    for _,q in ipairs(s.players) do
     if q~=p and q.status=='alive' and touching(p,q) then
      if q.team==p.team then friend=true else enemy=true end
     end
    end
    if enemy or s.tick>=p["until"] then p.status='out' elseif friend then p.status,p.immune='alive',s.tick+12 end
   end
    if p.status~='out' then if p.team==0 then red=red+1 else blue=blue+1 end end
   end
   if #s.items>0 or previous then collect_items(s,previous,cache) end
   if s.drops[1] and s.drops[1].at<=nowTick then
    local dropped=false
    for _,d in ipairs(s.drops) do if d.at<=nowTick then
     table.insert(s.balls,{x=d.x,y=d.y,id=d.id,fuseFrame=nowFrame+BOMB.fuseFrames,fuse=(nowFrame+BOMB.fuseFrames)/5,kind=d.kind,range=bomb_range(d.kind),dir=-1});dropped=true
    end end
    if dropped then occupied=occupancy(s.balls) end
    s.drops=filter(s.drops,function(d) return d.at>nowTick end)

   end
   local elapsedMs=nowFrame*20
   local last=s.lastWaveAt or -1
   local due=(last<0 and elapsedMs>=5000) or (last>=0 and elapsedMs-last>=(elapsedMs>=40000 and 4000 or 9000-floor(elapsedMs/8)))
   if due then
    s.lastWaveAt=elapsedMs
    local normal=math.min(15,5+floor(elapsedMs/16000))
    local football=math.min(10,1+floor(elapsedMs/16000))
    local targets=field_targets()
    local start=nowTick
    for i=1,normal+football do
     local chosen=i+rand(s,#targets-i+1)
     targets[i],targets[chosen]=targets[chosen],targets[i]
     local cell=targets[i]
     table.insert(s.drops,{id=s.nextId,x=cell%W,y=floor(cell/W),kind=i<=normal and 'normal' or 'football',fromX=rand(s,W),start=start,at=start+BOMB.fallTicks})
     s.nextId=s.nextId+1
    end
    wave_item(s,targets,normal+football,elapsedMs)
   end
   if #s.recycled>0 then recycle_items(s) end
   if red==0 or blue==0 or s.tick>=LIMIT then
    s.phase='ended';s.winner=-1
    if red==0 and blue>0 then s.winner=1 elseif blue==0 and red>0 then s.winner=0 end
    if s.winner>=0 then s.scores[s.winner+1]=s.scores[s.winner+1]+1 end
    break
   end
  end
 end
 cache.hot,cache.expires,cache.occupied=hot,expires,occupied
end

local function advance(s,now)
 if s.phase=='ended' or s.phase=='closed' then return end
 for _,p in ipairs(s.players) do if not p.ready or now-p.lastSeen>2000 then
  if s.phase~='waiting' then s.phase='paused' end
  return
 end end
 if s.phase=='waiting' or s.phase=='paused' then
  s.phase='countdown';s.lastStepAt=now
  -- A resumed round gets a fresh three-second countdown without altering bomb timers.
  s.resumeAt=now+3000
  for _,p in ipairs(s.players) do p.input=-1 end
  return
 end
 if s.resumeAt then
  if now<s.resumeAt then return end
  s.lastStepAt=s.resumeAt;s.resumeAt=nil;s.phase=s.tick<30 and 'countdown' or 'playing'
  -- Initial countdown has already been shown during resumeAt.
  if s.tick<30 then s.tick=29 end
 end
 if now-s.lastStepAt>800 then s.phase='paused';return end
 local n,cache=0,{}
 while now>=s.lastStepAt+STEP and n<8 and (s.phase=='playing' or s.phase=='countdown') do s.lastStepAt=s.lastStepAt+STEP;step(s,cache);n=n+1 end
end
function setup(context)
 assert(#context.players>=2 and #context.players<=4,'Bubble Kick requires 2–4 players')
 local now=context.serverTime or context.match.startedAt
 local s={seed=math.max(1,floor(now)%2147483647),round=1,players={},scores={0,0}}
 for i,p in ipairs(context.players) do s.players[i]={id=p.id,name=p.name or ('Player '..i),team=(i-1)%2,bot=false} end
 reset(s,now);return {state=s,events={}}
end
function on_action(s,a,context)
 local p
 for _,q in ipairs(s.players) do if q.id==context.actor.id then p=q end end
 if not p or context.actor.role=='spectator' then return reject('SPECTATOR','Spectators cannot control the game') end
 if type(a)~='table' or (a.type~='input' and a.type~='rematch') then return reject('INVALID_ACTION','Expected input or rematch') end
 if a.round~=s.round then return reject('STALE_ROUND','This round has already ended') end
 if s.phase=='closed' then return reject('CLOSED','Return to the room to start a new match') end
 if a.type=='input' and (type(a.dir)~='number' or a.dir%1~=0 or a.dir< -1 or a.dir>3 or (a.kick~=nil and type(a.kick)~='boolean') or type(a.seq)~='number' or a.seq%1~=0 or a.seq<1 or a.seq>1000000000) then return reject('INVALID_INPUT','Invalid direction, kick or sequence') end
 if a.type=='input' and (a.itemSlot~=nil or a.itemSeq~=nil) and (type(a.itemSlot)~='number' or a.itemSlot%1~=0 or a.itemSlot<1 or a.itemSlot>7 or type(a.itemSeq)~='number' or a.itemSeq%1~=0 or a.itemSeq<1 or a.itemSeq>1000000000) then return reject('INVALID_INPUT','Invalid item slot or sequence') end
 if a.type=='rematch' and s.phase~='ended' then return reject('ROUND_ACTIVE','The match is still active') end
 if a.type=='input' and a.seq<=p.seq then return accept(s) end
 local now=context.actionAt or context.serverTime
 advance(s,now);p.lastSeen,p.ready=now,true;advance(s,now)
 if a.type=='input' then
  p.seq=a.seq
  if s.phase~='ended' and p.status=='alive' then p.input=a.dir end
  if a.itemSeq and a.itemSeq>(p.itemSeq or 0) and s.phase=='playing' then p.itemSeq=a.itemSeq;use_item(s,p,a.itemSlot) end
 else
  p.rematch=true
  local all=true;for _,q in ipairs(s.players) do if not q.rematch then all=false end end
  if all then s.round=s.round+1;reset(s,now) end
 end
 return accept(s)
end
function view(s,events,context)
 local players={}
 for i,p in ipairs(s.players) do players[i]={id=p.id,name=p.name,team=p.team,bot=false,x=p.x,y=p.y,dir=p.dir,moving=p.moving,status=p.status,["until"]=p["until"],immune=p.immune,shield=p.shield,rematch=p.rematch,inventory=p.inventory,shoes=p.shoes,slowUntil=p.slowUntil,slideDir=p.slideDir,itemSeq=p.itemSeq} end
 return {state={tick=s.tick,substep=s.substep,lastStepAt=s.lastStepAt,phase=s.phase,winner=s.winner,round=s.round,scores=s.scores,players=players,balls=s.balls,blasts=s.blasts,drops=s.drops,items=s.items,traps=s.traps,itemDrops=s.itemDrops,resumeAt=s.resumeAt},events={}}
end
function on_player_left(s,context)
 for _,p in ipairs(s.players) do if p.id==context.actor.id then s.phase='closed';break end end
 return {state=s,events={}}
end
function on_return_to_room(s,context) return true end
