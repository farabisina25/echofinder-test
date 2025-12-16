import { GoogleGenerativeAI } from "@google/generative-ai";
import { setMergeState } from '../db.js';

export async function handleIssueComment(context) {
    try {
        const raw = (context.payload.comment.body || '').trim();
        const commentBody = raw.toLowerCase();
        const cmdMatch = commentBody.match(/^\/?(merge|accept|reject|cancel)\b/i);
        if (!cmdMatch) return; // require explicit command

        const command = cmdMatch[1].toLowerCase(); // 'merge' | 'accept' | 'reject' | 'cancel'
        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        const currentIssueNumber = context.payload.issue.number;
        const commenter = context.payload.comment.user.login;

        // Find pairing token in comments on this issue
        const commentsResp = await context.octokit.issues.listComments({
            owner, repo, issue_number: currentIssueNumber, per_page: 200
        });

        let pairToken = null;
        for (const c of commentsResp.data) {
            if (c.body && c.body.includes('<!-- ECHOFINDER_PAIR:')) {
                const m = c.body.match(/ECHOFINDER_PAIR:orig=(\d+);new=(\d+)/);
                if (m) { pairToken = { orig: Number(m[1]), new: Number(m[2]) }; break; }
            }
        }
        if (!pairToken) return;

        // Determine other issue and authors
        const otherIssueNumber = (pairToken.orig === currentIssueNumber) ? pairToken.new : pairToken.orig;
        const [issueAResp, issueBResp] = await Promise.all([
            context.octokit.issues.get({ owner, repo, issue_number: pairToken.orig }),
            context.octokit.issues.get({ owner, repo, issue_number: pairToken.new })
        ]);
        const origAuthor = issueAResp.data.user.login;
        const newAuthor = issueBResp.data.user.login;

        // Ensure commenter is the author of the issue where they commented
        const expectedAuthor = (pairToken.orig === currentIssueNumber) ? origAuthor : newAuthor;
        if (commenter !== expectedAuthor) {
            // ignore confirmations from non-authors
            return;
        }

        // Helper: check whether an author has confirmed on their own issue
        async function authorConfirmed(issueNumber, authorLogin) {
            const resp = await context.octokit.issues.listComments({
                owner, repo, issue_number: issueNumber, per_page: 200
            });
            return resp.data.some(c =>
                c.user && c.user.login === authorLogin &&
                /^\/?(merge|accept)\b/i.test((c.body || '').trim())
            );
        }

        // If explicit reject/cancel, mark rejected and notify both sides
        if (command === 'reject' || command === 'cancel') {
            await Promise.all([
                setMergeState(pairToken.orig, `${owner}/${repo}`, 'rejected'),
                setMergeState(pairToken.new, `${owner}/${repo}`, 'rejected')
            ]).catch(() => { });
            await Promise.all([
                context.octokit.issues.addLabels({ owner, repo, issue_number: pairToken.orig, labels: ['merge-rejected'] }).catch(() => { }),
                context.octokit.issues.addLabels({ owner, repo, issue_number: pairToken.new, labels: ['merge-rejected'] }).catch(() => { })
            ]);
            return;
        }

        // For approve commands: check both confirmations
        const [origConfirmed, newConfirmed] = await Promise.all([
            authorConfirmed(pairToken.orig, origAuthor),
            authorConfirmed(pairToken.new, newAuthor)
        ]);

        // If one confirmed and the other not, notify the user we are waiting
        if ((pairToken.orig === currentIssueNumber && !newConfirmed) || (pairToken.new === currentIssueNumber && !origConfirmed)) {
            console.log('ℹ️ One author confirmed; waiting for the other author to confirm.');

            // Post "Waiting" comment
            await context.octokit.issues.createComment({
                owner,
                repo,
                issue_number: currentIssueNumber,
                body: `⏳ **Confirmation Received**: You have voted to merge.\n\nWaiting for the other issue author to confirm by commenting \`/merge\` on their issue.`
            });

            // Notify the OTHER issue
            const otherNum = (pairToken.orig === currentIssueNumber) ? pairToken.new : pairToken.orig;
            await context.octokit.issues.createComment({
                owner,
                repo,
                issue_number: otherNum,
                body: `🔔 The author of #${currentIssueNumber} has proposed a merge.\n\nPlease comment \`/merge\` on this issue to accept and trigger the AI synthesis.`
            });

            return;
        }

        // If both confirmed -> Execute Gemini AI Merge
        if (origConfirmed && newConfirmed) {
            console.log(`✅ Both authors confirmed. Initiating Gemini AI Merge for #${pairToken.new} and #${pairToken.orig}`);

            if (!process.env.GEMINI_API_KEY) {
                console.error('❌ GEMINI_API_KEY is missing!');
                await context.octokit.issues.createComment({ owner, repo, issue_number: pairToken.orig, body: '❌ **Error**: Gemini API Key is missing. Cannot perform AI merge.' });
                return;
            }

            try {
                // 1. Fetch details of both issues
                const [origIssue, newIssue] = await Promise.all([
                    context.octokit.issues.get({ owner, repo, issue_number: pairToken.orig }),
                    context.octokit.issues.get({ owner, repo, issue_number: pairToken.new })
                ]);

                const issueA = origIssue.data;
                const issueB = newIssue.data;

                // 2. Prepare Prompt for Gemini
                const prompt = `You are an expert technical project manager. Your task is to merge two duplicate GitHub issues into a single, comprehensive new issue.
        
        ISSUE 1 (Original):
        Title: ${issueA.title}
        Body: ${issueA.body || ''}
        
        ISSUE 2 (Duplicate):
        Title: ${issueB.title}
        Body: ${issueB.body || ''}
        
        INSTRUCTIONS:
        1. Create a NEW title that best represents the core problem.
        2. Create a NEW body that combines details from both. Include reproduction steps, logs, and context from both if available. Format it nicely with Markdown.
        3. Return the result as a JSON object with keys: "title" and "body".
        4. Do NOT include Markdown code blocks (like \`\`\`json) in the response, just the raw JSON string.`;

                // 3. Call Gemini
                const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                // User has access to Gemini 2.5 Flash!
                const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
                const model = genAI.getGenerativeModel({ model: modelName });

                console.log('🤖 Sending merge request to Gemini...');
                const result = await model.generateContent(prompt);
                const responseText = result.response.text();

                // Clean up potential markdown formatting in response
                const jsonStr = responseText.replace(/^```json/, '').replace(/```$/, '').trim();
                const mergedData = JSON.parse(jsonStr);

                // 4. Create the NEW Merged Issue
                const createdIssue = await context.octokit.issues.create({
                    owner,
                    repo,
                    title: `[MERGED] ${mergedData.title}`,
                    body: `${mergedData.body}\n\n---\n*This issue was automatically synthesized by EchoFinder AI from issues #${issueA.number} and #${issueB.number}.*`,
                    labels: ['merged', 'substantiated']
                });

                console.log(`✨ Created NEW Merged Issue #${createdIssue.data.number}`);

                // 5. Update DB State
                await Promise.all([
                    setMergeState(pairToken.orig, `${owner}/${repo}`, 'merged'),
                    setMergeState(pairToken.new, `${owner}/${repo}`, 'merged')
                ]).catch(e => console.error('Error updating DB merge state:', e));


                // 6. Close OLD Issues and Link
                const closeComment = `✅ **Merged into #${createdIssue.data.number}**\n\n` +
                    `This issue has been closed. A new, comprehensive issue has been created by merging this with another duplicate.\n` +
                    `👉 **Go to #${createdIssue.data.number}** for the consolidated discussion.`;

                await Promise.all([
                    context.octokit.issues.update({ owner, repo, issue_number: issueA.number, state: 'closed', state_reason: 'not_planned' }),
                    context.octokit.issues.update({ owner, repo, issue_number: issueB.number, state: 'closed', state_reason: 'not_planned' }),
                    context.octokit.issues.createComment({ owner, repo, issue_number: issueA.number, body: closeComment }),
                    context.octokit.issues.createComment({ owner, repo, issue_number: issueB.number, body: closeComment })
                ]);

                console.log('✅ Closed old issues and posted links.');

            } catch (error) {
                console.error('❌ Error during Gemini Merge:', error);
                await context.octokit.issues.createComment({
                    owner, repo, issue_number: pairToken.orig,
                    body: `❌ **Merge Failed**: An error occurred while processing the AI merge. Check logs.`
                });
            }
        }

    } catch (err) {
        console.error('❌ Error in merge handler:', err.message || err);
    }
}
