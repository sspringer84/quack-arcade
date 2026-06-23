# 🦆 Quack Arcade

**Eine kleine Arcade-Halle voller Gummienten.** Ein Hub im CRT-Neon-Look führt zu **drei**
Enten-Minispielen — jedes mit einer eigenen, ungewöhnlichen Steuerung, alle um *eine* Gummiente herum.
Optik & Stimmung sind von der **Arcade-Ästhetik der Tron-Filme** inspiriert (Neon, Grid, CRT-Glühen).

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

**Der Clou:** Eine **echte Gummiente (oder deine Stimme) quietschen = springen** — über das Mikrofon.
Lauter quietschen = höher springen. 100 % optional, mit Tap-Fallback auf jedem Pfad (kein Mikro/
abgelehnt → tippen).

### 🌊 Quack Lift — *Ein-Knopf-Höhlen-Tide-Climber*
Du steuerst nicht die Ente — du steuerst das **Wasser**. **Halten** hebt den Wasserspiegel, **loslassen**
lässt ihn sinken; die Ente reitet per Auftrieb mit. Fädle die versetzten Lücken in den Eis- und
Stein-Toren einer Höhle, **rette die Küken** für einen Gier-Combo (bis x9, Reset nur bei Tod).
Berührst du ein Tor: *„Glub glub. Die Ente ist abgesoffen."*

### 🎵 Quackoustic — *Stimm die Ente (SingStar für Enten)*
**Du singst die Ente auf Kurs.** Tonhöhe deiner Stimme = Höhe der Ente: **tief summen → runter,
hoch singen → hoch, still sein → sie sinkt sanft**. Halte die Ente in den heranscrollenden Noten-Bändern
(a-Moll-Pentatonik), bis sie die Linie kreuzen → **Lock**: jede getroffene Note quakt ihren Ton, ein
sauberer Lauf komponiert eine kleine Melodie. PERFEKT-Treffer mittig geben Bonus, Combo bis x9,
3 Leben. Ein **Voice-Equalizer + Synthwave-Visualizer** tanzt dabei zu deiner Stimme. Kein Mikro?
Dann **halten/loslassen** als Fallback — bricht nie.

---

## Steuerung

| | DUCK & COVER | Quack Lift | Quackoustic |
|---|---|---|---|
| **Tastatur** | `←` `→` / `A` `D` bewegen · `Space` `W` `↑` / Klick springen | `Space` **halten** = Wasser hoch, loslassen = runter | `Space` **halten** = höher, loslassen = tiefer *(Fallback)* |
| **Touch** | Floating-Joystick lenken · tippen = springen | irgendwo **halten** = hoch, loslassen = runter | **halten** = höher, loslassen = tiefer *(Fallback)* |
| **Mikro 🎤** | quietschen/quaken = springen (lauter = höher) | — | **singen** = Tonhöhe steuert die Ente (tief→runter, hoch→hoch, still→sinkt) |
| **Zurück** | „‹ hub" antippen | „‹ hub" antippen | „‹ hub" antippen |

Oben rechts: 🔊 stummschalten · 🎵 nur Musik aus.

---

## Was es besonders macht

- **Die Gummiente IST der Controller.** Zwei verschiedene Mikrofon-Mechaniken, beide nur Analyse
  (kein Recording, kein Netz), beide auf demselben `getUserMedia`-Pfad (Echo-Cancelling/Noise-
  Suppression/AGC **aus**, damit Stimme/Quietschen durchkommen):
  - **DUCK & COVER** — Lautstärke-Erkennung: 150–3500 Hz Bandpass, adaptiver Geräusch-Boden,
    Peak-Hold (lauter = höher springen).
  - **Quackoustic** — echte **Tonhöhen-Erkennung** (YIN-Autokorrelation mit parabolischer
    Interpolation + Median-/Oktav-Guard) in einem eigenen, vom Lautstärke-Pfad getrennten Modul.
- **100 % prozedurales Audio** über die Web Audio API — Quietsch-Quacks, Sad-Quack, Near-Miss-Whoosh,
  pitch-bare Töne und ein geschedultes 128-bpm-Chiptune-Bett. **Keine Audio-Dateien** im Repo.
- **Handgeschriebene Canvas-2D-Engine ohne Dependencies** — Szenen-Stack, DPR-Skalierung,
  `env(safe-area-inset-*)` (HUDs weichen Notch/Home-Indicator aus), feste virtuelle Spielbreite
  (Handy- und Desktop-Schwierigkeit identisch).
- **Mobile-first** — Touch-Controls, Canvas-Text-Umbruch, Onboarding-Hints, per-Spiel-Highscores,
  überall graceful degradation (jedes Spiel ist ohne Mikro voll spielbar).
- **Headless verifiziert** — die Spiel-Logik (inkl. der Pitch-Erkennung über synthetische Töne und
  des Voice→Lock-Pfads über eine Fake-Mic) läuft gegen automatisierte Tests, nicht nur „bei mir".
- **Eine Enten-Identität** über Hub, alle drei Spiele und Cameos hinweg.

---

## Tech

- **Vanilla HTML/CSS/JS**, native **ES-Module**, **kein Build-Step / keine Dependencies** —
  Dateien werden as-is ausgeliefert.
- Eine **HTML5-Canvas-2D**-Engine (`src/engine.js`), geteilt von allen Spielen; Audio synthetisiert
  (`src/audio.js`); Enten als Sprites mit Canvas-Primitiv-Fallback (`src/duck.js`).
- Self-hosted Fonts (Audiowide + JetBrains Mono). Höhlen-Tor-Grafik: **CC0** (Kenney + OpenGameArt) —
  Details in [`CREDITS.md`](CREDITS.md).
- Statisch hostbar (Cloudflare Pages / GitHub Pages / Netlify / Vercel — alle unverändert).

```
index.html · style.css
src/
  engine.js   # geteilt: Loop, Input, Szenen, Highscore, responsive Canvas
  duck.js     # geteilt: Enten-Renderer (Sprite + Fallback)
  audio.js    # geteilt: WebAudio Quietsch-Synth + pitch-bare Töne + Chiptune
  mic.js      # Mikro-Lautstärke-Signature (DUCK & COVER)
  pitch.js    # Stimm-Tonhöhen-Erkennung, YIN (Quackoustic)
  main.js     # Hub/Menü
  games/{duckcover,quacklift,quackoustic}.js
```

## Lokal starten

ES-Module brauchen `http(s)`, nicht `file://` — also einen kleinen statischen Server:

```bash
python3 -m http.server 8000   # oder: npx serve
# → http://localhost:8000
```

---

## Lizenz & Credits

Eigener Code: **MIT** (siehe [`LICENSE`](LICENSE)). Dritt-Assets (Höhlen-Grafik, Fonts) sind frei
lizenziert (CC0 bzw. OFL), gelistet in [`CREDITS.md`](CREDITS.md).
