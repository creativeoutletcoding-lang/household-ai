// apply-batch-4.js
// 1. Remove all Skylight nodes and connections from the workflow
// 2. Add Google Calendar integration (Parse Cmd → Get Events → Format → Reply)
// 3. Update /help text for /calendar
// Run: node apply-batch-4.js

'use strict';
const fs = require('fs');
const d  = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));

// ── 1. Remove Skylight nodes ──────────────────────────────────────────────────
const SKYLIGHT_NODES = [
  'Build Skylight Request',
  'Authenticate Skylight',
  'Call Skylight API',
  'Parse Skylight Reply',
  'Reply Calendar',
];

const before = d.nodes.length;
d.nodes = d.nodes.filter(n => !SKYLIGHT_NODES.includes(n.name));
console.log(`[1] Removed ${before - d.nodes.length} Skylight nodes (${d.nodes.length} remain)`);

// Remove connections FROM each Skylight node
SKYLIGHT_NODES.forEach(name => { delete d.connections[name]; });

// Remove connections TO each Skylight node (only Command Switch→Build Skylight Request matters)
Object.keys(d.connections).forEach(from => {
  if (!d.connections[from].main) return;
  d.connections[from].main = d.connections[from].main.map(arr =>
    arr ? arr.filter(c => !SKYLIGHT_NODES.includes(c.node)) : arr
  );
});
console.log('[1] Removed Skylight connections');

// ── 2. Add Google Calendar nodes ──────────────────────────────────────────────
// Node A: Parse Calendar Cmd (Code) — interpret the calendarArg
const parseCalendarCmd = {
  parameters: {
    jsCode: [
      "const calendarArg = ($json.calendarArg || '').trim().toLowerCase();",
      "",
      "// Sub-calendar IDs for johnson2016family@gmail.com.",
      "// Find each ID in Google Calendar → Settings → <person>'s calendar → Calendar ID.",
      "// Replace these placeholder strings with the real IDs, then reimport the workflow.",
      "const CALENDAR_IDS = {",
      "  elliot:    'REPLACE_WITH_ELLIOT_CALENDAR_ID',",
      "  henry:     'REPLACE_WITH_HENRY_CALENDAR_ID',",
      "  jake:      'primary',",
      "  joce:      'REPLACE_WITH_JOCE_CALENDAR_ID',",
      "  jocelyn:   'REPLACE_WITH_JOCE_CALENDAR_ID',",
      "  loubi:     'REPLACE_WITH_LOUBI_CALENDAR_ID',",
      "  laurianne: 'REPLACE_WITH_LOUBI_CALENDAR_ID',",
      "  nana:      'REPLACE_WITH_NANA_CALENDAR_ID',",
      "  violette:  'REPLACE_WITH_VIOLETTE_CALENDAR_ID',",
      "};",
      "",
      "const now = new Date();",
      "const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);",
      "const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);",
      "const weekEnd    = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 7);",
      "",
      "let calendarId = 'primary';",
      "let timeMin    = todayStart.toISOString();",
      "let timeMax    = todayEnd.toISOString();",
      "let rangeLabel = 'today';",
      "",
      "if (calendarArg === 'week') {",
      "  timeMax    = weekEnd.toISOString();",
      "  rangeLabel = 'this week';",
      "} else if (calendarArg && calendarArg !== 'today' && CALENDAR_IDS[calendarArg]) {",
      "  calendarId = CALENDAR_IDS[calendarArg];",
      "  const name = calendarArg.charAt(0).toUpperCase() + calendarArg.slice(1);",
      "  rangeLabel = name + \"'s calendar — today\";",
      "} else if (calendarArg && calendarArg !== 'today') {",
      "  // Unrecognised arg — still show today, note the confusion",
      "  rangeLabel = 'today (unrecognised filter: ' + calendarArg + ')';",
      "}",
      "",
      "return [{ json: { calendarId, timeMin, timeMax, rangeLabel } }];",
    ].join('\n'),
  },
  id:          '60000000-0000-0000-0000-000000000001',
  name:        'Parse Calendar Cmd',
  type:        'n8n-nodes-base.code',
  typeVersion: 2,
  position:    [-672, 1040],
};

// Node B: Get Calendar Events (Google Calendar built-in node)
const getCalendarEvents = {
  parameters: {
    resource:  'event',
    operation: 'getAll',
    calendar: {
      __rl:  true,
      value: "={{ $json.calendarId }}",
      mode:  'id',
    },
    returnAll: false,
    limit:     15,
    options: {
      timeMin:       "={{ $json.timeMin }}",
      timeMax:       "={{ $json.timeMax }}",
      orderBy:       'startTime',
      singleEvents:  true,
    },
  },
  id:              '61000000-0000-0000-0000-000000000001',
  name:            'Get Calendar Events',
  type:            'n8n-nodes-base.googleCalendar',
  typeVersion:     1,
  position:        [-448, 1040],
  alwaysOutputData: true,
  credentials: {
    googleCalendarOAuth2Api: {
      id:   'GOOGLE_CALENDAR_CRED_ID',
      name: 'Google Calendar (johnson2016family)',
    },
  },
};

