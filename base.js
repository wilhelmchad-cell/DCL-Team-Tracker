const GAME_TYPES = ["League","Run to 21","Driveway rules","Cut Throat","Chairhole","Singles","Count Up"];
const STORAGE_KEY = "dcl-team-tracker-full-v1"; // Prior device data, used only for migration.

const defaultState = {
  matches: [],
  countUpAttempts: [],
  countUpDraft: {player:"", throws:[]},
  gameNights: [],
  scoreA: 0,
  scoreB: 0,
  activeTab: "score",
  gameType: "League",
  teamA: "",
  teamB: "",
  targetScore: 21,
  search: ""
};

let state = {...defaultState};
let connected = false;
let busy = false;
let errorMessage = "";
let lastRevision = -1;
let deferredInstallPrompt = null;
let scorerMode = false;
let scorerSetupOpen = false;
let scorerMenuOpen = false;
let scorerWakeLock = null;
let gameNightEditingId = null;

function loadState(){
  try {
    return {...defaultState, ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {})};
  } catch {
    return {...defaultState};
  }
}
function saveState(){} // Shared state is saved through updateCloud().
function acceptCloud(row){
  lastRevision=row.revision;
  Object.assign(state,row.data);
  connected=true; errorMessage=''; render();
}
async function syncCloud(){
  if(!session || busy || document.hidden || document.activeElement?.matches('input,select')) return;
  try { const row=await readCloud(); if(row.revision!==lastRevision) acceptCloud(row); else if(errorMessage){errorMessage='';render();} }
  catch(e){ errorMessage=e.message; render(); }
}
async function changeCloud(change){
  busy=true;
  try { acceptCloud(await updateCloud(change)); }
  catch(e){errorMessage=e.message;alert('Nothing was saved: '+e.message);}
  finally{busy=false;}
}
async function startCloud(){
  if(!configured()){render();return;}
  if(!session){render();return;}
  try {acceptCloud(await readCloud());}
  catch(e){errorMessage=e.message;render();}
}
async function login(event){
  event.preventDefault();
  const credentials=new FormData(event.target);
  busy=true;render();
  try{await signIn(credentials.get('email'),credentials.get('password'));await startCloud();}
  catch(e){errorMessage=e.message;render();}
  finally{busy=false;}
}
async function logout(){await signOut();connected=false;state={...defaultState};render();}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function esc(v){ return String(v ?? "").replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function normalizeName(n){ return n.trim().replace(/\s+/g, " "); }
function parsePlayers(teamName){
  return teamName.split(",").map(normalizeName).filter(Boolean);
}
function teamKey(teamName){
  return parsePlayers(teamName).map(p => p.toLowerCase()).sort().join("|");
}
function displayTeam(teamName){
  const players = parsePlayers(teamName);
  return players.length ? players.join(", ") : normalizeName(teamName);
}
function winPct(w,l){ return (w+l) ? Math.round((w/(w+l))*100) : 0; }
function countUpDraft(data){
  if(!data.countUpDraft) data.countUpDraft={player:"",throws:[]};
  if(!Array.isArray(data.countUpAttempts)) data.countUpAttempts=[];
  return data.countUpDraft;
}
function countUpStats(){
  const players=new Map();
  for(const attempt of state.countUpAttempts || []){
    const key=normalizeName(attempt.player).toLowerCase();
    if(!players.has(key)) players.set(key,{name:attempt.player,best:0,total:0,attempts:0});
    const p=players.get(key);
    p.best=Math.max(p.best,attempt.total);p.total+=attempt.total;p.attempts++;
  }
  return [...players.values()].sort((a,b)=>b.best-a.best || b.total/b.attempts-a.total/a.attempts || a.name.localeCompare(b.name));
}

function computeStats(){
  const teams = {};
  const players = {};
  const h2h = {};
  const gameTypes = {};
  const initStat = name => ({ name, wins:0, losses:0, pointsFor:0, pointsAgainst:0, byType:{}, opponents:{} });
  const addScoreStats = (obj, pf, pa) => { obj.pointsFor += Number(pf || 0); obj.pointsAgainst += Number(pa || 0); };
  for (const m of state.matches){
    const aKey = teamKey(m.teamA), bKey = teamKey(m.teamB);
    if (!teams[aKey]) teams[aKey] = initStat(displayTeam(m.teamA));
    if (!teams[bKey]) teams[bKey] = initStat(displayTeam(m.teamB));
    const aWin = m.winner === "A";
    const scoreA = Number(m.scoreA || 0), scoreB = Number(m.scoreB || 0);
    teams[aKey][aWin ? "wins" : "losses"]++;
    teams[bKey][aWin ? "losses" : "wins"]++;
    addScoreStats(teams[aKey], scoreA, scoreB);
    addScoreStats(teams[bKey], scoreB, scoreA);
    teams[aKey].byType[m.gameType] = teams[aKey].byType[m.gameType] || {wins:0,losses:0};
    teams[bKey].byType[m.gameType] = teams[bKey].byType[m.gameType] || {wins:0,losses:0};
    teams[aKey].byType[m.gameType][aWin ? "wins" : "losses"]++;
    teams[bKey].byType[m.gameType][aWin ? "losses" : "wins"]++;
    teams[aKey].opponents[bKey] = teams[aKey].opponents[bKey] || {name: teams[bKey].name, wins:0, losses:0};
    teams[bKey].opponents[aKey] = teams[bKey].opponents[aKey] || {name: teams[aKey].name, wins:0, losses:0};
    teams[aKey].opponents[bKey][aWin ? "wins" : "losses"]++;
    teams[bKey].opponents[aKey][aWin ? "losses" : "wins"]++;

    for (const p of parsePlayers(m.teamA)){
      const k = p.toLowerCase();
      if(!players[k]) players[k] = initStat(p);
      players[k][aWin ? "wins" : "losses"]++;
      addScoreStats(players[k], scoreA, scoreB);
      players[k].byType[m.gameType] = players[k].byType[m.gameType] || {wins:0,losses:0};
      players[k].byType[m.gameType][aWin ? "wins" : "losses"]++;
    }
    for (const p of parsePlayers(m.teamB)){
      const k = p.toLowerCase();
      if(!players[k]) players[k] = initStat(p);
      players[k][aWin ? "losses" : "wins"]++;
      addScoreStats(players[k], scoreB, scoreA);
      players[k].byType[m.gameType] = players[k].byType[m.gameType] || {wins:0,losses:0};
      players[k].byType[m.gameType][aWin ? "losses" : "wins"]++;
    }
    const pairKeys = [aKey,bKey].sort();
    const pair = pairKeys.join("::");
    if(!h2h[pair]) h2h[pair] = { aKey:pairKeys[0], bKey:pairKeys[1], aName:teams[pairKeys[0]].name, bName:teams[pairKeys[1]].name, aWins:0, bWins:0 };
    const winnerKey = aWin ? aKey : bKey;
    if(winnerKey === h2h[pair].aKey) h2h[pair].aWins++; else h2h[pair].bWins++;
    gameTypes[m.gameType] = (gameTypes[m.gameType] || 0) + 1;
  }
  const finalize = x => ({...x, games:x.wins+x.losses, winPct:winPct(x.wins,x.losses), pointDiff:x.pointsFor-x.pointsAgainst});
  const sortStats = arr => arr.map(finalize).sort((x,y)=>y.winPct-x.winPct || (y.wins-y.losses)-(x.wins-x.losses) || y.wins-x.wins || x.name.localeCompare(y.name));
  return {
    teams: sortStats(Object.values(teams)),
    players: sortStats(Object.values(players)),
    h2h: Object.values(h2h).sort((a,b)=>(b.aWins+b.bWins)-(a.aWins+a.bWins)),
    gameTypes
  };
}

function ensureGameNights(data){
  if(!Array.isArray(data.gameNights)) data.gameNights=[];
  return data.gameNights;
}
function gameNightDateTime(e){
  const raw=`${e.date || ''}T${e.startTime || '00:00'}`;
  const d=new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}
function formatEventDate(e){
  const d=gameNightDateTime(e);
  if(!d.getTime()) return e.date || 'Date TBD';
  return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
}
function formatEventTime(e){
  const fmt=t=>{ if(!t) return ''; const [h,m]=t.split(':').map(Number); return new Date(2000,0,1,h,m).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); };
  const start=fmt(e.startTime), end=fmt(e.endTime);
  return end ? `${start} – ${end}` : (start || 'Time TBD');
}
function moneyLabel(e){
  if(e.costType!=='paid') return 'Free';
  const n=Number(e.fee||0);
  return n>0 ? `$${n.toFixed(2)} to play` : 'Pay to play';
}
function saveGameNight(event){
  event.preventDefault();
  const form=event.target;
  const fd=new FormData(form);
  const name=normalizeName(fd.get('eventName')||'');
  const locationName=normalizeName(fd.get('locationName')||'');
  const address=normalizeName(fd.get('address')||'');
  const date=String(fd.get('date')||'');
  const startTime=String(fd.get('startTime')||'');
  if(!name || !locationName || !date || !startTime){alert('Event name, location, date, and start time are required.');return;}
  const item={
    id: gameNightEditingId || crypto.randomUUID(),
    createdAt:new Date().toISOString(),
    eventName:name,
    host:normalizeName(fd.get('host')||''),
    locationName,
    address,
    date,
    startTime,
    endTime:String(fd.get('endTime')||''),
    visibility:String(fd.get('visibility')||'public'),
    costType:String(fd.get('costType')||'free'),
    fee:Math.max(0,Number(fd.get('fee')||0)),
    surface:String(fd.get('surface')||'Concrete'),
    gameStyle:String(fd.get('gameStyle')||'Casual / Open Play'),
    skillLevel:String(fd.get('skillLevel')||'All skill levels'),
    maxPlayers:Math.max(0,Number(fd.get('maxPlayers')||0)),
    boardCount:Math.max(0,Number(fd.get('boardCount')||0)),
    bagsProvided:fd.get('bagsProvided')==='on',
    notes:String(fd.get('notes')||'').trim()
  };
  const editing=gameNightEditingId;
  changeCloud(d=>{
    const nights=ensureGameNights(d);
    if(editing){
      const i=nights.findIndex(x=>x.id===editing);
      if(i<0) throw new Error('That Game Night no longer exists.');
      item.createdAt=nights[i].createdAt || item.createdAt;
      nights[i]=item;
    } else nights.push(item);
    nights.sort((a,b)=>gameNightDateTime(a)-gameNightDateTime(b));
  }).then(()=>{if(!errorMessage){gameNightEditingId=null;render();}});
}
function editGameNight(id){gameNightEditingId=id;state.activeTab='nights';render();window.scrollTo({top:0,behavior:'smooth'});}
function cancelGameNightEdit(){gameNightEditingId=null;render();}
function deleteGameNight(id){
  const e=(state.gameNights||[]).find(x=>x.id===id);
  if(!confirm(`Delete ${e?.eventName || 'this Game Night'}?`)) return;
  if(gameNightEditingId===id) gameNightEditingId=null;
  changeCloud(d=>{d.gameNights=ensureGameNights(d).filter(x=>x.id!==id)});
}

