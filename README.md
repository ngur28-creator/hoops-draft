# 82-0 Hoops Draft

Roll a random era and franchise, draft five players, and chase an 82–0 season and a 16–0 title run. Or play the
Monthly Draft (the same five rolls for everyone all month, one try a day, your best try counts), a five-year
Dynasty, a Draft vs Friend, the Legends Gauntlet, and the Arcade: 100 games (the five classics, Higher or Lower,
Buzzer Beater, Survival, the daily Mystery Player and Speed Draft, plus 95 quick canvas games: shooting, arcade-hall
machines like Pop-A-Shot, Skee-Ball and a claw machine, action, reflex, retro, puzzle, brain and card games). Every Arcade game has three stars to earn and pays tickets for the Prize
Counter; the Prize Wheel spins free once a day. Three daily quests change every day.

- `site/index.html` is the whole game (player data included).
- `netlify/functions/lb/lb.mjs` is the leaderboard API at `/api/lb`: the Normal and Hard Mode boards, the Monthly
  Draft boards (one a month), the Mystery Player boards (one a day, California time), and the Legends Gauntlet,
  Dynasty, Higher or Lower, Buzzer Beater, Survival and Speed Draft boards, and one board for each of the
  Arcade's 95 canvas games (`x_<id>`, listed with their highest possible scores in `xgames.mjs`). (The old Daily Draft boards still take
  entries from pages that haven't reloaded since the Monthly Draft replaced it.) Anyone can submit; each browser keeps a secret token, so only its
  owner can replace their entry. Seasons can't be faked: every draft starts from a ticket the server signs (a
  random seed), and the server replays the whole draft and season with the game's own code (`engine.mjs`, built
  from `site/index.html`) and posts what really happened. The season's own seed only comes from the server once the lineup is
  final (one lineup per draft), so nobody can try lineups against it. The Monthly Draft replays from its day. The
  owner can post any season with the owner key (only its hash is in the code). Arcade results
  are checked for being possible.
- `netlify/functions/duel/duel.mjs` is Draft vs Friend over the internet at `/api/duel`: one player creates a duel,
  the other joins with their username, and the server checks every pick (whose turn, which roster, open spot).
- Scores live in Netlify Blobs (store `hoops-lb`). Deploy previews use a separate throwaway store.
- Players pick a name once; after that their best season on each board posts itself after every season
  (hard mode seasons go to the Hard Mode board, everything else to Normal), and so do their Arcade bests.

Run it locally with `npm install && npm run dev`, then open http://localhost:8888. Tests: `npm test`.