// Node C: Format Calendar Reply (Code)
const formatCalendarReply = {
  parameters: {
    jsCode: [
      "const items      = $input.all();",
      "const rangeLabel = $('Parse Calendar Cmd').first().json.rangeLabel;",
      "",
      "// Filter out empty placeholder items (alwaysOutputData may emit one empty item)",
      "const events = items.filter(function(item) { return item.json && item.json.id; });",
      "",
      "if (!events.length) {",
      "  return [{ json: { commandReply: 'No events found for ' + rangeLabel + '.' } }];",
      "}",
      "",
      "const lines = events.map(function(item) {",
      "  const e       = item.json;",
      "  const summary = e.summary || '(no title)';",
      "  const start   = e.start || {};",
      "  let dateStr   = '';",
      "  if (start.dateTime) {",
      "    const d = new Date(start.dateTime);",
      "    dateStr = d.toLocaleString('en-US', {",
      "      month: 'short', day: 'numeric',",
      "      hour: 'numeric', minute: '2-digit',",
      "      timeZone: 'America/New_York',",
      "    });",
      "  } else if (start.date) {",
      "    // All-day event — parse as noon UTC to avoid date-boundary shift",
      "    const d = new Date(start.date + 'T12:00:00Z');",
      "    dateStr = d.toLocaleString('en-US', {",
      "      month: 'short', day: 'numeric',",
      "      timeZone: 'America/New_York',",
      "    });",
      "  }",
      "  return dateStr ? ('**' + summary + '** — ' + dateStr) : ('**' + summary + '**');",
      "});",
      "",
      "const reply = '**Calendar — ' + rangeLabel + '**\\n' + lines.join('\\n');",
      "return [{ json: { commandReply: reply } }];",
    ].join('\n'),
  },
  id:          '62000000-0000-0000-0000-000000000001',
  name:        'Format Calendar Reply',
  type:        'n8n-nodes-base.code',
  typeVersion: 2,
  position:    [-224, 1040],
};

// Node D: Reply Calendar (Discord)
const replyCalendar = {
  parameters: {
    resource: 'message',
    guildId: {
      __rl:  true,
      value: '1495249842778148954',
      mode:  'id',
    },
    channelId: {
      __rl:  true,
      value: "={{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}",
      mode:  'id',
    },
    content: "={{ $json.commandReply }}",
    options: {},
  },
  id:          '63000000-0000-0000-0000-000000000001',
  name:        'Reply Calendar',
  type:        'n8n-nodes-base.discord',
  typeVersion: 2,
  position:    [0, 1040],
  webhookId:   'c3a9b842-7211-4c9d-9a21-8e2d3f7b1002',
  credentials: {
    discordBotApi: {
      id:   'om7VabWMiA8gC2i3',
      name: 'Discord Bot account',
    },
  },
};

d.nodes.push(parseCalendarCmd, getCalendarEvents, formatCalendarReply, replyCalendar);
console.log(`[2] Added 4 Google Calendar nodes (${d.nodes.length} total)`);

// ── 3. Wire up new nodes ──────────────────────────────────────────────────────
// Command Switch output 8 → Parse Calendar Cmd
const csMain = d.connections['Command Switch'].main;
csMain[8] = [{ node: 'Parse Calendar Cmd', type: 'main', index: 0 }];

d.connections['Parse Calendar Cmd'] = {
  main: [[{ node: 'Get Calendar Events', type: 'main', index: 0 }]],
};
d.connections['Get Calendar Events'] = {
  main: [[{ node: 'Format Calendar Reply', type: 'main', index: 0 }]],
};
d.connections['Format Calendar Reply'] = {
  main: [[{ node: 'Reply Calendar', type: 'main', index: 0 }]],
};
console.log('[3] Wired Parse Calendar Cmd → Get Calendar Events → Format Calendar Reply → Reply Calendar');

// ── 4. Update /help text in Channel Router ────────────────────────────────────
{
  const node = d.nodes.find(n => n.name === 'Channel Router');
  let code = node.parameters.jsCode;

  // The help commandReply is a double-quoted JS string; \n in it is the two-char literal.
  // We match on the substring as it actually appears in the code string.
  const OLD_CAL = "/calendar` \u2014 show today's Skylight events\\n";
  const NEW_CAL  = "/calendar` \u2014 show family calendar (today)\\n" +
                   "`/calendar week` \u2014 show events this week\\n" +
                   "`/calendar <person>` \u2014 show a person's calendar (jake, loubi, joce, nana, elliot, henry, violette)\\n";

  if (!code.includes(OLD_CAL)) {
    console.warn('[4] WARNING: /calendar help pattern not found — check manually');
  } else {
    code = code.replace(OLD_CAL, NEW_CAL);
    console.log('[4] Updated /help text for /calendar');
  }
  node.parameters.jsCode = code;
}

// ── Write & validate ──────────────────────────────────────────────────────────
fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
