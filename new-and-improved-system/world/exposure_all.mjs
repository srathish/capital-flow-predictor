#!/usr/bin/env node
// Runs the EDGAR exposure pulls for the full world universe (1,165): concepts for the companies the first pass didn't cover,
// then constraint language (DESIGN v1.1) for everyone. Free (SEC), 0 Skylit credits.
import { pull, CONCEPTS, CONSTRAINTS, universeTickers } from './edgar_exposure.mjs';
import { worldUniverse } from './collect.mjs';
const all = Object.fromEntries(worldUniverse().map((x) => [x.t, x.cik])), first = universeTickers();
const rest = Object.fromEntries(Object.entries(all).filter(([t]) => !(t in first)));
console.error(`concepts for ${Object.keys(rest).length} new companies; constraints for ${Object.keys(all).length}`);
await pull(CONCEPTS, rest, 'fts_add', 'exposure_add.json');
await pull(CONSTRAINTS, all, 'fts_constraints', 'constraints.json');
console.error('\nexposure_all done');
