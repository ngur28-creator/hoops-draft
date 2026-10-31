# PitchRank

Soccer player points and leaderboards from real match stats, live at https://claudba.netlify.app

- `site/` is the website (served as is). `site/index.html` is the whole app; it loads `site/data.json` (this season)
  and `site/history/*.json` (every season since 1999/00).
- `pitchrank/` holds the collected data and the updater. See `pitchrank/README.md`.
- `.github/workflows/pitchrank-update.yml` refreshes the stats every 3 hours.

Run it locally: `cd site && python3 -m http.server 8000`, then open http://localhost:8000.
