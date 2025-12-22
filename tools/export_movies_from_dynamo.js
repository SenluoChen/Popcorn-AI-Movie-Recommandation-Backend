#!/usr/bin/env node
'use strict';

// quick note: Export all movie items from DynamoDB table to local NDJSON
// quick note: Usage:
// quick note: node tools/export_movies_from_dynamo.js [—-table <name>] [—-out <path>] [—-no-backup]

// quick note: Try to load dotenv from movie-api-test; if not available, fallback to simple .env parser
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', 'Popcorn', 'movie-api-test', '.env') });
} catch (e) {
  // quick note: simple .env loader
  try {
    const dotenvPath = require('path').resolve(__dirname, '..', 'Popcorn', 'movie-api-test', '.env');
    if (require('fs').existsSync(dotenvPath)) {
      const txt = require('fs').readFileSync(dotenvPath, 'utf8');
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2] || '';
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch (_) { /*
 * quick note: ignore
 */ }
}
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

function parseArgs(argv) {
  const repoRoot = path.resolve(__dirname, '..');
  return {
    table: process.env.DDB_TABLE_NAME || process.env.MOVIES_TABLE_NAME || 'reLivre-movies',
    outPath: path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson'),
    backup: true,
  };
}

function getDocClient() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION;
  const client = new DynamoDBClient(region ? { region } : {});
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

async function scanAll(tableName, docClient) {
  const out = [];
  let ExclusiveStartKey = undefined;
  while (true) {
    const params = { TableName: tableName, ExclusiveStartKey, Limit: 200 };
    const cmd = new ScanCommand(params);
    const res = await docClient.send(cmd);
    if (Array.isArray(res.Items)) out.push(...res.Items);
    if (!res.LastEvaluatedKey) break;
    ExclusiveStartKey = res.LastEvaluatedKey;
    console.log('[scan] got', out.length, 'so far...');
  }
  return out;
}

(async function main() {
  const args = parseArgs(process.argv);
  const docClient = getDocClient();
  console.log('Scanning Dynamo table:', args.table);
  const items = await scanAll(args.table, docClient);
  console.log('Scan complete. Items:', items.length);

  // quick note: Backup existing file if present
  if (args.backup && fs.existsSync(args.outPath)) {
    const bak = args.outPath + '.ddb.' + Date.now();
    fs.copyFileSync(args.outPath, bak);
    console.log('Backed up existing ndjson to', bak);
  }

  // note: Convert Items to NDJSON — ensure stable ordering by imdbId if present
  items.sort((a,b) => {
    const ia = String(a.imdbId||a.key||'');
    const ib = String(b.imdbId||b.key||'');
    if (ia && ib) return ia.localeCompare(ib);
    return 0;
  });

  const nd = items.map(it => JSON.stringify(it)).join('\n') + (items.length? '\n':'');
  fs.writeFileSync(args.outPath, nd, 'utf8');
  const report = { generatedAt: new Date().toISOString(), table: args.table, count: items.length, outPath: args.outPath };
  const reportPath = path.join(path.resolve(__dirname, '..'), 'Movie-data', 'logs', 'export_movies_from_dynamo_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote NDJSON to', args.outPath);
  console.log('Report:', JSON.stringify(report, null, 2));
})();
