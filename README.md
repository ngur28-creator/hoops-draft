# 82-0 Hoops Draft

Roll a random era and franchise, draft five players, and chase an 82–0 season and a 16–0 title run.

- `site/index.html` is the whole game (player data included).
- `netlify/functions/lb/lb.mjs` is the leaderboard API at `/api/lb`. Anyone can submit; each browser keeps a
  secret token so only its owner can replace their entry. The server looks every player up in
  `valid.mjs` and recalculates the score itself, so ratings can't be faked.
- Scores live in Netlify Blobs (store `hoops-lb`). Deploy previews use a separate throwaway store.

Run it locally with `npm install && npm run dev`, then open http://localhost:8888. Tests: `npm test`.
