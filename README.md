# commit-tool

Asistente de terminal para automatizar el flujo de git del monorepo.
Arranca con un **menú** de herramientas. Base branch: `development`. Remote: `origin`.

Como trabajamos **muchos sobre el mismo repo**, `development` se mueve todo el
tiempo. Eso obliga a estar **sincronizando con `pull --rebase` y rebasando la rama
propia** constantemente antes de cada push. Hacerlo a mano es tedioso y propenso a
errores (olvidarse un paso, branchear desde una base vieja, hacer un push forzado
mal, etc.). La herramienta encapsula ese flujo en un menú, **te muestra cada comando
antes de ejecutarlo**, pide confirmaciones en los pasos peligrosos y frena de forma
segura cuando algo puede salir mal. Es un solo archivo Node, **cero dependencias**.

### Convenciones fijas

| Concepto | Valor | Dónde se configura |
|----------|-------|--------------------|
| Rama base | `development` | constante `BASE_BRANCH` |
| Remote | `origin` | constante `REMOTE` |
| Formato de commit | `tipo(EPIC): [TEAM-número] descripción` | `buildCommitMsg` |
| Nombre de rama | `TEAM-número` (ej: `NSTEAM1-648`) | — |

## Uso

Cero dependencias, solo Node.

```bash
node commit-tool.js        # menú, modo REAL (opera sobre tu repo)
node commit-tool.js --demo # menú, modo DEMO (simula todo, no toca git)
```

> **Modo demo para probar sin usar git.** Usá `--demo`: no ejecuta ni un solo comando de git,
> simula todo con datos ficticios (rutas `src/demo/...` obviamente de ejemplo).

El menú y las listas se mueven con **↑ ↓ y Enter**. `Ctrl+C` sale en cualquier momento.

### Instalación global (correr `commit-tool` desde cualquier carpeta)

Una vez, en la carpeta del script (ej: `C:\tools\commit-tool`):

```bash
npm link
```

Después: `commit-tool` (o `commit-tool --demo`). Desinstalar: `npm unlink -g commit-tool`.

#### Si `commit-tool` "no se reconoce" (Windows / PowerShell)

Pasa cuando la carpeta de binarios globales de npm no está en el PATH (típico en
PCs de trabajo sin permisos de admin). El comando quedó creado, pero PowerShell no
lo encuentra. Solución sin tocar el PATH ni pedir admin: definí una función en tu
perfil de PowerShell.

1. Abrí tu perfil:

```powershell
notepad $PROFILE
```

(Si te dice que no existe, primero: `New-Item -ItemType File -Path $PROFILE -Force`
y volvé a abrirlo con `notepad $PROFILE`.)

2. Pegá esta línea al final y guardá (ajustá la ruta si guardaste el script en otro
   lado):

```powershell
function commit-tool { node C:\tools\commit-tool\commit-tool.js @args }
```

3. Cerrá y abrí PowerShell de nuevo. Listo: `commit-tool` funciona desde cualquier
   carpeta. El `@args` permite pasar flags (ej: `commit-tool --demo`).

> Alternativa siempre válida (sin instalar nada): ejecutarlo con la ruta completa
> `node C:\tools\commit-tool\commit-tool.js`.

---

# Guía de uso

Tutorial de todas las funciones: **qué hace cada opción, qué considera antes de
actuar y exactamente qué comandos de git ejecuta** — con foco en las opciones que
resuelven los problemas típicos del monorepo.

## El menú principal

```
1. Crear PR (flujo completo, un solo commit)
2. Modo pilotado (commits de a poco, subir/bajar manual)
3. Chequear rama / sincronizar development
4. Arreglar PR bugueado tras pasaje a producción
5. Administrar EPICs y TEAMs
6. Salir
```

Hay **dos formas de trabajar** (opciones 1 y 2), pensadas para dos estilos:

- **Opción 1 — "de un tiro"**: hacés todo el cambio, y la herramienta arma la rama,
  el commit, sincroniza y pushea, todo de corrido. Rápido y directo.