function addScore(side, amount){
  changeCloud(d => { const key=side==='A'?'scoreA':'scoreB'; d[key]=Math.max(0,d[key]+amount); });
}
function recordCountUp(points){
  changeCloud(d=>{
    const draft=countUpDraft(d);
    if(d.gameType!=='Count Up') throw new Error('The shared game mode changed.');
    if(!normalizeName(draft.player) || draft.player.includes(',')) throw new Error('Enter one player name before scoring.');
    if(draft.throws.length>=16) throw new Error('All 16 bags have been scored. Save this attempt or reset it.');
    draft.throws.push(points);
  });
}
function undoCountUp(){changeCloud(d=>{countUpDraft(d).throws.pop()});}
function resetCountUp(){if(confirm('Reset the current Count Up attempt for everyone?'))changeCloud(d=>{countUpDraft(d).throws=[]});}
function saveCountUp(){
  const draft=countUpDraft(state);
  const player=normalizeName(draft.player);
  if(!player || player.includes(',')){alert('Enter one player name for Count Up.');return;}
  if(draft.throws.length!==16){alert('Score all 16 bags before saving the attempt.');return;}
  if(!confirm(`Save ${player}'s Count Up attempt of ${draft.throws.reduce((a,b)=>a+b,0)}/48?`))return;
  changeCloud(d=>{
    const current=countUpDraft(d);
    if(current.throws.length!==16 || !normalizeName(current.player) || current.player.includes(',')) throw new Error('The shared Count Up attempt changed. Review it before saving.');
    const throws=current.throws.slice();
    d.countUpAttempts.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),player:normalizeName(current.player),throws,total:throws.reduce((a,b)=>a+b,0)});
    current.throws=[];
  });
}
function deleteCountUp(id){if(confirm('Delete this Count Up attempt for everyone?'))changeCloud(d=>{countUpDraft(d);d.countUpAttempts=d.countUpAttempts.filter(a=>a.id!==id)});}
function resetScore(){changeCloud(d=>{d.scoreA=0;d.scoreB=0});}
function swapTeams(){changeCloud(d=>{[d.teamA,d.teamB]=[d.teamB,d.teamA];[d.scoreA,d.scoreB]=[d.scoreB,d.scoreA]});}
async function openGameScorer(){
  scorerMode=true;scorerMenuOpen=false;scorerSetupOpen=!state.teamA||!state.teamB;render();
  try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen()}catch{}
  try{scorerWakeLock=await navigator.wakeLock?.request('screen')}catch{}
  try{await screen.orientation?.lock('landscape')}catch{}
}
async function closeGameScorer(){
  scorerMode=false;scorerSetupOpen=false;scorerMenuOpen=false;
  try{await scorerWakeLock?.release()}catch{} scorerWakeLock=null;
  try{screen.orientation?.unlock()}catch{}
  try{if(document.fullscreenElement)await document.exitFullscreen()}catch{}
  render();
}
function toggleScorerSetup(){scorerSetupOpen=!scorerSetupOpen;scorerMenuOpen=false;render();}
function toggleScorerMenu(){scorerMenuOpen=!scorerMenuOpen;render();}
function logWinner(winner){
  if(state.gameType==='Count Up'){alert('Use Save Attempt for Count Up.');return;}
  const a=parsePlayers(state.teamA), b=parsePlayers(state.teamB);
  const singles=state.gameType==='Singles';
  if(a.length!==(singles?1:2) || b.length!==(singles?1:2) || new Set([...a,...b].map(n=>n.toLowerCase())).size!==a.length+b.length){
    alert(singles?'Enter one distinct player for each side.':'Enter two distinct names per team, separated by commas.');return;
  }
  if(teamKey(state.teamA)===teamKey(state.teamB)){alert('Teams must be different.');return;}
  if(state.scoreA===state.scoreB && !confirm('Scores are tied. Log this match anyway?')) return;
  const winnerName=winner==='A'?displayTeam(state.teamA):displayTeam(state.teamB);
  changeCloud(d=>{
    const aa=parsePlayers(d.teamA),bb=parsePlayers(d.teamB),one=d.gameType==='Singles';
    if(aa.length!==(one?1:2)||bb.length!==(one?1:2)||new Set([...aa,...bb].map(n=>n.toLowerCase())).size!==aa.length+bb.length) throw new Error('The shared teams changed. Check the scoreboard and retry.');
    d.matches.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),teamA:displayTeam(d.teamA),teamB:displayTeam(d.teamB),gameType:d.gameType,winner,scoreA:d.scoreA,scoreB:d.scoreB});
    d.scoreA=0;d.scoreB=0;
  }).then(()=>{if(!errorMessage) alert(`Logged: ${winnerName} won.`)});
}
function deleteMatch(id){if(confirm('Delete this match for everyone?'))changeCloud(d=>{d.matches=d.matches.filter(m=>m.id!==id)});}
function clearAll(){if(confirm('Delete EVERY league match, Count Up attempt, and Game Night, and reset both shared scoreboards for everyone?'))changeCloud(d=>{d.matches=[];d.countUpAttempts=[];d.countUpDraft={player:'',throws:[]};d.gameNights=[];d.scoreA=0;d.scoreB=0;d.teamA='';d.teamB=''});}
function exportData(){
  const blob=new Blob([JSON.stringify({matches:state.matches,countUpAttempts:state.countUpAttempts||[],countUpDraft:countUpDraft(state),gameNights:state.gameNights||[],teamA:state.teamA,teamB:state.teamB,scoreA:state.scoreA,scoreB:state.scoreB,gameType:state.gameType,targetScore:state.targetScore},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dcl-team-tracker-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function importData(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(!Array.isArray(data.matches) || data.matches.some(m=>!(/^[a-z0-9-]{8,80}$/i.test(m.id))||!m.teamA||!m.teamB||!['A','B'].includes(m.winner)||!GAME_TYPES.includes(m.gameType)))throw new Error('Invalid match data.');
      const attempts=data.countUpAttempts||[];
      if(!Array.isArray(attempts) || attempts.some(a=>!(/^[a-z0-9-]{8,80}$/i.test(a.id))||!normalizeName(a.player)||!Array.isArray(a.throws)||a.throws.length!==16||a.throws.some(p=>![0,1,3].includes(p))||a.total!==a.throws.reduce((x,y)=>x+y,0))) throw new Error('Invalid Count Up data.');
      const nights=data.gameNights||[];
      if(!Array.isArray(nights) || nights.some(e=>!e.id||!normalizeName(e.eventName||'')||!normalizeName(e.locationName||'')||!e.date||!e.startTime)) throw new Error('Invalid Game Night data.');
      if(!confirm(`Replace ALL shared league history with ${data.matches.length} matches, ${attempts.length} Count Up attempts, and ${nights.length} Game Nights from this backup? Export the current league data first.`))return;
      changeCloud(d=>{d.matches=data.matches;d.countUpAttempts=attempts;d.countUpDraft={player:'',throws:[]};d.gameNights=nights;for(const field of CLOUD_FIELDS)if(data[field]!==undefined)d[field]=data[field]});
    }catch(e){alert('Could not import that backup: '+e.message)}
  };reader.readAsText(file);
}
function migrateDevice(){
  const legacy=loadState();
  if(!legacy.matches.length){alert('No previous matches found on this device.');return;}
  if(!confirm(`Add ${legacy.matches.length} old device matches to the shared league? Check for duplicates first.`))return;
  changeCloud(d=>{
    const ids=new Set(d.matches.map(m=>m.id));
    d.matches.push(...legacy.matches.filter(m=>!ids.has(m.id)));
    d.matches.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  });
}

function renderCountUp(){
  const draft=countUpDraft(state);
  const scored=draft.throws.length;
  const total=draft.throws.reduce((sum,p)=>sum+p,0);
  const trip=Math.min(4,Math.floor(scored/4)+1);
  const bag=scored%4+1;
  return `<div class="card col-12">
    <h2>Count Up · Solo Challenge</h2>
    <p class="small">Four bags from each side, back and forth for four trips. Each bag scores 0 (miss), 1 (board), or 3 (hole). Maximum: 48 points.</p>
    <label for="countUpPlayer">Player</label>
    <input id="countUpPlayer" placeholder="Player name" value="${esc(draft.player)}" ${scored?'disabled':''} />
    <div class="count-up-total"><span>${total}</span><small> / 48</small></div>
    <p class="small">${scored===16?'All 16 bags scored. Save this attempt.':`Trip ${trip} of 4 · ${trip%2?'Starting side':'Opposite side'} · Bag ${bag} of 4`}</p>
    <div class="count-up-trips">${[0,1,2,3].map(i=>`<div class="trip"><b>Trip ${i+1} · ${i%2?'Opposite':'Starting'} side</b><span>${[0,1,2,3].map(j=>{
      const p=draft.throws[i*4+j];return `<span class="bag ${p===undefined?'pending':''}">${p===undefined?'–':p}</span>`
    }).join('')}</span><strong>${draft.throws.slice(i*4,i*4+4).reduce((a,b)=>a+b,0)}/12</strong></div>`).join('')}</div>
    <div class="actions">
      <button onclick="recordCountUp(0)" ${scored===16||!draft.player?'disabled':''}>Miss · 0</button>
      <button onclick="recordCountUp(1)" ${scored===16||!draft.player?'disabled':''}>Board · 1</button>
      <button onclick="recordCountUp(3)" ${scored===16||!draft.player?'disabled':''}>Hole · 3</button>
      <button class="secondary" onclick="undoCountUp()" ${!scored?'disabled':''}>Undo bag</button>
    </div>
    <div class="actions"><button onclick="saveCountUp()" ${scored!==16?'disabled':''}>Save Attempt</button>
      <button class="ghost" onclick="resetCountUp()" ${!scored?'disabled':''}>Reset Attempt</button></div>
    <p class="small">This attempt is shared with other signed-in phones. Saving it adds to the player's Count Up record, not to match wins or losses.</p>
  </div>`;
}
function renderScore(){
  return `<div class="grid">
    <div class="col-12 installBox" id="installBox"><div class="notice"><b>Install this app:</b> tap the install button, or use your browser menu and choose <b>Add to Home Screen</b>.</div></div>
    <div class="card col-12"><label for="gameType"><b>Game mode</b></label>
      <select id="gameType">${GAME_TYPES.map(g=>`<option ${state.gameType===g?'selected':''}>${esc(g)}</option>`).join('')}</select></div>
    ${state.gameType==='Count Up'?renderCountUp():`<div class="card col-12">
      <h2>Game Scorer</h2>
      <p class="small">Open the dedicated court scoreboard. It fills the screen and keeps the score large enough to read from the other end of the boards.</p>
      <div class="row">
        <input id="teamA" placeholder="Team A: Chris, Aiden" value="${esc(state.teamA)}" />
        <input id="teamB" placeholder="Team B: Mike, John" value="${esc(state.teamB)}" />
      </div>
      <div class="row" style="margin-top:10px">
        <input id="targetScore" type="number" min="1" placeholder="Target score" value="${esc(state.targetScore)}" />
      </div>
      <div class="score-preview"><span>${esc(displayTeam(state.teamA)||'Team A')}</span><strong>${state.scoreA} – ${state.scoreB}</strong><span>${esc(displayTeam(state.teamB)||'Team B')}</span></div>
      <button class="scorer-launch" onclick="openGameScorer()">OPEN FULL-SCREEN GAME SCORER</button>
      <p class="small">Player names are pulled from the team name automatically. Example: <b>Chris, Aiden</b> counts wins/losses for Chris and Aiden as individuals.</p>
    </div>`}
  </div>`;
}

function renderImmersiveScorer(){
  const a=displayTeam(state.teamA)||'Team A', b=displayTeam(state.teamB)||'Team B';
  return `<section class="immersive-scorer" aria-label="Full-screen game scorer">
    <div class="immersive-top"><button class="secondary" onclick="closeGameScorer()">✕ Exit</button><div class="immersive-title">DCL · ${esc(state.gameType)} · Race to ${esc(state.targetScore)}</div><button class="ghost" onclick="toggleScorerSetup()">⚙ Teams</button></div>
    <div class="immersive-board">
      <article class="immersive-team"><div class="immersive-name">${esc(a)}</div><div class="immersive-score" onclick="addScore('A',1)" title="Tap to add one">${state.scoreA}</div><div class="immersive-controls"><button class="minus" onclick="addScore('A',-1)">−1</button><button onclick="addScore('A',1)">+1</button></div></article>
      <article class="immersive-team"><div class="immersive-name">${esc(b)}</div><div class="immersive-score" onclick="addScore('B',1)" title="Tap to add one">${state.scoreB}</div><div class="immersive-controls"><button class="minus" onclick="addScore('B',-1)">−1</button><button onclick="addScore('B',1)">+1</button></div></article>
    </div>
    <div class="immersive-bottom"><button onclick="logWinner('A')">Log ${esc(a)} Win</button><button class="secondary" onclick="resetScore()">Reset</button><button class="ghost" onclick="swapTeams()">Swap Sides</button><button onclick="logWinner('B')">Log ${esc(b)} Win</button></div>
    ${scorerSetupOpen?`<div class="scorer-setup"><div class="scorer-setup-card"><h2>Game Setup</h2><div class="row"><div><label for="teamA">Left team / players</label><input id="teamA" value="${esc(state.teamA)}" placeholder="Chris, Aiden"></div><div><label for="teamB">Right team / players</label><input id="teamB" value="${esc(state.teamB)}" placeholder="Mike, John"></div></div><div class="row" style="margin-top:10px"><div><label for="gameType">Game mode</label><select id="gameType">${GAME_TYPES.filter(g=>g!=='Count Up').map(g=>`<option ${state.gameType===g?'selected':''}>${esc(g)}</option>`).join('')}</select></div><div><label for="targetScore">Target score</label><input id="targetScore" type="number" min="1" value="${esc(state.targetScore)}"></div></div><div class="actions"><button onclick="toggleScorerSetup()">Done · Start Scoring</button><button class="secondary" onclick="swapTeams()">Swap Sides</button></div></div></div>`:''}
  </section>`;
}

function rankingTable(items, type){
  const q = state.search.trim().toLowerCase();
  const filtered = q ? items.filter(x => x.name.toLowerCase().includes(q)) : items;
  if(!filtered.length) return `<div class="empty">No ${type} stats yet.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>${type}</th><th class="right">GP</th><th class="right">W</th><th class="right">L</th><th class="right">WIN%</th><th class="right">PF</th><th class="right">PA</th><th class="right">+/-</th></tr></thead>
  <tbody>${filtered.map(x=>`<tr><td><b>${esc(x.name)}</b>${detailsFor(x)}</td><td class="right">${x.games}</td><td class="right">${x.wins}</td><td class="right">${x.losses}</td><td class="right">${x.winPct}%</td><td class="right">${x.pointsFor}</td><td class="right">${x.pointsAgainst}</td><td class="right">${x.pointDiff>0?'+':''}${x.pointDiff}</td></tr>`).join("")}</tbody></table></div>`;
}
function detailsFor(x){
  const types = Object.entries(x.byType || {});
  if(!types.length && !x.opponents) return "";
  const byType = types.map(([g,s])=>`<span class="pill orange">${esc(g)}: ${s.wins}-${s.losses}</span>`).join(" ");
  const opps = Object.values(x.opponents || {}).map(o=>`<span class="pill">${esc(o.name)}: ${o.wins}-${o.losses}</span>`).join(" ");
  return `<details><summary>Breakdown</summary><div class="statline">${byType || ""}${opps || ""}</div></details>`;
}
function renderStats(){
  const stats = computeStats();
  return `<div class="grid">
    <div class="card col-12">
      <h2>Rankings</h2>
      <p class="small">Teams are matched by player combination, not entry order — Chris, Dathan and Dathan, Chris count as the same team.</p>
      <input class="search" id="search" placeholder="Search teams or players..." value="${esc(state.search)}" />
      <div class="grid">
        <div class="col-6"><h2>Team Rankings</h2>${rankingTable(stats.teams,"Team")}</div>
        <div class="col-6"><h2>Individual Player Rankings</h2>${rankingTable(stats.players,"Player")}</div>
      </div>
    </div>
    <div class="card col-12"><h2>Count Up Rankings</h2>
      <p class="small">Ranked by personal best. Count Up does not change match win/loss records.</p>
      ${countUpStats().length?`<table class="table"><thead><tr><th>Player</th><th class="right">Best</th><th class="right">Attempts</th><th class="right">Average</th></tr></thead><tbody>${countUpStats().filter(p=>!state.search || p.name.toLowerCase().includes(state.search.trim().toLowerCase())).map(p=>`<tr><td><b>${esc(p.name)}</b></td><td class="right">${p.best}/48</td><td class="right">${p.attempts}</td><td class="right">${(p.total/p.attempts).toFixed(1)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No Count Up attempts yet.</div>'}
    </div>
  </div>`;
}
function renderHeadToHead(){
  const stats = computeStats();
  if(!stats.h2h.length) return `<div class="card"><h2>Head-to-Head</h2><div class="empty">No opponent records yet.</div></div>`;
  return `<div class="card"><h2>Head-to-Head Records</h2><div class="list">
    ${stats.h2h.map(h=>`<div class="item"><div class="itemTop"><b>${esc(h.aName)} vs ${esc(h.bName)}</b><span class="pill orange">${h.aWins + h.bWins} games</span></div>
    <div class="statline"><span class="pill green">${esc(h.aName)}: ${h.aWins}</span><span class="pill danger">${esc(h.bName)}: ${h.bWins}</span></div></div>`).join("")}
  </div></div>`;
}
function renderHistory(){
  const attempts=state.countUpAttempts||[];
  return `<div class="grid"><div class="card col-12"><h2>Match History</h2>${!state.matches.length?'<div class="empty">No matches logged yet.</div>':`<div class="list">
    ${state.matches.map(m=>{
      const winName = m.winner === "A" ? m.teamA : m.teamB;
      const score = `${m.scoreA ?? 0}-${m.scoreB ?? 0}`;
      return `<div class="item">
        <div class="itemTop"><b>${esc(m.teamA)} vs ${esc(m.teamB)}</b><span class="pill orange">${esc(m.gameType)}</span></div>
        <div class="statline"><span class="pill green">Winner: ${esc(winName)}</span><span class="pill">Score: ${esc(score)}</span><span class="pill">${new Date(m.date).toLocaleDateString()}</span></div>
        <button class="danger" onclick="deleteMatch('${m.id}')">Delete Match</button>
      </div>`;
    }).join("")}
  </div>`}</div>
  <div class="card col-12"><h2>Count Up Attempts</h2>${!attempts.length?'<div class="empty">No Count Up attempts yet.</div>':`<div class="list">${attempts.map(a=>`<div class="item"><div class="itemTop"><b>${esc(a.player)}</b><span class="pill orange">${a.total}/48</span></div><div class="statline"><span class="pill">Trips: ${[0,1,2,3].map(i=>a.throws.slice(i*4,i*4+4).reduce((x,y)=>x+y,0)).join(' · ')}</span><span class="pill">${new Date(a.date).toLocaleDateString()}</span></div><button class="danger" onclick="deleteCountUp('${a.id}')">Delete Attempt</button></div>`).join('')}</div>`}</div></div>`;
}
function renderGameNights(){
  const nights=(state.gameNights||[]).slice().sort((a,b)=>gameNightDateTime(a)-gameNightDateTime(b));
  const edit=gameNightEditingId ? nights.find(x=>x.id===gameNightEditingId) : null;
  const now=new Date();
  const upcoming=nights.filter(e=>gameNightDateTime(e).getTime() >= now.getTime()-6*60*60*1000);
  const past=nights.filter(e=>gameNightDateTime(e).getTime() < now.getTime()-6*60*60*1000).reverse();
  const opt=(value,current)=>current===value?'selected':'';
  const GAME_STYLES=['Casual / Open Play','League Night','Blind Draw','Switcholio','Round Robin','Double Elimination','Singles','Driveway Rules','Cut Throat','Chairhole','Count Up','Custom'];
  const SURFACES=['Concrete','Asphalt','Grass','Artificial Turf','Carpet','Indoor Hard Floor','Dirt / Gravel','Mixed','Other'];
  const SKILLS=['All skill levels','Beginner friendly','Intermediate','Competitive','Advanced / Pro'];
  const card=e=>`<div class="item event-card">
      <div class="event-title"><div><h3>${esc(e.eventName)}</h3><div class="small">${esc(formatEventDate(e))} · ${esc(formatEventTime(e))}</div></div><span class="pill ${e.visibility==='private'?'private':'orange'}">${e.visibility==='private'?'Private':'Public'}</span></div>
      <div class="event-meta"><span class="pill ${e.costType==='paid'?'orange':'free'}">${esc(moneyLabel(e))}</span><span class="pill">${esc(e.gameStyle||'Open Play')}</span><span class="pill">${esc(e.surface||'Surface TBD')}</span>${e.skillLevel?`<span class="pill">${esc(e.skillLevel)}</span>`:''}</div>
      <div class="event-detail">
        <div><small>Location</small><b>${esc(e.locationName)}</b>${e.address?`<div class="small">${esc(e.address)}</div>`:''}</div>
        <div><small>Host</small><b>${esc(e.host||'DCL host')}</b></div>
        <div><small>Players</small><b>${e.maxPlayers?`Up to ${e.maxPlayers}`:'Open'}</b></div>
        <div><small>Boards / Courts</small><b>${e.boardCount||'TBD'}</b></div>
        <div><small>Bags</small><b>${e.bagsProvided?'Provided':'Bring your own / TBD'}</b></div>
        <div><small>Access</small><b>${e.visibility==='private'?'Invite only':'Open to the public'}</b></div>
      </div>
      ${e.notes?`<div class="event-notes">${esc(e.notes)}</div>`:''}
      <div class="actions"><button onclick="editGameNight('${e.id}')">Edit</button><button class="danger" onclick="deleteGameNight('${e.id}')">Delete</button></div>
    </div>`;
  return `<div class="grid">
    <div class="card col-12" id="gameNightForm">
      <div class="event-section-title"><h2>${edit?'Edit Game Night':'Create a Game Night'}</h2>${edit?'<button class="ghost" onclick="cancelGameNightEdit()">Cancel Edit</button>':''}</div>
      <p class="small">Build a driveway night, league night, tournament, or casual open-play event. Public nights are meant for the public event feed; private nights are invite-only when the shared backend is enabled.</p>
      <form onsubmit="saveGameNight(event)">
        <div class="event-grid">
          <div class="event-field"><label>Event name *</label><input name="eventName" required placeholder="Friday Night Bags" value="${esc(edit?.eventName||'')}"></div>
          <div class="event-field"><label>Host / organizer</label><input name="host" placeholder="Chad / DCL" value="${esc(edit?.host||'')}"></div>
          <div class="event-field"><label>Location name *</label><input name="locationName" required placeholder="Chad's Driveway / The Garage / Venue" value="${esc(edit?.locationName||'')}"></div>
          <div class="event-field"><label>Address</label><input name="address" placeholder="Street, city, state" value="${esc(edit?.address||'')}"></div>
          <div class="event-field third"><label>Date *</label><input name="date" type="date" required value="${esc(edit?.date||'')}"></div>
          <div class="event-field third"><label>Start time *</label><input name="startTime" type="time" required value="${esc(edit?.startTime||'')}"></div>
          <div class="event-field third"><label>End time</label><input name="endTime" type="time" value="${esc(edit?.endTime||'')}"></div>
          <div class="event-field third"><label>Visibility</label><select name="visibility"><option value="public" ${opt('public',edit?.visibility||'public')}>Public</option><option value="private" ${opt('private',edit?.visibility)}>Private / Invite Only</option></select></div>
          <div class="event-field third"><label>Cost</label><select name="costType"><option value="free" ${opt('free',edit?.costType||'free')}>Free</option><option value="paid" ${opt('paid',edit?.costType)}>Pay to Play</option></select></div>
          <div class="event-field third"><label>Entry fee ($)</label><input name="fee" type="number" min="0" step="0.01" placeholder="0.00" value="${esc(edit?.fee||'')}"></div>
          <div class="event-field third"><label>Surface</label><select name="surface">${SURFACES.map(v=>`<option ${opt(v,edit?.surface||'Concrete')}>${esc(v)}</option>`).join('')}</select></div>
          <div class="event-field third"><label>Game style / format</label><select name="gameStyle">${GAME_STYLES.map(v=>`<option ${opt(v,edit?.gameStyle||'Casual / Open Play')}>${esc(v)}</option>`).join('')}</select></div>
          <div class="event-field third"><label>Skill level</label><select name="skillLevel">${SKILLS.map(v=>`<option ${opt(v,edit?.skillLevel||'All skill levels')}>${esc(v)}</option>`).join('')}</select></div>
          <div class="event-field third"><label>Max players (0 = open)</label><input name="maxPlayers" type="number" min="0" step="1" value="${esc(edit?.maxPlayers||0)}"></div>
          <div class="event-field third"><label>Boards / courts</label><input name="boardCount" type="number" min="0" step="1" value="${esc(edit?.boardCount||0)}"></div>
          <div class="event-field third"><label>Bags</label><label style="display:flex;align-items:center;gap:8px;background:#080808;border:1px solid var(--border);border-radius:14px;padding:12px"><input name="bagsProvided" type="checkbox" style="width:auto" ${edit?.bagsProvided?'checked':''}> Bags provided</label></div>
          <div class="event-field full"><label>Notes / details</label><textarea name="notes" placeholder="Parking, house rules, food/drinks, payout, what to bring, weather backup plan...">${esc(edit?.notes||'')}</textarea></div>
        </div>
        <div class="actions"><button type="submit">${edit?'Save Changes':'Create Game Night'}</button>${edit?'<button type="button" class="secondary" onclick="cancelGameNightEdit()">Cancel</button>':''}</div>
      </form>
    </div>
    <div class="card col-12"><div class="event-section-title"><h2>Upcoming Game Nights</h2><span class="pill orange">${upcoming.length} scheduled</span></div>${upcoming.length?`<div class="list">${upcoming.map(card).join('')}</div>`:'<div class="empty">No Game Nights scheduled yet. Create the first one above.</div>'}</div>
    ${past.length?`<div class="card col-12"><details><summary>Past Game Nights (${past.length})</summary><div class="list" style="margin-top:10px">${past.map(card).join('')}</div></details></div>`:''}
  </div>`;
}

function renderSettings(){
  return `<div class="grid">
    <div class="card col-12">
      <h2>Backup / Sharing</h2>
      <p class="small">All signed-in phones use one shared league. Matches, Count Up attempts, Game Nights, and the live scorer are included in the same data set. Export a backup before replacing or clearing records.</p>
      <div class="actions">
        <button onclick="exportData()">Export Backup</button>
        <label class="buttonLabel"><input style="display:none" type="file" accept="application/json" onchange="importData(this.files[0])" /><button class="secondary" onclick="this.previousElementSibling.click()">Import Backup</button></label>
        <button class="secondary" onclick="migrateDevice()">Add Old Device Matches</button>
        <button class="danger" onclick="clearAll()">Clear All League Data</button>
      </div>
    </div>
    <div class="card col-12">
      <h2>Demo mode</h2><p class="small">This copy saves only in this Chromebook browser. The shared version requires hosting and a database.</p>
    </div><div class="card col-12"><h2>How to Install on Phone</h2>
      <div class="notice">
        <b>iPhone:</b> Open the hosted app in Safari → Share button → Add to Home Screen.<br><br>
        <b>Android:</b> Open in Chrome → menu ⋮ → Install App or Add to Home Screen.
      </div>
    </div>
  </div>`;
}
function nav(){
  const tabs = [["score","Score"],["nights","Nights"],["stats","Stats"],["h2h","H2H"],["history","History"],["settings","Settings"]];
  return `<div class="tabs">${tabs.map(([id,label])=>`<button class="${state.activeTab===id?"active":""}" onclick="setTab('${id}')">${label}</button>`).join("")}</div>`;
}
function setTab(tab){ state.activeTab = tab; saveState(); render(); }
function render(){
  const app = document.getElementById("app");
  document.body.classList.toggle('scorer-open',scorerMode);
  if(!configured()) {app.innerHTML='<main class="app"><h1>DCL Team Tracker</h1><div class="card">Shared database setup is needed. Follow README.txt and fill in config.js.</div></main>';return;}
  if(!session){app.innerHTML=`<main class="app"><header class="header"><div class="brand"><div class="logo">DCL</div><h1>DCL Team Tracker</h1></div></header><div class="card"><h2>League sign in</h2><p class="small">Use the email and password your league organizer set up.</p>${errorMessage?`<p role="alert" class="notice">${esc(errorMessage)}</p>`:''}<form onsubmit="login(event)"><input name="email" type="email" autocomplete="username" placeholder="Email" required><input name="password" type="password" autocomplete="current-password" placeholder="Password" required><div class="actions"><button type="submit">Sign in</button></div></form></div></main>`;return;}
  if(!connected){app.innerHTML=`<main class="app"><h1>DCL Team Tracker</h1><div class="card">${errorMessage?esc(errorMessage):'Loading shared league…'} <button onclick="startCloud()">Retry</button><button class="secondary" onclick="logout()">Sign out</button></div></main>`;return;}
  const screen = state.activeTab === "score" ? renderScore()
    : state.activeTab === "nights" ? renderGameNights()
    : state.activeTab === "stats" ? renderStats()
    : state.activeTab === "h2h" ? renderHeadToHead()
    : state.activeTab === "history" ? renderHistory()
    : renderSettings();
  if(scorerMode){app.innerHTML=renderImmersiveScorer();bindInputs();return;}
  app.innerHTML = `<main class="app">
    <header class="header">
      <div class="brand"><div class="logo">DCL</div><div><h1>DCL Team Tracker</h1><div class="tag">Play Where You Live • Score • Track • Gather</div></div></div>
      <button id="installBtn" class="ghost hide-mobile" style="display:none">Install</button>
    </header>
    ${errorMessage?`<div class="notice" role="alert">Sync error: ${esc(errorMessage)}. Changes may not be current. <button onclick="syncCloud()">Retry</button></div>`:''}
    ${screen}
  </main>${nav()}`;
  bindInputs();
}
function bindInputs(){
  const ids = ["teamA","teamB","gameType","targetScore","search","countUpPlayer"];
  for(const id of ids){
    const el = document.getElementById(id);
    if(el) el.addEventListener(id==='search'?'input':'change', e => {
      const value=id==='targetScore'?Number(e.target.value||21):e.target.value;
      state[id]=value;
      if(id==='search')return;
      if(id==='countUpPlayer') {changeCloud(d=>{const draft=countUpDraft(d);if(draft.throws.length)throw new Error('Reset the attempt before changing players.');draft.player=normalizeName(value)});return;}
      changeCloud(d=>{d[id]=value});
    });
  }
  const installBtn = document.getElementById("installBtn");
  if(installBtn && deferredInstallPrompt){
    installBtn.style.display = "block";
    installBtn.onclick = async () => {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      render();
    };
  }
  const installBox = document.getElementById("installBox");
  if(installBox && deferredInstallPrompt) installBox.classList.add("show");
}
