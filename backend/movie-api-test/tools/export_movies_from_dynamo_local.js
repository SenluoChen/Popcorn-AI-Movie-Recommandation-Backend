#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

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
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const table = process.env.DDB_TABLE_NAME || process.env.MOVIES_TABLE_NAME || 'reLivre-movies';
  const outPath = path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson');

  const docClient = getDocClient();
  console.log('Scanning Dynamo table:', table);
  const items = await scanAll(table, docClient);
  console.log('Scan complete. Items:', items.length);

  // Backup existing file
  if (fs.existsSync(outPath)) {
    const bak = outPath + '.ddb.' + Date.now();
    fs.copyFileSync(outPath, bak);
    console.log('Backed up existing ndjson to', bak);
  }

  items.sort((a,b) => {
    const ia = String(a.imdbId||a.key||'');
    const ib = String(b.imdbId||b.key||'');
    if (ia && ib) return ia.localeCompare(ib);
    return 0;
  });

  const nd = items.map(it => JSON.stringify(it)).join('\n') + (items.length? '\n':'');
  fs.writeFileSync(outPath, nd, 'utf8');
  const report = { generatedAt: new Date().toISOString(), table, count: items.length, outPath };
  const reportPath = path.join(repoRoot, 'Movie-data', 'logs', 'export_movies_from_dynamo_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote NDJSON to', outPath);
  console.log('Report:', JSON.stringify(report, null, 2));
})();
