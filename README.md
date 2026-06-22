# 🦆 Quack Arcade

**Eine kleine Arcade-Halle voller Gummienten.** Ein Hub im CRT-Neon-Look führt zu mehreren
Enten-Minispielen — jedes mit einer eigenen, ungewöhnlichen Steuerung, alle um *eine* Gummiente herum.

▶ **Live spielen: https://building-challenge.pages.dev**

Gebaut für die **SKAILE Academy Building Challenge** (Pflicht-Thema: eine Gummiente muss vorkommen).
Vanilla HTML/CSS/JS, **kein Build-Step**, läuft direkt im Browser auf Handy und Desktop.

---

## Die Spiele

### 🐤 DUCK & COVER — *Rubber-Duck-Debugging als Climber*
Klettere eine Säule aus **echten Code-Bugs** hoch. Jeder Absatz trägt einen benannten Software-Bug
(`NullPointerException`, `off-by-one`, `race condition`, `DROP TABLE students` …) — landest du drauf,
ist der Bug „gefixt" (grün durchgestrichen, +1). Die Kamera scrollt hoch, fällst du unten raus:
*„Have you tried explaining it to the duck?"*

**Der Clou:** Eine **echte Gummiente quietschen = springen** — über das Mikrofon. Lauter quietschen =
höher springen. 100 % optional, mit Tap-Fallback auf jedem Pfad (kein Mikro/abgelehnt → tippen).

### 🌊 Quack Lift — *Ein-Knopf-Höhlen-Tide-Climber*
Du steuerst nicht die Ente — du steuerst das **Wasser**. **Halten** hebt den Wasserspiegel, **loslassen**
lässt ihn sinken; die Ente reitet per Auftrieb mit. Fädle die versetzten Lücken in den Eis- und
Stein-Toren einer Höhle, **rette die Küken** für einen Gier-Combo (bis x9, Reset nur bei Tod).
Berührst du ein Tor: *„Glub glub. Die Ente ist abgesoffen."*

### 🎵 Quackoustic — *in Arbeit*
Squeeze-to-Tune: Ente quetschen hebt die Tonhöhe, im Timing-Fenster den Ziel-Ton rasten. Im Hub als
`🔒 SOON` gelistet, noch nicht spielbar.

---

## Steuerung

| | DUCK & COVER | Quack Lift |
|---|---|---|
| **Tastatur** | `←` `→` / `A` `D` bewegen · `Space` `W` `↑` / Klick springen | `Space` **halten** = Wasser hoch, loslassen = runter |
| **Touch** | Floating-Joystick unten rechts lenken · tippen = springen | irgendwo **halten** = hoch, loslassen = runter |
| **Mikro 🦆** | echte Gummiente quietschen = springen (lauter = höher) | — |
| **Zurück** | „‹ hub" antippen | „‹ hub" antippen |

Oben rechts: 🔊 stummschalten · 🎵 nur Musik aus.

---

## Was es besonders macht

- **Die Gummiente IST der Controller** — Mikrofon-Eingang in DUCK & COVER: `getUserMedia` mit
  abgeschaltetem Echo-Cancelling/Noise-Suppression/AGC, 300–2000 Hz Bandpass, adaptiver Geräusch-Boden,
  Peak-Hold-Erkennung. Nur Analyse, keine Aufnahme, kein Netz.
- **100 % prozedurales Audio** über die Web Audio API — Quietsch-Quacks, Sad-Quack, Near-Miss-Whoosh und
  ein geschedultes 128-bpm-Chiptune-Bett. **Keine Audio-Dateien** im Repo.
- **Handgeschriebene Canvas-2D-Engine ohne Dependencies** — Szenen-Stack, DPR-Skalierung,
  `env(safe-area-inset-*)` (HUDs weichen Notch/Home-Indicator aus), feste virtuelle Spielbreite
  (Handy- und Desktop-Schwierigkeit identisch).
- **Mobile-first** — Floating-Joystick, Canvas-Text-Umbruch, Onboarding-Hints, per-Spiel-Highscores.
- **Eine Enten-Identität** über Hub, beide Spiele und Cameos hinweg.

---

## Tech

- **Vanilla HTML/CSS/JS**, native **ES-Module**, **kein Build-Step / keine Dependencies** —
  Dateien werden as-is ausgeliefert.
- Eine **HTML5-Canvas-2D**-Engine (`src/engine.js`), geteilt von allen Spielen; Audio synthetisiert
  (`src/audio.js`); Enten als Sprites mit Canvas-Primitiv-Fallback (`src/duck.js`).
- Self-hosted Fonts (Audiowide + JetBrains Mono). Höhlen-Tor-Grafik: **CC0** (Kenney + OpenGameArt,
  Details in [`CREDITS.md`](CREDITS.md)).
- Statisch hostbar (Cloudflare Pages / GitHub Pages / Netlify / Vercel — alle unverändert).

```
index.html · style.css
src/
  engine.js   # geteilt: Loop, Input, Szenen, Highscore, responsive Canvas
  duck.js     # geteilt: Enten-Renderer (Sprite + Fallback)
  audio.js    # geteilt: WebAudio Quietsch-Synth + Chiptune
  main.js     # Hub/Menü
  mic.js      # Mikro-Signature (DUCK & COVER)
  games/{duckcover,quacklift}.js
```

## Lokal starten

ES-Module brauchen `http(s)`, nicht `file://` — also einen kleinen statischen Server:

```bash
python3 -m http.server 8000   # oder: npx serve
# → http://localhost:8000
```

---

## Lizenz & Credits

Eigener Code: **MIT** (siehe [`LICENSE`](LICENSE)). Dritt-Assets (Höhlen-Grafik) sind **CC0**,
gelistet in [`CREDITS.md`](CREDITS.md).
