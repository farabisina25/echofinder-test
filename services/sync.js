import { fetchEmbedding } from './embedding.js';
import { upsertIssue, getIssue } from '../db.js';

/**
 * Syncs ALL open issues from valid repositories to the database.
 * This runs on bot startup.
 */
export async function syncIssues(app) {
    app.log.info('🔄 Starting full issue sync...');

    try {
        // Authenticate as the App Installation
        // Note: We need a valid installation ID to list repos or issues.
        // For a single-install bot, we can iterate installations.
        const installations = await app.auth();
        const installationsList = await installations.apps.listInstallations();

        for (const installation of installationsList.data) {
            const octokit = await app.auth(installation.id);
            const repos = await octokit.apps.listReposAccessibleToInstallation({ installation_id: installation.id });

            for (const repo of repos.data.repositories) {
                app.log.info(`📡 Syncing repo: ${repo.full_name}`);

                const issues = await octokit.paginate(octokit.issues.listForRepo, {
                    owner: repo.owner.login,
                    repo: repo.name,
                    state: 'open',
                    per_page: 100
                });

                let newCount = 0;
                let skipCount = 0;

                for (const issue of issues) {
                    if (issue.pull_request) continue; // Skip PRs

                    // 1. Check if already in DB
                    // We need a lightweight check. For now, upsert is safe but expensive if we re-embed everything.
                    // Let's rely on upsert but only generate embedding if strictly needed?
                    // Better: Check existence first.
                    // We need to export a `getIssue` function from db.js or just force upsert logic.
                    // For efficiency: We check if it exists in DB.
                    const exists = await getIssue(issue.id);
                    if (exists) {
                        skipCount++;
                        continue;
                    }

                    // 2. Generate Embedding
                    const text = `${issue.title}\n${issue.body || ''}`;
                    const embedding = await fetchEmbedding(text);

                    if (!embedding) {
                        app.log.warn(`⚠️ Failed to embed issue #${issue.number} in ${repo.full_name}`);
                        continue;
                    }

                    // 3. Save to DB
                    await upsertIssue({
                        id: issue.id,
                        repo_name: repo.full_name,
                        issue_number: issue.number,
                        title: issue.title,
                        body: issue.body || '',
                        author: issue.user?.login,
                        embedding: embedding,
                        pairing_token: null,
                        merge_state: 'none'
                    });
                    newCount++;
                }
                app.log.info(`✅ Synced ${repo.full_name}: ${newCount} new, ${skipCount} skipped.`);
            }
        }
    } catch (err) {
        app.log.error('❌ Sync failed:', err.message);
    }
}
