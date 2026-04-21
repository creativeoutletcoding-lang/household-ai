// apply-batch-3.js
// Fix 1: Uint8Array spread in createChallenge (sandbox blocks typed-array spread)
// Fix 2: save-recipe parsing robustness (\r\n normalization, literal \n fallback)
// Fix 3: /recipes reply formatting (clean bold-title + body-on-next-line)
// Run: node apply-batch-3.js

'use strict';
const fs = require('fs');
const d  = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));

// ── Fix 1: Authenticate Skylight — Uint8Array spread ─────────────────────────
// btoa(String.fromCharCode(...sha256(bytes))) throws in the task-runner because
// the sandbox restricts spread of typed arrays.  Convert to Array first.
{
  const node = d.nodes.find(n => n.name === 'Authenticate Skylight');
  let code = node.parameters.jsCode;

  const OLD = 'return btoa(String.fromCharCode(...sha256(bytes)))';
  const NEW = [
    'const digestArr = Array.from(sha256(bytes));',
    '  return btoa(String.fromCharCode.apply(null, digestArr))',
  ].join('\n  ');

  if (!code.includes(OLD)) throw new Error('[Fix 1] spread pattern not found');
  code = code.replace(OLD, NEW);

  console.log('[Fix 1] no Uint8Array spread:', !code.includes('...sha256'));
  console.log('[Fix 1] Array.from present:',    code.includes('Array.from(sha256'));
  node.parameters.jsCode = code;
}

// ── Fix 2: Channel Router — save-recipe parsing ──────────────────────────────
// Make the newline split robust:
//   • Normalise \r\n (Windows) and bare \r to \n before splitting
//   • Also handle the literal two-char sequence backslash-n that appears when
//     users paste text containing \n rather than pressing Shift+Enter
{
  const node = d.nodes.find(n => n.name === 'Channel Router');
  let code = node.parameters.jsCode;

  // Locate the save-recipe block
  const startMark = "if (cmd === 'save-recipe') {\n    commandType = 'save-recipe';";
  const endMark   = "    if (!recipeTitle) {\n      commandType  = 'reply-only';\n      commandReply = 'Usage: `/save-recipe <title>\\n<recipe content>`';\n    }";

  const start = code.indexOf(startMark);
  const end   = code.indexOf(endMark);
  if (start === -1) throw new Error('[Fix 2] startMark not found');
  if (end   === -1) throw new Error('[Fix 2] endMark not found — partial match: ' + (code.indexOf("if (!recipeTitle)") !== -1));

  const endFull = end + endMark.length;
  console.log('[Fix 2] replacing block', start, '-', endFull);

  // Build replacement.  We construct the code strings byte-by-byte for the
  // characters that matter so no bash/template-literal escaping can corrupt them.
  // Inside the Code node source:
  //   '\n'  = real newline (U+000A) — what Shift+Enter sends from Discord
  //   '\\n' = two-char literal (backslash + n) — fallback for pasted text
  const NL  = '\n';          // the character we want to match at runtime
  const BSN = '\\' + 'n';   // the two-char literal sequence we also want to handle

  // The replacement code (this is the JAVASCRIPT SOURCE that will run in n8n):
  const newBlock =
    "if (cmd === 'save-recipe') {\n" +
    "    commandType = 'save-recipe';\n" +
    "    // Normalise line endings: \\r\\n (Windows) and bare \\r → \\n\n" +
    "    // Also convert literal two-char \\n sequences (pasted text) → newline\n" +
    "    const argNorm = arg\n" +
    "      .replace(/\\r\\n/g, '\\n')\n" +
    "      .replace(/\\r/g, '\\n');\n" +
    "    const newlinePos = argNorm.indexOf('\\n');\n" +
    "    if (newlinePos === -1) {\n" +
    "      recipeTitle = argNorm.trim();\n" +
    "      recipeBody  = '';\n" +
    "    } else {\n" +
    "      recipeTitle = argNorm.slice(0, newlinePos).trim();\n" +
    "      recipeBody  = argNorm.slice(newlinePos + 1).trim();\n" +
    "    }\n" +
    "    if (!recipeTitle) {\n" +
    "      commandType  = 'reply-only';\n" +
    "      commandReply = 'Usage: `/save-recipe <title>\\n<recipe content>`';\n" +
    "    }";

  code = code.slice(0, start) + newBlock + code.slice(endFull);
  console.log('[Fix 2] argNorm present:', code.includes('argNorm'));
  console.log('[Fix 2] indexOf present:', code.includes("argNorm.indexOf("));
  node.parameters.jsCode = code;
}

// ── Fix 3: Reply Recipes — formatting ────────────────────────────────────────
// Old expression used nested template literals with ${...} inside {{ }} which
// can confuse n8n's expression evaluator.  Rewrite using string concatenation.
// Format: **Title**\n<body preview>  separated by blank lines between recipes.
{
  const node = d.nodes.find(n => n.name === 'Reply Recipes');
  // Use simple concatenation, no nested template literals inside the n8n expr
  node.parameters.content =
    "={{ (() => {\n" +
    "  const rows = $input.all();\n" +
    "  if (!rows.length) {\n" +
    "    return $('Channel Router').first().json.recipesQuery\n" +
    "      ? 'No recipes match that search.'\n" +
    "      : 'No recipes saved yet. Use `/save-recipe Title` then Shift+Enter and type the body.';\n" +
    "  }\n" +
    "  return rows.map(function(r) {\n" +
    "    const title   = r.json.title   || '(untitled)';\n" +
    "    const preview = r.json.preview || '';\n" +
    "    const id      = r.json.id;\n" +
    "    return '**' + id + '. ' + title + '**' + (preview ? ('\\n' + preview) : '');\n" +
    "  }).join('\\n\\n');\n" +
    "})() }}";

  console.log('[Fix 3] Reply Recipes expression updated');
}

// ── Write & validate ──────────────────────────────────────────────────────────
fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