- **Opción 2 — "pilotado"**: entrás a una rama y vas decidiendo cada paso (commitear
  varias veces, cuándo bajar, cuándo subir). Más controlado.

Las opciones 3 y 4 resuelven casos puntuales, y la 5 administra datos guardados.

## Opción 1 — Crear PR (flujo completo, un solo commit)

Es el flujo "arma de un solo tiro": partís **posicionado en `development`** con tus
cambios hechos (sin commitear), y la herramienta hace **todo** hasta dejar la rama
pusheada y lista para abrir el PR.

### Qué chequea antes de arrancar

1. Que estés dentro de un repo git → `git rev-parse --show-toplevel`
2. Que exista el remote `origin` → `git remote`
3. Que exista la rama base local → `git rev-parse --verify --quiet refs/heads/development`
4. Que estés parado en `development`. Si no, te ofrece cambiarse:
   `git checkout development`
5. Te muestra tus cambios sin commitear → `git status --short`, y pide confirmación
   ("¿Los datos del repo están OK y seguimos?").

### Qué te pregunta

- **Tipo** de commit (`feat`, `fix`, `refactor`, …).
- **TEAM** (se guarda y se reutiliza).
- **Número** de tarea (solo dígitos).
- **EPIC** (se guarda y se reutiliza).
- **Descripción**.

Con eso arma:
- Rama: `TEAM-número` (ej: `NSTEAM1-648`)
- Commit: `tipo(EPIC): [TEAM-número] descripción`

### Si la rama ya existe localmente

Antes de crear, chequea `git rev-parse --verify --quiet refs/heads/TEAM-número`. Si
ya existe, te da 4 caminos:

| Opción | Qué hace | Comando |
|--------|----------|---------|
| **Reset a development** | Reusa la rama pisándola con el estado actual de development | `git checkout -B TEAM-número` |
| **Borrar y recrear** | La elimina y la crea de cero | `git branch -D TEAM-número` + `git checkout -b TEAM-número` |
| **Renombrar** | Pedís otro número y prueba con ese | (vuelve a preguntar el número) |
| **Cancelar** | Corta todo | — |

> Reset y recrear **reescriben** la rama, así que el push posterior será **forzado**
> (ver *Casos peligrosos y errores*).

### El plan que ejecuta (con vista previa)

Antes de tocar nada te muestra el **resumen** con la lista exacta de comandos y pide
un último "¿Ejecuto todo esto?". La secuencia para el caso normal (rama nueva) es:

```bash
git checkout -b TEAM-número              # crea la rama desde development
git add -A                               # stagea TODOS los cambios
git commit -m "tipo(EPIC): [TEAM-número] descripción"
git checkout development
git pull --rebase                        # trae lo último de development
git checkout TEAM-número
git rebase development                   # reaplica tu commit sobre lo último
git push origin TEAM-número              # push (normal)
```

Al terminar, si el remote (Bitbucket / GitHub / GitLab) devuelve el link para crear
el PR, lo **resalta** (`→ Crear PR: https://...`) para que lo abras de un clic.

### Consideraciones importantes

- **Staging**: la opción 1 usa `git add -A` (stagea *todo*). Es "una tarea = un
  commit". Si querés commits selectivos, usá el **modo pilotado**.
- **Push forzado**: si elegiste reset/recrear, el último paso es
  `git push --force-with-lease origin TEAM-número`, con **advertencia y confirmación
  aparte**.
- **Conflicto en el rebase**: si `git rebase development` choca, **frena antes del
  push** y te deja resolver (ver *Casos peligrosos y errores*). No se pierde nada.

## Opción 2 — Modo pilotado

Para trabajar controlado: entrás/creás la rama **una vez** y después vas eligiendo
cada paso desde un **tablero** que relee el estado real de git en cada vuelta.

```
  ──────── estado ────────
  Rama: NSTEAM1-648
  Cambios sin commitear: 2
  Commits sin pushear: 1
  ─────────────────────────
Acción:
  · Entrar / crear rama de tarea
  · Commitear (stagea + commit; repetible)
  · Bajar cambios — sync development (sin push)
  · Subir — push
  · Eliminar rama local
  · Estado detallado
  · Volver al menú
```

