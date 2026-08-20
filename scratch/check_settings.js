const { db } = require('@vercel/postgres');

process.env.POSTGRES_URL = "postgresql://neondb_owner:npg_rUMbCxOu5mT7@ep-winter-base-aux6y2ja-pooler.c-10.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

async function main() {
  try {
    const client = await db.connect();
    console.log("Connected to database successfully!");

    await client.sql`
      CREATE TABLE IF NOT EXISTS whitelisted_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("whitelisted_users table ready.");

    await client.sql`
      INSERT INTO whitelisted_users (email)
      VALUES ('sherif.else@gmail.com')
      ON CONFLICT (email) DO NOTHING;
    `;
    console.log("Seeded sherif.else@gmail.com in whitelisted_users.");

    const res = await client.sql`SELECT * FROM whitelisted_users;`;
    console.log("Whitelisted Users:", res.rows);

    await client.end();
  } catch (err) {
    console.error("Error:", err);
  }
}

main();




