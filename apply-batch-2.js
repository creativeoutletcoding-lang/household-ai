// apply-batch-2.js — Tasks 4 & 5: /help, /save-recipe, /recipes
// Run: node apply-batch-2.js  (once only)

const fs = require('fs');
const d = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));

// ── Helper: Discord reply node ───────────────────────────────────────────────
function discordReplyNode(id, name, contentExpr, position) {
  return {
    parameters: {
      resource: 'message',
      guildId: { __rl: true, value: '1495249842778148954', mode: 'id' },
      channelId: {
        __rl: true,
        value: "={{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}",
        mode: 'id',
      },
      content: contentExpr,
      options: {},
    },
    type: 'n8n-nodes-base.discord',
    typeVersion: 2,
    position,
    id,
    name,
    credentials: { discordBotApi: { id: 'om7VabWMiA8gC2i3', name: 'Discord Bot account' } },
  };
}

// ── Helper: Postgres execute node ────────────────────────────────────────────
function pgNode(id, name, query, position, alwaysOutputData = false) {
  const n = {
    parameters: { operation: 'executeQuery', query, options: {} },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position,
    id,
    name,
    credentials: { postgres: { id: 'EHBRO07aceirmFzt', name: 'Household Postgres' } },
  };
  if (alwaysOutputData) n.alwaysOutputData = true;
  return n;
}