El tablero se calcula con:
- Rama actual → `git rev-parse --abbrev-ref HEAD`
- Cambios sin commitear → `git status --short`
- Commits sin pushear → `git rev-list --count origin/RAMA..RAMA` (o `development..RAMA`
  si la rama todavía no tiene remote)

### Entrar / crear rama de tarea

Te pide TEAM y número y arma `TEAM-número`. Después:

- **Si la rama ya existe local** → simplemente entra: `git checkout TEAM-número`.
- **Si NO existe** → la crea, pero **primero previene el problema de branchear desde
  un `development` viejo** (ver *Los problemas del repo que resuelve*):
  1. `git fetch origin development` — trae lo último.
  2. `git rev-list --count development..origin/development` — mira cuántos commits
     está atrasado tu development local.
  3. Si está atrasado **y tu árbol está limpio**, te ofrece actualizarlo primero:
     `git checkout development` (si hace falta) + `git pull --rebase`.
  4. Crea la rama desde ese development ya fresco:
     `git checkout -b TEAM-número development`.
  - Si tenés **cambios sin commitear** (no se puede actualizar limpio), no rompe: te
    avisa y crea igual desde tu development local.

### Commitear (repetible)

Podés hacer **varios commits** antes de subir. Cada vez:

1. **Staging — te pregunta cada vez**:
   - *Todo* → `git add -A`
   - *Elegir archivos* → lista los archivos de `git status --short` numerados; elegís
     por número (ej: `1,3`) y stagea solo esos → `git add -- <rutas>`
2. Arma el mensaje preguntando tipo / EPIC / descripción (el `[TEAM-número]` sale de
   la rama actual).
3. `git commit -m "tipo(EPIC): [TEAM-número] descripción"`

### Bajar cambios — sync development (sin push)

Trae lo último de `development` y rebasa tu rama encima. **Nunca pushea.**

- **Guarda previa**: si tenés cambios sin commitear (`git status --short`), **no hace
  nada** y te avisa que commitees primero (el rebase no corre con el árbol sucio).
- Estando en tu rama de tarea, ejecuta:

```bash
git checkout development
git pull --rebase
git checkout TEAM-número
git rebase development
```

- Si estás parado en `development`, solo hace `git pull --rebase`.
- Si el rebase choca → maneja el conflicto (ver *Casos peligrosos y errores*).

### Subir — push

Pushea tu rama, pero **antes se asegura de que esté sobre el último development** y
decide solo si el push tiene que ser forzado.

1. `git fetch origin development`
2. `git rev-list --count TEAM-número..origin/development` — ¿tu rama está por detrás
   del último development? Si sí, te ofrece sincronizar primero (hace el sync de *Bajar*).
3. **Detección de force**: mira si el remote de tu rama tiene commits que vos no
   tenés (señal de que rebaseaste y reescribiste la historia):
   `git rev-list --count TEAM-número..origin/TEAM-número`. Si es > 0 → push forzado.
4. Push:
   - Normal → `git push origin TEAM-número`
   - Forzado → `git push --force-with-lease origin TEAM-número` (con confirmación)
5. Muestra el link de crear PR si el remote lo devuelve.

### Eliminar rama local

Borra una rama **local** (el remote **no se toca**). Útil cuando querés limpiar o
rehacer una rama.

1. Te pide TEAM y número.
2. Confirma (por defecto **No**).
3. Si estás parado en esa rama, primero sale: `git checkout development`.
4. `git branch -D TEAM-número`

### Estado detallado

Solo lectura, no modifica nada:

```bash
git status --short
git log --oneline -8 development..TEAM-número   # tus commits sobre development
```

## Opción 3 — Chequear rama / sincronizar development

Un chequeo rápido de sincronización, sin armar ningún commit.

