# Colour Clash — Updated cards, room order and scalable decks

For an EXISTING game, open UPDATE-HERE.html in this download. For a new project, START-HERE.html contains the original full setup guide.

## What changed

- Improved card faces: larger symbols, distinct action icons, corner values, colour markers and playable-card highlights.
- Every player has a name above a fan of hidden cards, an exact count underneath, a turn indicator and a ONE CARD warning. The decorative fan shows at most five backs; the numeric count is always the actual hand size. Opponents' card identities remain private.
- The host can move players earlier/later in the lobby. Player 1 starts. The numbered order is the underlying seating order; jump-ins resume after the jumper, Reverse changes direction, Skip misses the next active player, and eliminated/left players are bypassed.
- Forced draw-card pickups end the recipient's turn. They cannot immediately jump in until somebody plays another card. Normal one-card drawing in Regular allows that drawn card to be played if legal.
- No Mercy has an optional “Eliminate at 25 cards” setting, visible only in No Mercy and OFF by default. It applies to all players in that room and persists for rematches. No Mercy still uses draw-until-playable, 7 swaps, 0 passes, escalating draw stacks and its special action cards.
- No fixed player cap is enforced by the application. Real capacity depends on Supabase resources, bandwidth and devices. Local database checks included 40-player starts in both modes; this is not a claim of infinite practical capacity or a production load test.
- Corrected card ratios. No Mercy's earlier wildcard distribution was incorrect; the counts below replace it.

## Exact base-deck counts

Regular (108): one 0 of each colour; two each of 1–9 per colour; two each of Skip, Reverse and +2 per colour; four Wild; four Wild +4.

No Mercy (168): two each of 0–9 per colour; three each of Skip, Reverse, +2 and Discard All per colour; two each of coloured +4 and Skip Everyone per colour; eight Wild Reverse +4; eight Colour Roulette; four Wild +6; four Wild +10. No plain Wilds in this mode.

Starting deck copies = max(1, ceil((14 × players + 1) / base deck size)). Seven cards are dealt to each player; one number starts the discard pile. All copies are combined and shuffled server-side. Every card has a unique ID. When the draw pile empties, discards other than the top card and retired hands are reshuffled. If there are still no cards available, a complete extra base deck is added with fresh IDs. This preserves the manufactured deck proportions across all generated cards, while the remaining draw pile naturally changes during play. No partial or arbitrary card refill is used.

Examples: 2 players → 108 Regular or 168 No Mercy cards. 15 players → 216 Regular or 336 No Mercy. 40 players → 648 Regular or 672 No Mercy.

Composition references:
- Mattel Regular 108-card list: https://service.mattel.com/instruction_sheets/W2085.pdf
- No Mercy physical rules: https://service.mattel.com/instruction_sheets/HVW18-Eng.pdf
- No Mercy count cross-check: https://ruthlessgame.com/blog/uno/todas-las-cartas
- Independent physical-deck count: https://www.reddit.com/r/unocardgame/comments/1uqxy3u/help/

## Update steps

1. Finish any current matches. Keep your existing config.js with its Project URL and publishable key.
2. Open UPDATE-HERE.html. Copy its complete SQL update into a new query in the SAME Supabase project's SQL Editor and click Run. It updates game functions; it does not ask you to delete the project or tables.
3. In the SAME GitHub repository: Add file → Upload files. Upload the files inside this update folder and commit. The package contains no config.js, so it cannot overwrite your connection details.
4. Wait for Pages to finish publishing. Everyone should refresh the game (Ctrl+F5 on Windows) or close and reopen the installed app. If needed, reload once more after the service worker updates.
5. Create a NEW room for the new settings and corrected deck distribution. In No Mercy, elimination starts off. In the lobby, the host arranges the order using the arrows before starting.

Do not create a replacement Supabase project or change your website address. This update requires both the SQL and frontend changes.

## Existing house rules retained

Double play removes two identical cards as one move: draw penalties add, other effects happen once. No Mercy penalty stacking is a separate rule and requires an equal-or-higher individual draw value. Jump-in requires identical printed colour and value and pauses during pending draw penalties or roulette. ONE CARD is an automatic +2 if not declared when the played hand drops to one. Final-card wins are immediate before its final action; there are no points or challenges. Two-minute timeout rules remain. Settings change by creating a new room; rematches retain them.

## Verification

Local PostgreSQL-compatible tests cover exact composition and multipliers, unique IDs, larger rooms, default-off and enabled elimination, >25-card hands, empty-pile replenishment, permissions, hidden hands, host-only ordering, turn traversal, forced pickups, normal draws and existing actions. Local browser tests cover two separate player sessions, creating/joining/starting, the No Mercy-only toggle, host order buttons, player counters, card rendering and phone layouts. Live hosting and physical phone installation still need checking on your deployed site.

## Included update files

index.html, app.js, style.css, sw.js, manifest.webmanifest, setup.sql, README.md, START-HERE.html, UPDATE-HERE.html.

Keep your original config.js, supabase.js, icons and SUPABASE-LICENSE.txt in the repository. This is an update bundle, not a complete new installation.

Independent UNO-style game. No affiliation with Mattel. Supabase SDK remains under its supplied MIT licence.