// ── Helper: Switch rule ──────────────────────────────────────────────────────
function switchRule(ruleId, commandType, outputKey) {
  return {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: ruleId,
        leftValue: '={{ $json.commandType }}',
        rightValue: commandType,
        operator: { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    renameOutput: true,
    outputKey,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Channel Router — variables, CMD_RE, command blocks, return object
// ═══════════════════════════════════════════════════════════════════════════
const cr = d.nodes.find(n => n.name === 'Channel Router');
let crCode = cr.parameters.jsCode;

// 1a. Extend CMD_RE to include help, save-recipe, recipes
const OLD_CMDRE = 'CMD_RE = /^\\/(use|remember|forget|memories|clear|image|search|calendar)(?:\\s+([\\s\\S]*))?$/i;';
const NEW_CMDRE = 'CMD_RE = /^\\/(use|remember|forget|memories|clear|image|search|calendar|help|save-recipe|recipes)(?:\\s+([\\s\\S]*))?$/i;';
if (!crCode.includes(OLD_CMDRE)) throw new Error('CMD_RE not found');
crCode = crCode.replace(OLD_CMDRE, NEW_CMDRE);

// 1b. Add new variable declarations after `let commandReply = null;`
const OLD_DECL = 'let commandReply = null;   // pre-formatted confirmation text (use/forget/remember)';
const NEW_DECL = `let commandReply = null;   // pre-formatted confirmation text (use/forget/remember)
let recipeTitle = null;
let recipeBody  = null;
let recipesQuery = null;`;
if (!crCode.includes(OLD_DECL)) throw new Error('commandReply decl not found');
crCode = crCode.replace(OLD_DECL, NEW_DECL);

// 1c. Add /help, /save-recipe, /recipes command blocks after calendar block
const CALENDAR_CLOSE = `  } else if (cmd === 'calendar') {
    commandType = 'calendar';
    // Sub-commands are parsed downstream in Build Skylight Request.
    calendarArg = arg;
  }
}`;

const HELP_LINES = [
  '**Bruce Commands**',
  '`/use <model>` — switch AI model (`haiku`, `sonnet`, `opus`)',
  '`/use default` — reset to channel default',
  '`/remember <fact>` — save a memory',
  '`/forget <fact>` — remove a memory',
  '`/memories` — list your saved memories',
  '`/clear` — clear this channel\'s conversation history',
  '`/image <prompt>` — generate an image',
  '`/image --hd <prompt>` — generate high-quality image',
  '`/search <query>` — search the web with Perplexity',
  '`/calendar` — show today\'s Skylight events',
  '`/save-recipe <title>\\n<recipe content>` — save a recipe',
  '`/recipes` — list your saved recipes',
  '`/recipes <search>` — search your recipes by title or content',
  '`/help` — show this message',
].join('\\n');

const NEW_CMDS = `  } else if (cmd === 'calendar') {
    commandType = 'calendar';
    // Sub-commands are parsed downstream in Build Skylight Request.
    calendarArg = arg;
  }

  if (cmd === 'help') {
    commandType = 'reply-only';
    commandReply = \`${HELP_LINES}\`;
  }

  if (cmd === 'save-recipe') {
    commandType = 'save-recipe';
    const newlinePos = arg.indexOf('\\n');
    if (newlinePos === -1) {
      recipeTitle = arg.trim();
      recipeBody  = '';
    } else {
      recipeTitle = arg.slice(0, newlinePos).trim();
      recipeBody  = arg.slice(newlinePos + 1).trim();
    }
    if (!recipeTitle) {
      commandType  = 'reply-only';
      commandReply = 'Usage: \`/save-recipe <title>\\n<recipe content>\`';
    }
  }

  if (cmd === 'recipes') {
    commandType  = 'recipes';
    recipesQuery = arg || null;
  }
}`;

if (!crCode.includes(CALENDAR_CLOSE)) throw new Error('calendar close block not found');
crCode = crCode.replace(CALENDAR_CLOSE, NEW_CMDS);

// 1d. Add recipeTitle, recipeBody, recipesQuery to return object (after calendarArg)
const OLD_RET = '    calendarArg,\n    commandReply,';
const NEW_RET = '    calendarArg,\n    recipeTitle,\n    recipeBody,\n    recipesQuery,\n    commandReply,';
if (!crCode.includes(OLD_RET)) throw new Error('return block calendarArg not found');
crCode = crCode.replace(OLD_RET, NEW_RET);

cr.parameters.jsCode = crCode;
console.log('[CR] CMD_RE updated:',       crCode.includes('save-recipe|recipes'));
console.log('[CR] /help added:',          crCode.includes("cmd === 'help'"));
console.log('[CR] /save-recipe added:',   crCode.includes("cmd === 'save-recipe'"));
console.log('[CR] /recipes added:',       crCode.includes("cmd === 'recipes'"));
console.log('[CR] return has recipeTitle:', crCode.includes('recipeTitle,'));

// ═══════════════════════════════════════════════════════════════════════════
// 2. Command Switch — append two new rules
// ═══════════════════════════════════════════════════════════════════════════
const cs = d.nodes.find(n => n.name === 'Command Switch');
cs.parameters.rules.values.push(switchRule('sw-save-recipe', 'save-recipe', 'save-recipe'));
cs.parameters.rules.values.push(switchRule('sw-recipes',     'recipes',     'recipes'));
console.log('\n[CS] rule count:', cs.parameters.rules.values.length);

// ═══════════════════════════════════════════════════════════════════════════
// 3. New nodes
// ═══════════════════════════════════════════════════════════════════════════
const SAVE_PG_ID    = 'aa000000-0000-0000-0000-000000000001';
const SAVE_DISC_ID  = 'aa000000-0000-0000-0000-000000000002';
const QUERY_PG_ID   = 'aa000000-0000-0000-0000-000000000003';
const QUERY_DISC_ID = 'aa000000-0000-0000-0000-000000000004';

// Save Recipe: INSERT — title and body come from Channel Router
const saveQuery = [
  "INSERT INTO recipes (discord_user_id, title, body)",
  "VALUES (",
  "  '{{ $('Channel Router').first().json.userId }}',",
  "  '{{ $('Channel Router').first().json.recipeTitle?.replace(/'/g, \"''\") }}',",
  "  '{{ $('Channel Router').first().json.recipeBody?.replace(/'/g, \"''\") }}'",
  ")",
  "RETURNING id, title;",
].join('\n');

// Query Recipes: list or search
const queryQuery = [
  "SELECT id, title, LEFT(body, 300) AS preview",
  "FROM recipes",
  "WHERE discord_user_id = '{{ $('Channel Router').first().json.userId }}'",
  "{{ $('Channel Router').first().json.recipesQuery",
  "   ? \"AND (LOWER(title) LIKE LOWER('%\" + $('Channel Router').first().json.recipesQuery + \"%') OR LOWER(body) LIKE LOWER('%\" + $('Channel Router').first().json.recipesQuery + \"%'))\"",
  "   : '' }}",
  "ORDER BY created_at DESC",
  "LIMIT 20;",
].join('\n');

d.nodes.push(
  pgNode(SAVE_PG_ID, 'Save Recipe', saveQuery, [-448, 1280]),
  discordReplyNode(SAVE_DISC_ID, 'Reply Save Recipe',
    "={{ $json.id ? '✅ **' + $('Channel Router').first().json.recipeTitle + '** saved (id: ' + $json.id + ').' : '❌ Could not save the recipe — make sure you include a title.' }}",
    [-224, 1280]),
  pgNode(QUERY_PG_ID, 'Query Recipes', queryQuery, [-448, 1440], true),
  discordReplyNode(QUERY_DISC_ID, 'Reply Recipes',
    "={{ (() => { const rows = $input.all(); if (!rows.length) return $('Channel Router').first().json.recipesQuery ? 'No recipes match that search.' : 'No recipes saved yet. Use `/save-recipe <title>\\n<content>` to save one.'; return rows.map(r => `**${r.json.id}.** ${r.json.title}\\n${r.json.preview || ''}`.trim()).join('\\n\\n'); })() }}",
    [-224, 1440]),
);

console.log('\n[nodes] 4 recipe nodes added, total:', d.nodes.length);

// ═══════════════════════════════════════════════════════════════════════════
// 4. Connections
// ═══════════════════════════════════════════════════════════════════════════
const csConns = d.connections['Command Switch'].main;
// Currently: [0..8] = command outputs, [9] = Should Respond?
const shouldRespondEntry = csConns[9];

csConns[9]  = [{ node: 'Save Recipe',   type: 'main', index: 0 }];
csConns[10] = [{ node: 'Query Recipes', type: 'main', index: 0 }];
csConns[11] = shouldRespondEntry;

d.connections['Save Recipe']   = { main: [[{ node: 'Reply Save Recipe', type: 'main', index: 0 }]] };
d.connections['Query Recipes'] = { main: [[{ node: 'Reply Recipes',     type: 'main', index: 0 }]] };

console.log('[conns] CS outputs:', csConns.length);
console.log('[conns] [9]:', csConns[9][0].node);
console.log('[conns] [10]:', csConns[10][0].node);
console.log('[conns] [11]:', csConns[11][0].node);

// ═══════════════════════════════════════════════════════════════════════════
// 5. Write & validate
// ═══════════════════════════════════════════════════════════════════════════
fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
