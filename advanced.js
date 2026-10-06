// ===== DCL ADVANCED STATS / DCR PATCH =====
const MATCH_STAGES = ["Open Play","League","Round Robin","Bracket"];
const STAT_RANGES = [
  {id:"all",label:"All Time"},
  {id:"30",label:"30 Days"},
  {id:"90",label:"90 Days"},
  {id:"season",label:"This Season"}
];
function ensureAdvancedState(data){
  if(data.scoringMode!=='advanced' && data.scoringMode!=='quick') data.scoringMode='quick';
  if(!MATCH_STAGES.includes(data.matchStage)) data.matchStage=data.gameType==='League'?'League':'Open Play';
  if(data.activeGameNightId===undefined) data.activeGameNightId='';
  if(!data.advancedDraft || typeof data.advancedDraft!=='object') data.advancedDraft={rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};
  if(!Array.isArray(data.advancedDraft.rounds)) data.advancedDraft.rounds=[];
  if(!data.advancedDraft.current || typeof data.advancedDraft.current!=='object') data.advancedDraft.current={bagsA:[],bagsB:[],entryOrder:[]};
  for(const k of ['bagsA','bagsB','entryOrder']) if(!Array.isArray(data.advancedDraft.current[k])) data.advancedDraft.current[k]=[];
  return data.advancedDraft;
}
function ensureAdvancedLocal(){
  ensureAdvancedState(state);
  if(!MATCH_STAGES.includes(state.statStage) && state.statStage!=='Overall') state.statStage='Overall';
  if(!state.statStage) state.statStage='Overall';
  if(!['all','30','90','season'].includes(state.statRange)) state.statRange='all';
}
function currentStage(m){ return MATCH_STAGES.includes(m.matchStage) ? m.matchStage : (m.gameType==='League'?'League':'Open Play'); }
function currentEventName(id){ return (state.gameNights||[]).find(e=>e.id===id)?.eventName || ''; }
function matchInRange(m,range){
  if(range==='all') return true;
  const d=new Date(m.date); if(Number.isNaN(d.getTime())) return false;
  const now=new Date();
  if(range==='season') return d.getFullYear()===now.getFullYear();
  const days=Number(range); if(!days) return true;
  return d.getTime() >= now.getTime()-days*86400000;
}
function filteredMatches(stage=state.statStage,range=state.statRange){
  return (state.matches||[]).filter(m=>(!stage||stage==='Overall'||currentStage(m)===stage) && matchInRange(m,range||'all'));
}
function roundPlayers(data,roundIndex){
  const a=parsePlayers(data.teamA), b=parsePlayers(data.teamB);
  if(a.length===1 && b.length===1) return {playerA:a[0]||'Player A',playerB:b[0]||'Player B',end:1};
  const idx=roundIndex%2;
  return {playerA:a[idx]||a[0]||'Player A',playerB:b[idx]||b[0]||'Player B',end:idx+1};
}
function roundRaw(bags){ return (bags||[]).reduce((sum,v)=>sum+Number(v||0),0); }
function makeRound(data){
  const draft=ensureAdvancedState(data), cur=draft.current;
  const people=roundPlayers(data,draft.rounds.length);
  const bagsA=cur.bagsA.slice(0,4), bagsB=cur.bagsB.slice(0,4);
  const rawA=roundRaw(bagsA), rawB=roundRaw(bagsB);
  const netA=Math.max(0,rawA-rawB), netB=Math.max(0,rawB-rawA);
  return {round:draft.rounds.length+1,end:people.end,playerA:people.playerA,playerB:people.playerB,bagsA,bagsB,entryOrder:cur.entryOrder.slice(),rawA,rawB,netA,netB,runningA:Number(data.scoreA||0)+netA,runningB:Number(data.scoreB||0)+netB};
}
function recordAdvancedBag(side,points){
  if(!['A','B'].includes(side)||![0,1,3].includes(points)) return;
  changeCloud(d=>{
    ensureAdvancedState(d);
    if(d.scoringMode!=='advanced') throw new Error('Switch the scorer to Advanced mode first.');
    const a=parsePlayers(d.teamA),b=parsePlayers(d.teamB),one=d.gameType==='Singles';
    if(a.length!==(one?1:2)||b.length!==(one?1:2)) throw new Error(one?'Enter one player on each side.':'Enter two players on each team, separated by commas.');
    const cur=d.advancedDraft.current, key=side==='A'?'bagsA':'bagsB';
    if(cur[key].length>=4) return;
    cur[key].push(points); cur.entryOrder.push(side);
    if(cur.bagsA.length===4 && cur.bagsB.length===4){
      const round=makeRound(d);
      d.scoreA=round.runningA; d.scoreB=round.runningB;
      d.advancedDraft.rounds.push(round);
      d.advancedDraft.current={bagsA:[],bagsB:[],entryOrder:[]};
    }
  });
}
function undoAdvancedBag(){
  changeCloud(d=>{
    const draft=ensureAdvancedState(d),cur=draft.current;
    if(!cur.entryOrder.length && draft.rounds.length){
      const r=draft.rounds.pop();
      d.scoreA=Math.max(0,Number(d.scoreA||0)-Number(r.netA||0));
      d.scoreB=Math.max(0,Number(d.scoreB||0)-Number(r.netB||0));
      draft.current={bagsA:(r.bagsA||[]).slice(),bagsB:(r.bagsB||[]).slice(),entryOrder:(r.entryOrder||['A','B','A','B','A','B','A','B']).slice()};
    }
    const c=draft.current;
    const side=c.entryOrder.pop();
    if(side==='A') c.bagsA.pop(); else if(side==='B') c.bagsB.pop();
  });
}
function resetAdvancedGame(){
  if(!confirm('Reset this advanced game, including all bag-by-bag rounds?')) return;
  changeCloud(d=>{d.scoreA=0;d.scoreB=0;d.advancedDraft={rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};});
}
function advancedHasData(data=state){
  const draft=ensureAdvancedState(data);
  return draft.rounds.length || draft.current.bagsA.length || draft.current.bagsB.length;
}
function resetScore(){
  if(state.scoringMode==='advanced' && advancedHasData()) return resetAdvancedGame();
  changeCloud(d=>{d.scoreA=0;d.scoreB=0;ensureAdvancedState(d);d.advancedDraft={rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};});
}
function swapTeams(){
  if(state.scoringMode==='advanced' && advancedHasData() && !confirm('Swapping sides will reset the current advanced bag data. Continue?')) return;
  changeCloud(d=>{
    [d.teamA,d.teamB]=[d.teamB,d.teamA];[d.scoreA,d.scoreB]=[d.scoreB,d.scoreA];
    ensureAdvancedState(d);d.advancedDraft={rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};
  });
}
function playerRoundGameStats(m,player){
  const key=normalizeName(player).toLowerCase(); let raw=0,opp=0,rounds=0;
  for(const r of m.rounds||[]){
    if(normalizeName(r.playerA||'').toLowerCase()===key){raw+=Number(r.rawA||0);opp+=Number(r.rawB||0);rounds++;}
    else if(normalizeName(r.playerB||'').toLowerCase()===key){raw+=Number(r.rawB||0);opp+=Number(r.rawA||0);rounds++;}
  }
  return {raw,opp,rounds,ppr:rounds?raw/rounds:0,oppr:rounds?opp/rounds:0,dpr:rounds?(raw-opp)/rounds:0};
}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function computeDCR(matches){
  const ratings=new Map(); const names=new Map();
  const get=p=>ratings.get(normalizeName(p).toLowerCase())??1000;
  const set=(p,v)=>{const k=normalizeName(p).toLowerCase();ratings.set(k,v);names.set(k,normalizeName(p));};
  const sorted=matches.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  for(const m of sorted){
    const A=parsePlayers(m.teamA),B=parsePlayers(m.teamB); if(!A.length||!B.length) continue;
    const rA=A.reduce((s,p)=>s+get(p),0)/A.length, rB=B.reduce((s,p)=>s+get(p),0)/B.length;
    const expectedA=1/(1+Math.pow(10,(rB-rA)/400)), actualA=m.winner==='A'?1:0;
    const baseA=28*(actualA-expectedA), baseB=-baseA;
    for(const p of A){
      const perf=playerRoundGameStats(m,p); let delta=baseA + (perf.rounds?clamp(perf.dpr*1.5,-4,4):0);
      if(actualA===1) delta=Math.max(1,delta); else delta=Math.min(-1,delta); set(p,get(p)+delta);
    }
    for(const p of B){
      const perf=playerRoundGameStats(m,p); let delta=baseB + (perf.rounds?clamp(perf.dpr*1.5,-4,4):0);
      if(actualA===0) delta=Math.max(1,delta); else delta=Math.min(-1,delta); set(p,get(p)+delta);
    }
  }
  const out={}; for(const [k,v] of ratings) out[k]=Math.round(v); return out;
}
function advancedPlayerStats(stage=state.statStage,range=state.statRange){
  const matches=filteredMatches(stage,range), dcr=computeDCR(matches), players={};
  const init=name=>({name,wins:0,losses:0,pointsFor:0,pointsAgainst:0,rounds:0,bags:0,rawPoints:0,oppRawPoints:0,in:0,on:0,off:0,fourIn:0,roundWins:0,roundLosses:0,roundTies:0,highGamePPR:0,advancedGames:0,byType:{},byStage:{}});
  const get=p=>{const k=normalizeName(p).toLowerCase();if(!players[k])players[k]=init(normalizeName(p));return players[k];};
  for(const m of matches){
    const aWin=m.winner==='A',A=parsePlayers(m.teamA),B=parsePlayers(m.teamB),s=currentStage(m);
    for(const p of A){const x=get(p);x[aWin?'wins':'losses']++;x.pointsFor+=Number(m.scoreA||0);x.pointsAgainst+=Number(m.scoreB||0);x.byType[m.gameType]=x.byType[m.gameType]||{wins:0,losses:0};x.byType[m.gameType][aWin?'wins':'losses']++;x.byStage[s]=x.byStage[s]||{wins:0,losses:0};x.byStage[s][aWin?'wins':'losses']++;}
    for(const p of B){const x=get(p);x[aWin?'losses':'wins']++;x.pointsFor+=Number(m.scoreB||0);x.pointsAgainst+=Number(m.scoreA||0);x.byType[m.gameType]=x.byType[m.gameType]||{wins:0,losses:0};x.byType[m.gameType][aWin?'losses':'wins']++;x.byStage[s]=x.byStage[s]||{wins:0,losses:0};x.byStage[s][aWin?'losses':'wins']++;}
    const gameAgg={};
    for(const r of m.rounds||[]){
      const add=(p,bags,raw,oppRaw)=>{const x=get(p),k=normalizeName(p).toLowerCase();x.rounds++;x.bags+=bags.length;x.rawPoints+=raw;x.oppRawPoints+=oppRaw;x.in+=bags.filter(v=>v===3).length;x.on+=bags.filter(v=>v===1).length;x.off+=bags.filter(v=>v===0).length;if(bags.length===4&&bags.every(v=>v===3))x.fourIn++;if(raw>oppRaw)x.roundWins++;else if(raw<oppRaw)x.roundLosses++;else x.roundTies++;if(!gameAgg[k])gameAgg[k]={raw:0,rounds:0};gameAgg[k].raw+=raw;gameAgg[k].rounds++;};
      add(r.playerA||A[0]||'',r.bagsA||[],Number(r.rawA||0),Number(r.rawB||0)); add(r.playerB||B[0]||'',r.bagsB||[],Number(r.rawB||0),Number(r.rawA||0));
    }
    for(const [k,g] of Object.entries(gameAgg)){const x=players[k];if(x&&g.rounds){x.advancedGames++;x.highGamePPR=Math.max(x.highGamePPR,g.raw/g.rounds);}}
  }
  // Pressure +/- uses the selected date range but compares bracket vs round robin regardless of current stage tab.
  const pressure={};
  for(const m of (state.matches||[]).filter(m=>matchInRange(m,range))){
    const s=currentStage(m); if(s!=='Bracket'&&s!=='Round Robin')continue;
    for(const p of [...parsePlayers(m.teamA),...parsePlayers(m.teamB)]){const g=playerRoundGameStats(m,p);if(!g.rounds)continue;const k=normalizeName(p).toLowerCase();pressure[k]=pressure[k]||{Bracket:{raw:0,rounds:0},'Round Robin':{raw:0,rounds:0}};pressure[k][s].raw+=g.raw;pressure[k][s].rounds+=g.rounds;}
  }
  return Object.entries(players).map(([k,x])=>{
    const ppr=x.rounds?x.rawPoints/x.rounds:0,oppr=x.rounds?x.oppRawPoints/x.rounds:0,dpr=ppr-oppr;
    const pr=pressure[k]; const rr=pr&&pr['Round Robin'].rounds?pr['Round Robin'].raw/pr['Round Robin'].rounds:null; const br=pr&&pr.Bracket.rounds?pr.Bracket.raw/pr.Bracket.rounds:null;
    return {...x,games:x.wins+x.losses,winPct:(x.wins+x.losses)?x.wins/(x.wins+x.losses)*100:0,ppr,oppr,dpr,inPct:x.bags?x.in/x.bags*100:0,onPct:x.bags?x.on/x.bags*100:0,offPct:x.bags?x.off/x.bags*100:0,fourInPct:x.rounds?x.fourIn/x.rounds*100:0,pointDiff:x.pointsFor-x.pointsAgainst,dcr:dcr[k]||1000,pressure:(rr!==null&&br!==null)?br-rr:null,rrPpr:rr,bracketPpr:br};
  }).sort((a,b)=>b.dcr-a.dcr||b.ppr-a.ppr||b.winPct-a.winPct||a.name.localeCompare(b.name));
}
function computeStats(){
  const matches=filteredMatches(state.statStage||'Overall',state.statRange||'all');
  const teams={},players={},h2h={},gameTypes={};
  const init=name=>({name,wins:0,losses:0,pointsFor:0,pointsAgainst:0,byType:{},opponents:{}});
  for(const m of matches){
    const aKey=teamKey(m.teamA),bKey=teamKey(m.teamB),aWin=m.winner==='A',sa=Number(m.scoreA||0),sb=Number(m.scoreB||0);
    if(!teams[aKey])teams[aKey]=init(displayTeam(m.teamA));if(!teams[bKey])teams[bKey]=init(displayTeam(m.teamB));
    const apply=(x,win,pf,pa)=>{x[win?'wins':'losses']++;x.pointsFor+=pf;x.pointsAgainst+=pa;}; apply(teams[aKey],aWin,sa,sb);apply(teams[bKey],!aWin,sb,sa);
    teams[aKey].byType[m.gameType]=teams[aKey].byType[m.gameType]||{wins:0,losses:0};teams[bKey].byType[m.gameType]=teams[bKey].byType[m.gameType]||{wins:0,losses:0};teams[aKey].byType[m.gameType][aWin?'wins':'losses']++;teams[bKey].byType[m.gameType][aWin?'losses':'wins']++;
    teams[aKey].opponents[bKey]=teams[aKey].opponents[bKey]||{name:teams[bKey].name,wins:0,losses:0};teams[bKey].opponents[aKey]=teams[bKey].opponents[aKey]||{name:teams[aKey].name,wins:0,losses:0};teams[aKey].opponents[bKey][aWin?'wins':'losses']++;teams[bKey].opponents[aKey][aWin?'losses':'wins']++;
    for(const p of parsePlayers(m.teamA)){const k=p.toLowerCase();if(!players[k])players[k]=init(p);apply(players[k],aWin,sa,sb);}for(const p of parsePlayers(m.teamB)){const k=p.toLowerCase();if(!players[k])players[k]=init(p);apply(players[k],!aWin,sb,sa);}
    const pairKeys=[aKey,bKey].sort(),pair=pairKeys.join('::');if(!h2h[pair])h2h[pair]={aKey:pairKeys[0],bKey:pairKeys[1],aName:teams[pairKeys[0]].name,bName:teams[pairKeys[1]].name,aWins:0,bWins:0};const winnerKey=aWin?aKey:bKey;if(winnerKey===h2h[pair].aKey)h2h[pair].aWins++;else h2h[pair].bWins++;gameTypes[m.gameType]=(gameTypes[m.gameType]||0)+1;
  }
  const fin=x=>({...x,games:x.wins+x.losses,winPct:winPct(x.wins,x.losses),pointDiff:x.pointsFor-x.pointsAgainst});
  return {teams:Object.values(teams).map(fin).sort((a,b)=>b.winPct-a.winPct||(b.wins-b.losses)-(a.wins-a.losses)||a.name.localeCompare(b.name)),players:Object.values(players).map(fin).sort((a,b)=>b.winPct-a.winPct||b.wins-a.wins||a.name.localeCompare(b.name)),h2h:Object.values(h2h).sort((a,b)=>(b.aWins+b.bWins)-(a.aWins+a.bWins)),gameTypes};
}
function setStatStage(v){state.statStage=v;render();}
function setStatRange(v){state.statRange=v;render();}
function fmt(n,d=2){return Number.isFinite(n)?Number(n).toFixed(d):'—';}
function advancedDetails(x){
  const pressure=x.pressure===null?'Need RR + bracket data':`${x.pressure>=0?'+':''}${fmt(x.pressure)} PPR`;
  return `<details><summary>Advanced breakdown</summary><div class="player-expand">
    <div><small>Games / Record</small><b>${x.games} · ${x.wins}-${x.losses}</b></div><div><small>Rounds / Bags</small><b>${x.rounds} · ${x.bags}</b></div>
    <div><small>Raw Points</small><b>${x.rawPoints}</b></div><div><small>High Game PPR</small><b>${x.advancedGames?fmt(x.highGamePPR):'—'}</b></div>
    <div><small>IN / ON / OFF</small><b>${x.in} / ${x.on} / ${x.off}</b></div><div><small>Round W-L-T</small><b>${x.roundWins}-${x.roundLosses}-${x.roundTies}</b></div>
    <div><small>Pressure +/-</small><b class="${x.pressure===null?'':x.pressure>=0?'metric-positive':'metric-negative'}">${pressure}</b></div><div><small>RR / Bracket PPR</small><b>${x.rrPpr===null?'—':fmt(x.rrPpr)} / ${x.bracketPpr===null?'—':fmt(x.bracketPpr)}</b></div>
  </div><div class="statline">${Object.entries(x.byStage||{}).map(([k,v])=>`<span class="pill stage-badge">${esc(k)}: ${v.wins}-${v.losses}</span>`).join('')}</div></details>`;
}
function advancedRankingTable(items){
  const q=(state.search||'').trim().toLowerCase(),rows=q?items.filter(x=>x.name.toLowerCase().includes(q)):items;
  if(!rows.length)return '<div class="empty">No player stats in this view yet.</div>';
  return `<div class="table-wrap"><table class="table advanced-table"><thead><tr><th>Player</th><th class="right">DCR</th><th class="right">PPR</th><th class="right">DPR</th><th class="right">OPPR</th><th class="right">IN%</th><th class="right">ON%</th><th class="right">4IN%</th><th class="right">W-L</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.name)}</b>${advancedDetails(x)}</td><td class="right"><span class="dcr-badge">${x.dcr}</span></td><td class="right">${x.rounds?fmt(x.ppr):'—'}</td><td class="right ${x.rounds?(x.dpr>=0?'metric-positive':'metric-negative'):''}">${x.rounds?(x.dpr>=0?'+':'')+fmt(x.dpr):'—'}</td><td class="right">${x.rounds?fmt(x.oppr):'—'}</td><td class="right">${x.bags?fmt(x.inPct,1)+'%':'—'}</td><td class="right">${x.bags?fmt(x.onPct,1)+'%':'—'}</td><td class="right">${x.rounds?fmt(x.fourInPct,1)+'%':'—'}</td><td class="right">${x.wins}-${x.losses}</td></tr>`).join('')}</tbody></table></div>`;
}
function rankingTable(items,type){
  const q=(state.search||'').trim().toLowerCase(),filtered=q?items.filter(x=>x.name.toLowerCase().includes(q)):items;if(!filtered.length)return `<div class="empty">No ${type} stats yet.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>${type}</th><th class="right">GP</th><th class="right">W</th><th class="right">L</th><th class="right">WIN%</th><th class="right">PF</th><th class="right">PA</th><th class="right">+/-</th></tr></thead><tbody>${filtered.map(x=>`<tr><td><b>${esc(x.name)}</b>${detailsFor(x)}</td><td class="right">${x.games}</td><td class="right">${x.wins}</td><td class="right">${x.losses}</td><td class="right">${x.winPct}%</td><td class="right">${x.pointsFor}</td><td class="right">${x.pointsAgainst}</td><td class="right">${x.pointDiff>0?'+':''}${x.pointDiff}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderStats(){
  ensureAdvancedLocal(); const advanced=advancedPlayerStats(),stats=computeStats(),year=new Date().getFullYear();
  const stageButtons=['Overall',...MATCH_STAGES].map(v=>`<button class="${state.statStage===v?'active':''}" onclick="setStatStage('${v}')">${v}</button>`).join('');
  const rangeButtons=STAT_RANGES.map(v=>`<button class="${state.statRange===v.id?'active':''}" onclick="setStatRange('${v.id}')">${v.id==='season'?`Season ${year}`:v.label}</button>`).join('');
  return `<div class="grid"><div class="card col-12"><div class="stats-hero"><div><h2>Advanced Player Rankings</h2><p class="small">DCR starts at 1000 and moves with wins/losses, opponent strength, and a small advanced-performance adjustment from DPR.</p></div><div class="stats-legend"><span class="pill advanced-badge">Bag-tracked games = advanced stats</span><span class="pill">Quick games still count W/L</span></div></div>
    <div class="segmented">${stageButtons}</div><div class="segmented">${rangeButtons}</div><input class="search" id="search" placeholder="Search players or teams..." value="${esc(state.search||'')}">${advancedRankingTable(advanced)}</div>
    <div class="card col-12"><h2>Team Rankings</h2><p class="small">Team identity ignores player order, so Chris, Dathan and Dathan, Chris remain one team.</p>${rankingTable(stats.teams,'Team')}</div>
    <div class="card col-12"><h2>Count Up Rankings</h2><p class="small">Ranked by personal best. Count Up does not change match win/loss records.</p>${countUpStats().length?`<div class="table-wrap"><table class="table"><thead><tr><th>Player</th><th class="right">Best</th><th class="right">Attempts</th><th class="right">Average</th></tr></thead><tbody>${countUpStats().filter(p=>!state.search||p.name.toLowerCase().includes(state.search.trim().toLowerCase())).map(p=>`<tr><td><b>${esc(p.name)}</b></td><td class="right">${p.best}/48</td><td class="right">${p.attempts}</td><td class="right">${(p.total/p.attempts).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No Count Up attempts yet.</div>'}</div></div>`;
}
function gameNightOptions(){
  const nights=(state.gameNights||[]).slice().sort((a,b)=>gameNightDateTime(a)-gameNightDateTime(b));
  return `<option value="">No Game Night attached</option>${nights.map(e=>`<option value="${esc(e.id)}" ${state.activeGameNightId===e.id?'selected':''}>${esc(e.eventName)} · ${esc(formatEventDate(e))}</option>`).join('')}`;
}
function renderScore(){
  ensureAdvancedLocal();
  return `<div class="grid"><div class="col-12 installBox" id="installBox"><div class="notice"><b>Install this app:</b> tap the install button, or use your browser menu and choose <b>Add to Home Screen</b>.</div></div>
    <div class="card col-12"><label for="gameType"><b>Game mode</b></label><select id="gameType">${GAME_TYPES.map(g=>`<option ${state.gameType===g?'selected':''}>${esc(g)}</option>`).join('')}</select>
      ${state.gameType==='Count Up'?'':`<div class="mode-grid"><div><label>Scoring</label><select id="scoringMode"><option value="quick" ${state.scoringMode==='quick'?'selected':''}>Quick Score</option><option value="advanced" ${state.scoringMode==='advanced'?'selected':''}>Advanced · Bag by Bag</option></select></div><div><label>Match stage</label><select id="matchStage">${MATCH_STAGES.map(v=>`<option ${state.matchStage===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label>Game Night / Event</label><select id="activeGameNightId">${gameNightOptions()}</select></div></div>`}</div>
    ${state.gameType==='Count Up'?renderCountUp():`<div class="card col-12"><h2>${state.scoringMode==='advanced'?'Advanced Game Scorer':'Game Scorer'}</h2><p class="small">${state.scoringMode==='advanced'?'Score each bag as OFF (0), ON (1), or IN (3). The app calculates cancellation, PPR, DPR, OPPR, bag percentages, 4IN, and DCR data automatically.':'Use the large full-screen scoreboard for fast casual scoring. Quick games still count toward records and DCR, but do not create bag-level stats.'}</p>
      <div class="row"><input id="teamA" placeholder="Team A: Chris, Aiden" value="${esc(state.teamA)}"><input id="teamB" placeholder="Team B: Mike, John" value="${esc(state.teamB)}"></div><div class="row" style="margin-top:10px"><input id="targetScore" type="number" min="1" placeholder="Target score" value="${esc(state.targetScore)}"><div class="advanced-callout"><b>${esc(state.matchStage)}</b>${currentEventName(state.activeGameNightId)?` · ${esc(currentEventName(state.activeGameNightId))}`:''}<div class="advanced-badges"><span class="pill ${state.scoringMode==='advanced'?'advanced-badge':''}">${state.scoringMode==='advanced'?'Advanced stats ON':'Quick scoring'}</span>${state.scoringMode==='advanced'?`<span class="pill">${ensureAdvancedState(state).rounds.length} completed rounds</span>`:''}</div></div></div>
      <div class="score-preview"><span>${esc(displayTeam(state.teamA)||'Team A')}</span><strong>${state.scoreA} – ${state.scoreB}</strong><span>${esc(displayTeam(state.teamB)||'Team B')}</span></div><button class="scorer-launch" onclick="openGameScorer()">OPEN ${state.scoringMode==='advanced'?'ADVANCED ':''}FULL-SCREEN SCORER</button><p class="small">For doubles, enter players in throwing-end order: <b>End 1 player, End 2 player</b>. The advanced scorer alternates those player matchups by round automatically.</p></div>`}</div>`;
}
function renderScorerMenu(options={}){
  const roundLabel=options.roundLabel||'';
  const a=options.a||displayTeam(state.teamA)||'Team A';
  const b=options.b||displayTeam(state.teamB)||'Team B';
  const advanced=!!options.advanced;
  const canUndo=options.canUndo!==false;
  const handleText=roundLabel ? `${roundLabel} ${scorerMenuOpen?'⌃':'⌄'}` : (scorerMenuOpen?'⌃':'⌄');
  const actions=advanced
    ? `<div class="scorer-menu-actions"><button class="secondary" onclick="undoAdvancedBag()" ${canUndo?'':'disabled'}>↶ Undo</button><button onclick="logWinner('A')">✓ ${esc(a)}</button><button class="secondary" onclick="resetAdvancedGame()">Reset</button><button class="ghost" onclick="swapTeams()">Swap</button><button onclick="logWinner('B')">✓ ${esc(b)}</button></div>`
    : `<div class="scorer-menu-actions quick"><button onclick="logWinner('A')">✓ ${esc(a)}</button><button class="secondary" onclick="resetScore()">Reset</button><button class="ghost" onclick="swapTeams()">Swap</button><button onclick="logWinner('B')">✓ ${esc(b)}</button></div>`;
  return `<button class="scorer-menu-handle" onclick="toggleScorerMenu()" aria-label="${scorerMenuOpen?'Hide':'Show'} scorer menu">${handleText}</button><div class="scorer-menu ${scorerMenuOpen?'open':''}"><div class="scorer-menu-row"><button class="secondary" onclick="closeGameScorer()">✕ Exit</button><div class="scorer-menu-info">DCL · ${esc(state.matchStage)} · ${esc(state.gameType)} · Race to ${esc(state.targetScore)}</div><button class="ghost" onclick="toggleScorerSetup()">⚙ Setup</button></div>${actions}</div>`;
}
function renderAdvancedScorer(){
  ensureAdvancedLocal(); const draft=ensureAdvancedState(state),cur=draft.current,people=roundPlayers(state,draft.rounds.length),a=displayTeam(state.teamA)||'Team A',b=displayTeam(state.teamB)||'Team B';
  const bags=(arr)=>[0,1,2,3].map(i=>`<span class="bag ${arr[i]===undefined?'pending':''}">${arr[i]===undefined?'–':arr[i]}</span>`).join('');
  const side=(which,team,player,arr,score)=>`<article class="adv-side"><div class="adv-side-head"><div class="adv-team-name">${esc(team)}</div><div class="adv-player-name">${esc(player)}</div></div><div class="adv-big-score">${score}</div><div class="adv-bag-panel"><div class="adv-bags">${bags(arr)}</div><div class="adv-raw">Round raw: ${roundRaw(arr)}/12</div><div class="adv-bag-buttons"><button onclick="recordAdvancedBag('${which}',0)" ${arr.length>=4?'disabled':''}>OFF · 0</button><button onclick="recordAdvancedBag('${which}',1)" ${arr.length>=4?'disabled':''}>ON · 1</button><button onclick="recordAdvancedBag('${which}',3)" ${arr.length>=4?'disabled':''}>IN · 3</button></div></div></article>`;
  const recent=draft.rounds.slice(-6).reverse().map(r=>`<span class="round-chip">R${r.round}: ${esc(r.playerA)} ${r.rawA}–${r.rawB} ${esc(r.playerB)} · +${r.netA||0}/+${r.netB||0}</span>`).join('')||'<span class="round-chip">No completed rounds yet</span>';
  return `<section class="immersive-scorer" aria-label="Advanced full-screen game scorer">${renderScorerMenu({advanced:true,roundLabel:`R${draft.rounds.length+1} · E${people.end}`,a,b,canUndo:!!(cur.entryOrder.length||draft.rounds.length)})}<div class="adv-body"><div class="adv-scoreboard">${side('A',a,people.playerA,cur.bagsA,state.scoreA)}${side('B',b,people.playerB,cur.bagsB,state.scoreB)}</div><div class="adv-round-panel"><div class="adv-round-title">Round ${draft.rounds.length+1} · End ${people.end}</div><div class="adv-round-history">${recent}</div><button class="adv-undo" onclick="undoAdvancedBag()" ${(!cur.entryOrder.length&&!draft.rounds.length)?'disabled':''}>↶ UNDO BAG</button></div></div><div class="immersive-bottom"><button onclick="logWinner('A')">Log ${esc(a)} Win</button><button class="secondary" onclick="resetAdvancedGame()">Reset Game</button><button class="ghost" onclick="swapTeams()">Swap Sides</button><button onclick="logWinner('B')">Log ${esc(b)} Win</button></div>${scorerSetupOpen?renderScorerSetup():''}</section>`;
}
function renderScorerSetup(){
  return `<div class="scorer-setup"><div class="scorer-setup-card"><h2>Game Setup</h2><div class="row"><div><label for="teamA">Left team / players</label><input id="teamA" value="${esc(state.teamA)}" placeholder="Chris, Aiden"></div><div><label for="teamB">Right team / players</label><input id="teamB" value="${esc(state.teamB)}" placeholder="Mike, John"></div></div><div class="mode-grid"><div><label>Game mode</label><select id="gameType">${GAME_TYPES.filter(g=>g!=='Count Up').map(g=>`<option ${state.gameType===g?'selected':''}>${esc(g)}</option>`).join('')}</select></div><div><label>Scoring</label><select id="scoringMode"><option value="quick" ${state.scoringMode==='quick'?'selected':''}>Quick Score</option><option value="advanced" ${state.scoringMode==='advanced'?'selected':''}>Advanced</option></select></div><div><label>Stage</label><select id="matchStage">${MATCH_STAGES.map(v=>`<option ${state.matchStage===v?'selected':''}>${v}</option>`).join('')}</select></div></div><div class="row" style="margin-top:10px"><div><label for="targetScore">Target score</label><input id="targetScore" type="number" min="1" value="${esc(state.targetScore)}"></div><div><label>Game Night / Event</label><select id="activeGameNightId">${gameNightOptions()}</select></div></div><div class="actions"><button onclick="toggleScorerSetup()">Done · Start Scoring</button><button class="secondary" onclick="swapTeams()">Swap Sides</button></div></div></div>`;
}
function renderImmersiveScorer(){
  ensureAdvancedLocal(); if(state.scoringMode==='advanced') return renderAdvancedScorer();
  const a=displayTeam(state.teamA)||'Team A',b=displayTeam(state.teamB)||'Team B';
  return `<section class="immersive-scorer" aria-label="Full-screen game scorer">${renderScorerMenu({a,b})}<div class="immersive-board"><article class="immersive-team"><div class="immersive-name">${esc(a)}</div><div class="immersive-score" onclick="addScore('A',1)">${state.scoreA}</div><div class="immersive-controls"><button class="minus" onclick="addScore('A',-1)">−1</button><button onclick="addScore('A',1)">+1</button></div></article><article class="immersive-team"><div class="immersive-name">${esc(b)}</div><div class="immersive-score" onclick="addScore('B',1)">${state.scoreB}</div><div class="immersive-controls"><button class="minus" onclick="addScore('B',-1)">−1</button><button onclick="addScore('B',1)">+1</button></div></article></div><div class="immersive-bottom"><button onclick="logWinner('A')">Log ${esc(a)} Win</button><button class="secondary" onclick="resetScore()">Reset</button><button class="ghost" onclick="swapTeams()">Swap Sides</button><button onclick="logWinner('B')">Log ${esc(b)} Win</button></div>${scorerSetupOpen?renderScorerSetup():''}</section>`;
}
function logWinner(winner){
  ensureAdvancedLocal(); if(state.gameType==='Count Up'){alert('Use Save Attempt for Count Up.');return;}
  const a=parsePlayers(state.teamA),b=parsePlayers(state.teamB),singles=state.gameType==='Singles';
  if(a.length!==(singles?1:2)||b.length!==(singles?1:2)||new Set([...a,...b].map(n=>n.toLowerCase())).size!==a.length+b.length){alert(singles?'Enter one distinct player for each side.':'Enter two distinct names per team, separated by commas.');return;}
  if(teamKey(state.teamA)===teamKey(state.teamB)){alert('Teams must be different.');return;}
  if(state.scoringMode==='advanced'){
    const cur=ensureAdvancedState(state).current;if(cur.bagsA.length||cur.bagsB.length){alert('Finish the current round or undo the partial bags before logging the winner.');return;}
    if(!ensureAdvancedState(state).rounds.length && !confirm('No advanced rounds have been scored. Log this result without bag stats?'))return;
  }
  if(state.scoreA===state.scoreB&&!confirm('Scores are tied. Log this match anyway?'))return;
  const winnerName=winner==='A'?displayTeam(state.teamA):displayTeam(state.teamB);
  changeCloud(d=>{
    ensureAdvancedState(d);const aa=parsePlayers(d.teamA),bb=parsePlayers(d.teamB),one=d.gameType==='Singles';if(aa.length!==(one?1:2)||bb.length!==(one?1:2))throw new Error('The teams changed. Review the scoreboard and retry.');
    const event=(d.gameNights||[]).find(e=>e.id===d.activeGameNightId);
    const match={id:crypto.randomUUID(),date:new Date().toISOString(),teamA:displayTeam(d.teamA),teamB:displayTeam(d.teamB),gameType:d.gameType,matchStage:MATCH_STAGES.includes(d.matchStage)?d.matchStage:'Open Play',scoringMode:d.scoringMode==='advanced'?'advanced':'quick',gameNightId:d.activeGameNightId||'',eventName:event?.eventName||'',surface:event?.surface||'',winner,scoreA:d.scoreA,scoreB:d.scoreB};
    if(d.scoringMode==='advanced') match.rounds=d.advancedDraft.rounds.map(r=>structuredClone(r));
    d.matches.unshift(match);d.scoreA=0;d.scoreB=0;d.advancedDraft={rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};
  }).then(()=>{if(!errorMessage)alert(`Logged: ${winnerName} won.${state.scoringMode==='advanced'?' Advanced stats saved.':''}`)});
}
function renderHistory(){
  const attempts=state.countUpAttempts||[];
  return `<div class="grid"><div class="card col-12"><h2>Match History</h2>${!state.matches.length?'<div class="empty">No matches logged yet.</div>':`<div class="list">${state.matches.map(m=>{const winName=m.winner==='A'?m.teamA:m.teamB,score=`${m.scoreA??0}-${m.scoreB??0}`,rounds=(m.rounds||[]).length;return `<div class="item"><div class="itemTop"><b>${esc(m.teamA)} vs ${esc(m.teamB)}</b><span class="pill orange">${esc(m.gameType)}</span></div><div class="statline"><span class="pill green">Winner: ${esc(winName)}</span><span class="pill">Score: ${esc(score)}</span><span class="pill stage-badge">${esc(currentStage(m))}</span>${m.scoringMode==='advanced'?`<span class="pill advanced-badge">Advanced · ${rounds} rounds</span>`:''}${m.eventName?`<span class="pill">${esc(m.eventName)}</span>`:''}<span class="pill">${new Date(m.date).toLocaleDateString()}</span></div><button class="danger" onclick="deleteMatch('${m.id}')">Delete Match</button></div>`}).join('')}</div>`}</div><div class="card col-12"><h2>Count Up Attempts</h2>${!attempts.length?'<div class="empty">No Count Up attempts yet.</div>':`<div class="list">${attempts.map(a=>`<div class="item"><div class="itemTop"><b>${esc(a.player)}</b><span class="pill orange">${a.total}/48</span></div><div class="statline"><span class="pill">Trips: ${[0,1,2,3].map(i=>a.throws.slice(i*4,i*4+4).reduce((x,y)=>x+y,0)).join(' · ')}</span><span class="pill">${new Date(a.date).toLocaleDateString()}</span></div><button class="danger" onclick="deleteCountUp('${a.id}')">Delete Attempt</button></div>`).join('')}</div>`}</div></div>`;
}
function exportData(){
  ensureAdvancedLocal(); const blob=new Blob([JSON.stringify({matches:state.matches,countUpAttempts:state.countUpAttempts||[],countUpDraft:countUpDraft(state),gameNights:state.gameNights||[],teamA:state.teamA,teamB:state.teamB,scoreA:state.scoreA,scoreB:state.scoreB,gameType:state.gameType,targetScore:state.targetScore,scoringMode:state.scoringMode,matchStage:state.matchStage,activeGameNightId:state.activeGameNightId,advancedDraft:ensureAdvancedState(state)},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dcl-team-tracker-advanced-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function validAdvancedRounds(rounds){return !rounds||Array.isArray(rounds)&&rounds.every(r=>Array.isArray(r.bagsA)&&Array.isArray(r.bagsB)&&r.bagsA.length===4&&r.bagsB.length===4&&[...r.bagsA,...r.bagsB].every(v=>[0,1,3].includes(v)));}
function importData(file){
  if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(!Array.isArray(data.matches)||data.matches.some(m=>!m.id||!m.teamA||!m.teamB||!['A','B'].includes(m.winner)||!GAME_TYPES.includes(m.gameType)||!validAdvancedRounds(m.rounds)))throw new Error('Invalid match data.');const attempts=data.countUpAttempts||[];if(!Array.isArray(attempts)||attempts.some(a=>!a.id||!normalizeName(a.player)||!Array.isArray(a.throws)||a.throws.length!==16||a.throws.some(p=>![0,1,3].includes(p))))throw new Error('Invalid Count Up data.');const nights=data.gameNights||[];if(!Array.isArray(nights)||nights.some(e=>!e.id||!normalizeName(e.eventName||'')||!normalizeName(e.locationName||'')||!e.date||!e.startTime))throw new Error('Invalid Game Night data.');if(!confirm(`Replace ALL data with ${data.matches.length} matches, ${attempts.length} Count Up attempts, and ${nights.length} Game Nights? Export the current data first.`))return;changeCloud(d=>{d.matches=data.matches;d.countUpAttempts=attempts;d.countUpDraft={player:'',throws:[]};d.gameNights=nights;for(const f of ['teamA','teamB','scoreA','scoreB','gameType','targetScore','scoringMode','matchStage','activeGameNightId'])if(data[f]!==undefined)d[f]=data[f];d.advancedDraft=data.advancedDraft||{rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};ensureAdvancedState(d);});}catch(e){alert('Could not import that backup: '+e.message)}};reader.readAsText(file);
}
function clearAll(){if(confirm('Delete EVERY league match, Count Up attempt, Game Night, and advanced-stat round?'))changeCloud(d=>{d.matches=[];d.countUpAttempts=[];d.countUpDraft={player:'',throws:[]};d.gameNights=[];d.scoreA=0;d.scoreB=0;d.teamA='';d.teamB='';d.advancedDraft={rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};d.activeGameNightId='';});}
function bindInputs(){
  ensureAdvancedLocal(); const ids=['teamA','teamB','gameType','targetScore','search','countUpPlayer','scoringMode','matchStage','activeGameNightId'];
  for(const id of ids){const el=document.getElementById(id);if(!el)continue;el.addEventListener(id==='search'?'input':'change',e=>{let value=id==='targetScore'?Number(e.target.value||21):e.target.value;if(id==='search'){state.search=value;const caret=e.target.selectionStart??value.length;setTimeout(()=>{render();const s=document.getElementById('search');if(s){s.focus();try{s.setSelectionRange(caret,caret)}catch{}}},0);return;}if(id==='countUpPlayer'){state[id]=value;changeCloud(d=>{const draft=countUpDraft(d);if(draft.throws.length)throw new Error('Reset the attempt before changing players.');draft.player=normalizeName(value)});return;}const sensitive=['teamA','teamB','gameType','scoringMode'].includes(id);if(sensitive&&advancedHasData()&&value!==state[id]&&!confirm('Changing teams, game mode, or scoring mode will reset the current advanced bag data and score. Continue?')){e.target.value=state[id];return;}state[id]=value;changeCloud(d=>{ensureAdvancedState(d);if(sensitive&&value!==d[id]){d.advancedDraft={rounds:[],current:{bagsA:[],bagsB:[],entryOrder:[]}};d.scoreA=0;d.scoreB=0;}d[id]=value;});});}
  const installBtn=document.getElementById('installBtn');if(installBtn&&deferredInstallPrompt){installBtn.style.display='block';installBtn.onclick=async()=>{deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;render();};}const installBox=document.getElementById('installBox');if(installBox&&deferredInstallPrompt)installBox.classList.add('show');
}



function syncDclVisibleViewport(){
  const vv = window.visualViewport;
  const h = Math.max(180, Math.floor(vv ? vv.height : window.innerHeight));
  document.documentElement.style.setProperty('--dcl-vvh', h + 'px');
}
syncDclVisibleViewport();
window.addEventListener('resize', syncDclVisibleViewport);
window.addEventListener('orientationchange', () => {
  syncDclVisibleViewport();
  setTimeout(syncDclVisibleViewport, 80);
  setTimeout(syncDclVisibleViewport, 300);
});
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', syncDclVisibleViewport);
  window.visualViewport.addEventListener('scroll', syncDclVisibleViewport);
}
document.addEventListener('fullscreenchange', () => {
  syncDclVisibleViewport();
  setTimeout(syncDclVisibleViewport, 100);
});

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  render();
});

render();
startCloud();
setInterval(syncCloud,4000);
window.addEventListener('focus',syncCloud);
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&scorerMode){/* Keep the immersive layout even if browser full-screen is unavailable or dismissed. */}});