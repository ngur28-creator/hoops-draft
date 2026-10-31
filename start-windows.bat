@echo off
rem Double-click to run PitchRank on Windows: starts a small local web server and opens the site.
cd /d "%~dp0site"
start "" http://localhost:8000
python -m http.server 8000
