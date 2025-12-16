import { fetchEmbedding } from '../services/embedding.js';
import { upsertIssue, findNearest } from '../db.js';

const SIMILARITY_THRESHOLD = 0.70;

export async function handleIssueOpened(context) {
    const issue = context.payload.issue;
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const repoName = `${owner}/${repo}`;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📋 NEW ISSUE DETECTED`);
    console.log(`Repository: ${repoName}`);
    console.log(`Issue #${issue.number}: ${issue.title}`);
    console.log(`${'='.repeat(50)}\n`);

    try {
        // 1. Generate text and embedding for the NEW issue
        const newText = `${issue.title}\n${issue.body || ''}`;
        console.log('🔗 Fetching embedding for new issue...');
        const newEmbedding = await fetchEmbedding(newText);

        if (!newEmbedding || !Array.isArray(newEmbedding)) {
            console.log('⚠️ Failed to generate embedding. Skipping.');
            return;
        }

        // 2. Upsert the new issue to the DB immediately
        try {
            await upsertIssue({
                id: issue.id,
                repo_name: repoName,
                issue_number: issue.number,
                title: issue.title,
                body: issue.body || '',
                author: issue.user?.login || '',
                embedding: newEmbedding,
                pairing_token: null,
                merge_state: 'none'
            });
            console.log('✅ Issue upserted to DB');
        } catch (dbErr) {
            console.error('❌ DB upsert error:', dbErr.message);
            // We continue even if upsert fails, though duplication check might be limited
        }

        // 3. Search DB for nearest nieghbors (excluding self is handled by limit/logic or index usually)
        // But since we just inserted `issue.number`, it might return itself as the perfect match (score 1.0)
        // We get top 5 and filter out the current issue.
        console.log(`🔍 Searching database for similar issues...`);
        const matches = await findNearest(newEmbedding, repoName, 5);

        // Filter out the issue itself (it will be the top match with 1.0 similarity)
        const candidates = matches.filter(m => m.issue_number !== issue.number);

        console.log(`✓ Found ${candidates.length} potential candidates in DB`);

        if (candidates.length === 0) {
            console.log('ℹ️ No similar issues found.');
            return;
        }

        // 4. Check the best match
        const bestMatch = candidates[0];
        const bestScore = bestMatch.similarity; // findNearest returns 'similarity' column

        console.log(`\n🎯 RESULTS:`);
        console.log(`Best match: Issue #${bestMatch.issue_number}`);
        console.log(`Title: "${bestMatch.title}"`);
        console.log(`Score: ${(bestScore * 100).toFixed(1)}%`);
        console.log(`Threshold: ${(SIMILARITY_THRESHOLD * 100).toFixed(1)}%`);

        if (bestScore > SIMILARITY_THRESHOLD) {
            console.log(`\n✅ SCORE ABOVE THRESHOLD - Posting comment...\n`);

            // create a hidden pairing token so comment events can find the linked issues
            const pairToken = `<!-- ECHOFINDER_PAIR:orig=${bestMatch.issue_number};new=${issue.number} -->`;

            const newIssueComment = `🔍 **Potential Duplicate Found**\n\n` +
                `This issue is very similar to **#${bestMatch.issue_number}**: "${bestMatch.title}"\n\n` +
                `📊 **Similarity Score:** ${(bestScore * 100).toFixed(1)}%\n\n` +
                `Please review if this is a duplicate. If confirmed, you can close this issue.\n\n` +
                `To merge these two issues, BOTH issue authors must comment on *their own issue* with the command: \`/merge\`.\n\n` +
                pairToken;

            // Post to the NEW issue
            await context.octokit.issues.createComment({
                owner,
                repo,
                issue_number: issue.number,
                body: newIssueComment
            });

            // Also post the pairing comment to the ORIGINAL issue so confirmations there are detected
            const originalIssueNotice = `🔔 Note: A new issue (#${issue.number}) was opened that appears to be a possible duplicate of this issue.\n\n` +
                `**New issue title:** "${issue.title}"\n` +
                `📊 **Similarity:** ${(bestScore * 100).toFixed(1)}%\n\n` +
                `To mock-merge these issues, BOTH issue authors must comment on *their own issue* with \`/merge\` (accept) or \`/reject\` (decline). Once both confirmations are present the bot will post a mock-merge notification.` +
                `\n\n` + pairToken;

            await context.octokit.issues.createComment({
                owner,
                repo,
                issue_number: bestMatch.issue_number,
                body: originalIssueNotice
            });

            console.log('✅ Comments posted to both issues');

            // Add label to NEW issue
            try {
                await context.octokit.issues.addLabels({
                    owner, repo, issue_number: issue.number, labels: ['duplicate?']
                });
            } catch (ignore) { }

            // Add label to ORIGINAL issue
            try {
                await context.octokit.issues.addLabels({
                    owner, repo, issue_number: bestMatch.issue_number, labels: ['has-duplicates']
                });
            } catch (ignore) { }

        } else {
            console.log(`\n⏭️ Score below threshold. No comment posted.`);
        }
        console.log(`\n${'='.repeat(50)}\n`);

    } catch (error) {
        console.error('❌ ERROR processing issue:', error.message);
        console.error(error);
    }
}