1. Te dice en qué rama estás → `git rev-parse --abbrev-ref HEAD`.
2. Si no estás en `development`, te ofrece cambiarte → `git checkout development`.
3. Consulta el remote → `git fetch origin development`.
4. Calcula el atraso → `git rev-list --count development..origin/development`.
5. Si está atrasado, te ofrece actualizarlo → `git pull --rebase`.

Ideal para arrancar el día: "¿tengo development al día?".

## Los problemas del repo que la herramienta resuelve

Los dolores concretos de trabajar entre todos en el monorepo, y cómo la herramienta
los ataca.

### Sincronización constante (el dolor de todos los días)

Como `development` se mueve seguido, **hay que rebasar antes de cada push** o el push
se rechaza / el PR queda desactualizado. La herramienta lo hace por vos en el orden
correcto (`checkout development` → `pull --rebase` → `checkout rama` → `rebase
development`) en **todos** los flujos, y en el modo pilotado incluso **revalida antes
de pushear** que la rama esté sobre el último development.

### Branchear desde un `development` viejo (conflictos de rebase)

**El caso**: estás varios días sin hacer `pull` en `development`, y creás una rama
nueva para trabajar directamente desde esa base vieja. Al terminar, cuando querés
actualizar y rebasar, git tiene que **reaplicar tus commits por encima de todos los
cambios que entraron en esos días** → **conflictos de rebase**, a veces muchos.

**Por qué pasa**: no es un bug, es inherente a rebasar cruzando un gap grande. Tu
rama nació apuntando a un commit antiguo; cuanto más atrás, más probable el choque.

**Cómo lo resuelve la herramienta**: al **crear una rama nueva** en el modo pilotado,
primero hace `git fetch` y, si tu `development` está atrasado y limpio, te ofrece
actualizarlo (`git pull --rebase`) **antes** de crear la rama. Así la rama nace desde
el tip fresco y el rebase posterior **no cruza ningún gap**. Es exactamente lo que
antes se hacía a mano (backupear, borrar la rama, recrearla desde development
actualizado), pero automático y **antes** de trabajar en vez de después.

Y si el conflicto igual aparece (por ejemplo, porque ya tenías archivos modificados
al crear la rama), el menú de conflicto ofrece **rehacer la rama automáticamente**
(ver *Casos peligrosos y errores → Rehacer la rama con mis archivos*).

> **Dato clave para tranquilizar al equipo**: un rebase **nunca pierde tus commits**.
> Si choca y hacés `git rebase --abort`, la rama vuelve **exactamente** como estaba.
> Y aunque algo saliera mal, `git reflog` recupera todo. No hace falta backupear
> archivos a mano.

### PR que rompió tras pasar a producción

Lo resuelve la **Opción 4** (siguiente sección).

## Opción 4 — Arreglar PR bugueado tras pasaje a producción

**El caso**: un PR ya pasó a producción y algo quedó mal; hay que **refrescar la
rama del PR** rebasándola sobre el último development y volver a pushear (forzado)
para re-disparar el proceso.

### Paso a paso

1. Te pide TEAM y número → arma `TEAM-número`.
2. Si la rama **no está local**, la trae del remote:
   `git fetch origin TEAM-número` + `git checkout -b TEAM-número origin/TEAM-número`.
3. Muestra el resumen y pide confirmación.

### Comandos que ejecuta

```bash
git checkout development
git pull --rebase
git checkout TEAM-número
git rebase development                    # refresca la rama sobre lo último
git push -f origin TEAM-número            # push FORZADO
```

Este flujo **siempre** termina en push forzado (con confirmación), porque reescribe
la rama del PR. Si el rebase choca, frena antes del push.

## Casos peligrosos y errores

### Push forzado seguro (`--force-with-lease`)

Cuando un flujo **reescribe** una rama (reset/recrear en la opción 1, el arreglo de
la opción 4, o un rebase en el pilotado), el push tiene que ser forzado. La
herramienta **nunca** usa `--force` a secas: usa **`--force-with-lease`**, que es el
force **seguro**:

> Si alguien más tocó esa rama en el remote desde tu último fetch,
> `--force-with-lease` **aborta y avisa** en vez de pisar su trabajo.

