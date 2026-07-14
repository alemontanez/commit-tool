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
let DRY = false; // se activa en el dry-run
let cfg = null;

// ============================ COLORES ============================
const paint = (n) => (s) => `\x1b[${n}m${s}\x1b[0m`;
const dim = paint(2), bold = paint(1), red = paint(31), green = paint(32);
const yellow = paint(33), cyan = paint(36), gray = paint(90);

// ============================ PERSISTENCIA ============================
function loadConfig() {
  for (const p of [CONFIG_PATH, OLD_CONFIG_PATH]) {
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { teams: c.teams || [], epics: c.epics || [], lastTeam: c.lastTeam || null, lastEpic: c.lastEpic || null };
    } catch { /* sigue con el próximo path */ }
  }
  return { teams: [], epics: [], lastTeam: null, lastEpic: null };
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

async function step(args, { sim = {}, mutating = true } = {}) {
  console.log(gray('  $ ') + 'git ' + args.join(' '));
  await sleep(120);
  if (SANDBOX) { if (sim.note) console.log('    ' + green('✓ ') + dim(sim.note)); return { ok: true }; }
  if (DRY && mutating) { console.log('    ' + yellow('◦ ') + dim('(dry-run: no ejecutado)')); return { ok: true, dry: true }; }
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
  const up = (x) => x.toUpperCase();
  const v = (x) => (!x ? 'No puede estar vacío' : (/\s/.test(x) ? 'Sin espacios' : null));
  let team = null;
  if (cfg.lastTeam) { if (await confirm(`¿Usar el último team (${bold(cfg.lastTeam)})?`, true)) team = cfg.lastTeam; }
  if (!team) {
    if (cfg.teams.length === 0) {
      console.log(dim('  (todavía no hay teams guardados)'));
      team = await text('Nombre del nuevo team (ej: NSTEAM1)', { validate: v, transform: up });
    } else {
      const opts = cfg.teams.map((t) => ({ label: t, value: t }));
      opts.push({ label: green('➕ Cargar nuevo team'), value: '__new__' });
      const c = await select('Elegí el team:', opts);
      team = c === '__new__' ? await text('Nombre del nuevo team', { validate: v, transform: up }) : c;
    }
  }
  if (!cfg.teams.includes(team)) cfg.teams.push(team);
  cfg.lastTeam = team; saveConfig();
  return team;
}

