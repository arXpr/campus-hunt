# Campus Hunt

## Run locally
npm install && npm start   # http://localhost:3000
(GPS only works on HTTPS or localhost, so deploy for real phone tests.)

## How to play
1. The host creates a room and shares its four-letter code with the group.
2. In the lobby, use **Swap** to assign at least one hunter and one runner. The host can optionally assign hunters randomly and set a play-zone radius around their current location.
3. Set the runners' head start and the hunt duration, then start the game. Hunters get a live direction-and-distance radar; runners get nearby-hunter and play-zone alerts.
4. A hunter can tag when the nearest runner is within 50 m. Hunters need a fresh GPS fix with accuracy of 40 m or better. The game ends when all runners are caught or the hunt timer runs out.

Everyone should allow location access and keep the game open while playing. Use a phone with location services enabled; if GPS is weak, move to an open area. Choose an accessible play area, stay aware of traffic and your surroundings, and never enter restricted or unsafe places.

## Deploy (Render, free)
1. Push this folder to a GitHub repo.
2. render.com > New > Web Service > pick the repo.
3. Build command: npm install   Start command: npm start
4. Open the https://….onrender.com link on phones; make a QR code of it.
Free tier sleeps after idle: open the link ~1 minute before the event.

## Tuning (server.js top)
TAG_RANGE (50 m), MAX_ACC (40 m GPS accuracy limit), STALE (30 s).
Game state is in memory: a server restart ends active games.
