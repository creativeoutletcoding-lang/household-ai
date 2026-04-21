// fix-skylight-sandbox.js
// Replaces Web APIs unavailable in n8n's task-runner sandbox:
//   URLSearchParams  → manual encodeURIComponent joining
//   TextEncoder      → manual charCode loop (works for ASCII hex verifier)
//   crypto.getRandomValues → Math.random hex fallback

const fs = require('fs');
const d = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));

// -----------------------------------------------------------------------
// Build Skylight Request — fix URLSearchParams on the query-string line
// -----------------------------------------------------------------------
const buildNode = d.nodes.find(n => n.name === 'Build Skylight Request');
if (!buildNode) throw new Error('Build Skylight Request not found');

buildNode.parameters.jsCode = buildNode.parameters.jsCode.replace(
  'const qs = new URLSearchParams(skylightParams).toString();',
  [
    'const qs = Object.entries(skylightParams)',
    "  .filter(([, v]) => v !== undefined && v !== null)",
    "  .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))",
    "  .join('&');",
  ].join('\n  ')
);

console.log('[build] URLSearchParams fixed:', buildNode.parameters.jsCode.includes('encodeURIComponent(k)'));

// -----------------------------------------------------------------------
// Authenticate Skylight — fix URLSearchParams, TextEncoder, crypto.getRandomValues
// -----------------------------------------------------------------------
const authNode = d.nodes.find(n => n.name === 'Authenticate Skylight');
if (!authNode) throw new Error('Authenticate Skylight not found');

let code = authNode.parameters.jsCode;

// 1. Replace crypto.getRandomValues with Math.random hex
code = code.replace(
  `function randomHex(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}`,
  `function randomHex(len) {
  let hex = '';
  for (let i = 0; i < len * 2; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return hex;
}`
);

// 2. Replace TextEncoder in createChallenge with manual byte loop
//    (PKCE verifier is hex — pure ASCII, so charCodeAt is exact)
code = code.replace(
  `async function createChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
}`,
  `async function createChallenge(verifier) {
  const bytes = new Uint8Array(verifier.length);
  for (let i = 0; i < verifier.length; i++) bytes[i] = verifier.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
}`
);

// 3. Add formEncode helper after createChallenge and createState functions
//    Find createState() and add formEncode right after it
const CREATE_STATE_FN = `function createState() { return randomHex(5); }`;
if (!code.includes(CREATE_STATE_FN)) throw new Error('createState pattern not found');

code = code.replace(
  CREATE_STATE_FN,
  `${CREATE_STATE_FN}

function formEncode(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}`
);

// 4. Replace `loginBody = new URLSearchParams({...}).toString()`
//    The loginBody block spans multiple lines — replace the whole construction + .toString()
code = code.replace(
  `const loginBody = new URLSearchParams({
  authenticity_token: authenticityToken,
  email: EMAIL,
  password: PASSWORD,
});`,
  `const loginBody = formEncode({
  authenticity_token: authenticityToken,
  email: EMAIL,
  password: PASSWORD,
});`
);

// 5. Replace body: loginBody.toString() → body: loginBody  (already a string now)
code = code.replace('body: loginBody.toString(),', 'body: loginBody,');

// 6. Replace `tokenBody = new URLSearchParams({...})` block
code = code.replace(
  `const tokenBody = new URLSearchParams({
  grant_type: 'authorization_code',
  client_id: CLIENT_ID,
  scope: SCOPE,
  redirect_uri: REDIRECT_URI,
  code,
  code_verifier: verifier,
  skylight_api_client_device_platform: 'web',
  skylight_api_client_device_name: 'unknown',
  skylight_api_client_device_os_version: 'unknown',
  skylight_api_client_device_app_version: 'unknown',
  skylight_api_client_device_hardware: 'unknown',
  skylight_api_client_device_fingerprint: randomHex(16),
});`,
  `const tokenBody = formEncode({
  grant_type: 'authorization_code',
  client_id: CLIENT_ID,
  scope: SCOPE,
  redirect_uri: REDIRECT_URI,
  code,
  code_verifier: verifier,
  skylight_api_client_device_platform: 'web',
  skylight_api_client_device_name: 'unknown',
  skylight_api_client_device_os_version: 'unknown',
  skylight_api_client_device_app_version: 'unknown',
  skylight_api_client_device_hardware: 'unknown',
  skylight_api_client_device_fingerprint: randomHex(16),
});`
);

// 7. Replace body: tokenBody.toString() → body: tokenBody
code = code.replace('body: tokenBody.toString(),', 'body: tokenBody,');

authNode.parameters.jsCode = code;

// Verify all replacements landed
const checks = [
  ['no URLSearchParams', !code.includes('URLSearchParams')],
  ['no TextEncoder',     !code.includes('TextEncoder')],
  ['no getRandomValues', !code.includes('getRandomValues')],
  ['has formEncode',      code.includes('function formEncode')],
  ['has Math.random hex', code.includes('Math.floor(Math.random()')],
  ['has charCodeAt loop', code.includes('charCodeAt(i)')],
];
checks.forEach(([label, ok]) => console.log(`[auth] ${ok ? 'OK' : 'FAIL'} ${label}`));

fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));

// Final JSON validity check
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
