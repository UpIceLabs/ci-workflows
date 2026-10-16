#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

function events(workflow) {
  const value = workflow.on;
  return typeof value === 'string' ? {[value]: null} : Array.isArray(value)
    ? Object.fromEntries(value.map(key => [key, null])) : value || {};
}
function unconditional(value) {
  return value === undefined || value === true ||
    ['true', '${{ true }}', 'always()', '${{ always() }}'].includes(value);
}

// Unsupported named cron fields are unproven rather than guessed.
function validCron(value) {
  if (typeof value !== 'string') return false;
  const fields = value.trim().split(/\s+/);
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return fields.length === 5 && fields.every((field, index) => {
    const [minimum, maximum] = bounds[index];
    return field.split(',').every(part => {
      const match = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
      if (!match || (match[2] && (+match[2] < 1 || +match[2] > maximum + 1))) return false;
      if (match[1] === '*') return true;
      const range = match[1].split('-').map(Number);
      return range.every(number => number >= minimum && number <= maximum) &&
        (range.length === 1 || range[0] <= range[1]);
    });
  });
}

/** Parse only: never evaluate expressions or execute checked-out repository code. */
function audit(repository, manifest, libraries = {}) {
  const root = path.resolve(repository);
  const cache = new Map();
  function workflows(directory) {
    if (cache.has(directory)) return cache.get(directory);
    const result = new Map();
    const folder = path.join(directory, '.github/workflows');
    for (const name of fs.existsSync(folder) ? fs.readdirSync(folder) : []) {
      if (/\.ya?ml$/.test(name)) {
        const data = yaml.load(fs.readFileSync(path.join(folder, name), 'utf8'));
        if (!data || typeof data !== 'object') throw new Error(`Invalid workflow: ${name}`);
        result.set(`.github/workflows/${name}`, data);
      }
    }
    cache.set(directory, result);
    return result;
  }
  function resolveCall(directory, reference) {
    if (/^\.\/\.github\/workflows\/[^/]+\.ya?ml$/.test(reference)) {
      return {directory, file: reference.slice(2)};
    }
    const match = reference.match(/^([^/]+\/[^/]+)\/(\.github\/workflows\/[^/]+\.ya?ml)@(.+)$/);
    if (!match) return null;
    const location = libraries[`${match[1]}@${match[3]}`];
    return location ? {directory: path.resolve(location), file: match[2]} : null;
  }
  function visit(directory, file, event, trail = []) {
    const key = `${directory}:${file}`;
    if (trail.includes(key)) return [];
    const workflow = workflows(directory).get(file);
    if (!workflow || !(event in events(workflow))) return [];
    const config = events(workflow)[event];
    if (event !== 'schedule' && config !== null &&
        (typeof config !== 'object' || Array.isArray(config))) return [];
    if (event === 'pull_request' && config &&
      ['paths', 'paths-ignore', 'branches', 'branches-ignore'].some(key => key in config)) return [];
    if (event === 'pull_request' && config?.types &&
        (!Array.isArray(config.types) || !['opened', 'synchronize', 'reopened'].every(type => config.types.includes(type)) ||
        !config.types.every(type => ['opened', 'synchronize', 'reopened', 'ready_for_review', 'labeled', 'unlabeled'].includes(type)))) return [];
    if (event === 'schedule' && (!Array.isArray(config) ||
      !config.length || !config.every(item => item && validCron(item.cron)))) return [];
    const result = [];
    for (const [id, job] of Object.entries(workflow.jobs || {})) {
      // Unknown expression/dependency coverage is unproven, never green.
      if (!unconditional(job.if) || job.needs || job['continue-on-error'] || job.strategy) continue;
      const location = {directory, file, job: id, trail: [...trail, key]};
      if (job.uses) {
        const target = resolveCall(directory, job.uses);
        const targetWorkflow = target && workflows(target.directory).get(target.file);
        const call = targetWorkflow && events(targetWorkflow).workflow_call;
        const missingInput = Object.entries(call?.inputs || {}).some(([name, input]) =>
          input.required && input.default === undefined && !Object.hasOwn(job.with || {}, name));
        const missingSecret = Object.entries(call?.secrets || {}).some(([name, secret]) =>
          secret.required && job.secrets !== 'inherit' && !Object.hasOwn(job.secrets || {}, name));
        const children = target && !missingInput && !missingSecret
          ? visit(target.directory, target.file, 'workflow_call', [...trail, key]) : [];
        // A missing target or a manually triggered workflow is not an executor.
        result.push(...children);
      }
      if (!job['runs-on'] || job.uses) continue;
      for (const step of job.steps || []) {
        if (!unconditional(step.if) || step['continue-on-error']) continue;
        if (step.run || step.uses) result.push({...location, step: step.id, run: step.run, uses: step.uses});
      }
    }
    return result;
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.checks) || !manifest.checks.length) {
    throw new Error('Declare version: 1 and a nonempty checks array');
  }
  const ids = new Set();
  const findings = [];
  for (const check of manifest.checks) {
    if (!check.id || !['tenancy', 'secret'].includes(check.kind) || !check.workflow || !check.job ||
        !(check.run || check.uses)) throw new Error('Each check needs id, kind, workflow, job, and exact run or uses');
    if (ids.has(check.id)) throw new Error(`Duplicate check id: ${check.id}`);
    ids.add(check.id);
    const declaredRoot = check.library ? libraries[check.library] && path.resolve(libraries[check.library]) : root;
    const routes = [];
    for (const [file] of workflows(root)) {
      for (const trigger of ['pull_request', 'schedule']) {
        for (const candidate of visit(root, file, trigger)) {
          if (candidate.directory === declaredRoot && candidate.file === check.workflow && candidate.job === check.job &&
              (!check.step || candidate.step === check.step) &&
              (!check.run || candidate.run?.trim() === check.run.trim()) &&
              (!check.uses || candidate.uses === check.uses)) routes.push({trigger, path: candidate.trail});
        }
      }
    }
    findings.push({id: check.id, kind: check.kind, reachable: routes.length > 0,
      unconditional_pr: routes.some(route => route.trigger === 'pull_request'), routes});
  }
  return findings;
}
module.exports = {audit};
if (require.main === module) {
  try {
    const root = path.resolve(process.argv[2] || '.');
    const hasManifest = process.argv[3] && !process.argv[3].startsWith('--');
    const manifest = JSON.parse(fs.readFileSync(hasManifest ? process.argv[3] : path.join(root, '.github/ci-checks.json'), 'utf8'));
    const libraries = {};
    for (let i = hasManifest ? 4 : 3; i < process.argv.length; i += 2) {
      if (process.argv[i] !== '--library') throw new Error('Expected --library OWNER/REPO@REF=PATH');
      const argument = process.argv[i + 1] || '';
      const separator = argument.indexOf('=');
      if (separator < 1) throw new Error('Expected --library OWNER/REPO@REF=PATH');
      libraries[argument.slice(0, separator)] = argument.slice(separator + 1);
    }
    const findings = audit(root, manifest, libraries);
    console.log(JSON.stringify({repository: root, findings}, null, 2));
    process.exitCode = findings.some(f => !f.reachable || !f.unconditional_pr) ? 1 : 0;
  } catch (error) {
    console.error(`Reachability configuration error: ${error.message}`);
    process.exitCode = 2;
  }
}
