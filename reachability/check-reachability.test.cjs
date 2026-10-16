const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {audit} = require('./check-reachability.cjs');
const declaration = {version: 1, checks: [{id: 'tenant', kind: 'tenancy', workflow: '.github/workflows/check.yml', job: 'tenant', run: 'python3 checks/tenant.py'}]};
function fixture(t, files) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reachability-test-'));
 t.after(() => fs.rmSync(root, {recursive: true}));
 fs.mkdirSync(path.join(root, '.github/workflows'), {recursive: true});
 for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(root, '.github/workflows', name), JSON.stringify(value));
 return root;
}
const jobs = {tenant: {'runs-on': 'ubuntu-latest', steps: [{run: 'python3 checks/tenant.py'}]}};
test('mutation: removing the PR trigger changes reachable to unreachable', t => {
 const root = fixture(t, {'check.yml': {on: ['pull_request'], jobs}});
 assert.equal(audit(root, declaration)[0].unconditional_pr, true);
 fs.writeFileSync(path.join(root, '.github/workflows/check.yml'), JSON.stringify({on: ['workflow_dispatch'], jobs}));
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('local reusable call establishes a route; removing caller breaks it', t => {
 const root = fixture(t, {'check.yml': {on: ['workflow_call'], jobs}, 'caller.yml': {on: ['pull_request'], jobs: {call: {uses: './.github/workflows/check.yml'}}}});
 assert.equal(audit(root, declaration)[0].unconditional_pr, true);
 fs.unlinkSync(path.join(root, '.github/workflows/caller.yml'));
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('changed-path filtering does not establish unconditional coverage', t => {
 const root = fixture(t, {'check.yml': {on: {pull_request: {paths: ['db/**']}}, jobs}});
 assert.equal(audit(root, declaration)[0].unconditional_pr, false);
});
test('schedule proves reachability but not unconditional PR coverage', t => {
 const root = fixture(t, {'check.yml': {on: {schedule: [{cron: '0 0 * * *'}]}, jobs}});
 const result = audit(root, declaration)[0];
 assert.equal(result.reachable, true); assert.equal(result.unconditional_pr, false);
});
test('comments cannot substitute for executable checks', t => {
 const root = fixture(t, {'check.yml': {on: ['pull_request'], jobs: {tenant: {'runs-on': 'ubuntu-latest', steps: [{run: '# python3 checks/tenant.py\necho skipped'}]}}}});
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('conditional job and step are not unconditional', t => {
 for (const jobs of [{tenant: {'runs-on': 'ubuntu-latest', if: 'false', steps: [{run: 'python3 checks/tenant.py'}]}}, {tenant: {'runs-on': 'ubuntu-latest', steps: [{if: 'false', run: 'python3 checks/tenant.py'}]}}]) {
  const root = fixture(t, {'check.yml': {on: ['pull_request'], jobs}});
  assert.equal(audit(root, declaration)[0].reachable, false);
 }
});
test('empty schedules do not establish reachability', t => {
 const root = fixture(t, {'check.yml': {on: {schedule: []}, jobs}});
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('reusable workflow cycles terminate without inventing a PR route', t => {
 const root = fixture(t, {'check.yml': {on: ['workflow_call'], jobs: {...jobs, call: {uses: './.github/workflows/check.yml'}}}});
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('CLI exit code changes from zero to one when the actual trigger is disconnected', t => {
 const {spawnSync} = require('node:child_process');
 const root = fixture(t, {'check.yml': {on: ['pull_request'], jobs}});
 fs.writeFileSync(path.join(root, '.github/ci-checks.json'), JSON.stringify(declaration));
 const execute = () => spawnSync(process.execPath, [path.join(__dirname, 'check-reachability.cjs'), root], {encoding: 'utf8'});
 const before = execute();
 assert.equal(before.status, 0, before.stderr);
 fs.writeFileSync(path.join(root, '.github/workflows/check.yml'), JSON.stringify({on: ['workflow_dispatch'], jobs}));
 const after = execute();
 assert.equal(after.status, 1, after.stderr);
 assert.equal(JSON.parse(after.stdout).findings[0].reachable, false);
});
test('external reusable workflow requires an exact source mapping and callable target', t => {
 const reference = 'owner/shared/.github/workflows/check.yml@revision';
 const root = fixture(t, {'caller.yml': {on: ['pull_request'], jobs: {call: {uses: reference}}}});
 const library = fixture(t, {'check.yml': {on: ['workflow_call'], jobs}});
 const declaration = {version: 1, checks: [{id: 'external', kind: 'secret', library: 'owner/shared@revision', workflow: '.github/workflows/check.yml', job: 'tenant', run: 'python3 checks/tenant.py'}]};
 assert.equal(audit(root, declaration)[0].reachable, false);
 assert.equal(audit(root, declaration, {'owner/shared@different': library})[0].reachable, false);
 assert.equal(audit(root, declaration, {'owner/shared@revision': library})[0].unconditional_pr, true);
 fs.writeFileSync(path.join(library, '.github/workflows/check.yml'), JSON.stringify({on: ['workflow_dispatch'], jobs}));
 assert.equal(audit(root, declaration, {'owner/shared@revision': library})[0].reachable, false);
});
test('missing local workflow is not an executable declaration', t => {
 const root = fixture(t, {'caller.yml': {on: ['pull_request'], jobs: {call: {uses: './.github/workflows/absent.yml'}}}});
 const declaration = {version: 1, checks: [{id: 'missing', kind: 'secret', workflow: '.github/workflows/caller.yml', job: 'call', uses: './.github/workflows/absent.yml'}]};
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('checkout in a reusable workflow cannot hide a conditional security step', t => {
 const root = fixture(t, {'caller.yml': {on: ['pull_request'], jobs: {call: {uses: 'owner/shared/.github/workflows/check.yml@revision'}}}});
 const library = fixture(t, {'check.yml': {on: ['workflow_call'], jobs: {tenant: {'runs-on': 'ubuntu-latest', steps: [{uses: 'actions/checkout@v4'}, {if: 'false', run: 'python3 checks/tenant.py'}]}}}});
 const check = {...declaration, checks: declaration.checks.map(item => ({...item, library: 'owner/shared@revision'}))};
 assert.equal(audit(root, check, {'owner/shared@revision': library})[0].reachable, false);
});
test('invalid PR trigger and cron cannot establish an automated route', t => {
 for (const on of [{pull_request: false}, {schedule: [{cron: '99 99 * * *'}]}]) {
  const root = fixture(t, {'check.yml': {on, jobs}});
  assert.equal(audit(root, declaration)[0].reachable, false);
 }
});
test('a job without a runner cannot execute its security step', t => {
 const root = fixture(t, {'check.yml': {on: ['pull_request'], jobs: {tenant: {steps: [{run: 'python3 checks/tenant.py'}]}}}});
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('omitting a required reusable input does not establish a route', t => {
 const root = fixture(t, {'caller.yml': {on: ['pull_request'], jobs: {call: {uses: './.github/workflows/check.yml'}}}, 'check.yml': {on: {workflow_call: {inputs: {target: {required: true, type: 'string'}}}}, jobs}});
 assert.equal(audit(root, declaration)[0].reachable, false);
});
test('explicit standard PR events cover code changes, but a missing synchronize event does not', t => {
 const root = fixture(t, {'check.yml': {on: {pull_request: {types: ['opened', 'synchronize', 'reopened', 'ready_for_review']}}, jobs}});
 assert.equal(audit(root, declaration)[0].unconditional_pr, true);
 fs.writeFileSync(path.join(root, '.github/workflows/check.yml'), JSON.stringify({on: {pull_request: {types: ['opened', 'reopened']}}, jobs}));
 assert.equal(audit(root, declaration)[0].unconditional_pr, false);
});

test('CLI accepts library flags with the default manifest path', t => {
 const root = fixture(t, {'check.yml': {on: ['pull_request'], jobs}});
 fs.writeFileSync(path.join(root, '.github/ci-checks.json'), JSON.stringify(declaration));
 const result = require('node:child_process').spawnSync(process.execPath,
  [path.join(__dirname, 'check-reachability.cjs'), root, '--library', `owner/shared@v1=${root}`], {encoding: 'utf8'});
 assert.equal(result.status, 0, result.stderr);
});
