import axios from 'axios';

const EMBEDDING_SERVER = process.env.EMBEDDING_SERVER || 'http://localhost:8001';

export async function fetchEmbedding(text) {
    try {
        const r = await axios.post(`${EMBEDDING_SERVER}/embed`, { text });
        return r.data.embedding; // expect array of floats
    } catch (e) {
        console.error('❌ embed error', e.message || e);
        return null;
    }
}

export async function compareIssues(newText, oldTexts) {
    try {
        console.log(`🔗 Calling embedding server: ${EMBEDDING_SERVER}/compare`);
        const response = await axios.post(`${EMBEDDING_SERVER}/compare`, {
            new_text: newText,
            old_texts: oldTexts
        });
        console.log('✓ Embedding server responded');
        return response.data;
    } catch (error) {
        console.error('❌ Embedding service error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        throw error;
    }
}
