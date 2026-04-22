/**
 * apply-batch-7-hotfix.js
 *
 * Fixes a scope bug in apply-batch-7.js: the /private and /purge command
 * parsing blocks were inserted AFTER the closing brace of the `if (m)`
 * command-detection block, so `cmd` and `arg` are undefined when they
 * execute. All DM/test executions errored with "cmd is not defined" in
 * Channel Router (execution ids 320–326).
 *
 * This script moves the misplaced blocks back inside the `if (m)` block,
 * right after the `if (cmd === 'status') { ... }` handler, where every
 * other sub-command handler lives.
 *
 * Idempotent: re-running after the fix is a no-op.
 *
 * Run with: node apply-batch-7-hotfix.js
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, 'workflows', 'discord-bruce.json');
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

const router = workflow.nodes.find(n => n.name === 'Channel Router');
if (!router) throw new Error('Channel Router node not found');
let code = router.parameters.jsCode;

// The misplaced region starts just after the `if (m)` closing brace
// (right after the status handler) and ends just before the
// "// Response gating" comment. Extract it.
const MARKER_BEFORE = "if (cmd === 'status') {\n    const JAKE_CHANNELS = new Set(['jake-personal', 'fig', 'jake-ask']);";
const closeAfterStatus = code.indexOf("      commandType = 'status';\n    }\n  }\n}");
if (closeAfterStatus === -1) {
  throw new Error('Could not locate if (cmd === "status") closing structure');
}

// End of the if(m) block is the `}` on the line after status's `}}`.
// Structure we expect, verbatim:
//       commandType = 'status';
//     }
//   }
// }
// <blank lines>
//   if (cmd === 'private') { ... }
//   if (cmd === 'purge')   { ... }
// <blank line>
// // ----------------------------------------------------------------------------
// // Response gating (only applied when no command matched)

const ifMEnd = code.indexOf("    }\n  }\n}\n", closeAfterStatus);
if (ifMEnd === -1) throw new Error('Could not find if(m) end');
const ifMEndClose = ifMEnd + "    }\n  }\n}".length;  // position of the } that closes if(m)

// Locate where the misplaced blocks live (after the ifMEnd close, before
// the Response gating banner). If no misplaced blocks are found, assume
// already fixed and exit idempotently.
const responseGatingIdx = code.indexOf('// Response gating (only applied when no command matched)');
if (responseGatingIdx === -1) throw new Error('Could not find Response gating marker');

const misplacedRegion = code.slice(ifMEndClose, responseGatingIdx);
const hasPrivateOutside = /if \(cmd === 'private'\)/.test(misplacedRegion);
const hasPurgeOutside   = /if \(cmd === 'purge'\)/.test(misplacedRegion);

if (!hasPrivateOutside && !hasPurgeOutside) {
  // Check if they're already inside — if so, no-op
  const beforeClose = code.slice(0, ifMEndClose);
  if (beforeClose.includes("if (cmd === 'private')") && beforeClose.includes("if (cmd === 'purge')")) {
    console.log('[hotfix] /private + /purge already inside if (m) block — nothing to do');
    return;
  }
  throw new Error('Could not find misplaced /private + /purge parsing blocks');
}

// Grab the misplaced blocks verbatim (trimmed).
const privateBlockMatch = misplacedRegion.match(/\n\s*if \(cmd === 'private'\) \{[\s\S]*?\n\s{2}\}\n/);
const purgeBlockMatch   = misplacedRegion.match(/\n\s*if \(cmd === 'purge'\) \{[\s\S]*?\n\s{2}\}\n/);
if (!privateBlockMatch || !purgeBlockMatch) {
  throw new Error('Could not parse misplaced /private + /purge blocks cleanly');
}
const privateBlock = privateBlockMatch[0];
const purgeBlock   = purgeBlockMatch[0];

// Remove the misplaced region (between ifMEndClose and responseGatingIdx).
// Find the start of the banner comment block so we keep the blank-line spacing.
// responseGatingIdx points at the text "// Response gating..." — walk back to
// find the start of its preceding `// ----` banner.
let bannerStart = responseGatingIdx;
while (bannerStart > 0 && code[bannerStart - 1] !== '\n') bannerStart--;
// The banner has two lines ("// ---..." then "// Response gating..."). Walk
// back one more line to include the `// ---...` line too.
{
  const prevNl = code.lastIndexOf('\n', bannerStart - 2);
  if (prevNl !== -1 && code.slice(prevNl + 1, bannerStart).startsWith('// ----')) {
    bannerStart = prevNl + 1;
  }
}

// Reconstruct: everything up to ifMEndClose-position-of-the-final-brace,
// plus the two blocks indented correctly (already 2-space indented),
// plus the closing `\n}` of if(m), plus a blank line + banner + rest.
const beforeCloseBrace = code.slice(0, ifMEnd + "    }\n  }\n".length);  // keep inner `}}` but not outer `}`
const restFromBanner = code.slice(bannerStart);

// Reassemble. The blocks start with '\n  if (...)' so they slot naturally
// right before the outer '}' that closes if(m).
code =
  beforeCloseBrace +
  privateBlock +
  purgeBlock +
  '}\n\n' +
  restFromBanner;

router.parameters.jsCode = code;
fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(workflow, null, 2), 'utf8');

// Sanity: parse the new code to make sure it's valid JS.
try {
  new Function('return async function(){' + code + '}')();
  console.log('[hotfix] Channel Router JS parses cleanly after fix');
} catch (e) {
  throw new Error('[hotfix] Channel Router JS FAILS to parse: ' + e.message);
}

console.log('[hotfix] /private + /purge parsing moved inside if (m) block');
console.log('[hotfix] Workflow written. Reimport on VPS to apply.');
