'use strict';
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const crypto=require('crypto');
const path=require('path');
const app=express();
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:false},pingTimeout:20000});
const rooms=new Map();
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PHASE_MS={role:6500,action:40000,investigate:20000,vote:15000,results:6500,final:0};
const MAX_ROUNDS=3;
function code(){let s;do{s=Array.from({length:6},()=>CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('')}while(rooms.has(s));return s}
function roomOf(socket){return rooms.get(socket.data.code)}
function cleanName(n){return String(n||'').replace(/[<>\x00-\x1f]/g,'').trim().slice(0,18)||'Operator'}
function randomId(){return crypto.randomBytes(18).toString('base64url')}
function puzzle(){
 const type=crypto.randomInt(3);
 if(type===0){const a=crypto.randomInt(1,5),d=crypto.randomInt(1,5),b=crypto.randomInt(1,9),c=crypto.randomInt(1,9);return {type:'code',title:'AUTHENTICATION BYPASS',description:'Decode the access sequence from the encrypted clues.',clues:[`First digit: ${a}.`,`Last digit: ${d}.`,`The second digit is ${b}.`,`The last two digits total ${c+d}.`],question:`Enter a possible four-digit code.`,answer:`${a}${b}${c}${d}`}}
 if(type===1){const seq=Array.from({length:4},()=>crypto.randomInt(1,5));return {type:'pattern',title:'SIGNAL MEMORY',description:'Remember the four signals. A signal sequence is shown below.',sequence:seq,answer:seq.join(''),question:'Repeat the sequence by pressing the numbered keys in order.'}}
 const a=crypto.randomInt(2,8),step=crypto.randomInt(2,6);return {type:'logic',title:'FREQUENCY RECOVERY',description:'Recover the next reading in an arithmetic frequency sequence.',sequence:[a,a+step,a+step*2,a+step*3],question:'Enter the next frequency value.',answer:String(a+step*4)}
}
function active(r){return r.players.filter(p=>!p.quarantined)}
function snapshot(r,p){return {code:r.code,phase:r.phase,deadline:r.deadline,round:r.round,totalRounds:MAX_ROUNDS,integrity:r.integrity,nodes:r.nodes,mode:r.mode,hostId:r.hostId,meId:p.id,role:r.phase==='lobby'?'pending':p.role,quarantined:p.quarantined,players:r.players.map(x=>({id:x.id,name:x.name,connected:x.connected,quarantined:x.quarantined,score:x.score,ready:x.ready,host:x.id===r.hostId,...(r.phase==='final'?{role:x.role}:{})})),puzzle:r.phase==='action'&&r.current?{...r.current,answer:undefined}:null,submitted:!!r.actions[p.id],voted:!!r.votes[p.id],evidence:r.evidence,roundResult:r.roundResult,winner:r.winner,log:r.log.slice(-6),voteCandidates:active(r).filter(x=>x.id!==p.id).map(x=>({id:x.id,name:x.name})),canStart:r.phase==='lobby'&&r.players.length>=2}}
function broadcast(r){for(const p of r.players){if(p.socketId)io.to(p.socketId).emit('state',snapshot(r,p))}}
function note(r,s){r.log.push(s);if(r.log.length>20)r.log.shift()}
function schedule(r,phase,ms){clearTimeout(r.timer);r.phase=phase;r.deadline=ms?Date.now()+ms:null;broadcast(r);if(ms)r.timer=setTimeout(()=>advance(r),ms)}
function nextRound(r){r.round++;r.current=puzzle();r.actions={};r.votes={};r.evidence=[];r.roundResult=null;schedule(r,'action',PHASE_MS.action);note(r,`Operation ${r.round} initiated`);broadcast(r)}
function startGame(r){r.mode=r.players.length>=4?'infiltration':'cooperative';r.round=0;r.integrity=70;r.nodes=0;r.winner=null;r.evidence=[];r.roundResult=null;r.log=[];r.players.forEach(p=>{p.quarantined=false;p.score=0;p.role='operative';p.ready=false});if(r.mode==='infiltration'){const count=r.players.length>=7?2:1;const shuffled=[...r.players].sort(()=>crypto.randomInt(3)-1);for(let i=0;i<count;i++)shuffled[i].role='infiltrator'}note(r,`Protocol initiated: ${r.mode}.`);schedule(r,'role',PHASE_MS.role)}
function resolveAction(r){const participants=active(r);const actions=participants.map(p=>({...r.actions[p.id],player:p})).filter(a=>a.action);const correct=actions.filter(a=>a.correct).length;const repaired=actions.some(a=>a.action==='repair'&&a.correct);const needed=Math.ceil(participants.length/2);const success=correct>=needed&&repaired;const sabotages=actions.filter(a=>a.action==='sabotage'&&a.player.role==='infiltrator').length;
 if(success)r.nodes++;r.integrity=Math.max(0,Math.min(100,r.integrity+(success?12:-10)-Math.min(1,sabotages)*15));
 for(const a of actions){if(a.correct)a.player.score+=100;if(a.action==='repair'&&success)a.player.score+=40;if(a.action==='sabotage'&&sabotages)a.player.score+=60}
 r.evidence=[`${correct} of ${participants.length} active operators decoded the challenge.`,`${actions.filter(a=>a.action==='repair').length} repair command(s) submitted.`,`${sabotages?'Unauthorized system changes detected.':'No confirmed unauthorized command detected.'}`];
 if(sabotages){const attacker=actions.find(a=>a.action==='sabotage');if(attacker){r.evidence.push(`Suspicious access traced to an operator terminal; identity masked by the network.`)}}
 r.roundResult={success,correct,required:needed,sabotages,delta:(success?12:-10)-Math.min(1,sabotages)*15,accused:null};note(r,`Operation ${r.round}: ${success?'node repaired':'repair failed'}. Integrity ${r.integrity}%.`);
 if(r.integrity===0){finish(r);return}schedule(r,'investigate',PHASE_MS.investigate)
}
function resolveVotes(r){const counts={};for(const id of Object.values(r.votes)){if(id!=='skip')counts[id]=(counts[id]||0)+1}const ordered=Object.entries(counts).sort((a,b)=>b[1]-a[1]);const top=ordered[0];let result='No operator quarantined.';
 if(top&&(!ordered[1]||top[1]>ordered[1][1])&&top[1]>=Math.floor(active(r).length/2)+1){const p=r.players.find(p=>p.id===top[0]);if(p&&!p.quarantined){p.quarantined=true;result=`${p.name} was quarantined (${p.role==='infiltrator'?'INFILTRATOR':'OPERATIVE'}).`;if(p.role!=='infiltrator')r.integrity=Math.max(0,r.integrity-10)}}
 r.roundResult.accused=result;note(r,result);if(r.integrity===0){finish(r);return}schedule(r,'results',PHASE_MS.results)
}
function finish(r){const operatives=r.nodes>=2&&r.integrity>0;r.winner=operatives?'operatives':r.mode==='cooperative'?'network':'infiltrators';note(r,operatives?'Network restored. Operatives prevail.':'Network blackout. Mission failed.');schedule(r,'final',0)}
function advance(r){if(!rooms.has(r.code))return;
 if(r.phase==='role'){nextRound(r);return}
 if(r.phase==='action'){resolveAction(r);return}
 if(r.phase==='investigate'){if(r.mode==='infiltration'){schedule(r,'vote',PHASE_MS.vote)}else{r.roundResult.accused='Cooperative protocol: no accusation phase.';schedule(r,'results',PHASE_MS.results)}return}
 if(r.phase==='vote'){resolveVotes(r);return}
 if(r.phase==='results'){if(r.round>=MAX_ROUNDS)finish(r);else nextRound(r)}
}
function attach(socket,r,p){if(p.socketId&&p.socketId!==socket.id)io.to(p.socketId).emit('session_replaced');p.socketId=socket.id;p.connected=true;socket.data.code=r.code;socket.data.pid=p.id;socket.join(r.code);broadcast(r)}
function ackFail(cb,msg){cb?.({ok:false,error:msg})}
io.on('connection',socket=>{
 socket.on('create',({name}={},cb)=>{if(typeof cb!=='function')return;const r={code:code(),players:[],hostId:null,phase:'lobby',deadline:null,round:0,integrity:70,nodes:0,mode:'cooperative',actions:{},votes:{},current:null,evidence:[],roundResult:null,winner:null,log:[],timer:null,createdAt:Date.now()};const p={id:randomId(),token:randomId(),name:cleanName(name),connected:true,quarantined:false,ready:false,role:'pending',score:0,socketId:null};r.players.push(p);r.hostId=p.id;rooms.set(r.code,r);attach(socket,r,p);cb({ok:true,code:r.code,token:p.token});});
 socket.on('join',({code:raw,name}={},cb)=>{if(typeof cb!=='function')return;const c=String(raw||'').toUpperCase().trim(),r=rooms.get(c);if(!r)return ackFail(cb,'Room not found. Check your code.');if(r.phase!=='lobby')return ackFail(cb,'This match has started. Join the next one.');if(r.players.length>=8)return ackFail(cb,'Room is full.');const p={id:randomId(),token:randomId(),name:cleanName(name),connected:true,quarantined:false,ready:false,role:'pending',score:0,socketId:null};r.players.push(p);attach(socket,r,p);cb({ok:true,code:r.code,token:p.token})});
 socket.on('resume',({code:raw,token}={},cb)=>{const r=rooms.get(String(raw||'').toUpperCase());const p=r?.players.find(p=>p.token===token);if(!p)return ackFail(cb,'Previous session expired.');attach(socket,r,p);cb?.({ok:true,code:r.code,token:p.token})});
 socket.on('ready',(_payload,cb)=>{const r=roomOf(socket),p=r?.players.find(p=>p.id===socket.data.pid);if(!p||r.phase!=='lobby')return ackFail(cb,'Not in lobby');p.ready=!p.ready;broadcast(r);cb?.({ok:true})});
 socket.on('start',(_payload,cb)=>{const r=roomOf(socket);if(!r||r.phase!=='lobby'||r.hostId!==socket.data.pid)return ackFail(cb,'Only the host can start from the lobby.');if(r.players.length<2)return ackFail(cb,'At least two players are required.');if(!r.players.every(p=>p.ready||p.id===r.hostId))return ackFail(cb,'All guests must be ready.');startGame(r);cb?.({ok:true})});
 socket.on('submit',({answer,action}={},cb)=>{const r=roomOf(socket),p=r?.players.find(p=>p.id===socket.data.pid);if(!p||r.phase!=='action'||Date.now()>r.deadline)return ackFail(cb,'Action phase is closed.');if(r.actions[p.id])return ackFail(cb,'Already submitted.');const allowable=p.quarantined?['scan']:p.role==='infiltrator'?['repair','scan','sabotage']:['repair','scan'];if(!allowable.includes(action))return ackFail(cb,'Invalid action.');const correct=String(answer).trim()===r.current.answer;r.actions[p.id]={action,correct};broadcast(r);cb?.({ok:true,correct});});
 socket.on('vote',({target}={},cb)=>{const r=roomOf(socket),p=r?.players.find(p=>p.id===socket.data.pid);if(!p||r.phase!=='vote'||p.quarantined||Date.now()>r.deadline)return ackFail(cb,'Voting is closed.');if(r.votes[p.id])return ackFail(cb,'Vote already cast.');if(target!=='skip'&&!active(r).some(x=>x.id===target&&x.id!==p.id))return ackFail(cb,'Invalid target.');r.votes[p.id]=target;broadcast(r);cb?.({ok:true})});
 socket.on('rematch',(_payload,cb)=>{const r=roomOf(socket);if(!r||r.phase!=='final'||r.hostId!==socket.data.pid)return ackFail(cb,'Only the host can request a rematch.');r.phase='lobby';r.deadline=null;r.round=0;r.winner=null;r.players.forEach(p=>{p.role='pending';p.quarantined=false;p.ready=false});broadcast(r);cb?.({ok:true})});
 socket.on('disconnect',()=>{const r=roomOf(socket),p=r?.players.find(p=>p.id===socket.data.pid);if(!p||p.socketId!==socket.id)return;p.connected=false;p.socketId=null;if(r.phase==='lobby'){r.players=r.players.filter(x=>x.id!==p.id);if(r.hostId===p.id)r.hostId=r.players[0]?.id||null;if(!r.players.length){clearTimeout(r.timer);rooms.delete(r.code);return}}else if(r.hostId===p.id){r.hostId=r.players.find(x=>x.connected)?.id||r.hostId}broadcast(r)})
});
setInterval(()=>{for(const r of rooms.values()){if(r.phase==='final'&&Date.now()-r.createdAt>6*60*60*1000){clearTimeout(r.timer);rooms.delete(r.code)}}},60000).unref();
const PORT=Number(process.env.PORT||3000);server.listen(PORT,'0.0.0.0',()=>console.log(`THE SIGNAL listening on ${PORT}`));
