const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, 'workflows', 'discord-bruce.json');
const d = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

const devContextContent = fs.readFileSync('./prompts/bruce-dev-context.md', 'utf8');
// Escape for embedding in a JS template literal stored in JSON
const devContextEscaped = devContextContent
  .split('\\').join('\\\\')
  .split('`').join('\\`')
  .split('$').join('\\$');

const buildNode = d.nodes.find(n => n.name === 'Build Claude Request');
let code = buildNode.parameters.jsCode;

// Find insertion point: right after the closing of SELF_CONTEXT template literal
// In the code (after JSON.parse), the line ends with:  </bruce_system_context>\n`;
const MARKER = '</bruce_system_context>`;\n\n\n';
const selfContextEnd = code.indexOf(MARKER);
if (selfContextEnd === -1) throw new Error('Could not find SELF_CONTEXT closing marker');
const insertAt = selfContextEnd + MARKER.length;

const DEV_CONTEXT_INSERT = [
  '',
  'const DEV_CONTEXT_CHANNELS = [\'jake-personal\'];',
  'const DEV_CONTEXT = `<bruce_dev_context>',
  devContextEscaped,
  '</bruce_dev_context>`;',
  '',
  '',
].join('\n');

code = code.slice(0, insertAt) + DEV_CONTEXT_INSERT + code.slice(insertAt);

// Add devContextPrefix computation after selfContextPrefix line
const SELF_PREFIX_LINE = "const selfContextPrefix = SELF_CONTEXT_CHANNELS.includes(router.channelName) ? SELF_CONTEXT + '\\n\\n' : '';";
const DEV_PREFIX_LINE  = "\nconst devContextPrefix = DEV_CONTEXT_CHANNELS.includes(router.channelName) ? DEV_CONTEXT + '\\n\\n' : '';";

if (!code.includes(SELF_PREFIX_LINE)) throw new Error('Could not find selfContextPrefix line');
code = code.replace(SELF_PREFIX_LINE, SELF_PREFIX_LINE + DEV_PREFIX_LINE);

// Prepend devContextPrefix to systemPrompt
const OLD_SP = "const systemPrompt = selfContextPrefix + (router.systemPrompt || '')";
const NEW_SP = "const systemPrompt = devContextPrefix + selfContextPrefix + (router.systemPrompt || '')";
if (!code.includes(OLD_SP)) throw new Error('Could not find systemPrompt line');
code = code.replace(OLD_SP, NEW_SP);

buildNode.parameters.jsCode = code;
fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(d, null, 2));

// Verify JSON is still valid
const d2 = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
const c2 = d2.nodes.find(n => n.name === 'Build Claude Request').parameters.jsCode;
console.log('DEV_CONTEXT_CHANNELS:', c2.includes('DEV_CONTEXT_CHANNELS'));
console.log('devContextPrefix:', c2.includes('devContextPrefix'));
console.log('bruce_dev_context tag:', c2.includes('bruce_dev_context'));
console.log('systemPrompt line:', c2.substring(c2.indexOf('const systemPrompt ='), c2.indexOf('const systemPrompt =') + 110));
