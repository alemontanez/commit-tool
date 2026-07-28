#!/usr/bin/env node
'use strict';

/**
 * commit-tool — asistente para automatizar el flujo de git del monorepo.
 * Menú con varias herramientas. Base branch: development. Remote: origin.
 *
 * MODOS:
 *   (sin flag)   REAL   → opera sobre tu repo de verdad (con confirmaciones).
 *   --demo       SANDBOX→ simula todo, no toca git. Para mostrar/demostrar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

// ============================ CONFIG ============================
const SANDBOX = process.argv.includes('--demo') || process.argv.includes('--sandbox');
const BASE_BRANCH = 'development';
const REMOTE = 'origin';
const CONFIG_PATH = path.join(os.homedir(), '.commit-tool.json');
const OLD_CONFIG_PATH = path.join(os.homedir(), '.commit-flow.json');
const COMMIT_TYPES = [
  { v: 'feat', d: 'nueva funcionalidad' },
  { v: 'fix', d: 'corrección de bug' },
  { v: 'refactor', d: 'refactor sin cambio de comportamiento' },
  { v: 'docs', d: 'documentación' },
  { v: 'chore', d: 'tareas varias / mantenimiento' },
  { v: 'test', d: 'tests' },
  { v: 'perf', d: 'mejora de performance' },
  { v: 'style', d: 'formato / estilo' },
  { v: 'build', d: 'build system' },
  { v: 'ci', d: 'integración continua' },
  { v: 'revert', d: 'revertir un commit' },
];

let repoRoot = null;
let cfg = null;

// Validadores / helpers reutilizables (antes duplicados en cada prompt)
const upper = (x) => x.toUpperCase();
const validateName = (x) => (!x ? 'No puede estar vacío' : (/\s/.test(x) ? 'Sin espacios' : null));
const buildCommitMsg = ({ type = 'chore', epic, ticket, description }) => `${type}(${epic}): [${ticket}] ${description}`;

// Datos ficticios del modo demo — nombres OBVIAMENTE de ejemplo para que nadie se asuste.
const DEMO_STATUS = [' M src/demo/archivo-de-ejemplo.ts', '?? src/demo/notas-de-ejemplo.txt'];
let demoDirty = true; // en demo simulamos que hay cambios sin commitear hasta que se "commitea"

// Archivos exactos commiteados en el flujo actual (unión de todos los commits de la
// sesión sobre la rama). Lo usa "rehacer la rama" para traer del backup SOLO esos
// archivos y no inferirlos con un diff (que puede arrastrar archivos de más). Se
// resetea al arrancar cada flujo que crea/toca una rama.
let committedFiles = [];

// ============================ COLORES ============================
const paint = (n) => (s) => `\x1b[${n}m${s}\x1b[0m`;
const dim = paint(2), bold = paint(1), red = paint(31), green = paint(32);
const yellow = paint(33), cyan = paint(36), gray = paint(90);

// ============================ PERSISTENCIA ============================
function loadConfig() {
  for (const p of [CONFIG_PATH, OLD_CONFIG_PATH]) {
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { teams: c.teams || [], epics: c.epics || [], lastTeam: c.lastTeam || null, lastEpic: c.lastEpic || null, lastBranch: c.lastBranch || null };
    } catch { /* sigue con el próximo path */ }
  }
  return { teams: [], epics: [], lastTeam: null, lastEpic: null, lastBranch: null };
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); }
  catch (e) { console.log(red(`  ✗ No pude guardar la config: ${e.message}`)); }
}

// ============================ UI ============================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function select(message, options) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(cyan('? ') + bold(message));
      options.forEach((o, i) => console.log(`  ${dim((i + 1) + ')')} ${o.label}`));
      rl.question(dim('  Número: '), (a) => {
        rl.close(); let i = parseInt(a, 10) - 1;
        if (isNaN(i) || i < 0 || i >= options.length) i = 0;
        console.log(green('  ✓ ') + options[i].label + '\n'); resolve(options[i].value);
      });
      return;
    }
    let sel = 0;
    const rl = readline.createInterface({ input: process.stdin, escapeCodeTimeout: 50 });
    readline.emitKeypressEvents(process.stdin, rl);
    process.stdin.setRawMode(true);
    console.log(cyan('? ') + bold(message) + dim('  (↑↓ y Enter)'));
    const render = (first) => {
      if (!first) process.stdout.write(`\x1b[${options.length}A`);
      options.forEach((o, i) => {
        const line = i === sel ? cyan('❯ ' + o.label) : '  ' + o.label;
        process.stdout.write('\x1b[2K' + line + '\n');
      });
    };
    render(true);
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.removeListener('keypress', onKey); rl.close(); };
    const onKey = (str, key) => {
      if (!key) return;
      if (key.name === 'up') { sel = (sel - 1 + options.length) % options.length; render(false); }
      else if (key.name === 'down') { sel = (sel + 1) % options.length; render(false); }
      else if (key.name === 'return') { cleanup(); process.stdout.write(dim('  → ') + options[sel].label + '\n\n'); resolve(options[sel].value); }
      else if (key.ctrl && key.name === 'c') { cleanup(); console.log('\n' + yellow('Chau.')); process.exit(0); }
    };
    process.stdin.on('keypress', onKey);
  });
}

function text(message, opts = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = () => {
      const def = opts.defaultValue ? dim(` (${opts.defaultValue})`) : '';
      rl.question(cyan('? ') + bold(message) + def + dim(': '), (ans) => {
        ans = (ans || '').trim();
        if (!ans && opts.defaultValue) ans = opts.defaultValue;
        if (opts.transform) ans = opts.transform(ans);
        if (opts.validate) { const e = opts.validate(ans); if (e) { console.log(red('  ✗ ' + e)); return ask(); } }
        rl.close(); resolve(ans);
      });
    };
    ask();
  });
}

function confirm(message, def = true) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(cyan('? ') + bold(message) + ' ' + dim(def ? '(S/n)' : '(s/N)') + dim(': '), (a) => {
      rl.close(); a = (a || '').trim().toLowerCase();
      if (!a) return resolve(def);
      resolve(['s', 'si', 'sí', 'y', 'yes'].includes(a));
    });
  });
}

