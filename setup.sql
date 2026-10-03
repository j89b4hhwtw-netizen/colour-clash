-- Colour Clash v1. Run this WHOLE file in a NEW Supabase project's SQL Editor.
-- No extensions, paid functions, Realtime switch, or table policies needed.
begin;
create schema if not exists clash_private;
revoke all on schema clash_private from public, anon, authenticated;
create table if not exists clash_private.rooms (
 code text primary key, host uuid not null, state jsonb not null,
 version integer not null default 0, updated_at timestamptz not null default now()
);
alter table clash_private.rooms enable row level security;
revoke all on clash_private.rooms from public, anon, authenticated;

create or replace function clash_private.shuffle(a jsonb) returns jsonb
language sql volatile set search_path = '' as $$
 select coalesce(jsonb_agg(value order by random()), '[]'::jsonb) from jsonb_array_elements(a)
$$;
drop function if exists clash_private.deck(text);
create or replace function clash_private.deck(mode text default 'regular', packs int default 1) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare d jsonb := '[]'; c text; v text; copies int; k int; pack int; id int := 0; vals text[];
begin
 for pack in 1..packs loop
  foreach c in array array['red','yellow','green','blue'] loop
   vals:=array['0','1','2','3','4','5','6','7','8','9','skip','reverse','+2'];
   if mode='mercy' then vals:=vals || array['+4','skipall','discard']; end if;
   foreach v in array vals loop
    copies:=case when mode='regular' and v='0' then 1 when mode='mercy' and v in ('skip','reverse','+2','discard') then 3 else 2 end;
    for k in 1..copies loop
     id:=id+1; d:=d || jsonb_build_array(jsonb_build_object('id',id,'color',c,'value',v));
    end loop;
   end loop;
  end loop;
  vals:=case when mode='mercy' then array['reverse4','+6','+10','roulette'] else array['wild','+4'] end;
  foreach v in array vals loop
   copies:=case when mode='mercy' and v in ('reverse4','roulette') then 8 else 4 end;
   for k in 1..copies loop
    id:=id+1; d:=d || jsonb_build_array(jsonb_build_object('id',id,'color','wild','value',v));
   end loop;
  end loop;
 end loop;
 return clash_private.shuffle(d);
end $$;
create or replace function clash_private.active_count(s jsonb) returns int
language sql immutable set search_path = '' as $$
 select count(*)::int from jsonb_array_elements(s->'players') p where not coalesce((p->>'out')::boolean,false)
$$;
create or replace function clash_private.next_seat(s jsonb, steps int default 1) returns int
language plpgsql immutable set search_path = '' as $$
declare pos int:=(s->>'turn')::int; n int:=jsonb_array_length(s->'players'); k int; tries int;
begin
 if clash_private.active_count(s)=0 then return pos; end if;
 for k in 1..steps loop
  for tries in 1..n loop
   pos:=(pos+(s->>'direction')::int+n)%n;
   exit when not coalesce((s->'players'->pos->>'out')::boolean,false);
  end loop;
 end loop;
 return pos;
end $$;
create or replace function clash_private.draw(s jsonb, seat int, amount int) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare d jsonb:=s->'deck'; pile jsonb:=s->'pile'; h jsonb:=s->'players'->seat->'hand'; k int; retired jsonb:=coalesce(s->'retired','[]'::jsonb); fresh jsonb; first_id int; max_id int;
 elimination boolean:=s->'settings'->>'mode'='mercy' and coalesce((s->'settings'->>'eliminate25')::boolean,false);