async function pickEpic() {
  const up = (x) => x.toUpperCase();
  const v = (x) => (!x ? 'No puede estar vacío' : (/\s/.test(x) ? 'Sin espacios' : null));
  let epic;
  if (cfg.epics.length === 0) {
    console.log(dim('  (todavía no hay EPICs guardados)'));
    epic = await text('Nombre del nuevo EPIC (ej: AR-RETEN-SANTAFE-REVFEB26)', { validate: v, transform: up });
  } else {
    const opts = [];
    if (cfg.lastEpic) opts.push({ label: `${cfg.lastEpic} ${dim('(último usado)')}`, value: cfg.lastEpic });
    cfg.epics.filter((e) => e !== cfg.lastEpic).forEach((e) => opts.push({ label: e, value: e }));
    opts.push({ label: green('➕ Cargar nuevo EPIC'), value: '__new__' });
    const c = await select('Elegí el EPIC:', opts);
    epic = c === '__new__' ? await text('Nombre del nuevo EPIC', { validate: v, transform: up }) : c;
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

// ============================ TOOL 1 + 3: CREAR PR (real / dry) ============================
async function flowCreatePR({ dryRun = false } = {}) {
  DRY = dryRun;
  const tag = dryRun ? cyan(' [DRY-RUN — no se modifica nada]') : '';
  console.log(bold('› Crear PR' ) + tag);

  // repo
  const info = getRepoInfo();
  if (!SANDBOX && !info) { console.log(red('  ✗ No estás dentro de un repo git.')); DRY = false; return; }
  console.log('  ' + green('✓ ') + dim('repo: ') + (SANDBOX ? info.root : repoRoot));
  if (!SANDBOX) {
    if (!info.hasRemote) console.log('  ' + yellow('⚠ ') + dim(`no encontré el remote '${REMOTE}'.`));
    if (!branchExistsLocal(BASE_BRANCH)) { console.log(red(`  ✗ No existe la rama local '${BASE_BRANCH}'.`)); DRY = false; return; }
    if (info.branch !== BASE_BRANCH) {
      if (!(await confirm(`Estás en '${info.branch}', no en '${BASE_BRANCH}'. ¿Cambio a '${BASE_BRANCH}'?`, true))) { DRY = false; return; }
      if (!DRY) { const r = git(['checkout', BASE_BRANCH]); if (!r.ok) { console.log(red('  ✗ ' + r.stderr)); DRY = false; return; } }
    }
    console.log('  ' + green('✓ ') + dim(`en '${BASE_BRANCH}'`));
  } else {
    console.log('  ' + green('✓ ') + dim(`rama actual: '${BASE_BRANCH}'  ·  remote '${REMOTE}' ok`));
  }

  // status
  console.log(bold('\n› Cambios sin commitear:'));
  if (SANDBOX) {
    console.log('    ' + green(' M src/FileCabinet/SuiteScripts/ism/ism_abm/setRetencion.ts'));
  } else {
    const st = git(['status', '--short']).stdout;
    if (!st) { console.log(yellow('  No hay nada para commitear.')); DRY = false; return; }
    console.log(st.split('\n').map((l) => '    ' + l).join('\n'));
  }

  if (!SANDBOX && !dryRun) { if (!(await confirm('\n¿Los datos del repo están OK y seguimos?', true))) { DRY = false; return; } }
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
    if (c === 'cancel') { DRY = false; return; }
    if (c === 'reset' || c === 'recreate') { strategy = c; break; }
    if (c === 'rename') { number = await askNumber('Nuevo número de tarea'); branch = `${team}-${number}`; }
  }

  const ticket = `${team}-${number}`;
  const commitMsg = `${type}(${epic}): [${ticket}] ${description}`;
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
  [branchLine, `git add -A`, `git commit -m "..."`, `git checkout ${BASE_BRANCH}`, `git pull --rebase`,
    `git checkout ${branch}`, `git rebase ${BASE_BRANCH}`,
    forced ? `git push --force-with-lease ${REMOTE} ${branch}   ${yellow('(FORZADO)')}` : `git push ${REMOTE} ${branch}`,
  ].forEach((p) => console.log('    ' + gray('· ') + p));
  console.log('');
  if (!(await confirm('¿Ejecuto todo esto?', true))) { DRY = false; return; }
  console.log('\n' + bold('› Ejecutando...'));

  // branch step
  let r;
  if (strategy === 'create') r = await step(['checkout', '-b', branch], { sim: { note: `rama '${branch}' creada` } });
  else if (strategy === 'reset') r = await step(['checkout', '-B', branch], { sim: { note: `rama '${branch}' reseteada a ${BASE_BRANCH}` } });
  else { r = await step(['branch', '-D', branch], { sim: { note: 'borrada' } }); if (real(r)) r = await step(['checkout', '-b', branch], { sim: { note: 'recreada' } }); }
  if (bad(r)) return stop('No pude preparar la rama.');

  r = await step(['add', '-A'], { sim: { note: 'staged' } }); if (bad(r)) return stop('Falló el add.');
  r = await step(['commit', '-m', commitMsg], { sim: { note: 'commit creado' } }); if (bad(r)) return stop('Falló el commit.');
  r = await step(['checkout', BASE_BRANCH], { sim: { note: `en '${BASE_BRANCH}'` } }); if (bad(r)) return stop('No pude volver a ' + BASE_BRANCH + '.');
  r = await step(['pull', '--rebase'], { sim: { note: `${BASE_BRANCH} actualizado` } }); if (bad(r)) return stop('Falló el pull --rebase.');
  r = await step(['checkout', branch], { sim: { note: `en '${branch}'` } }); if (bad(r)) return stop('No pude volver a la rama.');

  r = await step(['rebase', BASE_BRANCH], { sim: { note: 'rebase ok' } });
  if (real(r) && !r.ok) { if (await handleRebaseConflict(branch)) return; else return; }

  // push (con confirmación de force)
  if (forced && !SANDBOX && !DRY) {
    console.log('\n  ' + yellow('⚠ Este caso reescribió la rama, el push tiene que ser FORZADO.'));
    if (!(await confirm(`¿Hacer push --force-with-lease sobre ${branch}?`, false))) {
      console.log(dim('  No pusheé. La rama local quedó lista; podés pushear a mano cuando quieras.'));
      DRY = false; return;
    }
  }
  const pushArgs = forced ? ['push', '--force-with-lease', REMOTE, branch] : ['push', REMOTE, branch];
  r = await step(pushArgs, { sim: { note: 'pusheado — listo para el PR' } }); if (bad(r)) return stop('Falló el push.');

  console.log('\n' + green(bold('✔ Listo.')) + dim(dryRun ? '  (dry-run: nada se modificó)' : ''));
  DRY = false;
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
      const r = await step(['pull', '--rebase'], { sim: { note: `${BASE_BRANCH} actualizado` } });
      if (!SANDBOX && !r.ok) console.log(red('  ✗ Falló: ' + r.stderr));
    }
  } else console.log('  ' + green('✓ ') + `'${BASE_BRANCH}' está al día con ${REMOTE}.`);
}

