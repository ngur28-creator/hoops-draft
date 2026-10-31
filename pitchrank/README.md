# PitchRank

Soccer player points and leaderboards from real match stats. Lives at `/pitchrank/` on the same site as the hoops game.

- `site/pitchrank/index.html` is the whole website. It loads `site/pitchrank/data.json`.
- `pitchrank/data/` holds every match collected so far (`matches.ndjson`, one match per line) plus players, clubs and photo ids (`meta.json`).
- `pitchrank/update.mjs` fetches newly finished matches from Sofascore, matches new players to FotMob photos once a day, and rebuilds `data.json`.
- `.github/workflows/pitchrank-update.yml` runs the updater every 3 hours and commits the new data, which redeploys the site.

## Update by hand

```
node pitchrank/update.mjs            # new matches (and photos once a day)
node pitchrank/update.mjs --images   # re-match photos and badges now
node pitchrank/update.mjs --build    # just rebuild data.json
git add pitchrank/data site/pitchrank/data.json && git commit -m "PitchRank: stats update" && git push
```

If the GitHub Action log says Sofascore refused the requests (403), run the same command on your own computer instead.
On a Mac you can schedule it with `crontab -e`, for example every 3 hours:

```
17 */3 * * * cd ~/hoops-draft && git pull -q && node pitchrank/update.mjs && git add pitchrank/data site/pitchrank/data.json && git commit -qm "PitchRank: stats update" && git push -q
```

## Free services the page uses
- AI answers: Pollinations (`text.pollinations.ai`), free, no key.
- Translation: Google Translate's free web endpoint.
- Photos and badges: FotMob's image server.
