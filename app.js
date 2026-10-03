/* Colour Clash visual update v2. All moves and hidden hands are validated by setup.sql. */
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
async function enter(create=false){await connect();const name=$('name').value.trim();if(!name)throw Error('Enter your name first.');const code=$('code').value.trim().toUpperCase();if(!create&&!/^[A-F0-9]{8}$/.test(code))throw Error('Enter the eight-character room code.');save('name',name);apply(await rpc('clash_enter',{p_name:name,p_code:create?null:code,p_mode:$('mode').value,p_jump:$('jumpSetting').checked,p_double:$('doubleSetting').checked,p_elimination:$('mode').value==='mercy'&&$('eliminationSetting').checked}));}
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
  if(room.skipJump===uid)return false;
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
const actionNames={skip:'SKIP',reverse:'REVERSE',wild:'CHOOSE COLOUR','+2':'DRAW TWO','+4':'DRAW FOUR','+6':'DRAW SIX','+10':'DRAW TEN',reverse4:'REVERSE +4',roulette:'COLOUR ROULETTE',discard:'DISCARD ALL',skipall:'SKIP EVERYONE'};
const suitMarks={red:'●',yellow:'◆',green:'▲',blue:'■',wild:'✦'};
const cardIcons={
 reverse:'<path d="M12 23h31l-8-8m8 8-8 8M52 41H21l8 8m-8-8 8-8"/>',
 skip:'<circle cx="32" cy="32" r="20"/><path d="m18 46 28-28"/>',
 discard:'<rect x="13" y="19" width="26" height="33" rx="4"/><path d="M25 12h22a4 4 0 0 1 4 4v25M21 35h10m-5-5v10"/>',
 skipall:'<circle cx="25" cy="32" r="17"/><path d="m13 44 24-24m10-2a17 17 0 0 1 0 28"/>'
};
function iconNode(value){
 const wrap=document.createElement('span');wrap.className='card-icon';wrap.setAttribute('aria-hidden','true');
 // Icon paths are fixed artwork, never player-provided HTML.
 wrap.innerHTML='<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">'+cardIcons[value]+'</svg>';
 return wrap;
}
function cardElement(c,interactive=false){
 const el=document.createElement(interactive?'button':'div');el.className='card face '+c.color;
 const description=actionNames[c.value]||c.value;
 el.setAttribute('aria-label',`${names[c.color]} ${description}`);el.title=`${names[c.color]} · ${description}`;
 const corner=document.createElement('span');corner.className='corner';
 const value=document.createElement('b');value.textContent=c.value==='skipall'?'⊘':labels[c.value]||c.value;
 const suit=document.createElement('i');suit.textContent=suitMarks[c.color];corner.append(value,suit);
 const opposite=corner.cloneNode(true);opposite.classList.add('opposite');
 const oval=document.createElement('span');oval.className='card-oval';oval.setAttribute('aria-hidden','true');
 const center=document.createElement('span');center.className='card-center';
 if(cardIcons[c.value])center.append(iconNode(c.value));
 else if(c.value==='reverse4'){center.append(iconNode('reverse'));const draw=document.createElement('b');draw.textContent='+4';center.append(draw);el.classList.add('reverse-draw');}
 else if(c.value==='roulette'){const wheel=document.createElement('span');wheel.className='roulette-wheel';wheel.textContent='?';center.append(wheel);}
 else center.textContent=labels[c.value]||c.value;
 const bottom=document.createElement('small');bottom.className='card-caption';bottom.textContent=actionNames[c.value]||names[c.color].toUpperCase();
 el.append(oval,corner,center,opposite,bottom);
 if(c.value==='+10')el.classList.add('long');
 if(/^\+\d+$/.test(c.value))el.classList.add('draw-numeric');
 if(interactive){el.disabled=busy||!legal(c);el.classList.toggle('playable',!el.disabled);el.addEventListener('click',()=>chooseCard(c));}
 return el;
}
function renderPlayers(playing){
 const container=$('players');container.setAttribute('role','list');container.setAttribute('aria-label','Players and cards remaining');
 container.classList.toggle('dealt',room.phase!=='lobby');
 container.replaceChildren(...room.players.map((p,i)=>{
  const active=playing&&i===room.turn,me=p.id===uid;
  const el=document.createElement('div');el.className='player'+(active?' active':'')+(p.out?' out':'')+(me?' me':'')+(p.count===1&&!p.out&&room.phase!=='lobby'?' last-card':'');
  el.setAttribute('role','listitem');el.setAttribute('aria-label',p.name+(me?' (you)':'')+', '+(p.left?'left':p.out?'eliminated':room.phase==='lobby'?'ready':p.count+' cards')+(active?', current turn':''));
  const name=document.createElement('b');name.className='player-name';name.textContent=p.name;name.title=p.name;
  const role=document.createElement('span');role.className='player-role';role.textContent=[String(i+1),me?'YOU':'',p.id===room.host?'HOST':''].filter(Boolean).join(' · ');
  el.append(name,role);
  if(room.phase==='lobby'){
   const avatar=document.createElement('span');avatar.className='lobby-avatar';avatar.textContent=p.name.slice(0,1).toUpperCase();el.append(avatar);
  }else{
   const fan=document.createElement('div');fan.className='opponent-hand';fan.setAttribute('aria-hidden','true');
   // Decorative backs only. Always show the exact total in the counter below.
   const shown=Math.min(p.count,5);
   if(!p.out&&shown>0){for(let k=0;k<shown;k++){
    const back=document.createElement('span');back.className='mini-card';
    const position=k-(shown-1)/2;back.style.setProperty('--fan-x',(position*13)+'px');back.style.setProperty('--fan-angle',(position*9)+'deg');back.style.setProperty('--fan-y',(Math.abs(position)*3)+'px');
    back.textContent='✦';fan.append(back);
   }}else {const empty=document.createElement('span');empty.className='empty-hand';empty.textContent=p.left?'LEFT':p.out?'OUT':'✓';fan.append(empty);}
   el.append(fan);
  }
  const count=document.createElement('div');count.className='player-count';
  if(room.phase==='lobby')count.textContent='Ready';
  else if(p.out)count.textContent=p.left?'Left room':'Eliminated';
  else {const total=document.createElement('strong');total.textContent=p.count;const label=document.createElement('span');label.textContent=p.count===1?'card left':'cards';count.append(total,label);}
  const turn=document.createElement('span');turn.className='player-turn';turn.textContent=active?(me?'YOUR TURN':'PLAYING'):p.count===1&&!p.out&&room.phase!=='lobby'?'ONE CARD!':' ';
  el.append(count,turn);
  if(room.phase==='lobby'&&room.host===uid){
   const controls=document.createElement('div');controls.className='order-controls';
   for(const [delta,label,arrow] of [[-1,'Move earlier','↑'],[1,'Move later','↓']]){
    const button=document.createElement('button');button.className='order-button';button.textContent=arrow;button.title=label;button.setAttribute('aria-label',label+': '+p.name);
    button.disabled=busy||i+delta<0||i+delta>=room.players.length;
    button.onclick=()=>run(()=>action('reorder',{p_target:p.id,p_card:i+delta}));controls.append(button);
   }
   el.append(controls);
  }
  return el;
 }));
}
function render(){
 if(!room)return;
 const host=room.host===uid,playing=room.phase==='playing',out=room.players.find(p=>p.id===uid)?.out,myTurn=playing&&!out&&room.players[room.turn]?.id===uid;
 $('roomSettings').replaceChildren(...[(isMercy()?'No Mercy':'Regular')+' · UNO-style','Jump-in: '+(room.settings.jump?'ON':'OFF'),'Double play: '+(room.settings.double?'ON':'OFF'),...(isMercy()?['25-card elimination: '+(room.settings.eliminate25?'ON':'OFF')]:[]),...(room.deckCopies?[room.deckCopies+' deck'+(room.deckCopies===1?'':'s')]:[])].map(t=>{const e=document.createElement('span');e.textContent=t;return e;}));
 $('roomCode').textContent=room.code;$('count').textContent=room.players.filter(p=>!p.left).length+' PLAYERS';
 $('roomTitle').textContent=room.phase==='lobby'?'The waiting room':room.phase==='finished'?'That’s a wrap.':'Let the rivalry begin.';
 renderPlayers(playing);
 $('lobby').hidden=room.phase!=='lobby';$('game').hidden=room.phase==='lobby';
 $('lobbyText').textContent=host?'Use the arrows under each player to choose the starting order. Player 1 goes first. Then deal the cards.':'The host can arrange the numbered player order above. Player 1 starts when the host deals.';
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
 else if(!myTurn&&room.skipJump===uid)$('hint').textContent='Penalty taken — your turn is over. Wait for the next play.';
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

function updateModeOptions(){$('eliminationOption').hidden=$('mode').value!=='mercy';}
$('mode').addEventListener('change',updateModeOptions);updateModeOptions();
