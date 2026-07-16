# commit-tool

Asistente de terminal para automatizar el flujo de git del monorepo.
Arranca con un **menú** de herramientas. Base branch: `development`. Remote: `origin`.

## Uso

Cero dependencias, solo Node.

```bash
node commit-tool.js        # menú, modo REAL (opera sobre tu repo)
node commit-tool.js --demo # menú, modo DEMO (simula todo, no toca git)
```

> **¿Querés probar sin miedo?** Usá `--demo`: no ejecuta ni un solo comando de git,
> simula todo con datos ficticios (rutas `src/demo/...` obviamente de ejemplo).

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

## El menú

1. **Crear PR (flujo completo, de un tiro)** — branch → add -A → commit →
   pull --rebase de development → rebase → push, todo de corrido. Arma el commit
   con el formato `{tipo}({EPIC}): [{TEAM}-{n}] {desc}` y la branch `{TEAM}-{n}`.
   Es el "arma de un solo tiro": rápido y directo.
2. **Modo pilotado (commits de a poco, subir/bajar manual)** — para trabajar más
   controlado. Entrás/creás la rama una vez y después vos decidís cada paso desde
   un tablero que muestra el estado real (rama, cambios sin commitear, commits sin
   pushear):
   - **Commitear** (repetible) — stagea (te pregunta *todo* o *elegir archivos*) y
     commitea. Podés hacer varios commits antes de subir.
   - **⬇️ Bajar** — sincroniza development (`pull --rebase`) y rebasa tu rama sobre
     él. **Nunca pushea.** Avisa si tenés cambios sin commitear.
   - **⬆️ Subir** — push. Antes chequea que tu rama esté sobre el último
     development (y ofrece sincronizar si no); fuerza con `--force-with-lease` solo
     si hizo falta reescribir.
   - **🗑 Eliminar rama local** — borra una rama local (el remote no se toca).
   - **📊 Estado detallado** — `git status` + commits de la rama sobre development.
3. **Chequear rama / sincronizar development** — te dice en qué rama estás, te
   ofrece moverte a development y avisa si quedó atrás de origin (ofreciendo el
   pull --rebase).
4. **Arreglar PR bugueado tras pasaje a producción** — actualiza development,
   rebasa la rama del PR, agrega un cambio mínimo (salto de línea a un archivo
   que elegís) para tener algo que commitear, y hace push **forzado**.
5. **Administrar EPICs y TEAMs** — agregar / eliminar los guardados sin arrancar
   un commit.
6. **Salir**.

> El modo dry-run se sacó del menú: para probar sin tocar nada está `--demo`.

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

## Force push

Cuando un flujo reescribe una rama (reset/recrear en la opción 1, o el arreglo de
la opción 4), el push tiene que ser forzado. En esos casos:
- Se usa `git push --force-with-lease` (force **seguro**: si alguien tocó la rama
  en el remote desde tu último fetch, frena y avisa en vez de pisar).
- Antes de hacerlo, muestra una advertencia y pide confirmación **S/n**
  (por defecto N).

## Otros comportamientos

- **git add**: en la opción 1 (un tiro) usa `git add -A` (todos los cambios). En el
  modo pilotado te **pregunta cada vez**: todo o elegir archivos por número (para
  armar commits chicos y separados).
- **Si la branch ya existe (local)** en la opción 1: te ofrece resetearla a
  development, borrarla y recrearla, usar otro número, o cancelar.
- **Conflicto en el rebase**: frena, lista los archivos en conflicto y **no hace
  push**. Elegís entre abortar (`git rebase --abort`) o salir a resolver a mano.
- **Config**: teams y EPICs en `~/.commit-tool.json` (fuera del repo). El último
  team, EPIC y rama usados se recuerdan para no recargarlos.
- **Link del PR**: al terminar un push, si el remote (Bitbucket / GitHub / GitLab)
  devuelve el link para crear el PR/MR, se resalta al final (`→ Crear PR: ...`)
  para que sea un clic y no quede perdido en el output del push.
