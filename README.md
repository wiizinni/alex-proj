# Pop Quiz Party

PopSauce-style multiplayer trivia. Friends join with a 4-letter room code, no accounts needed.
Host adds custom text and image questions; guesses are judged on the server, so answers stay hidden until the reveal.
No dependencies: just Node 18+.

## Deploy online (Render, free)

1. Create a GitHub repo and push this folder to it (server.js, package.json, public/, render.yaml).
2. Go to https://render.com, sign up, then New > Web Service and connect the repo.
3. Settings: Runtime = Node, Build Command = (leave empty or `true`), Start Command = `node server.js`, Plan = Free.
   (Or choose New > Blueprint and Render will read render.yaml.)
4. Deploy. Render gives you a URL like https://pop-quiz-party.onrender.com.

Railway, Fly.io or any Node host also work: just run `node server.js` (it reads the PORT env var).

## Run on your own computer

    node server.js
    # open http://localhost:3000

To let friends reach it, run a tunnel in another terminal, e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and share the URL it prints.

## Playing

1. Open the site, enter a nickname, click **Create a room**. You are the host (and can play too).
2. Add questions in Host controls. Image questions: choose a file (it is shrunk to 1024px automatically) and list accepted answers, comma separated.
   Matching ignores case, spaces, punctuation and accents.
3. Click **Copy invite link** and send it to friends. They enter a nickname and join.
4. Hit **Next question**. Faster correct guesses score more (100 down to 10). The round ends when the timer runs out or everyone online has solved it.

## Good to know

- Everything is stored in memory. Free hosts sleep after inactivity and restarts wipe rooms and questions. Open the site a minute before game night to wake it, and keep the host tab open during play.
- Rooms with nobody connected are deleted after 6 hours.
- Anyone with the room code can join; only the browser that created the room has the host token. Refreshing the page keeps you in the room (same tab).
