#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const path = require('path');

function getDynamoDocClient() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION;
  const ddb = new DynamoDBClient(region ? { region } : {});
  return DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node tools/get_dynamo_item.js <imdbId>');
    process.exit(2);
  }
  const tableName = (process.env.DDB_TABLE_NAME || process.env.MOVIES_TABLE_NAME || 'reLivre-movies').trim();
  const docClient = getDynamoDocClient();
  try {
    const res = await docClient.send(new GetCommand({ TableName: tableName, Key: { imdbId: id } }));
    console.log(JSON.stringify(res.Item || null, null, 2));
  } catch (e) {
    console.error('Error:', e && e.message);
    process.exit(1);
  }
}

main();
