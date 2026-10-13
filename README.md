# 21 Blackjack

Tres piezas en la misma red wifi:

| Pieza | Dónde va | Qué hace |
|---|---|---|
| `server/` | 1 PC (la de caja) | Guarda saldos, reparte cartas y lleva la bitácora. Es la única fuente de verdad. |
| `admin/` | La PC de caja | Recargas, cobros, máquinas, reglas y la retención de la noche. |
| `game/` | Cada máquina de 21 | La mesa de 21. Solo muestra y manda jugadas al servidor. |
| `holdem/` | Cada máquina de Hold'em | La mesa de Texas Hold'em contra la casa. Misma tarjeta, mismo saldo. |

## Instalar

**1. Servidor (PC de caja)**
1. Instala [Node.js 22 LTS](https://nodejs.org) o más nuevo.
2. Copia la carpeta `server` y abre `iniciar-servidor.bat`. Si Windows pregunta por el firewall, permite **Redes privadas**.
3. Anota la IP de esa PC (`ipconfig` → IPv4, por ejemplo `192.168.1.10`) y dale IP fija en el router.
4. Para que arranque solo: pon un acceso directo del `.bat` en `shell:startup`.
5. Para actualizar el servidor: ciérralo, reemplaza la carpeta `server` y vuelve a poner tu `blackjack.db`. Si junto a él hay `blackjack.db-wal` y `blackjack.db-shm`, cópialos también: ahí pueden estar los últimos movimientos. Desde la versión 1.1.1 el servidor los junta en `blackjack.db` al cerrarse.

**2. Instaladores `.exe`**
- Fácil: sube esta carpeta a un repo de GitHub, ve a *Actions → Instaladores Windows → Run workflow* y descarga los `.exe`.
- O en una PC Windows con Node y [Rust](https://rustup.rs): `cd game && npm install && npx tauri build` (igual en `holdem` y `admin`). El `.exe` queda en `src-tauri/target/release/bundle/nsis/`.

**3. Admin** — instala *21 Blackjack Admin* en la misma PC del servidor y entra con `http://localhost:7021` y el PIN `2121` (cámbialo en *Reglas*). En *Máquinas* agrega una por cada equipo y copia su clave. Por seguridad el admin solo responde en esa PC; para usarlo desde otra, arranca el servidor con `set BJ_REMOTE_ADMIN=1`.

**4. Cada máquina** — instala *21 Blackjack* o *Texas Holdem*, escribe `http://IP:7021` y la clave. Abre en pantalla completa. Para reconfigurar, toca 7 veces el logo (**21** o **♠**). Una máquina de Hold'em se da de alta igual que una de 21, en *Máquinas*.

**Caja** — cada cajero abre su turno con su nombre. Una recarga equivocada se corrige desde el historial de la tarjeta (solo en el turno abierto y si el saldo no se ha jugado). Al cerrar el turno sale el corte de caja para imprimir y firmar.

**Lector NFC** — lector USB en modo teclado (escribe el número de la tarjeta y Enter). Usa el mismo modelo en caja y en las máquinas para que el número salga igual.

## Texas Hold'em contra la casa

Reglas tipo *Ultimate Texas Hold'em*: el jugador juega solo contra el crupier, con sus 2 cartas y las 5 de la mesa.

1. Pone **Ante** y **Ciega** iguales (necesita en saldo 3 veces el Ante, para poder llegar al final de la mano).
2. Antes del flop puede apostar **4× o 3×** el Ante, o pasar. En el flop **2×** o pasar. Al final **1×** o retirarse (pierde Ante y Ciega).
3. El crupier califica con par o mejor. Si no califica, el Ante regresa.
4. Si gana el jugador: Juego y Ante pagan 1 a 1; la Ciega paga solo con escalera o mejor (escalera 1:1, color 3:2, full 3:1, póker 10:1, escalera de color 50:1, escalera real 500:1). Empate: todo regresa.

Cada juego tiene su configurador en *Reglas* (*21 Blackjack* y *Texas Hold'em*; meta, PIN y respaldos en *General*). Los dos muestran arriba la retención esperada (simulador) contra la real de la noche y la meta, explican cada regla, piden confirmar los cambios con un antes → después y guardan un historial. En Hold'em se configuran la comisión (40% por defecto), el Ante mínimo y máximo ($10 a $500), si se permite el 3× antes del flop y la tabla de pagos de la Ciega. Con eso, el simulador da ≈ 17–19% para un jugador experto y ≈ 26–28% para uno casual. *Resumen* muestra cada juego por separado y el total de la noche.

## Cómo se llega a la meta

No hay ajuste por jugador: todos juegan con las mismas reglas y un RNG criptográfico. La retención sale de las reglas que eliges en *Reglas*:

| Reglas | Casa retiene de lo apostado |
|---|---|
| Blackjack 3:2, crupier se planta en 17 suave | ≈ 0.6% (experto) · ≈ 6% (casual) |
| Blackjack 6:5, crupier pide en 17 suave | ≈ 2% · ≈ 7.5% |
| 8 barajas, 6:5, crupier pide en 17 suave + 40% de comisión sobre ganancias *(recomendadas, por defecto)* | ≈ 20% · ≈ 24% |
| Lo mismo con 50% de comisión | ≈ 25% · ≈ 29% |

El botón **Simular** recalcula esto con tus reglas y te dice qué comisión necesitas para tu meta. *Resumen* muestra la retención real de la noche contra la meta (20% por defecto). El botón **Usar reglas recomendadas** en *Reglas* las vuelve a cargar. La comisión se le muestra al jugador en la mesa.

## Mantener

- `server/engine.js` reglas del 21 · `server/index.js` API · `server/db.js` base de datos y bitácora · `server/sim.js` simulador
- `server/holdem.js` reglas del Hold'em · `server/holdem-sim.js` su simulador
- `game/src/App.jsx` mesa de 21 · `holdem/src/App.jsx` mesa de Hold'em · `admin/src/App.jsx` admin
- Respaldos: automáticos cada día y al cerrar cada noche en `server/respaldos/` (se guardan 30). Para restaurar, apaga el servidor y copia el respaldo como `server/blackjack.db`.
- Seguridad: las claves de máquina y el PIN nunca viajan por el wifi; cada petición va firmada (HMAC-SHA256) y una firma copiada o vieja se rechaza. Los saldos sí viajan sin cifrar: usa una red wifi solo para las máquinas.
- Pruebas: `cd server && npm test`
- Desarrollo: `npm start` en `server`, `npm run dev` en `game`, `holdem` y `admin` (se abren en el navegador; en modo desarrollo hay botón de *Tarjeta de prueba*).

Cada mano guarda su *seed*: con él se reproduce exactamente el barajado, y *Bitácora → Verificar cadena* detecta cualquier edición a la base de datos.
