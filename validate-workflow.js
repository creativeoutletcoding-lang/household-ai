const fs = require('fs');
const workflow = JSON.parse(fs.readFileSync('workflows/discord-bruce.json', 'utf8'));
console.log(`Nodes: ${workflow.nodes.length}`);
console.log(`Connections keys: ${Object.keys(workflow.connections).length}`);

// Check all Discord nodes have hardcoded guild + cred
const discordNodes = workflow.nodes.filter(n => n.type?.includes('discord'));
discordNodes.forEach(n => {
  const guild = n.parameters?.guildId?.value || n.parameters?.guildId || 'MISSING';
  const cred = n.credentials?.discordBotApi?.id || 'MISSING';
  const channel = JSON.stringify(n.parameters?.channelId?.value || n.parameters?.channelId || 'N/A');
  console.log(`Discord node "${n.name}": guild=${guild}, cred=${cred}, channel=${channel.substring(0,80)}`);
});

// Check Postgres creds
const pgNodes = workflow.nodes.filter(n => n.type?.includes('postgres'));
pgNodes.forEach(n => {
  const cred = n.credentials?.postgres?.id || 'MISSING';
  console.log(`Postgres node "${n.name}": cred=${cred}`);
});

// Check auto-search nodes exist
const detectNode = workflow.nodes.find(n => n.name === 'Detect Search Intent');
const ifNode = workflow.nodes.find(n => n.name === 'Auto-Search IF');
const perplexityNode = workflow.nodes.find(n => n.name === 'Auto-Search Perplexity');
console.log('\nAuto-search nodes:');
console.log('  Detect Search Intent:', detectNode ? 'EXISTS' : 'MISSING');
console.log('  Auto-Search IF:', ifNode ? 'EXISTS' : 'MISSING');
console.log('  Auto-Search Perplexity:', perplexityNode ? 'EXISTS' : 'MISSING');

// Check wiring
const shouldRespondConn = workflow.connections['Should Respond?'];
console.log('\nShould Respond? → ' + (shouldRespondConn?.main?.[0]?.[0]?.node || 'MISSING'));
const detectConn = workflow.connections['Detect Search Intent'];
console.log('Detect Search Intent → ' + (detectConn?.main?.[0]?.[0]?.node || 'MISSING'));
const autoIfConn = workflow.connections['Auto-Search IF'];
console.log('Auto-Search IF true → ' + (autoIfConn?.main?.[0]?.[0]?.node || 'MISSING'));
console.log('Auto-Search IF false → ' + (autoIfConn?.main?.[1]?.[0]?.node || 'MISSING'));
const autoPerplexityConn = workflow.connections['Auto-Search Perplexity'];
console.log('Auto-Search Perplexity → ' + (autoPerplexityConn?.main?.[0]?.[0]?.node || 'MISSING'));

// Check Skylight nodes
const authNode = workflow.nodes.find(n => n.name === 'Authenticate Skylight');
const callApiNode = workflow.nodes.find(n => n.name === 'Call Skylight API');
const callMcpNode = workflow.nodes.find(n => n.name === 'Call Skylight MCP');
console.log('\nSkylight nodes:');
console.log('  Authenticate Skylight:', authNode ? 'EXISTS' : 'MISSING');
console.log('  Call Skylight API:', callApiNode ? 'EXISTS' : 'MISSING');
console.log('  Call Skylight MCP (should be gone):', callMcpNode ? 'STILL EXISTS' : 'REMOVED OK');

// Check calendar pipeline wiring
const buildSkylightConn = workflow.connections['Build Skylight Request'];
console.log('Build Skylight Request → ' + (buildSkylightConn?.main?.[0]?.[0]?.node || 'MISSING'));
const authConn = workflow.connections['Authenticate Skylight'];
console.log('Authenticate Skylight → ' + (authConn?.main?.[0]?.[0]?.node || 'MISSING'));
const callApiConn = workflow.connections['Call Skylight API'];
console.log('Call Skylight API → ' + (callApiConn?.main?.[0]?.[0]?.node || 'MISSING'));

// Check thread_id in all Discord reply nodes
console.log('\nDiscord reply channel expressions:');
discordNodes.forEach(n => {
  const val = n.parameters?.channelId?.value || '';
  const hasThread = val.includes('thread_id');
  console.log(`  "${n.name}": ${hasThread ? 'HAS thread_id' : 'MISSING thread_id'} — ${val.substring(0,60)}`);
});

// Verify JSON is valid (already parsed above, but confirm no issues)
console.log('\nValidation complete — review output above for MISSING values');
