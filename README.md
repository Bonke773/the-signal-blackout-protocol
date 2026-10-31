# THE SIGNAL — Blackout Protocol

A playable real-time multiplayer cyber-thriller for **2–8 people on separate devices**. Uses Express and Socket.IO, with a server-authoritative match engine and a responsive vanilla JavaScript frontend.

## Features

- Create and join private six-character room codes
- Share invite links and enter a nickname without signup
- 2–3 players: cooperative protocol; 4–8: infiltration protocol
- Secret player roles, 3 rounds, server-managed timers, puzzle verification, repair/sabotage actions
- Investigation, strict-majority quarantine voting, team victory, personal points, rematches
- Automatic session resume after refresh on the same device (browser localStorage)

## Local quick start

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open **http://localhost:3000**. Test with another browser (or incognito) to create and join a separate player. To test on another device connected to the same Wi-Fi, open `http://YOUR_LAN_IP:3000`, and make sure the computer firewall allows port 3000.

## Public publishing

**Recommended: a Node.js host such as Render, Railway, or Fly.io.** This is a **Node.js server** and cannot be deployed as a static-only Netlify Drop upload. Netlify Drop alone cannot host the continuous Socket.IO backend.

1. Put this folder in a GitHub repository (do not upload `node_modules`).
2. In your hosting provider, create a **Web Service** from that repository.
3. Build command: `npm install`. Start command: `npm start`. Use Node 20+.
4. Make sure the provider supports persistent Node HTTP servers and WebSockets. The application listens on `process.env.PORT` automatically.
5. Open your assigned public HTTPS URL from two unrelated devices and play all three rounds.

The host should run one server instance. Rooms are currently in-memory and reset on server restart or sleep. Free host plans may sleep between matches. For durable production scale, use Redis or a transactionally consistent database and the Socket.IO multi-node adapter. Users must not be routed to separate uncoordinated replicas.

## Rules

The network begins at 70 integrity. Complete 3 rounds. Each round: 40 seconds of action, 20 seconds investigation, 15 seconds voting (infiltration mode), 6.5 seconds result. Puzzle correctness is validated on the server. A node is repaired if at least half of non-quarantined players correctly answer **and** a correct solver submits a repair action. Successful repair: +12 integrity and +1 node. Failure: -10 integrity. Confirmed sabotage: -15 integrity (cap one penalty per round). Wrong quarantine: -10. Win by restoring at least 2 nodes with integrity >0 after round 3. The infiltrators win otherwise. In cooperative mode everyone is an operative.

## Constraints

- This is a **complete playable MVP**, not a high-security or production-scaled service. Room state is ephemeral. Reconnection is supported while the process is running.
- For privacy, only the client authenticated by its random per-player token receives its private role; reconnecting with the token replaces its former session.
- Public status changes arrive over Socket.IO. There is no voice or text chat; players can use existing communication channels.
- Puzzle challenges are lightweight and designed for mobile. Production-hardening could include rate limits, replay protection, spectator roles, and better identity authentication.
- **Important:** The game is not published yet. It must be deployed to a compatible public host and tested over the internet before competition submission.
