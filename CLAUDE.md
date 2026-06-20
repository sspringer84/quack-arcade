# CLAUDE.md — Quack Arcade (SKAILE Building Challenge)

Projekt-lokale Regeln. Jede Session in diesem Repo befolgt sie.

## Push-Disziplin (Fairness-Pflicht)
- Nach **jedem** abgeschlossenen Arbeitsschritt sofort committen + zu `origin` pushen (`git add -A`, kurze klare Conventional-Commit-Message, `git push`). Gekoppelt an den Fortschritt, kein Timer.
- **Immer nur zu `origin`** (eigenes Repo `sspringer84/quack-arcade`) pushen. Ziel nie ändern.
- Zu Beginn jeder Session zuerst `git log --oneline -5` + `git status`, kurz orientieren, dann nahtlos weiterbauen.
- Grund: Der Wettbewerb prüft den **Push-Verlauf**, nicht das Commit-Datum. Progressiv pushen ist Regel.

## Was wir bauen
„Quack Arcade" — Hub mit 3 Enten-Minispielen. Reihenfolge: **DUCK & COVER → Quack Lift → Quackoustic**.
Voller Plan + zweites Gehirn: `~/clients/building-challenge/notes/CONTEXT.md`.

## Leitprinzip — „immer auslieferbar"
Kein Spiel anfangen, bevor das vorige sauber-spielbar + committet + gepusht ist. Zeit knapp → lieber 1–2 polierte Spiele als 3 kaputte.

## Tech-Constraints
- Vanilla HTML/CSS/JS, ES-Module, **kein Build-Step**. Statisch deploybar (Cloudflare Pages).
- Keine Bildgen/Assets — Visuals canvas-gezeichnet (`src/duck.js`), Audio synthetisiert (`src/audio.js`).
- Geteilte Engine (`src/engine.js`) + Renderer + Audio EINMAL, von allen Spielen genutzt.
- Mobile + Desktop: Touch via Pointer-Events, `touch-action:none`, AudioContext-Unlock per Geste.

## Deploy
`*.pages.dev` über Cloudflare (Projekt `building-challenge`). Deploy-Befehl + Token siehe CONTEXT.md.
