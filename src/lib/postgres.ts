/**
 * src/lib/postgres.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional PostgreSQL Database Connection & Query Engine for Quegar Quant Engine.
 * 
 * Provides a high-performance, resilient, connection-pooled drop-in replacement
 * for @vercel/postgres that natively supports:
 *  1. Self-hosted VPS PostgreSQL (`quegar_admin` on loopback `localhost:5432`).
 *  2. Forwarded SSH database tunnels (`quegar_readonly` on `localhost:5433`).
 *  3. Fallback to Cloud/Neon if configured.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Pool, QueryResult, QueryResultRow } from 'pg';

let pgModule: any = null;
try {
  // Dynamic runtime require: avoids Turbopack build warning and prevents crash when pg is absent locally
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  pgModule = eval('require')('pg');
} catch {
  // Graceful fallback if pg native driver is not installed locally
}

let poolInstance: Pool | null = null;

export function setDbPool(pool: Pool | null): void {
  poolInstance = pool;
}

export function getDbPool(): Pool {
  if (!poolInstance) {
    if (!pgModule) {
      return {
        query: async () => ({ rows: [], rowCount: 0 }),
        connect: async () => ({ release: () => {} }),
        on: () => {},
      } as unknown as Pool;
    }

    const connectionString =
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      'postgres://quegar_admin:bc1205f23ebf49e5140aa5408b72bc75@127.0.0.1:5432/quegar_db';

    const PgPool = pgModule.Pool || pgModule;

    try {
      const pool = new PgPool({
        connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
      }) as Pool;

      pool.on('error', (err: Error) => {
        console.error('[POSTGRES_POOL_ERROR] Unexpected error on idle client:', err);
      });

      poolInstance = pool;
    } catch (poolErr) {
      console.warn('[POSTGRES] Failed to initialize Pool (operating in mock offline mode):', poolErr);
      return {
        query: async () => ({ rows: [], rowCount: 0 }),
        connect: async () => ({ release: () => {} }),
        on: () => {},
      } as unknown as Pool;
    }
  }

  return poolInstance!;
}

export interface SqlQueryResult<T extends QueryResultRow = any> {
  rows: T[];
  rowCount: number;
  command?: string;
}

/**
 * Tagged template literal SQL execution helper.
 * Compatible drop-in with @vercel/postgres `sql` syntax:
 *   const { rows } = await sql`SELECT * FROM users WHERE email = ${email}`;
 */
export async function sql<T extends QueryResultRow = any>(
  strings: TemplateStringsArray,
  ...values: any[]
): Promise<SqlQueryResult<T>> {
  const pool = getDbPool();

  let queryText = '';
  for (let i = 0; i < strings.length; i++) {
    queryText += strings[i];
    if (i < values.length) {
      queryText += `$${i + 1}`;
    }
  }

  try {
    const result: QueryResult<T> = await pool.query<T>(queryText, values);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
      command: result.command,
    };
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
      console.warn('[POSTGRES] Database connection refused (operating in offline fallback mode):', err.message);
      return { rows: [], rowCount: 0 };
    }
    throw err;
  }
}

/**
 * Direct raw query method on `sql`:
 *   const { rows } = await sql.query('SELECT * FROM users WHERE id = $1', [userId]);
 */
sql.query = async function <T extends QueryResultRow = any>(
  text: string,
  values?: any[]
): Promise<SqlQueryResult<T>> {
  const pool = getDbPool();
  try {
    const result: QueryResult<T> = await pool.query<T>(text, values);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
      command: result.command,
    };
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
      console.warn('[POSTGRES] Database connection refused (operating in offline fallback mode):', err.message);
      return { rows: [], rowCount: 0 };
    }
    throw err;
  }
};

/**
 * Exported `db` helper for compatibility
 */
export const db = {
  query: sql.query,
  connect: async () => getDbPool().connect(),
};

export default sql;