begin
 for k in 1..amount loop
  exit when elimination and jsonb_array_length(h)>=25;
  if jsonb_array_length(d)=0 then
   d:=clash_private.shuffle((pile - (jsonb_array_length(pile)-1)) || retired); retired:='[]';
   if jsonb_array_length(pile)>0 then pile:=jsonb_build_array(pile->(jsonb_array_length(pile)-1)); end if;
  end if;
  if jsonb_array_length(d)=0 then
   -- Everybody may be holding the remaining cards when elimination is off.
   -- Add one WHOLE base deck, with fresh IDs, instead of truncating a penalty.
   select coalesce(max((x->>'id')::int),0) into max_id from (
    select value x from jsonb_array_elements(coalesce(s->'deck','[]') || coalesce(s->'pile','[]') || coalesce(s->'retired','[]') || h)
    union all select card from jsonb_array_elements(s->'players') p cross join lateral jsonb_array_elements(p->'hand') card
   ) all_cards;
   first_id:=greatest(coalesce((s->>'nextCardId')::int,1),max_id+1);
   fresh:=clash_private.deck(s->'settings'->>'mode',1);
   select jsonb_agg(jsonb_set(value,'{id}',to_jsonb((value->>'id')::int+first_id-1)) order by ordinality) into d from jsonb_array_elements(fresh) with ordinality;
   s:=jsonb_set(s,'{nextCardId}',to_jsonb(first_id+jsonb_array_length(fresh)));
   s:=jsonb_set(s,'{deckCopies}',to_jsonb(coalesce((s->>'deckCopies')::int,1)+1));
  end if;
  h:=h || jsonb_build_array(d->0); d:=d-0;
 end loop;
 s:=jsonb_set(s,'{deck}',d); s:=jsonb_set(s,'{pile}',pile); s:=jsonb_set(s,'{retired}',retired);
 return jsonb_set(s,array['players',seat::text,'hand'],h);
end $$;
create or replace function clash_private.draw_value(c jsonb) returns int
language sql immutable set search_path = '' as $$
 select case c->>'value' when '+2' then 2 when '+4' then 4 when 'reverse4' then 4 when '+6' then 6 when '+10' then 10 else 0 end
$$;
create or replace function clash_private.matches(c jsonb,s jsonb) returns boolean
language sql immutable set search_path = '' as $$
 select c->>'color'='wild' or c->>'color'=s->>'color' or c->>'value'=(s->'pile'->(jsonb_array_length(s->'pile')-1)->>'value')
