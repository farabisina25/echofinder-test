import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Upsert issue record (embedding: JS array of floats)
export async function upsertIssue({ id, repo_name, issue_number, title, body, author, embedding, pairing_token, merge_state }) {
  const client = await pool.connect();
  try {
    // Convert embedding array to pgvector format: '[0.1,0.2,0.3]'
    const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

    const q = `
      INSERT INTO issues (id, repo_name, issue_number, title, body, author, embedding, pairing_token, merge_state, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,$9, now())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        author = EXCLUDED.author,
        embedding = EXCLUDED.embedding,
        pairing_token = EXCLUDED.pairing_token,
        merge_state = EXCLUDED.merge_state,
        updated_at = now()
    `;
    await client.query(q, [
      id, repo_name, issue_number, title, body, author, embeddingStr, pairing_token || null, merge_state || 'none'
    ]);
  } finally {
    client.release();
  }
}

export async function findNearest(embeddingArray, owner, limit = 10) {
  const client = await pool.connect();
  try {
    const embeddingStr = `[${embeddingArray.join(',')}]`;
    const q = `
      SELECT id, repo_name, issue_number, title, body, (1 - (embedding <=> $1::vector)) AS similarity
      FROM issues
      WHERE repo_name LIKE $2 || '/%' AND embedding IS NOT NULL AND merge_state != 'merged'
      ORDER BY embedding <=> $1::vector
      LIMIT $3;
    `;
    const res = await client.query(q, [embeddingStr, owner, limit]);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function setMergeState(issue_number, repo_name, state) {
  const client = await pool.connect();
  try {
    const q = `UPDATE issues SET merge_state = $1, updated_at = now() WHERE repo_name = $2 AND issue_number = $3`;
    await client.query(q, [state, repo_name, issue_number]);
  } finally {
    client.release();
  }
}

export async function getIssue(id) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id FROM issues WHERE id = $1', [id]);
    return res.rows[0];
  } finally {
    client.release();
  }
}

export async function markAsMerged(issue_number, repo_name) {
  return setMergeState(issue_number, repo_name, 'merged');
}