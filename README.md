# Crownless Court

Crownless Court ist ein modernes Online-Mehrspieler-Kartenspiel (Node.js + Express + Socket.io) mit Lobby, Chat, Rundenlogik, Rangwechseln, Kartentausch, Revolution/Aufstand und Bot-Unterstützung.

## Highlights

- Lobby mit Raumverwaltung, Invite-Link, Start/Join/Leave/Rejoin
- Spielerzahl 4–8, Runden 1–30
- Punktewertung über mehrere Runden (Rang-basiert)
- Kartentausch zwischen obersten/untersten Rängen (Narren ausgeschlossen)
- Revolution/Aufstand bei zwei Narren
- Mehrfachauswahl von Karten, Spielen/Passen/Austausch
- Animierte Fächer-Hand mit Emoji-Karten
- Bots können Slots auffüllen, übernehmen bei Disconnect, geben Sitz zurück bei Rejoin

## Setup

```bash
npm install
npm start
```

Dann öffnen: `http://localhost:3000`

## Invite-Link

Beispiel:

```text
http://localhost:3000/?room=hof-77&name=Alex
```

Oder in der Lobby auf **„Einladungslink kopieren“** klicken.

## Hosting

### Render
- Build Command: `npm install`
- Start Command: `npm start`
- Port: `3000`

### Railway
- Deploy aus Repo
- Start Command: `npm start`
- Port: `3000`

### Heroku
```bash
heroku create
heroku buildpacks:set heroku/nodejs
git push heroku main
```

### VPS
```bash
sudo apt update && sudo apt install -y nodejs npm
npm install
npm start
```

Für Produktivbetrieb optional `pm2` oder `systemd` nutzen.
