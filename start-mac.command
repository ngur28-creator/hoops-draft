#!/bin/bash
# Double-click to run PitchRank on your Mac: starts a small local web server and opens the site.
cd "$(dirname "$0")/site"
( sleep 1; open "http://localhost:8000" ) &
python3 -m http.server 8000
