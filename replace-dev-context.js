// Replaces the DEV_CONTEXT string inside Build Claude Request
// with the current contents of prompts/bruce-dev-context.md.
// Safe to run repeatedly.

const fs = require('fs');

const WORKFLOW_PATH = './workflows/discord-bruce.json';
const d = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

const newContent = fs.readFileSync('./prompts/bruce-dev-context.md', 'utf8');
const escaped = newContent
  .split('\\').join('\\\\')
  .split('`').join('\\`')
  .split('$').join('\\$');

const node = d.nodes.find(n => n.name === 'Build Claude Request');
let code = node.parameters.jsCode;

// Replace between the opening and closing bruce_dev_context tags
const OPEN  = '<bruce_dev_context>\n';
const CLOSE = '\n</bruce_dev_context>';

const openIdx  = code.indexOf(OPEN);
const closeIdx = code.indexOf(CLOSE);
if (openIdx === -1 || closeIdx === -1) throw new Error('Could not find dev_context tags in Build Claude Request');

code = code.slice(0, openIdx + OPEN.length) + escaped + code.slice(closeIdx);
node.parameters.jsCode = code;

fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(d, null, 2));

// Verify JSON valid + spot-check
const d2 = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
const c2 = d2.nodes.find(n => n.name === 'Build Claude Request').parameters.jsCode;
console.log('bruce_dev_context tag present:', c2.includes('bruce_dev_context'));
console.log('Tool Delegation updated:', c2.includes('primary execution tool'));
console.log('Deploy section updated:', c2.includes('git push'));
console.log('SCP removed:', !c2.includes('SCP to VPS'));
