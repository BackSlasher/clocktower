# Clocktower

A co-op steampunk tower defence for a living room, in the style of Jackbox games. The TV shows the town of Brasswick and a horde of scrap-metal machines marching on its Great Clock. Up to eight players join from their phones, build and upgrade clockwork towers, and keep them wound by hand to hold out for 15 waves. It is one Go binary: no accounts, no app to install, no front-end build step.

![A late wave on the TV: towers of every kind, enemies on the streets, four engineers along the bottom](docs/img/tv-hero.jpg)

## Quick start

1. Install Go (version in `go.mod`) and clone this repository.
2. `go run ./cmd/clocktower`
3. Open `http://localhost:8080/tv` on the big screen.
4. Players scan the QR code with their phones (or open the address shown and type the room code).
5. The first player to join presses Start.

![Phone with a Rivet Gun selected, showing Upgrade, Sell and CRANK](docs/img/phone-tower.jpg)

## Documentation

- [docs/GAMEPLAY.md](docs/GAMEPLAY.md): how the game plays, for players and hosts. Towers, enemies, cranking, perks.
- [docs/RUNNING.md](docs/RUNNING.md): running, hosting, deploying, and developing it.
- [docs/DESIGN.md](docs/DESIGN.md): design rationale and balance targets.
- [docs/PROTOCOL.md](docs/PROTOCOL.md): architecture and websocket protocol.
- [CREDITS.md](CREDITS.md): audio credits and licences.
