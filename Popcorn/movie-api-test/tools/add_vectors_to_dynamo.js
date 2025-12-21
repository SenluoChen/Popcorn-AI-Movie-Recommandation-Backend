#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env var: ${name}`);
  return String(v);
}

function getDocClient() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const client = new DynamoDBClient(region ? { region } : {});
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

function readNdjsonLines(fp) {
  if (!fs.existsSync(fp)) throw new Error(`NDJSON not found: ${fp}`);
  return fs.readFileSync(fp, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(JSON.parse);
}

async function updateItem(docClient, tableName, imdbId, vector) {
  const params = {
    TableName: tableName,
    Key: { imdbId },
    UpdateExpression: 'SET #v = :v',
    ExpressionAttributeNames: { '#v': 'vector' },
    ExpressionAttributeValues: { ':v': vector }
  };
  await docClient.send(new UpdateCommand(params));
}

async function main() {
  const localRoot = path.resolve(process.env.LOCAL_DATA_PATH || path.join(__dirname, '..', '..', '..', 'Movie-data'));
  const embeddingsPath = path.join(localRoot, 'vectors', 'embeddings.ndjson');
  const tableName = process.argv[2] || process.env.DDB_TABLE_NAME || 'reLivre-movies';

  console.log(`[AddVectors] embeddings=${embeddingsPath}`);
  console.log(`[AddVectors] table=${tableName}`);

  const docClient = getDocClient();
  const rows = readNdjsonLines(embeddingsPath);

  const concurrency = 8;
  let idx = 0;
  let success = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      const r = rows[i];
      const imdbId = r.imdbId || r.key;
      if (!imdbId) { console.warn('[AddVectors] missing key at', i); failed++; continue; }
      try {
        await updateItem(docClient, tableName, String(imdbId), r.vector);
        success++;
        if (success % 50 === 0) process.stdout.write(`\r[AddVectors] updated ${success}/${rows.length}`);
      } catch (err) {
        failed++;
        console.error('\n[AddVectors] update failed for', imdbId, err?.message || err);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  console.log(`\n[AddVectors] Done. success=${success} failed=${failed} total=${rows.length}`);
}

main().catch(err => { console.error(err?.stack || err?.message || String(err)); process.exit(1); });