// ============================ GIT ============================
function git(args, { cwd = repoRoot } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

async function step(args, { sim = {} } = {}) {
  console.log(gray('  $ ') + 'git ' + args.join(' '));
  await sleep(120);
  if (SANDBOX) { if (sim.note) console.log('    ' + green('✓ ') + dim(sim.note)); return { ok: true }; }
  const r = git(args);
  const out = [r.stdout, r.stderr].filter(Boolean).join('\n');
  if (out) console.log(out.split('\n').map((l) => dim('    ' + l)).join('\n'));
  if (r.ok) { if (sim.note) console.log('    ' + green('✓ ') + dim(sim.note)); }
  else console.log('    ' + red('✗ ') + dim('exit ' + r.code));
  return r;
}

function branchExistsLocal(b) { return SANDBOX ? false : git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok; }

function getRepoInfo() {
  if (SANDBOX) return { root: '/Users/vos/dev/monorepo', branch: BASE_BRANCH, hasRemote: true };
  const rr = git(['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  if (!rr.ok) return null;
  repoRoot = rr.stdout;
  return { root: repoRoot, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout, hasRemote: git(['remote']).stdout.split('\n').includes(REMOTE) };
}

class Cancel extends Error {}
function cancel(msg = 'Cancelado.') { throw new Cancel(msg); }

// ============================ PROMPTS REUTILIZABLES ============================
async function pickTeam() {
  let team = null;
  if (cfg.lastTeam) { if (await confirm(`¿Usar el último team (${bold(cfg.lastTeam)})?`, true)) team = cfg.lastTeam; }
  if (!team) {
    if (cfg.teams.length === 0) {
      console.log(dim('  (todavía no hay teams guardados)'));
      team = await text('Nombre del nuevo team (ej: NSTEAM1)', { validate: validateName, transform: upper });
    } else {
      const opts = cfg.teams.map((t) => ({ label: t, value: t }));
      opts.push({ label: green('➕ Cargar nuevo team'), value: '__new__' });
      const c = await select('Elegí el team:', opts);
      team = c === '__new__' ? await text('Nombre del nuevo team', { validate: validateName, transform: upper }) : c;
    }
  }
  if (!cfg.teams.includes(team)) cfg.teams.push(team);
  cfg.lastTeam = team; saveConfig();
  return team;
}

async function pickEpic() {
  let epic;
  if (cfg.epics.length === 0) {
    console.log(dim('  (todavía no hay EPICs guardados)'));
    epic = await text('Nombre del nuevo EPIC (ej: AR-RETEN-SANTAFE-REVFEB26)', { validate: validateName, transform: upper });
  } else {
    const opts = [];
    if (cfg.lastEpic) opts.push({ label: `${cfg.lastEpic} ${dim('(último usado)')}`, value: cfg.lastEpic });
    cfg.epics.filter((e) => e !== cfg.lastEpic).forEach((e) => opts.push({ label: e, value: e }));
    opts.push({ label: green('➕ Cargar nuevo EPIC'), value: '__new__' });
    const c = await select('Elegí el EPIC:', opts);
    epic = c === '__new__' ? await text('Nombre del nuevo EPIC', { validate: validateName, transform: upper }) : c;
  }
  if (!cfg.epics.includes(epic)) cfg.epics.push(epic);
  cfg.lastEpic = epic; saveConfig();
  return epic;
}

const askNumber = (label = 'Número de tarea (solo el número, ej: 648)') =>
  text(label, { validate: (x) => (/^\d+$/.test(x) ? null : 'Tiene que ser solo números') });

async function pickType() {
  return select('Tipo de commit:', COMMIT_TYPES.map((t) => ({ label: `${t.v.padEnd(9)} ${dim('· ' + t.d)}`, value: t.v })));
}

// Arma el mensaje convencional preguntando tipo/epic/descripción. El ticket viene dado (rama).
async function buildCommitInteractive(ticket) {
  const type = await pickType();
  const epic = await pickEpic();
  const description = await text('Descripción del commit', { validate: (x) => (x.length < 3 ? 'Muy corta' : null) });
  return buildCommitMsg({ type, epic, ticket, description });
}

// ============================ TOOL 1: CREAR PR (flujo completo, de un tiro) ============================
async function flowCreatePR() {
  console.log(bold('› Crear PR'));
  committedFiles = [];

  // repo
  const info = getRepoInfo();
  if (!SANDBOX && !info) { console.log(red('  ✗ No estás dentro de un repo git.')); return; }
  console.log('  ' + green('✓ ') + dim('repo: ') + (SANDBOX ? info.root : repoRoot));
  if (!SANDBOX) {
    if (!info.hasRemote) console.log('  ' + yellow('⚠ ') + dim(`no encontré el remote '${REMOTE}'.`));
    if (!branchExistsLocal(BASE_BRANCH)) { console.log(red(`  ✗ No existe la rama local '${BASE_BRANCH}'.`)); return; }
    if (info.branch !== BASE_BRANCH) {
      if (!(await confirm(`Estás en '${info.branch}', no en '${BASE_BRANCH}'. ¿Cambio a '${BASE_BRANCH}'?`, true))) return;
      const r = git(['checkout', BASE_BRANCH]); if (!r.ok) { console.log(red('  ✗ ' + r.stderr)); return; }
    }
    console.log('  ' + green('✓ ') + dim(`en '${BASE_BRANCH}'`));
  } else {
    console.log('  ' + green('✓ ') + dim(`rama actual: '${BASE_BRANCH}'  ·  remote '${REMOTE}' ok`));
  }

  // status
  console.log(bold('\n› Cambios sin commitear:'));
  if (SANDBOX) {
    DEMO_STATUS.forEach((l) => console.log('    ' + green(l)));
  } else {
    const st = git(['status', '--short']).stdout;
    if (!st) { console.log(yellow('  No hay nada para commitear.')); return; }
    console.log(st.split('\n').map((l) => '    ' + l).join('\n'));
  }

  if (!SANDBOX) { if (!(await confirm('\n¿Los datos del repo están OK y seguimos?', true))) return; }
  console.log('');

  // prompts
  const type = await pickType();
  const team = await pickTeam();
  let number = await askNumber();
  const epic = await pickEpic();
  const description = await text('Descripción del commit', { validate: (x) => (x.length < 3 ? 'Muy corta' : null) });

  // resolver branch
  let branch = `${team}-${number}`;
  let strategy = 'create';
  while (true) {
    if (!branchExistsLocal(branch)) { strategy = 'create'; break; }
    console.log('\n  ' + yellow(`⚠ La rama '${branch}' ya existe localmente.`));
    const c = await select('¿Qué hacés?', [
      { label: `Usar la existente y pisar lo que tenga (reset a ${BASE_BRANCH})`, value: 'reset' },
      { label: 'Borrarla y crear una nueva desde cero', value: 'recreate' },
      { label: 'Usar otro número (renombrar ahora)', value: 'rename' },
      { label: 'Cancelar', value: 'cancel' },
    ]);
    if (c === 'cancel') return;
    if (c === 'reset' || c === 'recreate') { strategy = c; break; }
    if (c === 'rename') { number = await askNumber('Nuevo número de tarea'); branch = `${team}-${number}`; }
  }

  const ticket = `${team}-${number}`;
  const commitMsg = buildCommitMsg({ type, epic, ticket, description });
  const forced = strategy !== 'create';

  // preview
  const branchLine = {
    create: `git checkout -b ${branch}`,
    reset: `git checkout -B ${branch}   ${dim('(reset de la rama a ' + BASE_BRANCH + ')')}`,
    recreate: `git branch -D ${branch} && git checkout -b ${branch}`,
  }[strategy];
  console.log('\n' + bold('› Resumen'));
  console.log(dim('  ─────────────────────────────────────────────'));
  console.log('  Commit: ' + cyan(commitMsg));
  console.log('  Branch: ' + cyan(branch) + (forced ? dim('  [' + strategy + ']') : ''));
  console.log(dim('  ─────────────────────────────────────────────'));
  [branchLine, `git add -A`, `git commit -m "${commitMsg}"`, `git checkout ${BASE_BRANCH}`, `git pull --rebase`,
    `git checkout ${branch}`, `git rebase ${BASE_BRANCH}`,
    forced ? `git push --force-with-lease ${REMOTE} ${branch}   ${yellow('(FORZADO)')}` : `git push ${REMOTE} ${branch}`,
  ].forEach((p) => console.log('    ' + gray('· ') + p));
  console.log('');
  if (!(await confirm('¿Ejecuto todo esto?', true))) return;
  console.log('\n' + bold('› Ejecutando...'));

  // branch step
  let r;
  if (strategy === 'create') r = await step(['checkout', '-b', branch], { sim: { note: `rama '${branch}' creada` } });
  else if (strategy === 'reset') r = await step(['checkout', '-B', branch], { sim: { note: `rama '${branch}' reseteada a ${BASE_BRANCH}` } });
  else { r = await step(['branch', '-D', branch], { sim: { note: 'borrada' } }); if (isLive()) r = await step(['checkout', '-b', branch], { sim: { note: 'recreada' } }); }
  if (bad(r)) return stop('No pude preparar la rama.');

  r = await step(['add', '-A'], { sim: { note: 'staged' } }); if (bad(r)) return stop('Falló el add.');
  if (!(await commit(commitMsg)).ok) return;

  if (!(await syncFromBase(branch)).ok) return;            // bajar base + rebasar (maneja conflictos)
  if (!(await pushBranch(branch, { forced })).ok) return;  // subir

  cfg.lastBranch = branch; saveConfig();
  console.log('\n' + green(bold('✔ Listo.')));
}

// ============================ TOOL 2: CHEQUEAR / SINCRONIZAR ============================
async function toolCheckSync() {
  console.log(bold('› Chequear rama y sincronizar ' + BASE_BRANCH));
  const info = getRepoInfo();
  if (!SANDBOX && !info) { console.log(red('  ✗ No estás en un repo git.')); return; }
  const branch = SANDBOX ? 'NSTEAM1-648' : info.branch;
  console.log('  rama actual: ' + cyan(branch));
  if (branch !== BASE_BRANCH) {
    if (await confirm(`No estás en '${BASE_BRANCH}'. ¿Cambio a '${BASE_BRANCH}'?`, true)) {
      if (!SANDBOX) { const r = git(['checkout', BASE_BRANCH]); if (!r.ok) { console.log(red('  ✗ ' + r.stderr)); return; } }
      console.log('  ' + green('✓ ') + `en '${BASE_BRANCH}'`);
    } else { console.log(dim('  Te quedás en ' + branch + '.')); return; }
  } else console.log('  ' + green('✓ ') + `ya estás en '${BASE_BRANCH}'`);

  console.log(dim('  Consultando ' + REMOTE + '...'));
  let behind = 0;
  if (SANDBOX) behind = 2;
  else { git(['fetch', REMOTE, BASE_BRANCH]); behind = parseInt(git(['rev-list', '--count', `${BASE_BRANCH}..${REMOTE}/${BASE_BRANCH}`]).stdout || '0', 10); }

  if (behind > 0) {
    console.log('  ' + yellow(`⚠ '${BASE_BRANCH}' está ${behind} commit(s) atrás de ${REMOTE}. Conviene un pull --rebase.`));
    if (await confirm('¿Hago git pull --rebase ahora?', true)) {
      const r = await pullRebase();
      if (!SANDBOX && !r.ok) console.log(red('  ✗ Falló: ' + r.stderr));
    }
  } else console.log('  ' + green('✓ ') + `'${BASE_BRANCH}' está al día con ${REMOTE}.`);
}

// ============================ TOOL 4: ARREGLAR PR BUGUEADO (prod) ============================
async function toolFixProdPR() {
  console.log(bold('› Arreglar PR bugueado tras pasaje a producción'));
  console.log(dim('  Actualiza development, rebasa la rama del PR sobre lo último y hace push FORZADO (git push -f).'));
  committedFiles = [];
  const info = getRepoInfo();
  if (!SANDBOX && !info) { console.log(red('  ✗ No estás en un repo git.')); return; }

  const team = await pickTeam();
  const number = await askNumber('Número de la tarea del PR bugueado');
  const branch = `${team}-${number}`;

  if (!SANDBOX && !branchExistsLocal(branch)) {
    // intentar traerla del remote
    console.log(dim(`  '${branch}' no está local. Intento traerla de ${REMOTE}...`));
    const f = git(['fetch', REMOTE, branch]);
    if (!f.ok) { console.log(red(`  ✗ Tampoco existe en ${REMOTE}. Revisá el número.`)); return; }
    git(['checkout', '-b', branch, `${REMOTE}/${branch}`]);
  }

  console.log('\n' + bold('› Resumen'));
  console.log(dim('  ─────────────────────────────────────────────'));
  console.log('  Branch: ' + cyan(branch) + yellow('  (push FORZADO)'));
  console.log(dim('  ─────────────────────────────────────────────'));
  [`git checkout ${BASE_BRANCH}`, `git pull --rebase`, `git checkout ${branch}`, `git rebase ${BASE_BRANCH}`,
    `git push -f ${REMOTE} ${branch}   ${yellow('(FORZADO)')}`,
  ].forEach((p) => console.log('    ' + gray('· ') + p));
  console.log('');
  if (!(await confirm('¿Ejecuto esto?', true))) return;
  console.log('\n' + bold('› Ejecutando...'));

  if (!(await syncFromBase(branch)).ok) return;   // bajar base + rebasar (maneja conflictos)

  const r = await step(['push', '-f', REMOTE, branch], { sim: { note: 'pusheado (forzado)' } });
  if (bad(r)) return stop('Falló el push.');
  console.log('\n' + green(bold('✔ Listo.')));
}

// ============================ TOOL 5: ADMINISTRAR EPICs / TEAMs ============================
async function toolManageConfig() {
  while (true) {
    console.log(bold('\n› Administrar EPICs y TEAMs'));
    console.log(dim('  TEAMs (' + cfg.teams.length + '): ') + (cfg.teams.join(', ') || dim('—')));
    console.log(dim('  EPICs (' + cfg.epics.length + '): ') + (cfg.epics.join(', ') || dim('—')));
    const c = await select('¿Qué hacés?', [
      { label: 'Agregar TEAM', value: 'at' }, { label: 'Eliminar TEAM', value: 'dt' },
      { label: 'Agregar EPIC', value: 'ae' }, { label: 'Eliminar EPIC', value: 'de' },
      { label: 'Volver al menú', value: 'back' },
    ]);
    if (c === 'back') return;
    if (c === 'at') { const t = await text('Nuevo TEAM', { validate: validateName, transform: upper }); if (cfg.teams.includes(t)) console.log(yellow('  Ya existía.')); else { cfg.teams.push(t); saveConfig(); console.log(green('  ✓ agregado.')); } }
    if (c === 'ae') { const e = await text('Nuevo EPIC', { validate: validateName, transform: upper }); if (cfg.epics.includes(e)) console.log(yellow('  Ya existía.')); else { cfg.epics.push(e); saveConfig(); console.log(green('  ✓ agregado.')); } }
    if (c === 'dt') {
      if (!cfg.teams.length) { console.log(dim('  No hay teams.')); continue; }
      const t = await select('¿Cuál elimino?', [...cfg.teams.map((x) => ({ label: x, value: x })), { label: dim('(cancelar)'), value: '__c__' }]);
      if (t !== '__c__' && await confirm(`¿Eliminar '${t}'?`, false)) { cfg.teams = cfg.teams.filter((x) => x !== t); if (cfg.lastTeam === t) cfg.lastTeam = null; saveConfig(); console.log(green('  ✓ eliminado.')); }
    }
    if (c === 'de') {
      if (!cfg.epics.length) { console.log(dim('  No hay epics.')); continue; }
      const e = await select('¿Cuál elimino?', [...cfg.epics.map((x) => ({ label: x, value: x })), { label: dim('(cancelar)'), value: '__c__' }]);
      if (e !== '__c__' && await confirm(`¿Eliminar '${e}'?`, false)) { cfg.epics = cfg.epics.filter((x) => x !== e); if (cfg.lastEpic === e) cfg.lastEpic = null; saveConfig(); console.log(green('  ✓ eliminado.')); }
    }
  }
}

// ============================ HELPERS DE FLUJO ============================
const isLive = () => !SANDBOX;                    // ¿estamos ejecutando git de verdad?
const bad = (r) => !SANDBOX && r && !r.ok;
function stop(msg) { console.log('\n' + red('✗ ' + msg) + dim('  (revisá con git status)')); }

// ── PRIMITIVAS COMPARTIDAS (las usan tanto el flujo de un tiro como el pilotado) ──

// Devuelve la ruta de archivo desde una línea de `git status --short`.
function statusPath(line) {
  let p = line.slice(3);                          // saltea los 2 chars de estado + espacio
  const arrow = p.indexOf(' -> ');                // renames: "old -> new"
  if (arrow !== -1) p = p.slice(arrow + 4);
  return p.replace(/^"(.*)"$/, '$1');
}

// Cantidad de cambios sin commitear (en demo, según el estado simulado).
const dirtyCount = () => SANDBOX ? (demoDirty ? DEMO_STATUS.length : 0) : git(['status', '--short']).stdout.split('\n').filter(Boolean).length;

// Stagea cambios preguntando cada vez: todo o elegir archivos. Muestra el `git add`
// tanto en real como en demo. { ok, empty }
async function stageChanges() {
  const files = SANDBOX ? (demoDirty ? DEMO_STATUS : []) : git(['status', '--short']).stdout.split('\n').filter(Boolean);
  if (!files.length) { console.log(yellow('  No hay cambios para commitear.')); return { ok: false, empty: true }; }
  const mode = await select('¿Qué stageo?', [
    { label: 'Todo (git add -A)', value: 'all' },
    { label: 'Elegir archivos', value: 'pick' },
  ]);
  let r;
  if (mode === 'all') {
    r = await step(['add', '-A'], { sim: { note: 'staged (todo)' } });
  } else {
    console.log(dim('  Archivos:'));
    files.forEach((f, i) => console.log(`  ${dim((i + 1) + ')')} ${f}`));
    const ans = await text("Números separados por coma (ej: 1,3) o 'todos'");
    const paths = /^todos?$/i.test(ans.trim())
      ? files.map(statusPath)
      : [...new Set(ans.split(',').map((s) => parseInt(s.trim(), 10) - 1).filter((n) => n >= 0 && n < files.length))].map((i) => statusPath(files[i]));
    if (!paths.length) { console.log(dim('  No elegiste nada.')); return { ok: false, empty: true }; }
    r = await step(['add', '--', ...paths], { sim: { note: `staged (${paths.length})` } });
  }
  return bad(r) ? { ok: false } : { ok: true };
}

// Registra en committedFiles los archivos del último commit (HEAD).
function recordCommittedFiles() {
  const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).stdout
    .split('\n').map((f) => f.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  for (const f of files) if (!committedFiles.includes(f)) committedFiles.push(f);
}

// Crea el commit con el mensaje ya armado. { ok }
async function commit(commitMsg) {
  const r = await step(['commit', '-m', commitMsg], { sim: { note: 'commit creado' } });
  if (bad(r)) { stop('Falló el commit.'); return { ok: false }; }
  if (!SANDBOX) recordCommittedFiles();   // guardo los archivos exactos para "rehacer la rama"
  return { ok: true };
}

// pull --rebase con reintentos. Un `pull --rebase` puede fallar por algo transitorio
// (o porque justo hay un pasaje a producción bloqueando el remote). Reintenta solo una
// vez; si sigue fallando, pregunta si hay un pasaje a prod en curso y deja decidir
// entre esperar y reintentar o frenar. Devuelve el último resultado de git.
async function pullRebase() {
  const attempt = () => step(['pull', '--rebase'], { sim: { note: `${BASE_BRANCH} actualizado` } });

  let r = await attempt();
  if (!bad(r)) return r;

  // reintento automático (1 vez) tras una pausa corta
  console.log('  ' + yellow('⚠ Falló el pull --rebase.') + dim(' Reintento automático en unos segundos...'));
  await sleep(4000);
  r = await attempt();
  if (!bad(r)) return r;

  // sigue fallando → involucrar al usuario
  while (bad(r)) {
    const deploy = await confirm('El pull --rebase sigue fallando. ¿Se está haciendo un pasaje a producción ahora?', false);
    if (deploy) {
      console.log('  ' + yellow('⚠ El remote puede estar bloqueado por el pasaje.') + dim(' Conviene esperar a que termine.'));
      const c = await select('¿Qué hago?', [
        { label: 'Esperar ~20s y reintentar', value: 'wait' },
        { label: 'Frenar acá (reintento a mano cuando termine el pasaje)', value: 'stop' },
      ]);
      if (c === 'stop') return r;
      console.log(dim('  Esperando a que termine el pasaje...'));
      await sleep(20000);
    } else {
      console.log('  ' + dim('Parece transitorio. Espero un poco y reintento...'));
      await sleep(6000);
    }
    r = await attempt();
    if (!bad(r)) return r;
  }
  return r;
}

// "Bajar": actualiza la base y rebasa la rama sobre ella. NUNCA pushea. { ok, conflict }
async function syncFromBase(branch) {
  let r = await step(['checkout', BASE_BRANCH], { sim: { note: `en '${BASE_BRANCH}'` } });
  if (bad(r)) { stop('No pude ir a ' + BASE_BRANCH + '.'); return { ok: false }; }
  r = await pullRebase();
  if (bad(r)) { stop('Falló el pull --rebase.'); return { ok: false }; }
  r = await step(['checkout', branch], { sim: { note: `en '${branch}'` } });
  if (bad(r)) { stop('No pude volver a la rama.'); return { ok: false }; }
  r = await step(['rebase', BASE_BRANCH], { sim: { note: 'rebase ok' } });
  if (isLive() && !r.ok) { await handleRebaseConflict(branch); return { ok: false, conflict: true }; }
  return { ok: true };
}

// "Subir": push. Si la rama fue reescrita (rebase), pide force-with-lease con confirmación. { ok, skipped }
async function pushBranch(branch, { forced = false } = {}) {
  if (forced && isLive()) {
    console.log('\n  ' + yellow('⚠ La rama fue reescrita; el push tiene que ser FORZADO.'));
    if (!(await confirm(`¿Hacer push --force-with-lease sobre ${branch}?`, false))) {
      console.log(dim('  No pusheé. La rama local quedó lista; podés pushear a mano cuando quieras.'));
      return { ok: false, skipped: true };
    }
  }
  const args = forced ? ['push', '--force-with-lease', REMOTE, branch] : ['push', REMOTE, branch];
  const r = await step(args, { sim: { note: forced ? 'pusheado (forzado)' : 'pusheado — listo para el PR' } });
  if (bad(r)) { stop('Falló el push.'); return { ok: false }; }
  showPrLink(branch, r);
  return { ok: true };
}

// Resalta el link para crear el PR/MR que el remote (Bitbucket, GitHub, GitLab...)
// devuelve en el stderr del push, así queda a un clic en vez de perdido en el output.
function showPrLink(branch, r) {
  if (SANDBOX) {
    console.log('\n  ' + bold(green('→ Crear PR: ')) + cyan(`https://bitbucket.org/tu-workspace/tu-repo/pull-requests/new?source=${branch}`) + dim('  (demo)'));
    return;
  }
  const urls = ((r && r.stderr) || '').match(/https?:\/\/\S+/g) || [];
  const prUrl = urls.find((u) => /pull-?request|merge_request|pull\/new/i.test(u));
  if (prUrl) console.log('\n  ' + bold(green('→ Crear PR: ')) + cyan(prUrl));
}

// Elige un nombre de backup libre: RAMA-bk, RAMA-bk2, RAMA-bk3, ...
function pickBackupName(branch) {
  let name = `${branch}-bk`;
  let i = 2;
  while (branchExistsLocal(name)) { name = `${branch}-bk${i++}`; }
  return name;
}

// OPCIÓN AGRESIVA de resolución: en vez de mergear el conflicto, rehace la rama
// desde development actualizado y trae TUS versiones de los archivos elegidos.
// Descarta lo que otros cambiaron EN ESOS archivos (queda como revisión de código;
// sus cambios siguen sanos en development). Nada se borra hasta que el push salió bien.
async function rebuildBranchFromBackup(branch) {
  console.log('\n  ' + yellow('⚠ Rehacer la rama (modo agresivo).'));
  console.log(dim(`  Trae TUS versiones de los archivos que elijas y descarta lo que otros cambiaron en ESOS archivos.`));
  console.log(dim(`  (los cambios ajenos siguen intactos en '${BASE_BRANCH}'; esto es un tema de revisión de código, no de pérdida de datos). Al final PUSHEA.`));

  // salgo del conflicto; la rama vuelve como estaba (tu commit intacto)
  const ab = git(['rebase', '--abort']);
  if (!ab.ok) { console.log(red('  ✗ No pude abortar el rebase: ' + ab.stderr)); return; }

  const commitMsg = git(['log', '-1', '--format=%B', branch]).stdout;           // mensaje del último commit

  // Archivos a traer: los EXACTOS que commiteó esta sesión (100% preciso). Si no hay
  // (ej. arreglar PR, que no commitea nada nuevo), caigo a los archivos de los commits
  // propios de la rama (git log dos-puntos), que es más preciso que el diff three-dot.
  let changed = committedFiles.slice();
  if (!changed.length) {
    changed = [...new Set(git(['log', '--name-only', '--pretty=format:', `${BASE_BRANCH}..${branch}`]).stdout
      .split('\n').map((f) => f.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean))];
  }
  if (!changed.length) { console.log(yellow('  No detecté archivos cambiados en la rama; mejor resolvé a mano.')); return; }

  // elegir qué archivos traer
  console.log(dim('\n  Archivos que tocaste en la rama:'));
  changed.forEach((f, i) => console.log(`  ${dim((i + 1) + ')')} ${f}`));
  const mode = await select('¿Qué archivos traigo (con TU versión)?', [
    { label: 'Traer TODOS', value: 'all' },
    { label: 'Elegir cuáles', value: 'pick' },
  ]);
  let files = changed;
  if (mode === 'pick') {
    const ans = await text("Números separados por coma (ej: 1,3) o 'todos'");
    files = /^todos?$/i.test(ans.trim()) ? changed
      : [...new Set(ans.split(',').map((s) => parseInt(s.trim(), 10) - 1).filter((n) => n >= 0 && n < changed.length))].map((i) => changed[i]);
    if (!files.length) { console.log(dim('  No elegiste nada. Cancelo (la rama sigue como estaba, rebase abortado).')); return; }
  }

  // preview + confirmación
  const bk = pickBackupName(branch);
  console.log('\n  ' + bold('Voy a hacer:'));
  [`git branch -m ${branch} ${bk}`, `git checkout -b ${branch} ${BASE_BRANCH}`, `git checkout ${bk} -- ${files.join(' ')}`,
    `git add -A`, `git commit -m "${commitMsg}"`, `git push ${REMOTE} ${branch}`,
  ].forEach((p) => console.log('    ' + gray('· ') + p));
  if (!(await confirm('¿Ejecuto?', true))) { console.log(dim('  Cancelado. La rama sigue como estaba (rebase abortado).')); return; }

  // b) backup por rename
  let r = await step(['branch', '-m', branch, bk], { sim: { note: `backup '${bk}' creado` } }); if (bad(r)) return stop('No pude renombrar la rama a backup.');
  // c) rama nueva desde development (ya actualizado por el pull --rebase previo)
  r = await step(['checkout', '-b', branch, BASE_BRANCH], { sim: { note: `'${branch}' recreada desde ${BASE_BRANCH}` } }); if (bad(r)) return stop('No pude recrear la rama.');
  // d) traer TUS versiones de los archivos elegidos, desde el backup
  r = await step(['checkout', bk, '--', ...files], { sim: { note: `${files.length} archivo(s) traído(s) del backup` } }); if (bad(r)) return stop('No pude traer los archivos del backup.');
  // e) commit único con el mensaje del último commit
  r = await step(['add', '-A'], { sim: { note: 'staged' } }); if (bad(r)) return stop('add falló.');
  if (!(await commit(commitMsg)).ok) return;
  console.log('  ' + green('✓ ') + dim(`rama '${branch}' rehecha sobre ${BASE_BRANCH}, sin conflicto.`));

  // f) push (detección de force por si la rama ya existía en el remote)
  cfg.lastBranch = branch; saveConfig();
  let forced = false;
  const remoteRef = git(['rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${branch}`]).ok;
  if (remoteRef) forced = parseInt(git(['rev-list', '--count', `${branch}..${REMOTE}/${branch}`]).stdout || '0', 10) > 0;
  const pushed = await pushBranch(branch, { forced });

  // g) limpiar backup solo si el push salió bien (y si el usuario quiere)
  if (pushed.ok) {
    console.log('\n' + green(bold('✔ Listo — rama rehecha y pusheada.')));
    if (await confirm(`¿Borro el backup '${bk}' ahora? (si querés verificar el PR primero, dejalo)`, false)) {
      const d = git(['branch', '-D', bk]);
      console.log(d.ok ? green('  ✓ backup borrado.') : red('  ✗ ' + d.stderr));
    } else {
      console.log(dim(`  El backup '${bk}' queda como red de seguridad. Cuando confirmes que está todo bien: git branch -D ${bk}`));
    }
  } else {
    console.log(dim(`  No se pusheó. Tu trabajo está a salvo en '${bk}' (backup) y en '${branch}'.`));
  }
}

async function handleRebaseConflict(branch) {
  const conflicted = git(['diff', '--name-only', '--diff-filter=U']).stdout;
  console.log('\n  ' + yellow('⚠ El rebase encontró conflictos.'));
  if (conflicted) { console.log(dim('  Archivos en conflicto:')); conflicted.split('\n').forEach((f) => console.log('    ' + red('· ') + f)); }
  console.log(dim('  Tranqui: tus commits NO se pierden. Si abortás, la rama vuelve exactamente como estaba.'));
  const c = await select('¿Cómo seguimos? (NO se va a hacer push, salvo la opción de rehacer)', [
    { label: 'Abortar el rebase y volver todo atrás (git rebase --abort)', value: 'abort' },
    { label: 'Salir y resolver a mano en la terminal', value: 'manual' },
    { label: yellow('Rehacer la rama desde ' + BASE_BRANCH + ' con mis archivos (agresivo, con backup)'), value: 'rebuild' },
  ]);
  if (c === 'abort') {
    const a = git(['rebase', '--abort']);
    console.log(a.ok ? green('  ✓ Rebase abortado.') : red('  ✗ ' + a.stderr));
    console.log(yellow('  Frené antes del push.'));
  } else if (c === 'rebuild') {
    await rebuildBranchFromBackup(branch);
  } else {
    console.log(dim('  Rebase en curso. Para continuar:'));
    console.log(dim('    1) resolvé los conflictos  2) git add <archivos> && git rebase --continue  3) git push ' + REMOTE + ' ' + branch));
    console.log(yellow('  Frené antes del push.'));
  }
}

// ============================ MODO PILOTADO ============================
// Caja automática pero manual al subir/bajar: entrás a una rama, commiteás de a
// poco, y vos decidís cuándo bajar (sync) y cuándo subir (push). El estado vive
// en git, así que cada vuelta releemos la rama real.
async function pilotedMode() {
  console.log(bold('› Modo pilotado'));
  committedFiles = [];
  const info = getRepoInfo();
  if (!SANDBOX && !info) { console.log(red('  ✗ No estás en un repo git.')); return; }

  while (true) {
    const branch = SANDBOX ? (cfg.lastBranch || 'DEMO-000') : git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
    const onBase = branch === BASE_BRANCH;

    // tablero
    console.log('');
    console.log(dim('  ──────── estado ────────'));
    console.log('  Rama: ' + cyan(branch) + (onBase ? yellow('  (estás en la base — entrá a una rama de tarea)') : ''));
    const dirty = dirtyCount();
    console.log('  Cambios sin commitear: ' + (dirty ? yellow(String(dirty)) : dim('0')));
    if (!SANDBOX && !onBase) {
      const remoteRef = git(['rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${branch}`]).ok;
      const ahead = remoteRef ? parseInt(git(['rev-list', '--count', `${REMOTE}/${branch}..${branch}`]).stdout || '0', 10)
                              : parseInt(git(['rev-list', '--count', `${BASE_BRANCH}..${branch}`]).stdout || '0', 10);
      console.log('  Commits sin pushear: ' + (ahead ? yellow(String(ahead)) : dim('0')) + (remoteRef ? '' : dim('  (rama nueva, sin remote)')));
    }
    console.log(dim('  ─────────────────────────'));

    const c = await select('Acción:', [
      { label: '· Entrar / crear rama de tarea', value: 'branch' },
      { label: '· Commitear (stagea + commit; repetible)', value: 'commit' },
      { label: '· Bajar cambios — sync ' + BASE_BRANCH + ' (sin push)', value: 'down' },
      { label: '· Subir — push', value: 'up' },
      { label: '· Eliminar rama local', value: 'delete' },
      { label: '· Estado detallado', value: 'status' },
      { label: '· Volver al menú', value: 'back' },
    ]);
    if (c === 'back') return;
    try {
      if (c === 'branch') await pilotEnterBranch();
      else if (c === 'commit') await pilotCommit(branch, onBase);
      else if (c === 'down') await pilotDown(branch, onBase);
      else if (c === 'up') await pilotUp(branch, onBase);
      else if (c === 'delete') await pilotDeleteBranch(branch);
      else if (c === 'status') pilotStatus(branch);
    } catch (e) {
      if (!(e instanceof Cancel)) console.log(red('  ✗ ' + e.message));
    }
  }
}

async function pilotEnterBranch() {
  const team = await pickTeam();
  const number = await askNumber();
  const branch = `${team}-${number}`;
  if (SANDBOX) { cfg.lastBranch = branch; saveConfig(); console.log('  ' + green('✓ ') + dim(`(demo) en '${branch}'`)); return; }
  if (branchExistsLocal(branch)) {
    const r = await step(['checkout', branch], { sim: {} });
    if (bad(r)) return stop('No pude entrar a la rama.');
    console.log('  ' + green('✓ ') + dim(`entraste a '${branch}'`));
  } else {
    if (!branchExistsLocal(BASE_BRANCH)) { console.log(red(`  ✗ No existe la base '${BASE_BRANCH}'.`)); return; }
    // Prevención: branchear desde un development viejo genera conflictos de rebase después.
    // Traemos lo último y, si development está limpio, lo actualizamos antes de crear la rama.
    git(['fetch', REMOTE, BASE_BRANCH]);
    const behind = parseInt(git(['rev-list', '--count', `${BASE_BRANCH}..${REMOTE}/${BASE_BRANCH}`]).stdout || '0', 10);
    if (behind > 0) {
      console.log('  ' + yellow(`⚠ Tu '${BASE_BRANCH}' local está ${behind} commit(s) atrás de ${REMOTE}.`) + dim(' Branchear desde acá suele traer conflictos de rebase después.'));
      if (dirtyCount() > 0) {
        console.log('  ' + dim(`Tenés cambios sin commitear, así que no puedo actualizar '${BASE_BRANCH}' ahora. Creo la rama desde tu '${BASE_BRANCH}' local igual (ojo con el rebase después).`));
      } else if (await confirm(`¿Actualizo '${BASE_BRANCH}' antes de crear la rama? (evita el problema del rebase)`, true)) {
        const cur = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
        if (cur !== BASE_BRANCH) { const co = git(['checkout', BASE_BRANCH]); if (!co.ok) { console.log(red('  ✗ ' + co.stderr)); return; } }
        const pr = await pullRebase();
        if (bad(pr)) return stop(`No pude actualizar '${BASE_BRANCH}'.`);
      }
    }
    const r = await step(['checkout', '-b', branch, BASE_BRANCH], { sim: {} });
    if (bad(r)) return stop('No pude crear la rama (¿cambios sin commitear que chocan?).');
    console.log('  ' + green('✓ ') + dim(`rama '${branch}' creada desde ${BASE_BRANCH}`));
  }
  cfg.lastBranch = branch; saveConfig();
}

async function pilotCommit(branch, onBase) {
  if (onBase && !(await confirm(yellow(`Estás en '${BASE_BRANCH}'. ¿Seguro querés commitear acá?`), false))) return;
  const staged = await stageChanges();   // muestra el git add (real y demo)
  if (!staged.ok) return;
  const commitMsg = await buildCommitInteractive(branch);
  console.log('\n  Commit: ' + cyan(commitMsg));
  if (!(await confirm('¿Commiteo?', true))) return;
  if ((await commit(commitMsg)).ok) { if (SANDBOX) demoDirty = false; console.log('  ' + green('✓ ') + dim('commit creado (todavía sin pushear)')); }
}

async function pilotDown(branch, onBase) {
  if (dirtyCount() > 0) {
    console.log('  ' + yellow('⚠ Tenés cambios sin commitear.') + dim(' Commiteá primero: el rebase no corre con el árbol sucio y podrías perder trabajo.'));
    return;
  }
  if (onBase) {
    const r = await pullRebase();
    if (bad(r)) return stop('Falló el pull --rebase.');
    console.log('  ' + green('✓ ') + dim(`'${BASE_BRANCH}' al día.`));
    return;
  }
  if ((await syncFromBase(branch)).ok) console.log('  ' + green('✓ ') + dim(`rama al día con ${BASE_BRANCH} (sin push).`));
}

async function pilotUp(branch, onBase) {
  if (onBase) { console.log(yellow(`  '${BASE_BRANCH}' no se pushea desde acá.`)); return; }
  // Antes de pushear: asegurar que la rama esté sobre el último development del remote.
  if (!SANDBOX) {
    git(['fetch', REMOTE, BASE_BRANCH]);
    const behind = parseInt(git(['rev-list', '--count', `${branch}..${REMOTE}/${BASE_BRANCH}`]).stdout || '0', 10);
    if (behind > 0) {
      console.log('  ' + yellow(`⚠ '${branch}' no está sobre el último '${BASE_BRANCH}' (faltan ${behind} commit(s) del remote).`));
      if (await confirm(`¿Sincronizo ${BASE_BRANCH} y rebaso ${branch} antes del push?`, true)) {
        if (dirtyCount() > 0) { console.log('  ' + yellow('⚠ Hay cambios sin commitear; commiteá antes de sincronizar.')); return; }
        if (!(await syncFromBase(branch)).ok) return;   // si hubo conflicto, ya frenó
      }
    }
  }
  // Si el remote de la rama tiene commits que no están en local, es porque rebaseamos → push forzado.
  let forced = false;
  if (!SANDBOX) {
    const remoteRef = git(['rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${branch}`]).ok;
    if (remoteRef) forced = parseInt(git(['rev-list', '--count', `${branch}..${REMOTE}/${branch}`]).stdout || '0', 10) > 0;
  }
  if ((await pushBranch(branch, { forced })).ok) console.log('  ' + green('✓ ') + dim('pusheado.'));
}

async function pilotDeleteBranch(current) {
  const team = await pickTeam();
  const number = await askNumber();
  const target = `${team}-${number}`;
  if (SANDBOX) {
    if (!(await confirm(`¿Eliminar la rama LOCAL '${target}'?`, false))) return;
    console.log('  ' + green('✓ ') + dim(`(demo) rama local '${target}' eliminada — el remote no se toca`));
    if (cfg.lastBranch === target) { cfg.lastBranch = null; saveConfig(); }
    return;
  }
  if (!branchExistsLocal(target)) { console.log(yellow(`  La rama '${target}' no existe localmente.`)); return; }
  console.log('  ' + yellow(`⚠ Vas a borrar la rama LOCAL '${target}'.`) + dim(' (el remote no se toca)'));
  if (!(await confirm(`¿Eliminar '${target}'?`, false))) return;
  if (current === target) {   // no se puede borrar la rama en la que estás parado
    const c = await step(['checkout', BASE_BRANCH], { sim: {} });
    if (bad(c)) return stop(`No pude salir de '${target}' hacia '${BASE_BRANCH}'.`);
  }
  const r = await step(['branch', '-D', target], { sim: { note: 'borrada' } });
  if (bad(r)) return stop('No pude borrar la rama (¿tiene cambios sin mergear? probá -D de nuevo).');
  if (cfg.lastBranch === target) { cfg.lastBranch = null; saveConfig(); }
  console.log('  ' + green('✓ ') + dim(`rama local '${target}' eliminada.`));
}

function pilotStatus(branch) {
  if (SANDBOX) { console.log(dim('  (demo) git status / log simulados.')); return; }
  console.log(dim('  git status --short:'));
  const st = git(['status', '--short']).stdout;
  console.log(st ? st.split('\n').map((l) => '    ' + l).join('\n') : dim('    (limpio)'));
  console.log(dim(`  Commits de la rama sobre ${BASE_BRANCH}:`));
  const log = git(['log', '--oneline', '-8', `${BASE_BRANCH}..${branch}`]).stdout;
  console.log(log ? log.split('\n').map((l) => '    ' + l).join('\n') : dim(`    (sin commits sobre ${BASE_BRANCH})`));
}

// ============================ MENÚ ============================
function banner() {
  const t = ' commit-tool ';
  console.log('\n' + cyan('┌' + '─'.repeat(t.length + 2) + '┐'));
  console.log(cyan('│ ') + bold(t.trim()) + cyan(' │'));
  console.log(cyan('└' + '─'.repeat(t.length + 2) + '┘'));
  if (SANDBOX) console.log(yellow('  ⚠ MODO DEMO') + dim(' — no se ejecuta git, se simula todo.'));
  else console.log(dim('  Base: ') + BASE_BRANCH + dim('  ·  Remote: ') + REMOTE);
}

async function mainMenu() {
  banner();
  while (true) {
    console.log('');
    const choice = await select('¿Qué querés hacer?', [
      { label: '· Crear PR (flujo completo, un solo commit)', value: 'create' },
      { label: '· Modo pilotado (commits de a poco, subir/bajar manual)', value: 'piloted' },
      { label: '· Chequear rama / sincronizar ' + BASE_BRANCH, value: 'check' },
      { label: '· Arreglar PR bugueado tras pasaje a producción', value: 'fixprod' },
      { label: '· Administrar EPICs y TEAMs', value: 'config' },
      { label: '· Salir', value: 'exit' },
    ]);
    if (choice === 'exit') { return; }
    try {
      if (choice === 'create') await flowCreatePR();
      else if (choice === 'piloted') await pilotedMode();
      else if (choice === 'check') await toolCheckSync();
      else if (choice === 'fixprod') await toolFixProdPR();
      else if (choice === 'config') await toolManageConfig();
    } catch (e) {
      if (!(e instanceof Cancel)) console.log(red('\n✗ ' + e.message));
    }
    console.log('');
    if (!(await confirm('¿Volver al menú?', true))) { return; }
  }
}

cfg = loadConfig();
mainMenu().catch((e) => { console.error(red('\n✗ ' + e.message)); process.exit(1); });
