#!/usr/bin/env node
import { loadMigrations, lintMigrations } from './migrations-lib.mjs';
const problems = lintMigrations(loadMigrations());
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('Migrations look safe (expand-only or marked contract).');
