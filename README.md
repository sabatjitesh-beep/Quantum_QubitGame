# Quantum Traitor: public multiplayer

A social deduction game about quantum key distribution. Anyone with the link can play. No Claude account is needed.

The game has two parts that must run together: the **server** (`server.js`) and the **page** (`public/index.html`). You must open the game through the server's web address. Double-clicking `index.html` will not work for multiplayer.

## Files (keep them together)
    server.js          the backend (no installs needed)
    package.json
    public/index.html  the game page (the public folder must stay next to server.js)
    start.bat          Windows: double-click to start
    start.sh           Mac/Linux: ./start.sh
    render.yaml        optional settings for Render hosting


Friends on the same Wi-Fi can open the `On your network` address that is printed.



## How it works
- The browser opens a Server-Sent Events stream to `/events` and sends actions to `/act`.
- Rooms live in memory with a 4-character code. Up to 6 humans per room, and bots fill the rest.
- Roles stay on the server. A refresh keeps your seat, and if the host leaves another player becomes host.
- Rooms with nobody online are deleted after 10 minutes. Run one instance only, since rooms are lost on restart.
