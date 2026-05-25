const { db } = require('@vercel/postgres');

process.env.POSTGRES_URL = "postgresql://neondb_owner:npg_ytShG9Px0VrY@ep-dawn-hall-aq9jnz3p-pooler.c-8.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

async function main() {
  try {
    const client = await db.connect();
    console.log("Connected to database.");

    const res = await client.sql`SELECT key_name, key_value FROM system_settings;`;
    console.log("System Settings Rows:");
    for (const row of res.rows) {
      console.log(`- ${row.key_name}: ${row.key_value.slice(0, 100)}...`);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
