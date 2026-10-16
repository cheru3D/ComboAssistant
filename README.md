# Combo Assistant

App móvil (PWA) para Magic: The Gathering Commander que te avisa de los disparos de tus cartas,
y de las de tus oponentes, en cada fase del turno.

## Estructura

```
app/                 La app (lo que se publica)
  index.html, styles.css, sw.js, manifest.webmanifest
  js/triggers.js     Motor: lee el texto Oracle y detecta disparos
  js/game.js         Estado de la partida y qué se dispara en cada momento
  js/app.js          Interfaz
  data/cards.json    Base de cartas sin conexión (Scryfall, solo legales en Commander)
rules/               Comprehensive Rules oficiales (TXT y PDF)
tests/               Pruebas del motor (node --test tests/triggers.test.mjs)
tools/               build-cards.mjs (actualiza cards.json) y make-icons.mjs
```

## Uso local

```bash
python -m http.server 5173 --directory app
```

Abre http://localhost:5173

## Actualizar la base de cartas

```bash
node tools/build-cards.mjs
```

Después sube `VERSION` en `app/sw.js` para que los teléfonos descarguen la versión nueva.

## Instalar en el teléfono

El modo sin conexión necesita que la app se sirva por **HTTPS**. Puedes publicar la carpeta `app/`
en GitHub Pages, Netlify o Cloudflare Pages. Luego ábrela en el teléfono:

- Android (Chrome): menú ⋮ → "Instalar app"
- iPhone (Safari): Compartir → "Agregar a pantalla de inicio"

## Cómo detecta los disparos

- Disparos de fase: "At the beginning of your upkeep / each end step / combat on your turn…"
- Disparos por evento: "Whenever … dies / enters / attacks / casts / draws…"
- Modificadores: Teysa, Panharmonicon (duplican) y Torpor Orb (anula)
- Lo que no entiende queda marcado con ⚠ en la ficha de la carta, para revisarlo a mano.

Clasifica bien alrededor del 91 % de las cartas con disparos.
