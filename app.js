/* Colour Clash v1. All moves and hidden hands are validated by setup.sql. */
'use strict';
const $ = id => document.getElementById(id);
const read = key => { try { return localStorage.getItem('clash-'+key) || ''; } catch { return ''; } };
const save = (key, value) => { try { localStorage.setItem('clash-'+key,value); } catch {} };
const names = {red:'Red ●',yellow:'Yellow ◆',green:'Green ▲',blue:'Blue ■',wild:'Wild ✦'};
const labels = {skip:'⊘',reverse:'↔',wild:'✦','+2':'+2','+4':'+4',reverse4:'↔+4','+6':'+6','+10':'+10',roulette:'?',discard:'ALL',skipall:'⊘ ALL'};
let client, uid, room, busy=false, polling=false, pendingCard, pendingDouble=false, pendingUno=false, colorAction='play', toastTimer, timeOffset=0, installPrompt, lastVersion=-1, lastTurn;
function toast(message){ $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,6500); }
function status(text){ $('connection').textContent=text; }
function fail(e){ const m=e?.message||String(e); status('Connection needs attention'); toast(m.includes('Failed to fetch')?'Connection lost. Check your internet; your place is saved.':m); }
async function run(fn){ if(busy)return; busy=true;document.body.classList.add('waiting');try{await fn();}catch(e){fail(e);}finally{busy=false;document.body.classList.remove('waiting');if(room)render();} }
async function connect(){
 if(client && uid)return;
 const cfg=window.CLASH_CONFIG||{};
 if(!cfg.supabaseUrl?.startsWith('https://') || !cfg.supabaseKey || cfg.supabaseKey.includes('PASTE_'))throw Error('Finish the setup guide and add your Supabase URL and publishable key in config.js.');
 if(cfg.supabaseKey.startsWith('sb_secret_'))throw Error('Use your publishable key, never a secret key.');
 if(!window.supabase)throw Error('supabase.js is missing. Upload all of the game files.');
 client ||= window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey);
 status('Connecting…');
 let {data,error}=await client.auth.getSession();if(error)throw error;
 if(!data.session){const result=await client.auth.signInAnonymously();if(result.error)throw result.error;data=result.data;}
 uid=data.session.user.id;status('Connected');
}
async function rpc(name,args){const {data,error}=await client.rpc(name,args);if(error)throw error;return data;}
function apply(next){
 if(room && next.code===room.code && next.version<room.version)return;
 timeOffset=Number(next.serverTime)*1000-Date.now();
 const changed=!room||next.version!==room.version||next.code!==room.code;
 if(!room||next.turn!==room.turn||next.phase!==room.phase){$('uno').checked=false;$('doublePlay').checked=false;}
 room=next;save('room',room.code);status('Connected');
 $('home').hidden=true;$('room').hidden=false;
 if(changed){if($('colors').open)$('colors').close();if($('targets').open)$('targets').close();render();}
}
async function enter(create=false){await connect();const name=$('name').value.trim();if(!name)throw Error('Enter your name first.');const code=$('code').value.trim().toUpperCase();if(!create&&!/^[A-F0-9]{8}$/.test(code))throw Error('Enter the eight-character room code.');save('name',name);apply(await rpc('clash_enter',{p_name:name,p_code:create?null:code,p_mode:$('mode').value,p_jump:$('jumpSetting').checked,p_double:$('doubleSetting').checked}));}
async function action(type, extra={}){
 if(!room)return;
 const code=room.code;
 const next=await rpc('clash_action',{p_code:code,p_version:room.version,p_action:type,...extra});
 if(next.left){room=null;save('room','');$('home').hidden=false;$('room').hidden=true;$('resume').hidden=true;history.replaceState(null,'',location.pathname);status('Ready to play');return;}
 if(type==='play'){$('uno').checked=false;$('doublePlay').checked=false;}
 apply(next);
}
function drawValue(c){return c.value==='reverse4'?4:(/^\+\d+$/.test(c.value)?Number(c.value.slice(1)):0);}
function isMercy(){return room?.settings?.mode==='mercy';}
function legal(c){
 if(!room||room.phase!=='playing'||room.players.find(p=>p.id===uid)?.out||room.roulette)return false;
 const myTurn=room.players[room.turn]?.id===uid;
 if(!myTurn){
  if(!room.settings.jump||room.pending>0||c.color!==room.top.color||c.value!==room.top.value)return false;
 }else{
  if(room.drawn!=null&&Number(room.drawn)!==c.id)return false;
  if(room.pending>0)return drawValue(c)>=room.minimum;
 }
 if(!isMercy()&&c.value==='+4'&&room.hand.some(x=>x.color===room.color))return false;
 return c.color==='wild'||c.color===room.color||c.value===room.top.value;
}
function chooseCard(c){
 pendingCard=c.id;pendingDouble=$('doublePlay').checked;pendingUno=$('uno').checked;
 const remaining=room.hand.length-(pendingDouble?2:1);
 if(isMercy()&&c.value==='7'&&remaining>0){
  $('targetList').replaceChildren(...room.players.filter(p=>p.id!==uid&&!p.out).map(p=>{const b=document.createElement('button');b.className='secondary';b.textContent=p.name+' · '+p.count+' cards';b.onclick=()=>{$('targets').close();run(()=>action('play',{p_card:pendingCard,p_double:pendingDouble,p_uno:pendingUno,p_target:p.id}));};return b;}));$('targets').showModal();
 }else if(c.color==='wild'&&c.value!=='roulette'){
  colorAction='play';$('colorTitle').textContent='Choose the next colour.';$('colors').showModal();
 }else run(()=>action('play',{p_card:c.id,p_uno:pendingUno,p_double:pendingDouble}));
}
function cardElement(c,interactive=false){
 const el=document.createElement(interactive?'button':'div');el.className='card '+c.color;
 el.setAttribute('aria-label',`${names[c.color]} ${c.value}`);
 const corner=document.createElement('span');corner.className='corner';corner.textContent=labels[c.value]||c.value;
 const center=document.createElement('span');center.textContent=labels[c.value]||c.value;
 const bottom=document.createElement('small');bottom.textContent=c.color==='wild'?(c.value==='+4'?'WILD +4':'WILD'):names[c.color].toUpperCase();
 el.append(corner,center,bottom);
 if(['reverse4','skipall'].includes(c.value))el.classList.add('long');
 if(interactive){el.disabled=busy||!legal(c);el.addEventListener('click',()=>chooseCard(c));}
 return el;
}
function render(){
 if(!room)return;
 const host=room.host===uid,playing=room.phase==='playing',out=room.players.find(p=>p.id===uid)?.out,myTurn=playing&&!out&&room.players[room.turn]?.id===uid;
 $('roomSettings').replaceChildren(...[(isMercy()?'No Mercy':'Regular')+' · UNO-style','Jump-in: '+(room.settings.jump?'ON':'OFF'),'Double play: '+(room.settings.double?'ON':'OFF')].map(t=>{const e=document.createElement('span');e.textContent=t;return e;}));
 $('roomCode').textContent=room.code;$('count').textContent=room.players.length+' / 15 PLAYERS';
 $('roomTitle').textContent=room.phase==='lobby'?'The waiting room':room.phase==='finished'?'That’s a wrap.':'Let the rivalry begin.';
 $('players').replaceChildren(...room.players.map((p,i)=>{
  const el=document.createElement('div');el.className='player'+(playing&&i===room.turn?' active':'')+(p.out?' out':'');
  const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=p.name.slice(0,1).toUpperCase();
  const name=document.createElement('b');name.textContent=p.name+(p.id===uid?' (you)':'');
  const detail=document.createElement('p');detail.textContent=(p.left?'Left':p.out?'Eliminated':room.phase==='lobby'?'Ready':p.count+' cards')+(p.id===room.host?' · Host':'');
  el.append(avatar,name,detail);return el;
 }));
 $('lobby').hidden=room.phase!=='lobby';$('game').hidden=room.phase==='lobby';
 $('lobbyText').textContent=host?'Share your invite. Once everyone has joined, deal the cards.':'Make yourself comfortable. The host will start when everyone is here.';
 $('start').hidden=!host;$('start').disabled=busy||room.players.length<2;
 $('winner').hidden=room.phase!=='finished';$('rematch').hidden=!host;
 $('winnerText').textContent=(room.players.find(p=>p.id===room.winner)?.name||'A player')+' wins!';
 $('discard').replaceChildren(...(room.top?[cardElement(room.top)]:[]));
 $('currentColor').textContent='COLOUR: '+(names[room.color]||'');
 $('direction').textContent=room.direction===1?'↻ Clockwise · left to right':'↺ Anticlockwise · right to left';
 $('event').textContent=room.message;
 $('turnText').textContent=playing?(myTurn?'Your turn. Make it count.':(room.players[room.turn]?.name||'Player')+'’s turn'):'Round complete';
 $('handCount').textContent=room.hand.length+' cards';
 $('hint').textContent=!playing?'Ready for another round?':!myTurn?'Your playable cards light up on your turn.':room.drawn!=null?'Play the card you drew, or pass.':'Match the colour or symbol, or draw a card.';
 $('draw').hidden=room.drawn!=null||room.roulette;$('draw').disabled=!myTurn||busy;
 $('draw').textContent=room.pending>0?'Take +'+room.pending:isMercy()?'Draw until playable':'Draw 1';
 $('rouletteButton').hidden=!room.roulette;$('rouletteButton').disabled=!myTurn||busy;
 $('doubleLabel').hidden=!room.settings.double;$('doublePlay').disabled=busy||!playing||out;
 $('pass').hidden=room.drawn==null||isMercy();$('pass').disabled=!myTurn||busy;
 $('uno').disabled=(!myTurn&&!room.settings.jump)||out||busy;
 if(out)$('hint').textContent='You are out this round. Watch the table, then join the rematch.';
 else if(room.roulette)$('hint').textContent=myTurn?'Choose a colour for your roulette penalty.':'Waiting for the roulette colour choice.';
 else if(room.pending>0)$('hint').textContent='Draw stack: +'+room.pending+'. Play a +'+room.minimum+' or higher, or take the penalty.';
 else if(!myTurn&&room.settings.jump)$('hint').textContent='Exact matches light up for a jump-in.';
 const scroll=$('hand').scrollLeft;$('hand').replaceChildren(...room.hand.map(c=>cardElement(c,true)));$('hand').scrollLeft=scroll;
 tick();
}
async function poll(){
 if(!room||!client||polling||busy||document.hidden)return;
 polling=true;const code=room.code;
 try {const next=await rpc('clash_state',{p_code:code});if(room?.code===code)apply(next);}catch(e){status('Reconnecting…');}finally{polling=false;}
}
function tick(){
 if(!room||room.phase!=='playing'){$('timer').textContent='';return;}
 const seconds=Math.max(0,Math.ceil(Number(room.deadline)-(Date.now()+timeOffset)/1000));
 $('timer').textContent=seconds+'s';
 if(seconds===0&&!busy&&!polling&&!document.hidden){run(async()=>{try{await action('timeout');}catch(e){await poll();}});}
}
$('create').onclick=()=>run(()=>enter(true));$('join').onclick=()=>run(()=>enter(false));
$('code').addEventListener('keydown',e=>{if(e.key==='Enter')run(()=>enter(false));});
$('start').onclick=()=>run(()=>action('start'));$('draw').onclick=()=>run(()=>action('draw'));$('pass').onclick=()=>run(()=>action('pass'));$('rematch').onclick=()=>run(()=>action('lobby'));
$('leave').onclick=()=>{if(confirm('Leave this room? You can rejoin only while it is in the lobby.'))run(()=>action('leave'));};
$('share').onclick=()=>run(async()=>{const url=new URL(location.href);url.search='';url.searchParams.set('room',room.code);url.hash='';try{await navigator.clipboard.writeText(url.href);toast('Invite copied. Send it to your friends.');}catch{prompt('Copy this invite:',url.href);}});
$('help').onclick=()=>$('rules').showModal();$('closeRules').onclick=()=>$('rules').close();$('cancelColor').onclick=()=>$('colors').close();
document.querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>{const id=pendingCard;$('colors').close();run(()=>action(colorAction,{p_card:colorAction==='play'?id:null,p_color:button.dataset.color,p_uno:pendingUno,p_double:pendingDouble}));});
$('resume').onclick=()=>run(async()=>{await connect();apply(await rpc('clash_state',{p_code:read('room')}));});
$('cancelTarget').onclick=()=>$('targets').close();
$('rouletteButton').onclick=()=>{colorAction='roulette';pendingDouble=false;pendingUno=false;$('colorTitle').textContent='Pick your roulette colour.';$('colors').showModal();};
$('name').value=read('name');$('code').value=new URL(location.href).searchParams.get('room')||'';
$('resume').hidden=!read('room');$('setup').hidden=!!window.CLASH_CONFIG?.supabaseUrl?.startsWith('https://');
window.addEventListener('online',()=>{status('Reconnecting…');poll();});window.addEventListener('offline',()=>status('Offline · reconnect to play'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
setInterval(poll,1800);setInterval(tick,1000);