// ============================ TOOL 4: ARREGLAR PR BUGUEADO (prod) ============================
async function toolFixProdPR() {
  console.log(bold('› Arreglar PR bugueado tras pasaje a producción'));
  console.log(dim('  Actualiza development, rebasa la rama del PR, agrega un cambio mínimo y hace push FORZADO.'));
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

  const epic = await pickEpic();
  const description = await text('Descripción del commit de refresco', {
    defaultValue: 'refresh PR tras pasaje a produccion', validate: (x) => (x.length < 3 ? 'Muy corta' : null),
  });
  const commitMsg = `chore(${epic}): [${branch}] ${description}`;

  // elegir archivo a tocar
  let fileToTouch = null;
  if (SANDBOX) fileToTouch = 'src/FileCabinet/SuiteScripts/ism/ism_abm/setRetencion.ts';
  else {
    const files = git(['diff', '--name-only', `${BASE_BRANCH}...${branch}`]).stdout.split('\n').filter(Boolean);
    if (files.length) {
      const opts = files.slice(0, 15).map((f) => ({ label: f, value: f }));
      opts.push({ label: dim('Escribir otra ruta a mano'), value: '__other__' });
      const c = await select('¿A qué archivo le agrego el cambio mínimo (salto de línea)?', opts);
      fileToTouch = c === '__other__' ? await text('Ruta del archivo (relativa a la raíz del repo)') : c;
    } else {
      fileToTouch = await text('Ruta del archivo para el cambio mínimo (relativa a la raíz del repo)');
    }
  }

  console.log('\n' + bold('› Resumen'));
  console.log(dim('  ─────────────────────────────────────────────'));
  console.log('  Branch: ' + cyan(branch) + yellow('  (push FORZADO)'));
  console.log('  Commit: ' + cyan(commitMsg));
  console.log('  Cambio mínimo en: ' + cyan(fileToTouch));
  console.log(dim('  ─────────────────────────────────────────────'));
  [`git checkout ${BASE_BRANCH}`, `git pull --rebase`, `git checkout ${branch}`, `git rebase ${BASE_BRANCH}`,
    `(agrega un salto de línea a ${fileToTouch})`, `git add -A`, `git commit -m "..."`,
    `git push --force-with-lease ${REMOTE} ${branch}   ${yellow('(FORZADO)')}`,
  ].forEach((p) => console.log('    ' + gray('· ') + p));
  console.log('');
  if (!(await confirm('¿Ejecuto esto?', true))) return;
  console.log('\n' + bold('› Ejecutando...'));

  let r;
  r = await step(['checkout', BASE_BRANCH], { sim: { note: `en '${BASE_BRANCH}'` } }); if (bad(r)) return stop('checkout falló.');
  r = await step(['pull', '--rebase'], { sim: { note: `${BASE_BRANCH} actualizado` } }); if (bad(r)) return stop('pull falló.');
  r = await step(['checkout', branch], { sim: { note: `en '${branch}'` } }); if (bad(r)) return stop('checkout falló.');
  r = await step(['rebase', BASE_BRANCH], { sim: { note: 'rebase ok' } });
  if (real(r) && !r.ok) { await handleRebaseConflict(branch); return; }

  // cambio mínimo
  if (SANDBOX) console.log('  ' + green('✓ ') + dim('(simulado) salto de línea agregado'));
  else if (DRY) console.log('  ' + yellow('◦ ') + dim('(dry-run: no se tocó el archivo)'));
  else {
    try { fs.appendFileSync(path.join(repoRoot, fileToTouch), '\n'); console.log('  ' + green('✓ ') + dim('salto de línea agregado a ' + fileToTouch)); }
    catch (e) { return stop('No pude escribir el archivo: ' + e.message); }
  }

  r = await step(['add', '-A'], { sim: { note: 'staged' } }); if (bad(r)) return stop('add falló.');
  r = await step(['commit', '-m', commitMsg], { sim: { note: 'commit creado' } }); if (bad(r)) return stop('commit falló.');

  console.log('\n  ' + yellow('⚠ Este flujo hace un push FORZADO sobre ' + branch + '.'));
  if (!SANDBOX && !DRY && !(await confirm(`¿Hacer push --force-with-lease sobre ${branch}?`, false))) {
    console.log(dim('  No pusheé. La rama quedó lista localmente.')); return;
  }
  r = await step(['push', '--force-with-lease', REMOTE, branch], { sim: { note: 'pusheado (forzado)' } }); if (bad(r)) return stop('push falló.');
  console.log('\n' + green(bold('✔ Listo.')));
}

