// apply-batch-5-hotfix.js
// Fix autoSearchBlock in Build Claude Request:
//   (a) Wrap bare URLs in the Perplexity answer with <> before injecting
//   (b) Add "do not redirect to /search" instruction
//   (c) Ensure URL note in systemPrompt is present
// Run: node apply-batch-5-hotfix.js

'use strict';
const fs = require('fs');
const d  = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
const bc = d.nodes.find(n => n.name === 'Build Claude Request');
let code = bc.parameters.jsCode;

// ── Locate the existing autoSearchBlock template by position ─────────────────
// Find the `if (searchAnswer) {` guard block inside the try
const GUARD = '    if (searchAnswer) {';
const gIdx = code.indexOf(GUARD);
if (gIdx === -1) { console.error('GUARD not found'); process.exit(1); }

// Find the closing `}` of that if block
const GUARD_CLOSE = '    }\n  }\n} catch(_) {}';
const gcIdx = code.indexOf(GUARD_CLOSE, gIdx);
if (gcIdx === -1) { console.error('GUARD_CLOSE not found'); process.exit(1); }

console.log('Replacing block', gIdx, '-', gcIdx + GUARD_CLOSE.length);

// Build the replacement. We use string concat (no template literal) for the outer
// code so backslash escapes are unambiguous. The JS code stored in the workflow
// uses RegExp() constructor to avoid regex-literal slash escaping.
//
// The searchAnswerWrapped line uses RegExp() so we can specify \S without
// fighting multiple layers of template-literal + JSON escaping.
// In the RegExp string arg, '\\S' = the two-char sequence \S (non-whitespace class).
// We skip wrapping if the URL already starts with < (lookbehind alternative).

const newGuardBlock =
  '    if (searchAnswer) {\n' +
  // Use a word-boundary split to wrap bare URLs without regex backslash fights
  '      const urlRe = new RegExp(' +
    "'(^|[\\\\s(])(https?://[^\\\\s<>\"]+)', 'g'" +
  ');\n' +
  '      const searchAnswerWrapped = searchAnswer.replace(urlRe, function(_, pre, url) {\n' +
  '        return pre + \'<\' + url + \'>\';\n' +
  '      });\n' +
  '      autoSearchBlock =\n' +
  '        \'\\n\\n<auto_search_results>\\n\' +\n' +
  '        \'The following web search was automatically performed for context:\\n\' +\n' +
  '        \'Query: \' + autoSearchData.search_query + \'\\n\' +\n' +
  '        \'Results: \' + searchAnswerWrapped + \'\\n\' +\n' +
  '        \'Auto-search results are already included above. Do not suggest the user \' +\n' +
  '        \'run /search manually or check external apps \u2014 you already have the data. \' +\n' +
  '        \'If the data is incomplete, say so directly without redirecting the user elsewhere.\\n\' +\n' +
  '        \'When citing any URLs in your response, always wrap them in angle brackets \' +\n' +
  '        \'like <https://example.com> to prevent Discord from embedding them as rich previews.\\n\' +\n' +
  '        \'</auto_search_results>\';\n' +
  '    }\n' +
  '  }\n' +
  '} catch(_) {}';

code = code.slice(0, gIdx) + newGuardBlock + code.slice(gcIdx + GUARD_CLOSE.length);
console.log('[Fix 1] autoSearchBlock replaced with string-concat version');
console.log('  searchAnswerWrapped present:', code.includes('searchAnswerWrapped'));
console.log('  "do not suggest" present:  ', code.includes('Do not suggest the user'));
console.log('  urlRe present:             ', code.includes('urlRe'));

// ── Fix 2: systemPrompt URL note ─────────────────────────────────────────────
// Check current state — previous run may have partially applied it
const SYS_OLD = "const systemPrompt = devContextPrefix + selfContextPrefix + (router.systemPrompt || '') + currentSpeakerBlock + memoryBlock + sharedNote + dateBlock + autoSearchBlock;";
const SYS_NEW = "const systemPrompt = devContextPrefix + selfContextPrefix + (router.systemPrompt || '') + currentSpeakerBlock + memoryBlock + sharedNote + dateBlock + autoSearchBlock + '\\n\\nWhen citing URLs in your response, always wrap them in angle brackets like <https://example.com> to prevent Discord from displaying rich embed previews.';";

if (code.includes(SYS_NEW)) {
  console.log('[Fix 2] systemPrompt URL note already present');
} else if (code.includes(SYS_OLD)) {
  code = code.replace(SYS_OLD, SYS_NEW);
  console.log('[Fix 2] systemPrompt URL note added');
} else {
  console.warn('[Fix 2] WARNING: systemPrompt line not found in expected form');
}

bc.parameters.jsCode = code;

// ── Verify key strings are present ───────────────────────────────────────────
const checks = [
  ['urlRe = new RegExp',                      'RegExp URL wrapper'],
  ['searchAnswerWrapped',                      'searchAnswerWrapped variable'],
  ['Do not suggest the user',                  'no-redirect instruction'],
  ['Auto-search results are already included', 'already-have-data instruction'],
  ['When citing any URLs',                     'URL wrapping instruction in block'],
  ['prevent Discord from displaying',          'URL note in systemPrompt'],
];
checks.forEach(([needle, label]) => {
  console.log(label + ':', code.includes(needle) ? 'OK' : 'MISSING');
});

// ── Write & validate ──────────────────────────────────────────────────────────
fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