$$;
create or replace function clash_private.finish(s jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare i int; ps jsonb; retired jsonb:=coalesce(s->'retired','[]'); active int;
begin
 if s->'settings'->>'mode'='mercy' and coalesce((s->'settings'->>'eliminate25')::boolean,false) then
  for i in 0..jsonb_array_length(s->'players')-1 loop
   if jsonb_array_length(s->'players'->i->'hand')>=25 and not coalesce((s->'players'->i->>'out')::boolean,false) then
    retired:=retired || (s->'players'->i->'hand');
    s:=jsonb_set(s,array['players',i::text,'hand'],'[]'); s:=jsonb_set(s,array['players',i::text,'out'],'true');
    s:=jsonb_set(s,'{message}',to_jsonb(coalesce(s->>'message','') || ' ' || (s->'players'->i->>'name') || ' is out (25 cards).'));
   end if;
  end loop;
  s:=jsonb_set(s,'{retired}',retired);
 end if;
 if s->>'phase'='playing' then
  active:=clash_private.active_count(s);
  for i in 0..jsonb_array_length(s->'players')-1 loop
   if not coalesce((s->'players'->i->>'out')::boolean,false) and (jsonb_array_length(s->'players'->i->'hand')=0 or active=1) then
    s:=jsonb_set(s,'{phase}','"finished"'); s:=jsonb_set(s,'{winner}',s->'players'->i->'id');
    s:=jsonb_set(s,'{message}',to_jsonb(coalesce(s->>'message','') || ' ' || (s->'players'->i->>'name') || ' wins!')); exit;
   end if;
  end loop;
  if active=0 then s:=jsonb_set(s,'{phase}','"finished"'); end if;
 end if;
 return s;
end $$;

create or replace function public.clash_state(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r clash_private.rooms; s jsonb; ps jsonb:='[]'; p jsonb; mine jsonb; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Please reconnect.'; end if;
 select * into r from clash_private.rooms where code=upper(trim(p_code));
 if not found then raise exception 'Room not found. Check the code or create a new room.'; end if;
 s:=r.state;
 for p in select value from jsonb_array_elements(s->'players') loop
  ps:=ps || jsonb_build_array(jsonb_build_object('id',p->>'id','name',p->>'name','count',jsonb_array_length(p->'hand'),'out',coalesce((p->>'out')::boolean,false),'left',coalesce((p->>'left')::boolean,false)));
  if p->>'id'=uid::text and not coalesce((p->>'left')::boolean,false) then mine:=p->'hand'; end if;
 end loop;
 if mine is null then raise exception 'You are not in this room. Join it first.'; end if;
 return jsonb_build_object('code',r.code,'host',r.host,'version',r.version,'phase',s->>'phase','settings',s->'settings',
  'players',ps,'hand',mine,'turn',s->'turn','direction',s->'direction','color',s->'color',
  'top',(s->'pile')->(jsonb_array_length(s->'pile')-1),
  'drawn',case when s->'players'->((s->>'turn')::int)->>'id'=uid::text then s->'drawn' else 'null'::jsonb end,
  'skipJump',s->'skipJump','pending',s->'pending','minimum',s->'minimum','roulette',s->'roulette','winner',s->'winner',
  'deckCopies',coalesce(s->'deckCopies','0'::jsonb),'message',s->>'message','deadline',s->'deadline','serverTime',extract(epoch from clock_timestamp()));
end $$;
-- Remove the old prototype overload if updating an earlier copy.
drop function if exists public.clash_enter(text,text);
drop function if exists public.clash_enter(text,text,text,boolean,boolean);
create or replace function public.clash_enter(p_name text, p_code text default null, p_mode text default 'regular',
 p_jump boolean default false, p_double boolean default false, p_elimination boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); r clash_private.rooms; c text; s jsonb; nm text:=left(trim(p_name),20); ps jsonb;
begin
 if uid is null then raise exception 'Please reconnect.'; end if;
 if nm is null or length(nm)<1 then raise exception 'Enter your name first.'; end if;
 if p_mode is null or p_mode not in ('regular','mercy') then raise exception 'Choose a valid game mode.'; end if;
 perform pg_advisory_xact_lock(hashtext(uid::text));
 if p_code is null or trim(p_code)='' then
  delete from clash_private.rooms where host=uid and updated_at<now()-interval '24 hours';
  if (select count(*) from clash_private.rooms where host=uid)>=5 then raise exception 'You already host five rooms. Rejoin one, or leave an old room first.'; end if;
  loop
   c:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
   exit when not exists(select 1 from clash_private.rooms where code=c);
  end loop;
  s:=jsonb_build_object('phase','lobby','players',jsonb_build_array(jsonb_build_object('id',uid,'name',nm,'hand','[]'::jsonb,'out',false,'left',false)),
    'settings',jsonb_build_object('mode',p_mode,'jump',coalesce(p_jump,false),'double',coalesce(p_double,false),'eliminate25',p_mode='mercy' and coalesce(p_elimination,false)),
    'deck','[]'::jsonb,'pile','[]'::jsonb,'retired','[]'::jsonb,'turn',0,'direction',1,'drawn',null,'skipJump',null,'pending',0,'minimum',0,'roulette',false,'message',nm || ' opened the room.');
  insert into clash_private.rooms(code,host,state) values(c,uid,s);
 else
  c:=upper(trim(p_code)); select * into r from clash_private.rooms where code=c for update;
  if not found then raise exception 'Room not found. Check the eight-character code.'; end if;
  s:=r.state; ps:=s->'players';
  if exists(select 1 from jsonb_array_elements(ps) p where p->>'id'=uid::text and not coalesce((p->>'left')::boolean,false)) then return public.clash_state(c); end if;
  if s->>'phase'<>'lobby' then raise exception 'Game already started. Ask the host to return to the lobby after this round.'; end if;
  s:=jsonb_set(s,'{players}',ps || jsonb_build_array(jsonb_build_object('id',uid,'name',nm,'hand','[]'::jsonb,'out',false,'left',false)));
  s:=jsonb_set(s,'{message}',to_jsonb(nm || ' joined.'));
  update clash_private.rooms set state=s,version=version+1,updated_at=now() where code=c;
 end if;
 return public.clash_state(c);
end $$;

drop function if exists public.clash_action(text,int,text,int,text,boolean);
create or replace function public.clash_action(p_code text, p_version int, p_action text,
 p_card int default null, p_color text default null, p_uno boolean default false,
 p_double boolean default false, p_target text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); r clash_private.rooms; s jsonb; ps jsonb; h jsonb; oldhands jsonb; card jsonb; topcard jsonb; extras jsonb; item jsonb;
 seat int; n int; i int; j int; target int; steps int:=1; amount int:=0; before_count int; picked int; copies int:=1; idx int; jump boolean:=false;
 nm text; val text; msg text; mode text; advance boolean:=false; turnseat int; countbefore int; timeout boolean:=false; elimination boolean:=false; packs int;
begin
 if uid is null then raise exception 'Please reconnect.'; end if;
 select * into r from clash_private.rooms where code=upper(trim(p_code)) for update;
 if not found then raise exception 'Room no longer exists.'; end if;
 s:=r.state; ps:=s->'players'; n:=jsonb_array_length(ps); mode:=s->'settings'->>'mode'; elimination:=mode='mercy' and coalesce((s->'settings'->>'eliminate25')::boolean,false);
 for i in 0..n-1 loop if ps->i->>'id'=uid::text and not coalesce((ps->i->>'left')::boolean,false) then seat:=i; end if; end loop;
 if seat is null then raise exception 'Join this room first.'; end if;
 if p_version is distinct from r.version then raise exception 'The room changed. Try again.'; end if;
 nm:=ps->seat->>'name';
 if p_action='leave' then
  if s->>'phase'='lobby' then
   ps:=ps-seat; s:=jsonb_set(s,'{players}',ps); s:=jsonb_set(s,'{turn}','0');
  else
   s:=jsonb_set(s,'{retired}',(s->'retired') || (ps->seat->'hand'));
   s:=jsonb_set(s,array['players',seat::text,'hand'],'[]'); s:=jsonb_set(s,array['players',seat::text,'out'],'true');
   s:=jsonb_set(s,array['players',seat::text,'left'],'true');
   if seat=(s->>'turn')::int then
    s:=jsonb_set(s,'{turn}',to_jsonb(clash_private.next_seat(s))); s:=jsonb_set(s,'{drawn}','null');
    s:=jsonb_set(s,'{deadline}',to_jsonb(extract(epoch from clock_timestamp())+120));
   end if;
   ps:=s->'players';
  end if;
  if not exists(select 1 from jsonb_array_elements(ps) p where not coalesce((p->>'left')::boolean,false)) then
   delete from clash_private.rooms where code=r.code; return jsonb_build_object('left',true);
  end if;
  if r.host=uid then select (p->>'id')::uuid into r.host from jsonb_array_elements(ps) p where not coalesce((p->>'left')::boolean,false) limit 1; end if;
  s:=jsonb_set(s,'{message}',to_jsonb(nm || ' left the room.')); s:=clash_private.finish(s);
  update clash_private.rooms set state=s,host=r.host,version=version+1,updated_at=now() where code=r.code;
  return jsonb_build_object('left',true);
 elsif p_action='lobby' then
  if uid<>r.host or s->>'phase'<>'finished' then raise exception 'Only the host can reopen a finished game.'; end if;
  select coalesce(jsonb_agg(jsonb_set(jsonb_set(p,'{hand}','[]'),'{out}','false')),'[]') into ps from jsonb_array_elements(ps) p where not coalesce((p->>'left')::boolean,false);
  s:=jsonb_set(s,'{players}',ps); s:=jsonb_set(s,'{phase}','"lobby"');
  s:=s || jsonb_build_object('deck','[]'::jsonb,'pile','[]'::jsonb,'retired','[]'::jsonb,'turn',0,'drawn',null,'skipJump',null,'pending',0,'minimum',0,'roulette',false);
  s:=s-'winner'-'deadline'; msg:='Lobby open. Invite friends or start again.';
 elsif p_action='reorder' then
  if uid<>r.host then raise exception 'Only the host can change the starting order.'; end if;
  if s->>'phase'<>'lobby' then raise exception 'Starting order can only be changed in the lobby.'; end if;
  if p_card is null or p_card<0 or p_card>=n then raise exception 'Choose a valid position in the order.'; end if;
  select value,(ordinality-1)::int into item,idx from jsonb_array_elements(ps) with ordinality where value->>'id'=p_target;
  if item is null then raise exception 'That player is no longer in the room.'; end if;
  ps:=ps-idx; ps:=jsonb_insert(ps,array[p_card::text],item);
  s:=jsonb_set(s,'{players}',ps); s:=jsonb_set(s,'{turn}','0');
  msg:='Host updated the order. ' || (ps->0->>'name') || ' will start.';
 elsif p_action='start' then
  if uid<>r.host then raise exception 'Only the host can start.'; end if;
  if s->>'phase'<>'lobby' then raise exception 'Return to the lobby first.'; end if;
  if n<2 then raise exception 'You need at least two players.'; end if;
  packs:=greatest(1,ceil((n::numeric*14+1)/(case when mode='mercy' then 168 else 108 end))::int);
  s:=jsonb_set(s,'{deck}',clash_private.deck(mode,packs));
  s:=jsonb_set(s,'{deckCopies}',to_jsonb(packs)); s:=jsonb_set(s,'{nextCardId}',to_jsonb(jsonb_array_length(s->'deck')+1)); s:=jsonb_set(s,'{pile}','[]'); s:=jsonb_set(s,'{retired}','[]');
  for i in 0..n-1 loop s:=jsonb_set(s,array['players',i::text,'hand'],'[]'); s:=clash_private.draw(s,i,7); end loop;
  select value,(ordinality-1)::int into card,idx from jsonb_array_elements(s->'deck') with ordinality where value->>'value' ~ '^[0-9]$' limit 1;
  s:=jsonb_set(s,'{deck}',(s->'deck')-idx); s:=jsonb_set(s,'{pile}',jsonb_build_array(card));
  s:=s || jsonb_build_object('color',card->>'color','phase','playing','turn',0,'direction',1,'drawn',null,'skipJump',null,'pending',0,'minimum',0,'roulette',false,'deadline',extract(epoch from clock_timestamp())+120);
  s:=s-'winner'; msg:='Cards dealt. Let’s play!';
 else
  if s->>'phase'<>'playing' then raise exception 'The game is not running.'; end if;
  turnseat:=(s->>'turn')::int;
  timeout:=p_action='timeout';
  if timeout then
   if extract(epoch from clock_timestamp()) < (s->>'deadline')::numeric then raise exception 'There is still time on this turn.'; end if;
   seat:=turnseat; nm:=ps->seat->>'name';
  elsif coalesce((ps->seat->>'out')::boolean,false) then raise exception 'You are out this round. You can watch until the rematch.';
  end if;
  h:=s->'players'->seat->'hand'; topcard:=s->'pile'->(jsonb_array_length(s->'pile')-1); countbefore:=jsonb_array_length(h);
  if not timeout and extract(epoch from clock_timestamp()) >= (s->>'deadline')::numeric then raise exception 'Time is up. Wait for the next turn.'; end if;
  if p_action='play' then
   select value,(ordinality-1)::int into card,idx from jsonb_array_elements(h) with ordinality where (value->>'id')::int=p_card;
   if card is null then raise exception 'That card is not in your hand.'; end if;
   jump:=seat<>turnseat;
   if jump then
    if s->>'skipJump'=uid::text then raise exception 'Taking a draw penalty ends your turn. Wait for another card to be played before jumping in.'; end if;
    if not coalesce((s->'settings'->>'jump')::boolean,false) or card->>'color'<>topcard->>'color' or card->>'value'<>topcard->>'value' then raise exception 'Wait for your turn, or jump in with an exact matching card.'; end if;
    if (s->>'roulette')::boolean or (s->>'pending')::int>0 then raise exception 'Resolve the draw penalty before jumping in.'; end if;
   elsif s->>'drawn' is not null and (s->>'drawn')::int<>p_card then raise exception 'You can only play the card you just drew.';
   end if;
   val:=card->>'value'; amount:=clash_private.draw_value(card);
   if (s->>'roulette')::boolean then raise exception 'Choose a roulette colour first.'; end if;
   if (s->>'pending')::int>0 then
    if amount<(s->>'minimum')::int then raise exception 'Stack a draw card of equal or higher value, or take the penalty.'; end if;
   elsif not clash_private.matches(card,s) then raise exception 'Match the colour or symbol.';
   end if;
   if mode='regular' and val='+4' and exists(select 1 from jsonb_array_elements(h) x where x->>'color'=s->>'color') then raise exception 'You can only play +4 when you have no cards of the current colour.'; end if;
   if card->>'color'='wild' and val<>'roulette' and (p_color is null or p_color not in ('red','yellow','green','blue')) then raise exception 'Choose a colour.'; end if;
   h:=h-idx;
   if coalesce(p_double,false) then
    if not coalesce((s->'settings'->>'double')::boolean,false) then raise exception 'Double play is off in this room.'; end if;
    if not jump and s->>'drawn' is not null then raise exception 'After drawing, play only the drawn card.'; end if;
    select (ordinality-1)::int into idx from jsonb_array_elements(h) with ordinality where value->>'color'=card->>'color' and value->>'value'=val limit 1;
    if idx is null then raise exception 'You need two identical cards (same colour and symbol).'; end if;
    s:=jsonb_set(s,'{pile}',(s->'pile') || jsonb_build_array(h->idx)); h:=h-idx; copies:=2;
   end if;
   s:=jsonb_set(s,'{skipJump}','null');
   s:=jsonb_set(s,'{turn}',to_jsonb(seat));
   if mode='mercy' and val='discard' then
    select coalesce(jsonb_agg(value),'[]') into extras from jsonb_array_elements(h) where value->>'color'=card->>'color';
    select coalesce(jsonb_agg(value),'[]') into h from jsonb_array_elements(h) where value->>'color'<>card->>'color';
    s:=jsonb_set(s,'{pile}',(s->'pile') || extras);
   end if;
   s:=jsonb_set(s,array['players',seat::text,'hand'],h);
   s:=jsonb_set(s,'{pile}',(s->'pile') || jsonb_build_array(card));
   if val<>'roulette' then s:=jsonb_set(s,'{color}',to_jsonb(case when card->>'color'='wild' then p_color else card->>'color' end)); end if;
   msg:=nm || case when jump then ' jumped in with ' else ' played ' end || copies || ' × ' || (card->>'color') || ' ' || val || '.';
   -- Finishing on any card wins immediately, before swap/pass effects.
   if jsonb_array_length(h)=0 then
    s:=jsonb_set(s,'{phase}','"finished"'); s:=jsonb_set(s,'{winner}',to_jsonb(uid::text)); msg:=msg || ' ' || nm || ' wins!';
   else
    if val in ('reverse','reverse4') then s:=jsonb_set(s,'{direction}',to_jsonb(-(s->>'direction')::int)); if clash_private.active_count(s)=2 then steps:=2; end if; end if;
    if val='skip' then steps:=2; end if;
    if val='skipall' then steps:=0; end if;
    if amount>0 then
     if mode='mercy' then
      s:=jsonb_set(s,'{pending}',to_jsonb((s->>'pending')::int+amount*copies)); s:=jsonb_set(s,'{minimum}',to_jsonb(amount));
     else
      target:=clash_private.next_seat(s); s:=clash_private.draw(s,target,amount*copies); steps:=2;
      s:=jsonb_set(s,'{skipJump}',ps->target->'id');
      msg:=msg || ' ' || (ps->target->>'name') || ' draws ' || amount*copies || ' and misses a turn.';
     end if;
    end if;
    if mode='mercy' and val='7' then
     select (ordinality-1)::int into target from jsonb_array_elements(s->'players') with ordinality where value->>'id'=p_target and value->>'id'<>uid::text and not coalesce((value->>'out')::boolean,false);
     if target is null then raise exception 'Choose an active player to swap hands with.'; end if;
     s:=jsonb_set(s,array['players',seat::text,'hand'],s->'players'->target->'hand');
     s:=jsonb_set(s,array['players',target::text,'hand'],h); msg:=msg || ' Swapped hands with ' || (ps->target->>'name') || '.';
    elsif mode='mercy' and val='0' then
     oldhands:=s->'players';
     for j in 0..n-1 loop
      if not coalesce((oldhands->j->>'out')::boolean,false) then
       target:=clash_private.next_seat(jsonb_set(s,'{turn}',to_jsonb(j)));
       s:=jsonb_set(s,array['players',target::text,'hand'],oldhands->j->'hand');
      end if;
     end loop;
     msg:=msg || ' Everyone passed their hand.';
    end if;
    -- Simplified digital ONE CARD rule applies to the played hand before swaps.
    if jsonb_array_length(h)=1 then
     if coalesce(p_uno,false) then msg:=msg || ' ONE CARD!';
     else s:=clash_private.draw(s,seat,2); msg:=msg || ' Forgot ONE CARD: drew 2.'; end if;
    end if;
    if val='roulette' then s:=jsonb_set(s,'{roulette}','true'); end if;
   end if;
   advance:=true;
  else
   if not timeout and seat<>turnseat then raise exception 'Wait for your turn.'; end if;
   if not timeout and extract(epoch from clock_timestamp()) >= (s->>'deadline')::numeric then raise exception 'Time is up. Wait for the next turn.'; end if;
   if (s->>'roulette')::boolean then
    if not timeout and p_action<>'roulette' then raise exception 'Choose a roulette colour first.'; end if;
    if timeout then p_color:='red'; end if;
    if p_color is null or p_color not in ('red','yellow','green','blue') then raise exception 'Choose a colour.'; end if;
    loop
     before_count:=jsonb_array_length(s->'players'->seat->'hand'); s:=clash_private.draw(s,seat,1); h:=s->'players'->seat->'hand';
     exit when jsonb_array_length(h)=before_count;
     card:=h->(jsonb_array_length(h)-1);
     exit when card->>'color'=p_color or (elimination and jsonb_array_length(h)>=25);
    end loop;
    s:=jsonb_set(s,'{color}',to_jsonb(p_color)); s:=jsonb_set(s,'{roulette}','false'); s:=jsonb_set(s,'{skipJump}',ps->seat->'id');
    msg:=nm || ' chose ' || p_color || ' and drew ' || (jsonb_array_length(h)-countbefore) || ' in roulette.'; advance:=true;
   elsif (s->>'pending')::int>0 then
    if not timeout and p_action<>'draw' then raise exception 'Stack a draw card or take the penalty.'; end if;
    amount:=(s->>'pending')::int; s:=clash_private.draw(s,seat,amount);
    s:=jsonb_set(s,'{skipJump}',ps->seat->'id');
    s:=jsonb_set(s,'{pending}','0'); s:=jsonb_set(s,'{minimum}','0'); msg:=nm || ' took a +' || amount || ' penalty.'; advance:=true;
   elsif timeout then
    if s->>'drawn' is null then s:=clash_private.draw(s,seat,1); end if;
    msg:=nm || ' ran out of time. Turn passed.'; advance:=true;
   elsif p_action='draw' then
    if s->>'drawn' is not null then raise exception 'You already drew. Play that card or pass.'; end if;
    if mode='mercy' and exists(select 1 from jsonb_array_elements(h) x where clash_private.matches(x,s)) then raise exception 'You have a playable card. Play it instead of drawing.'; end if;
    loop
     before_count:=jsonb_array_length(s->'players'->seat->'hand'); s:=clash_private.draw(s,seat,1); h:=s->'players'->seat->'hand';
     if jsonb_array_length(h)=before_count then advance:=true; exit; end if;
     card:=h->(jsonb_array_length(h)-1);
     exit when mode='regular' or clash_private.matches(card,s) or (elimination and jsonb_array_length(h)>=25);
    end loop;
    s:=jsonb_set(s,'{drawn}',coalesce(card->'id','null'::jsonb));
    msg:=nm || ' drew ' || (jsonb_array_length(h)-countbefore) || ' card(s).';
    if elimination and jsonb_array_length(h)>=25 then advance:=true; end if;
   elsif p_action='pass' then
    if s->>'drawn' is null then raise exception 'Draw a card before passing.'; end if;
    if mode='mercy' and exists(select 1 from jsonb_array_elements(h) x where (x->>'id')::int=(s->>'drawn')::int and clash_private.matches(x,s)) then raise exception 'In No Mercy, you must play the matching card you drew.'; end if;
    advance:=true; msg:=nm || ' passed.';
   else raise exception 'Unknown action.';
   end if;
  end if;
  s:=jsonb_set(s,'{message}',to_jsonb(msg)); s:=clash_private.finish(s); msg:=s->>'message';
  if advance then
   if steps=0 and coalesce((s->'players'->((s->>'turn')::int)->>'out')::boolean,false) then steps:=1; end if;
   s:=jsonb_set(s,'{turn}',to_jsonb(clash_private.next_seat(s,steps))); s:=jsonb_set(s,'{drawn}','null');
   s:=jsonb_set(s,'{deadline}',to_jsonb(extract(epoch from clock_timestamp())+120));
  end if;
 end if;
 s:=jsonb_set(s,'{message}',to_jsonb(msg));
 update clash_private.rooms set state=s,version=version+1,updated_at=now() where code=r.code;
 return public.clash_state(r.code);
end $$;
revoke all on all functions in schema clash_private from public, anon, authenticated;
revoke all on function public.clash_state(text) from public, anon;
revoke all on function public.clash_enter(text,text,text,boolean,boolean,boolean) from public, anon;
revoke all on function public.clash_action(text,int,text,int,text,boolean,boolean,text) from public, anon;
grant execute on function public.clash_state(text) to authenticated;
grant execute on function public.clash_enter(text,text,text,boolean,boolean,boolean) to authenticated;
grant execute on function public.clash_action(text,int,text,int,text,boolean,boolean,text) to authenticated;
commit;
