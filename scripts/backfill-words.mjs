#!/usr/bin/env node
/**
 * Writes each project's page word count into data/projects.json as `words`,
 * which highlight.js uses to score how in-depth a project is.
 *
 * editor.html keeps `words` current on every save; run this after editing
 * project JSON any other way.
 *
 * Usage: node scripts/backfill-words.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countWords } from '../highlight.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const listPath = join(DATA, 'projects.json');
const list = JSON.parse(await readFile(listPath, 'utf8'));

let changed = 0;
for (const entry of list) {
  try {
    const detail = JSON.parse(await readFile(join(DATA, 'projects', `${entry.id}.json`), 'utf8'));
    const words = countWords(detail);
    if (entry.words !== words) { entry.words = words; changed++; }
  } catch {
    // no detail file — leave the entry as is
  }
}

await writeFile(listPath, JSON.stringify(list, null, 2) + '\n');
console.log(`Updated word counts on ${changed} of ${list.length} projects.`);
