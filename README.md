# Colour Clash

Open **START-HERE.html** for the complete beginner setup guide, a copy button for the database code, and a config.js generator.

An independent UNO-style private-room game for 2–15 players. Works in modern phone/tablet/desktop browsers; includes an installable web-app manifest, service worker and icons.

## Included settings

The host chooses before creating a room:

- **Regular / No Mercy**.
- **Jump-in**: exact colour and value match. Disabled during pending draw stacks or roulette.
- **Double play**: tick “Play two” to discard two identical cards as one move. Draw penalties add; other effects happen once. Not allowed immediately after drawing.

No Mercy draw-penalty stacking is separate from double play. Equal-or-higher draw cards can extend a pending penalty; the last individual draw card sets the minimum, not the combined total. Colours do not restrict responding to a draw stack.

## Setup summary

1. Create a Supabase Free project; enable anonymous sign-ins.
2. Run **all of setup.sql** in SQL Editor.
3. Put the project URL and **publishable** key in config.js. Never use a secret/service_role key.
4. Upload the files inside this folder to the root of a public GitHub repository.
5. Settings → Pages → Deploy from a branch → main → / (root) → Save.
6. Open the published URL. Install to the phone's home screen before joining a room.
7. Create a room and invite friends. Use a private/incognito browser for a second local test player.

## Controls

Click a highlighted card. Wild cards open a colour picker; No Mercy sevens offer a hand-swap picker. Tick “Call ONE CARD” before playing down to one card. Draw or pass using the buttons. The host starts and reopens the lobby after a round. Settings persist for rematches; create a new room to change them.

## Rules and deliberate adaptations

- Two 108-card decks in Regular; two expanded 168-card decks in No Mercy for up to 15 players.
- Regular: draw one, optionally play only that drawn card, or pass. No draw-penalty stacking. Wild +4 is valid only with no current-colour cards.
- No Mercy: draw until playable, escalating draw penalties, elimination at 25 cards, 7 hand swaps, 0 passing all active hands, Discard All, Skip Everyone, coloured +4, Wild Reverse +4, +6, +10 and Colour Roulette.
- With two players, Reverse skips the opponent. No Mercy Wild Reverse +4 sends the pending penalty back to its player, who may stack or take it.
- Double play removes two identical cards as one move. Draw amounts combine, but other effects apply once. Two skips skip one player, two reverses reverse once, two sevens swap once.
- Jump-in changes the active move to the jumper. Exact printed colour and symbol are required, including identical wild types. Pending penalties must resolve first. Simultaneous actions are serialized; a stale action is rejected and can be retried after refresh.
- A final card wins immediately before its final action, including 7/0.
- ONE CARD uses an automatic +2 penalty if not declared when the played hand drops to one; swaps/passing do not trigger extra calls. This differs from an official catch/challenge system.
- Two-minute turns. Timeout resolves pending penalties or draws one if not already drawn and passes. Roulette timeout picks red. This is a custom anti-stall rule.
- No Mercy draws stop at elimination (25); eliminated hands are set aside until replenishment. Eliminated players can watch and return at the next lobby.
- No points, official branding, challenges, bots, public matchmaking or mid-round joining. This is an independent adaptation, not an official UNO product.

## Technical structure

The static frontend uses bundled Supabase JS 2.57.4. No build command is required. The browser signs in anonymously and calls three authenticated RPC functions: clash_enter, clash_state and clash_action. All rules, shuffling, hands and room updates live in PostgreSQL. The private schema is inaccessible to anon/authenticated roles; only the narrow API functions are executable. State responses include only the caller's hand, public counts and table state. The current drawn-card ID is private to the current player. Names are rendered as text, not HTML.

Moves acquire a row lock and require the current room version. Polling is every 1.8 seconds while the tab is visible; this intentionally avoids a Realtime subscription setup. Use for friends; this is not optimized for a large public service. Host roles transfer on explicit leave, not automatically when a browser is closed. Other players can advance expired turns. Each anonymous identity can host up to five rooms. Old rooms and anonymous identities require occasional owner cleanup. Free-plan quotas and sign-in rate limits apply. Consider an anti-abuse/CAPTCHA integration before opening it to a large public audience; it is not included.

The PWA uses network-first shell caching. Multiplayer always needs internet. The app does not save API responses or other players' hands in its service-worker cache. Your local anonymous authentication session persists in that browser/app; clearing site data loses that identity. Install before joining because an installed app may have separate storage. Updates require uploading changed frontend files; SQL updates must also be run in the dashboard. Create new rooms after a rules update.

## Verification

Local PostgreSQL-compatible engine tests cover room capacity, private hands, role permissions, turn enforcement, complete Regular playthroughs with card conservation, host transfer, recycling, penalties, timers, jump-in/double rules and No Mercy actions. Browser checks cover desktop/mobile layout, two separate players, room settings, create/join/start, jump-in + double play, wild colour selection, No Mercy penalties, refresh/rejoin and guide config generation. Live Supabase, GitHub Pages and physical iPhone/Android installation remain to be checked after account setup.

## Files

- index.html / style.css / app.js — frontend.
- config.js — project URL and publishable browser key.
- supabase.js / SUPABASE-LICENSE.txt — bundled MIT-licensed SDK.
- setup.sql — protected database schema and game logic.
- manifest.webmanifest / sw.js / icon-*.png — home-screen installation.
- START-HERE.html — full setup guide with copy/download buttons.

Your generated game code is supplied for editing and use. The bundled Supabase library retains its MIT licence. UNO and UNO Show 'em No Mercy are Mattel trademarks; no affiliation is claimed.