// ============================ TOOL 5: ADMINISTRAR EPICs / TEAMs ============================
async function toolManageConfig() {
  const up = (x) => x.toUpperCase();
  const v = (x) => (!x ? 'No puede estar vacío' : (/\s/.test(x) ? 'Sin espacios' : null));
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
    if (c === 'at') { const t = await text('Nuevo TEAM', { validate: v, transform: up }); if (cfg.teams.includes(t)) console.log(yellow('  Ya existía.')); else { cfg.teams.push(t); saveConfig(); console.log(green('  ✓ agregado.')); } }
    if (c === 'ae') { const e = await text('Nuevo EPIC', { validate: v, transform: up }); if (cfg.epics.includes(e)) console.log(yellow('  Ya existía.')); else { cfg.epics.push(e); saveConfig(); console.log(green('  ✓ agregado.')); } }
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
const real = (r) => SANDBOX || DRY ? false : true; // ¿estamos ejecutando de verdad?
const bad = (r) => !SANDBOX && !DRY && r && !r.ok;
function stop(msg) { console.log('\n' + red('✗ ' + msg) + dim('  (revisá con git status)')); DRY = false; }

async function handleRebaseConflict(branch) {
  const conflicted = git(['diff', '--name-only', '--diff-filter=U']).stdout;
  console.log('\n  ' + yellow('⚠ El rebase encontró conflictos.'));
  if (conflicted) { console.log(dim('  Archivos en conflicto:')); conflicted.split('\n').forEach((f) => console.log('    ' + red('· ') + f)); }
  const c = await select('¿Cómo seguimos? (NO se va a hacer push)', [
    { label: 'Abortar el rebase y volver todo atrás (git rebase --abort)', value: 'abort' },
    { label: 'Salir y resolver a mano en la terminal', value: 'manual' },
  ]);
  if (c === 'abort') {
    const a = git(['rebase', '--abort']);
    console.log(a.ok ? green('  ✓ Rebase abortado.') : red('  ✗ ' + a.stderr));
  } else {
    console.log(dim('  Rebase en curso. Para continuar:'));
    console.log(dim('    1) resolvé los conflictos  2) git add <archivos> && git rebase --continue  3) git push ' + REMOTE + ' ' + branch));
  }
  console.log(yellow('  Frené antes del push.'));
  DRY = false;
  return true;
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
      { label: '1. Crear PR (flujo completo)', value: 'create' },
      { label: '2. Chequear rama / sincronizar ' + BASE_BRANCH, value: 'check' },
      { label: '3. Simular el flujo de PR (dry-run, no toca nada)', value: 'dry' },
      { label: '4. Arreglar PR bugueado tras pasaje a producción', value: 'fixprod' },
      { label: '5. Administrar EPICs y TEAMs', value: 'config' },
      { label: '6. Salir', value: 'exit' },
    ]);
    if (choice === 'exit') { console.log(dim('Chau!')); return; }
    try {
      if (choice === 'create') await flowCreatePR({ dryRun: false });
      else if (choice === 'check') await toolCheckSync();
      else if (choice === 'dry') await flowCreatePR({ dryRun: true });
      else if (choice === 'fixprod') await toolFixProdPR();
      else if (choice === 'config') await toolManageConfig();
    } catch (e) {
      if (!(e instanceof Cancel)) console.log(red('\n✗ ' + e.message));
      DRY = false;
    }
    console.log('');
    if (!(await confirm('¿Volver al menú?', true))) { console.log(dim('Chau!')); return; }
  }
}

cfg = loadConfig();
mainMenu().catch((e) => { console.error(red('\n✗ ' + e.message)); process.exit(1); });
