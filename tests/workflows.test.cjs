const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const yaml = require('../reachability/node_modules/js-yaml');
const root = path.resolve(__dirname, '..');
const read = file => yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));
test('public workflows use hosted runners, read-only permissions and pinned Actions', () => {
 for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
  const workflow = read(`.github/workflows/${file}`);
  assert.equal(workflow.on?.pull_request_target, undefined);
  assert.equal(workflow.on?.workflow_run, undefined);
  assert.deepEqual(workflow.permissions, {contents:'read'});
  for (const job of Object.values(workflow.jobs)) {
   if (job.uses) assert.match(job.uses, /^\.\//);
   else assert.equal(job['runs-on'], 'ubuntu-latest');
   for (const step of job.steps || []) {
    if (step.uses && !step.uses.startsWith('./')) assert.match(step.uses, /@[a-f0-9]{40}$/);
    if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
   }
  }
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
