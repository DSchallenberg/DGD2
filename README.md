# Crownless Court

Crownless Court ist ein Online-Multiplayer-Kartenspiel mit Rangwechseln, Austausch, Revolution/Aufstand und Punktewertung über mehrere Runden. Es basiert auf einem klassischen höfischen Stichspiel, verwendet aber einen eigenen Namen.

## Features

- Node.js/Express/Socket.io-Server mit Lobby, Chat und Raumverwaltung
- Spielregeln mit Rangwechseln, Kartentausch, Revolution/Aufstand
- Mehrere Runden mit Punktewertung und Rang-Scoreboard
- Mehrfachauswahl auf der Hand, „Ausgewählte spielen“, „Passen“, „Austausch senden“
- Einfache Bots, die gültige Züge wählen, optionales Auffüllen leerer Plätze
- Einladungslink per URL-Parameter (`?room=...`) zum schnellen Beitritt

## Setup

```bash
npm install
npm start
```

Danach unter `http://localhost:3000` öffnen.

### Einladungslink

Öffne `http://localhost:3000/?room=dein-raum&name=DeinName`, um einem Raum direkt beizutreten
oder teile den Link über den Button „Einladungslink kopieren“ in der Lobby.

## Hosting-Beispiele

### Render
1. Neues Web Service Projekt erstellen.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Port: `3000`

### Railway
1. Neues Projekt aus GitHub-Repo.
2. Deploy starten, Railway erkennt `npm start` automatisch.
3. Port: `3000`

### Heroku
```bash
heroku create
heroku buildpacks:set heroku/nodejs
heroku config:set NODE_ENV=production
 git push heroku main
```

### VPS (Ubuntu)
```bash
sudo apt update && sudo apt install -y nodejs npm
npm install
npm start
```

Optional: Verwende `pm2` oder `systemd`, um den Server dauerhaft laufen zu lassen.
