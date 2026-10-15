# TODO

Planned work, in the order it was asked for. Nothing here is started unless ticked.
Notes under an item are decisions or open questions to settle before building it.

## Live games
- [ ] **Bring the remaining games online.** Each needs a server-side rules module in `worker/rules/`, a registry entry in `worker/live-games.mjs`, and a `LiveShare` next to its `AsyncShare` (see README, "To add a game").
  - [ ] Wave 2: Checkers, Mancala, Pentago, Memory, Minesweeper (two-player)
  - [ ] Chess (extract the move generator so browser and server share it)
  - [ ] Hidden-information games: Battleship, Hangman, Mastermind. The server must hold the secrets and reveal only results, the way Rock Paper Scissors does now.

## Online button and mode picker
- [ ] Put the lightning emoji back **inside the games**, next to "Online" (it was removed from the hub badges and the button; confirm it is wanted only inside the game pages).
- [ ] Tone down the Online colour. The orange gradient button is too bright; the hub badge may need the same.
- [ ] Fix the Online button position in games where it lands at the bottom, under "new game". It should sit beside the mode picker, as it does elsewhere. Check each game's markup: the picker row is not always the first `.controls`.
- [ ] Customize every selector (mode, difficulty, best-of, ...) instead of the browser's default `<select>`. One shared component, keyboard and screen-reader friendly.
- [ ] Keep "how to ?" at the top right on every game, in the same place.

## In-game polish
- [ ] Reduce what is visible once a game starts (hide setup chrome, secondary buttons) so taunts and the board get the room.
- [ ] Rock Paper Scissors: replace the in-game emojis with better art. Reuse the hub card's hand illustrations.
- [ ] In-game light mode. Game pages are dark-only today; the hub already has light/dark/system.

## Accounts-lite, friends and notifications
- [ ] **Usernames.** The player picks one; if it is taken they pick another. All names live in a database (Durable Object registry or D1), so uniqueness is enforced server-side. No passwords or email.
  - Open: how a name is "owned" after it is picked (a secret token kept in the browser, like the room seat tokens), and what happens if that is lost.
  - Open: reserved and offensive names, length and character set, rate limits.
- [ ] **Installable web app** (add to home screen). A manifest exists; add a service worker and an install prompt on the homepage.
- [ ] **Poke a friend.** Send a push notification asking a friend to play a specific game with you, opening straight into a live room.
  - Web Push (VAPID) needs the installed app on iOS (16.4+); Android and desktop work from the browser.
  - Needs: friend list or "find by username", notification permission flow, a way to block or mute someone, an abuse limit on pokes.
  - Update the privacy page: what is stored (username, push subscription), retention, how to delete it.

## Taunts in live games
- [ ] **Angel and devil taunts.** During a live game, suggest a "good" (angel) and a "bad" (devil) taunt. Tapping one sends it to the opponent.
  - Server: a new `taunt` message carrying only an id from a fixed list (never free text), validated and rate limited, relayed to the other seat.
  - Client: show the two suggestions, show the received taunt briefly, respect a mute option.
  - Reuse and extend the existing lines in `taunts.js` so wording stays in one place.

## Suggested order
1. Quick visual fixes: Online colour and position, "how to" placement, lightning emoji.
2. Custom selectors and the reduced in-game chrome (they touch the same markup).
3. In-game light mode and Rock Paper Scissors art.
4. Angel/devil taunts (self-contained, builds on the live protocol).
5. Remaining live games, in the waves above.
6. Usernames, then the installable app, then poke notifications. These add a database and Web Push, so they are the largest piece and want their own plan.
