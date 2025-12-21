import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load .env from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function initDB() {
    const client = await pool.connect();
    try {
        console.log('🔌 Connected to database...');

        // Read SQL file
        const sqlPath = path.resolve(__dirname, '../../create_issues_table');
        console.log(`📄 Reading SQL from: ${sqlPath}`);

        if (!fs.existsSync(sqlPath)) {
            throw new Error(`SQL file not found at ${sqlPath}`);
        }

        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Remove the comment line that might confuse simple query execution if it has unwanted chars, 
        // or just run it. Multiline SQL is fine.

        console.log('🚀 Executing SQL...');
        await client.query(sql);

        console.log('✅ Database initialized successfully!');
        console.log('   - Extension `vector` created');
        console.log('   - Table `issues` created');
        console.log('   - Indices created');

    } catch (err) {
        console.error('❌ Error initializing database:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

initDB();