Además, antes de un push forzado siempre muestra una **advertencia** y pide una
**confirmación aparte** (por defecto **No**).

### Conflictos de rebase

Si un `git rebase` choca, la herramienta:
1. **Frena antes de cualquier push.**
2. Lista los archivos en conflicto → `git diff --name-only --diff-filter=U`.
3. Te recuerda que **tus commits no se pierden**.
4. Te da **tres caminos**:
   - **Abortar** → `git rebase --abort` (la rama vuelve como estaba).
   - **Salir y resolver a mano**, con las instrucciones:
     `resolver` → `git add <archivos>` → `git rebase --continue` → `git push`.
   - **Rehacer la rama desde development (agresivo, con backup)** → ver abajo.

#### Rehacer la rama con mis archivos (opción agresiva)

Pensada para el caso "volví de vacaciones, brancheé desde un development viejo y el
rebase choca con un montón de conflictos". En vez de mergear a mano, **rehace la rama
desde el development actualizado y trae tus versiones** de los archivos que elijas.
No borra nada hasta que el push salió bien.

La lista de archivos a traer son los **exactos que commiteaste en esta sesión**
(la herramienta los registra en cada commit, con `git diff-tree --name-only HEAD`),
no un diff que podría arrastrar archivos de más. Si no hubo commit de la sesión
(ej. arreglar PR), cae a los archivos de los commits propios de la rama
(`git log --name-only development..RAMA`).

| Paso | Comando | Qué hace |
|------|---------|----------|
| guarda | (registro de archivos por commit) + `git log -1 --format=%B RAMA` | Ya tiene la lista exacta de archivos commiteados y el mensaje del último commit. |
| a | `git rebase --abort` | Sale del conflicto (rama intacta). |
| b | `git branch -m RAMA RAMA-bk` | Renombra la rama a **backup** (si ya existe `-bk`, usa `-bk2`, etc.). |
| c | `git checkout -b RAMA development` | Recrea la rama, nombre correcto, desde development al día. |
| d | `git checkout RAMA-bk -- <archivos>` | Trae **tus** versiones de los archivos elegidos (todos o los que elijas). |
| e | `git add -A && git commit -m "<mensaje>"` | Commit único, sobre development último → **sin rebase ni conflicto**. |
| f | `git push origin RAMA` | Sube (con `--force-with-lease` solo si la rama ya existía en el remote). |
| g | `git branch -D RAMA-bk` | Borra el backup **solo si vos confirmás** (después de verificar el PR). |

**Qué garantiza**: nada se pierde. Tu trabajo queda en la `-bk` hasta que confirmás,
y los cambios de los demás siguen intactos en `development`.
**El costo (opt-in, con aviso)**: tu versión final de esos archivos **no incluye** lo
que otros cambiaron en ellos → es un punto de **revisión de código**. Por eso está
marcada como agresiva y pide confirmación mostrando qué archivos va a traer.

> Esta opción solo aparece cuando hay un conflicto real, así que no se ve en `--demo`
> (en demo el rebase nunca choca).

### `pull --rebase` con reintentos (pasajes a producción)

Un `pull --rebase` puede fallar por algo transitorio, o porque justo hay un **pasaje
a producción** bloqueando el remote. En cualquier flujo que sincronice, si falla:

1. **Reintenta solo una vez**, automáticamente, tras una pausa corta.
2. Si sigue fallando, pregunta: *"¿Se está haciendo un pasaje a producción ahora?"*.
   - **Sí** → avisa que el remote puede estar bloqueado y te deja elegir entre
     **esperar ~20s y reintentar** o **frenar** (reintentar a mano cuando termine el pasaje).
   - **No** → asume que es transitorio: espera unos segundos y reintenta (en loop,
     volviéndote a preguntar en cada vuelta).

### Otras validaciones

- **Árbol sucio antes de bajar/sincronizar**: si tenés cambios sin commitear, no
  corre el rebase y te avisa (evita perder trabajo).
- **Rama sin remote / remote inexistente**: lo detecta y lo informa en vez de fallar
  feo.
