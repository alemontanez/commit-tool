# commit-tool

Asistente de terminal para automatizar el flujo de git del monorepo.
Arranca con un **menú** de herramientas. Base branch: `development`. Remote: `origin`.

## Uso

Cero dependencias, solo Node.

```bash
node commit-tool.js        # menú, modo REAL (opera sobre tu repo)
node commit-tool.js --demo # menú, modo DEMO (simula todo, no toca git)
```

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

1. **Crear PR (flujo completo)** — branch → add -A → commit → pull --rebase de
   development → rebase → push. Arma el commit con el formato
   `{tipo}({EPIC}): [{TEAM}-{n}] {desc}` y la branch `{TEAM}-{n}`.
2. **Chequear rama / sincronizar development** — te dice en qué rama estás, te
   ofrece moverte a development y avisa si quedó atrás de origin (ofreciendo el
   pull --rebase).
3. **Simular el flujo de PR (dry-run)** — igual que la 1 pero sin ejecutar nada
   que modifique. Lee el repo real y muestra el plan.
4. **Arreglar PR bugueado tras pasaje a producción** — actualiza development,
   rebasa la rama del PR, agrega un cambio mínimo (salto de línea a un archivo
   que elegís) para tener algo que commitear, y hace push **forzado**.
5. **Administrar EPICs y TEAMs** — agregar / eliminar los guardados sin arrancar
   un commit.
6. **Salir**.

## Force push

Cuando un flujo reescribe una rama (reset/recrear en la opción 1, o el arreglo de
la opción 4), el push tiene que ser forzado. En esos casos:
- Se usa `git push --force-with-lease` (force **seguro**: si alguien tocó la rama
  en el remote desde tu último fetch, frena y avisa en vez de pisar).
- Antes de hacerlo, muestra una advertencia y pide confirmación **S/n**
  (por defecto N).

## Otros comportamientos

- **git add**: usa `git add -A` (todos los cambios del repo). Para el flujo de una
  tarea a la vez.
- **Si la branch ya existe (local)** en la opción 1: te ofrece resetearla a
  development, borrarla y recrearla, usar otro número, o cancelar.
- **Conflicto en el rebase**: frena, lista los archivos en conflicto y **no hace
  push**. Elegís entre abortar (`git rebase --abort`) o salir a resolver a mano.
- **Config**: teams y EPICs en `~/.commit-tool.json` (fuera del repo). El último
  team y EPIC usados aparecen primero.

## Pendiente / a futuro

- Soporte para más de un commit por branch.
