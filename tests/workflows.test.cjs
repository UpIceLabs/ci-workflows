const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const yaml = require('../reachability/node_modules/js-yaml');
const root = path.resolve(__dirname, '..');
const read = file => yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));
const reaperFiles = ['stuck-run-reaper.yml', 'stuck-run-reaper-cancel.yml'];
const reusable = ['node-gates.yml', 'python-gates.yml', 'secret-scan.yml'];
test('public workflows use hosted runners, read-only permissions and pinned Actions', () => {
 for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
  const workflow = read(`.github/workflows/${file}`);
  assert.equal(workflow.on?.pull_request_target, undefined);
  assert.equal(workflow.on?.workflow_run, undefined);
  assert.deepEqual(workflow.permissions, reaperFiles.includes(file) ? {contents:'read',actions:'read'} : {contents:'read'});
  for (const job of Object.values(workflow.jobs)) {
   if (job.uses) assert.match(job.uses, /^\.\//);
   else if (reaperFiles.includes(file)) {
    assert.match(job['runs-on'], /inputs\.runs-on/);
    assert.doesNotMatch(job['runs-on'], /ubuntu-latest|CI_RUNNER/);
    assert.equal(workflow.on.workflow_call.inputs['runs-on'].required, true);
    assert.equal(workflow.on.workflow_call.inputs['runs-on'].default, undefined);
   }
   else if (reusable.includes(file)) {
    assert.match(job['runs-on'], /inputs\['runs-on'\] \|\| vars\.CI_RUNNER \|\| 'ubuntu-latest'/);
    assert.equal(workflow.on.workflow_call.inputs['runs-on'].type, 'string');
    assert.equal(workflow.on.workflow_call.inputs['runs-on'].default, '');
   }
   else assert.equal(job['runs-on'], 'ubuntu-latest');
   for (const step of job.steps || []) {
    if (step.uses && !step.uses.startsWith('./')) assert.match(step.uses, /@[a-f0-9]{40}$/);
    if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
   }
  }
 }
});
test('composite Action pins dependencies and disables npm lifecycle scripts', () => {
 const action=read('reachability/action.yml');
 for (const step of action.runs.steps) {
  if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  if (step.run?.includes('npm ci')) assert.match(step.run, /--ignore-scripts/);
 }
});
test('Python fails on zero tests and failing tests, passes real success', t => {
 const step = read('.github/workflows/python-gates.yml').jobs.gates.steps.find(s => s.name === 'Test (pytest)');
 // Hosted CI installs dependencies; execute the actual workflow test command here.
 const command = step.run.trim().split('\n').at(-1);
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-python-proof-'));
 t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
 const run = () => spawnSync('bash', ['-e','-o','pipefail','-c',command], {cwd:dir,encoding:'utf8',env:{...process.env,PYTEST_DISABLE_PLUGIN_AUTOLOAD:'1'}});
 let result = run(); assert.equal(result.status, 5, result.stdout + result.stderr);
 fs.writeFileSync(path.join(dir, 'test_example.py'), 'def test_example(): assert False\n');
 result=run(); assert.equal(result.status,1,result.stdout+result.stderr);
 fs.writeFileSync(path.join(dir, 'test_example.py'), 'def test_example(): assert True\n');
 result=run(); assert.equal(result.status,0,result.stdout+result.stderr);
});
test('the library declares an unconditional secret scan route', () => {
 const {audit} = require('../reachability/check-reachability.cjs');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'.github/ci-checks.json'),'utf8'));
 assert.equal(audit(root,manifest)[0].unconditional_pr,true);
});
test('all three reusable gates share one runs-on expression', () => {
 const expressions = reusable.map(file => Object.values(read(`.github/workflows/${file}`).jobs)[0]['runs-on']);
 assert.equal(new Set(expressions).size, 1);
});
test('every job has timeout-minutes; reusable gates take it as an input', () => {
 for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
  const workflow = read(`.github/workflows/${file}`);
  for (const [name, job] of Object.entries(workflow.jobs)) {
   if (job.uses) continue; // timeout lives in the called workflow
   assert.ok(job['timeout-minutes'] !== undefined, `${file}:${name} lacks timeout-minutes`);
   if (file !== 'ci.yml') {
    assert.equal(job['timeout-minutes'], '${{ inputs.timeout-minutes }}');
    assert.equal(workflow.on.workflow_call.inputs['timeout-minutes'].type, 'number');
    assert.ok(workflow.on.workflow_call.inputs['timeout-minutes'].default > 0);
   }
  }
 }
});
test('stuck-run-reaper split: report is read-only everywhere, cancel is the only actions: write file', () => {
 const dir = path.join(root, '.github/workflows');
 const writers = fs.readdirSync(dir).filter(f => /actions:\s*write/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
 assert.deepEqual(writers, ['stuck-run-reaper-cancel.yml']);
 const report = read('.github/workflows/stuck-run-reaper.yml');
 const cancel = read('.github/workflows/stuck-run-reaper-cancel.yml');
 assert.doesNotMatch(fs.readFileSync(path.join(dir, 'stuck-run-reaper.yml'), 'utf8'), /:\s*write\b/);
 for (const w of [report, cancel]) {
  assert.ok(w.on.workflow_call, 'must be workflow_call');
  assert.equal(w.permissions.actions, 'read');
  const inp = w.on.workflow_call.inputs;
  assert.equal(inp.cancel, undefined);
  assert.equal(inp['in-progress-max-minutes'].default, 180);
  assert.equal(inp['queued-max-minutes'].default, 120);
  assert.equal(inp['runs-on'].required, true);
  assert.equal(inp['runs-on'].default, undefined);
  assert.equal(inp['exclude-workflows'].type, 'string');
  assert.equal(inp['exclude-workflows'].default, '');
 }
 assert.deepEqual(Object.keys(report.jobs), ['report']);
 assert.deepEqual(Object.keys(cancel.jobs), ['cancel']);
 assert.equal(report.jobs.report.permissions.actions, 'read');
 assert.equal(cancel.jobs.cancel.permissions.actions, 'write');
 const rs = report.jobs.report.steps[0], cs = cancel.jobs.cancel.steps[0];
 assert.equal(rs.env.CANCEL, 'false');
 assert.equal(cs.env.CANCEL, 'true');
 // Same filter/thresholds/exclusion logic in both: scripts identical.
 assert.equal(rs.run, cs.run);
 assert.match(rs.run, /command -v gh/);
 assert.match(rs.run, /databaseId != \$\{SELF_RUN_ID\}/);
 assert.match(rs.run, /--limit 500/);
 assert.match(rs.run, /EXCLUDE_JSON/);
});
test('templates: reaper caller reports by default; ci-caller passes runs-on explicitly', () => {
 const caller = fs.readFileSync(path.join(root, 'templates/stuck-run-reaper-caller.yml'), 'utf8');
 const live = yaml.load(caller);
 assert.match(live.jobs.reap.uses, /stuck-run-reaper\.yml@/);
 assert.equal(live.jobs.reap.permissions.actions, 'read');
 assert.match(caller, /#\s+uses: .*stuck-run-reaper-cancel\.yml@/);
 const ci = read('templates/ci-caller.yml');
 for (const job of Object.values(ci.jobs)) if (job.uses) assert.match(job.with['runs-on'], /^<ALLOWED_RUNNER_JSON/);
});
