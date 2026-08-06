// Runs a .sql file against DATABASE_URL.
// Usage: node --env-file=.env db/run-sql.js <filename-in-db-folder>
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    console.error("Usage: node db/run-sql.js <filename-in-db-folder>");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set (check your .env file).");
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(__dirname, filename), "utf8");
  const client = new Client({
    connectionString,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log(`${filename} applied successfully.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
