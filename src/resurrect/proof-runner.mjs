// Proof runner. Runs in a child Node.js process started with --permission, so
// the old and new package code can read only the files the proof needs, cannot
// write files, and cannot start processes. It receives a config file path and
// prints one JSON result on stdout.
//
// The proof: for every generated input, the old package and the new code must
// return deep-equal values, or both throw the same kind of error.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const require = createRequire(import.meta.url);
const fc = require('fast-check');
const { encode } = require('./codec.cjs');

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const oldModule = require(config.oldPath);
const newModule = require(config.newPath);

// eslint-disable-next-line no-new-func
const evaluate = (source) => new Function('fc', `return (${source});`)(fc);

function run(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: (err && err.constructor && err.constructor.name) || typeof err };
  }
}

function same(a, b) {
  if (a.ok !== b.ok) return false;
  return a.ok ? isDeepStrictEqual(a.value, b.value) : a.error === b.error;
}

function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function show(outcome) {
  return outcome.ok ? fc.stringify(outcome.value) : `throws ${outcome.error}`;
}

/** Expands the "__each_export__" marker into one call per exported function. */
function expandCalls(spec) {
  if (spec.call !== '__each_export__') {
    return [{ label: '', source: spec.call || '(m, args) => m(...args)' }];
  }
  const calls = [];
  if (typeof oldModule === 'function') calls.push({ label: '', source: '(m, args) => m(...args)' });
  if (oldModule && (typeof oldModule === 'object' || typeof oldModule === 'function')) {
    for (const key of Object.keys(oldModule)) {
      if (typeof oldModule[key] === 'function') {
        calls.push({ label: ` (export ${key})`, source: `(m, args) => m[${JSON.stringify(key)}](...args)` });
      }
    }
  }
  return calls;
}

const results = [];
const golden = [];
const seed = config.seed;

for (const spec of config.properties) {
  if (spec.kind === 'perf') {
    const input = evaluate(spec.input);
    const call = evaluate(spec.call || '(m, args) => m(...args)');
    const t0 = performance.now();
    const oldOut = run(() => call(oldModule, [input]));
    const t1 = performance.now();
    const newOut = run(() => call(newModule, [input]));
    const t2 = performance.now();
    const oldMs = t1 - t0;
    const newMs = t2 - t1;
    const passed = newMs <= spec.maxMs && same(oldOut, newOut);
    results.push({
      name: `${spec.name} (old ${oldMs.toFixed(1)} ms, new ${newMs.toFixed(2)} ms, limit ${spec.maxMs} ms)`,
      runs: 1,
      passed,
      seed,
      ...(passed ? {} : { error: same(oldOut, newOut) ? `new code took ${newMs.toFixed(1)} ms` : 'outputs differ' }),
    });
    continue;
  }

  const arb = evaluate(spec.args);
  for (const { label, source } of expandCalls(spec)) {
    const call = evaluate(source);
    const name = spec.name + label;
    const details = fc.check(
      fc.property(arb, (args) => same(run(() => call(oldModule, clone(args))), run(() => call(newModule, clone(args))))),
      { numRuns: config.numRuns, seed },
    );
    const result = { name, runs: details.numRuns, passed: !details.failed, seed };
    if (details.failed) {
      if (details.counterexample) {
        const [args] = details.counterexample;
        result.counterexample = {
          args: fc.stringify(args),
          oldResult: show(run(() => call(oldModule, clone(args)))),
          newResult: show(run(() => call(newModule, clone(args)))),
        };
      } else {
        result.error = String(details.errorInstance ?? details.error ?? 'property failed');
      }
    }
    results.push(result);

    if (!details.failed && config.golden > 0) {
      const cases = [];
      for (const args of fc.sample(arb, { numRuns: config.golden, seed })) {
        const outcome = run(() => call(oldModule, clone(args)));
        try {
          cases.push({
            args: encode(args),
            outcome: outcome.ok ? { ok: true, value: encode(outcome.value) } : outcome,
          });
        } catch {
          // Values the codec cannot store (rare) are left out of the replay file.
        }
      }
      golden.push({ property: name, call: source, cases });
    }
  }
}

process.stdout.write(JSON.stringify({ properties: results, golden }));