- **Cancelaciones**: en cualquier prompt podés cancelar; nada se ejecuta hasta la
  confirmación final de cada flujo.

## Opción 5 — Administrar EPICs y TEAMs

No toca git. Administra los datos que la herramienta recuerda para no recargarlos:

- Agregar / eliminar **TEAMs**.
- Agregar / eliminar **EPICs**.

Se guardan en `~/.commit-tool.json` (fuera del repo). El último TEAM, EPIC y rama
usados se recuerdan y aparecen como opción por defecto la próxima vez.

## Tipos de commit (Conventional Commits)

El commit se arma como `tipo(EPIC): [TEAM-n] descripción`. El `tipo` sigue la
convención **[Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/)**,
que a su vez toma los tipos de la [convención de Angular](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#type).
La idea: que el mensaje comunique *la intención* del cambio de forma estandarizada,
lo que permite leer el historial de un vistazo y, si algún día se quiere, generar
changelogs o versionado semántico automático.

En la práctica, en el día a día del equipo se usan sobre todo **`feat`**, **`fix`**
y **`refactor`**. Los demás quedan disponibles por si aparecen (docs, chore, test,
perf, style, build, ci, revert), pero no son de uso frecuente.

| tipo | cuándo |
|------|--------|
| `feat` | nueva funcionalidad |
| `fix` | corrección de bug |
| `refactor` | cambio de código sin cambiar comportamiento |
| `docs` | documentación |
| `chore` | tareas varias / mantenimiento |
| `test` | tests |
| `perf` | mejora de performance |
| `style` | formato / estilo (sin cambio de lógica) |
| `build` | sistema de build |
| `ci` | integración continua |
| `revert` | revertir un commit |

Referencias:
- Conventional Commits 1.0.0 — https://www.conventionalcommits.org/es/v1.0.0/
- Angular commit message guidelines — https://github.com/angular/angular/blob/main/CONTRIBUTING.md#commit

## Referencia rápida — comandos de git por flujo

| Flujo | Comandos principales |
|-------|----------------------|
| **Crear PR (1)** | `checkout -b` · `add -A` · `commit` · `checkout development` · `pull --rebase` · `checkout rama` · `rebase development` · `push [--force-with-lease]` |
| **Pilotado: entrar/crear** | `fetch origin development` · `rev-list --count development..origin/development` · `pull --rebase` · `checkout -b rama development` |
| **Pilotado: commitear** | `status --short` · `add -A` \| `add -- rutas` · `commit` |
| **Pilotado: bajar** | `checkout development` · `pull --rebase` · `checkout rama` · `rebase development` |
| **Pilotado: subir** | `fetch origin development` · `rev-list --count` · `push [--force-with-lease]` |
| **Pilotado: eliminar** | `checkout development` · `branch -D rama` |
| **Rehacer rama (conflicto)** | `rebase --abort` · `branch -m rama rama-bk` · `checkout -b rama development` · `checkout rama-bk -- archivos` · `commit` · `push` |
| **Chequear (3)** | `fetch origin development` · `rev-list --count` · `pull --rebase` |
| **Arreglar PR (4)** | `checkout development` · `pull --rebase` · `checkout rama` · `rebase development` · `push -f` |

## Preguntas frecuentes

**¿Puedo probar sin miedo a romper algo?**
Sí: `node commit-tool.js --demo`. No ejecuta ningún git.

**¿Y si me equivoco en un rebase?**
No perdés commits. `git rebase --abort` te deja como estabas; la herramienta te
ofrece esa opción sola cuando hay conflicto.

**¿Por qué a veces el push es forzado?**
Porque rebasaste/reescribiste la rama. Se usa `--force-with-lease` (seguro) y con
confirmación aparte.

**¿Cuándo uso la opción 1 y cuándo la 2?**
Opción 1 si tenés el cambio listo y querés un commit único de una. Opción 2 si querés
ir commiteando de a poco y controlar cuándo bajar y cuándo subir.

**¿Dónde quedan guardados los TEAMs y EPICs?**
En `~/.commit-tool.json`, fuera del repo, por usuario.
