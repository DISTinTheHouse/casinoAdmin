# 21 Blackjack

Tres piezas en la misma red wifi:

| Pieza | Dónde va | Qué hace |
|---|---|---|
| `server/` | 1 PC (la de caja) | Guarda saldos, reparte cartas y lleva la bitácora. Es la única fuente de verdad. |
| `admin/` | La PC de caja | Recargas, cobros, máquinas, reglas y la retención de la noche. |
| `game/` | Cada máquina | La mesa de 21. Solo muestra y manda jugadas al servidor. |

## Instalar

**1. Servidor (PC de caja)**
1. Instala [Node.js 22 LTS](https://nodejs.org) o más nuevo.
2. Copia la carpeta `server` y abre `iniciar-servidor.bat`. Si Windows pregunta por el firewall, permite **Redes privadas**.
3. Anota la IP de esa PC (`ipconfig` → IPv4, por ejemplo `192.168.1.10`) y dale IP fija en el router.
4. Para que arranque solo: pon un acceso directo del `.bat` en `shell:startup`.

**2. Instaladores `.exe`**
- Fácil: sube esta carpeta a un repo de GitHub, ve a *Actions → Instaladores Windows → Run workflow* y descarga los dos `.exe`.
- O en una PC Windows con Node y [Rust](https://rustup.rs): `cd game && npm install && npx tauri build` (igual en `admin`). El `.exe` queda en `src-tauri/target/release/bundle/nsis/`.

**3. Admin** — instala *21 Blackjack Admin* en la misma PC del servidor y entra con `http://localhost:7021` y el PIN `2121` (cámbialo en *Reglas*). En *Máquinas* agrega una por cada equipo y copia su clave. Por seguridad el admin solo responde en esa PC; para usarlo desde otra, arranca el servidor con `set BJ_REMOTE_ADMIN=1`.

**4. Cada máquina** — instala *21 Blackjack*, escribe `http://IP:7021` y la clave. Abre en pantalla completa. Para reconfigurar, toca 7 veces el logo **21**.

**Caja** — cada cajero abre su turno con su nombre. Una recarga equivocada se corrige desde el historial de la tarjeta (solo en el turno abierto y si el saldo no se ha jugado). Al cerrar el turno sale el corte de caja para imprimir y firmar.

**Lector NFC** — lector USB en modo teclado (escribe el número de la tarjeta y Enter). Usa el mismo modelo en caja y en las máquinas para que el número salga igual.

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
- `game/src/App.jsx` mesa · `admin/src/App.jsx` admin
- Respaldos: automáticos cada día y al cerrar cada noche en `server/respaldos/` (se guardan 30). Para restaurar, apaga el servidor y copia el respaldo como `server/blackjack.db`.
- Seguridad: las claves de máquina y el PIN nunca viajan por el wifi; cada petición va firmada (HMAC-SHA256) y una firma copiada o vieja se rechaza. Los saldos sí viajan sin cifrar: usa una red wifi solo para las máquinas.
- Pruebas: `cd server && npm test`
- Desarrollo: `npm start` en `server`, `npm run dev` en `game` y `admin` (se abren en el navegador; en modo desarrollo hay botón de *Tarjeta de prueba*).

Cada mano guarda su *seed*: con él se reproduce exactamente el barajado, y *Bitácora → Verificar cadena* detecta cualquier edición a la base de datos.
