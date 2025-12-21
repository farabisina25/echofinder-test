import { GoogleGenerativeAI } from "@google/generative-ai";
import { setMergeState } from '../db.js';

export async function handleIssueComment(context) {
    try {
        const raw = (context.payload.comment.body || '').trim();
        const commentBody = raw.toLowerCase();
        const cmdMatch = commentBody.match(/^\/?(merge|reject)\b/i);
        if (!cmdMatch) return; // require explicit command

        const command = cmdMatch[1].toLowerCase(); // 'merge' | 'reject'

        // Context of the CURRENT comment
        const currentOwner = context.payload.repository.owner.login;
        const currentRepoName = context.payload.repository.name;
        const currentRepoFullName = `${currentOwner}/${currentRepoName}`;
        const currentIssueNumber = context.payload.issue.number;
        const commenter = context.payload.comment.user.login;

        // Find pairing token in comments on THIS issue
        // We look for comments in the current thread
        const commentsResp = await context.octokit.issues.listComments({
            owner: currentOwner, repo: currentRepoName, issue_number: currentIssueNumber, per_page: 200
        });

        let pairToken = null;
        for (const c of commentsResp.data) {
            if (c.body && c.body.includes('<!-- ECHOFINDER_PAIR:')) {
                // New Format: orig=owner/repo#123;new=owner/repo#456
                const m = c.body.match(/ECHOFINDER_PAIR:orig=([^#]+)#(\d+);new=([^#]+)#(\d+)/);
                if (m) {
                    pairToken = {
                        origRepo: m[1], origNum: Number(m[2]),
                        newRepo: m[3], newNum: Number(m[4])
                    };
                    break;
                }
            }
        }
        if (!pairToken) return;

        // Determine if we are on the Orig side or New side
        const isOrig = (currentRepoFullName === pairToken.origRepo && currentIssueNumber === pairToken.origNum);
        const isNew = (currentRepoFullName === pairToken.newRepo && currentIssueNumber === pairToken.newNum);

        if (!isOrig && !isNew) {
            console.warn('⚠️ Comment found with token, but issuing issue does not match token details.');
            return;
        }

        // Fetch details of both issues to get authors
        // Function to split owner/repo
        const getRepoDetails = (fullRepoName) => {
            const [o, r] = fullRepoName.split('/');
            return { owner: o, repo: r };
        };

        const origDetails = getRepoDetails(pairToken.origRepo);
        const newDetails = getRepoDetails(pairToken.newRepo);

        const [issueAResp, issueBResp] = await Promise.all([
            context.octokit.issues.get({ owner: origDetails.owner, repo: origDetails.repo, issue_number: pairToken.origNum }),
            context.octokit.issues.get({ owner: newDetails.owner, repo: newDetails.repo, issue_number: pairToken.newNum })
        ]);
        const origAuthor = issueAResp.data.user.login;
        const newAuthor = issueBResp.data.user.login;

        // Ensure commenter is the author of the issue where they commented
        const expectedAuthor = isOrig ? origAuthor : newAuthor;
        if (commenter !== expectedAuthor) {
            // ignore confirmations from non-authors
            return;
        }

        // Helper: check whether an author has confirmed on their own issue
        async function authorConfirmed(issueNumber, repoFullName, authorLogin) {
            const r = getRepoDetails(repoFullName);
            const resp = await context.octokit.issues.listComments({
                owner: r.owner, repo: r.repo, issue_number: issueNumber, per_page: 200
            });
            return resp.data.some(c =>
                c.user && c.user.login === authorLogin &&
                /^\/?(merge)\b/i.test((c.body || '').trim())
            );
        }

        // If explicit reject/cancel, mark rejected and notify both sides
        if (command === 'reject' || command === 'cancel') {
            await Promise.all([
                setMergeState(pairToken.origNum, pairToken.origRepo, 'rejected'),
                setMergeState(pairToken.newNum, pairToken.newRepo, 'rejected')
            ]).catch(() => { });

            await Promise.all([
                context.octokit.issues.addLabels({ owner: origDetails.owner, repo: origDetails.repo, issue_number: pairToken.origNum, labels: ['merge-rejected'] }).catch(() => { }),
                context.octokit.issues.addLabels({ owner: newDetails.owner, repo: newDetails.repo, issue_number: pairToken.newNum, labels: ['merge-rejected'] }).catch(() => { })
            ]);

            // Comment on both confirming rejection
            const rejectComment = `⛔ **Merge Rejected**\n\nUser @${commenter} has rejected the merge proposal. The duplicate detection process for this pair has been cancelled.`;
            await Promise.all([
                context.octokit.issues.createComment({ owner: origDetails.owner, repo: origDetails.repo, issue_number: pairToken.origNum, body: rejectComment }),
                context.octokit.issues.createComment({ owner: newDetails.owner, repo: newDetails.repo, issue_number: pairToken.newNum, body: rejectComment })
            ]);

            return;
        }

        // For approve commands: check both confirmations
        const [origConfirmed, newConfirmed] = await Promise.all([
            authorConfirmed(pairToken.origNum, pairToken.origRepo, origAuthor),
            authorConfirmed(pairToken.newNum, pairToken.newRepo, newAuthor)
        ]);

        // If one confirmed and the other not, notify the user we are waiting
        if ((isOrig && !newConfirmed) || (isNew && !origConfirmed)) {
            console.log('ℹ️ One author confirmed; waiting for the other author to confirm.');

            // Post "Waiting" comment on THIS issue
            await context.octokit.issues.createComment({
                owner: currentOwner,
                repo: currentRepoName,
                issue_number: currentIssueNumber,
                body: `⏳ **Confirmation Received**: You have voted to merge.\n\nWaiting for the other issue author to confirm by commenting \`/merge\` on their issue.`
            });

            // Notify the OTHER issue
            const otherRepo = isOrig ? newDetails : origDetails;
            const otherNum = isOrig ? pairToken.newNum : pairToken.origNum;
            const linkToCurrent = `${currentOwner}/${currentRepoName}#${currentIssueNumber}`;

            await context.octokit.issues.createComment({
                owner: otherRepo.owner,
                repo: otherRepo.repo,
                issue_number: otherNum,
                body: `🔔 The author of ${linkToCurrent} has proposed a merge.\n\nPlease comment \`/merge\` on this issue to accept and trigger the merge or \`/reject\` to reject the merge.`
            });

            return;
        }

        // If both confirmed -> Execute Gemini AI Merge
        if (origConfirmed && newConfirmed) {
            console.log(`✅ Both authors confirmed. Merging ${pairToken.newRepo}#${pairToken.newNum} and ${pairToken.origRepo}#${pairToken.origNum}`);

            if (!process.env.GEMINI_API_KEY) {
                console.error('❌ GEMINI_API_KEY is missing!');
                await context.octokit.issues.createComment({
                    owner: origDetails.owner, repo: origDetails.repo,
                    issue_number: pairToken.origNum,
                    body: '❌ **Error**: Gemini API Key is missing. Cannot perform AI merge.'
                });
                return;
            }

            try {
                const issueA = issueAResp.data;
                const issueB = issueBResp.data;

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

                let mergedData = null;

                // 1. Try to find pre-generated preview in the CURRENT thread's comments
                // logic: Looking for "ECHOFINDER_PAIR:..." which we found earlier in 'c' loop, but we need the JSON
                const tokenString = `ECHOFINDER_PAIR:orig=${pairToken.origRepo}#${pairToken.origNum};new=${pairToken.newRepo}#${pairToken.newNum}`;

                for (const c of commentsResp.data) {
                    if (c.body && c.body.includes(tokenString)) {
                        const match = c.body.match(/ECHOFINDER_PREVIEW_JSON:([A-Za-z0-9+/=]+)/);
                        if (match) {
                            try {
                                const jsonStr = Buffer.from(match[1], 'base64').toString('utf-8');
                                mergedData = JSON.parse(jsonStr);
                                console.log('✅ Reuse: Found pre-generated merge preview in comment.');
                            } catch (e) {
                                console.warn('⚠️ Found preview JSON but failed to parse:', e.message);
                            }
                        }
                        break;
                    }
                }

                if (!mergedData) {
                    console.log('Generate: No preview found, calling Gemini...');
                    if (process.env.GEMINI_API_KEY) {
                        const { GoogleGenerativeAI } = await import("@google/generative-ai");
                        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

                        // Fallback strategy helper
                        async function generateWithFallback(prompt) {
                            const models = [
                                process.env.GEMINI_MODEL || "gemini-2.5-flash",
                                "gemini-2.0-flash" // fallback
                            ];

                            for (const m of models) {
                                try {
                                    console.log(`🤖 Executing merge with model: ${m}...`);
                                    const model = genAI.getGenerativeModel({ model: m });
                                    const result = await model.generateContent(prompt);
                                    return result.response.text();
                                } catch (e) {
                                    console.warn(`⚠️ Model ${m} failed: ${e.message}`);
                                    if (e.message.includes('503') || e.message.includes('overloaded')) {
                                        continue; // try next model
                                    }
                                    throw e; // other errors are fatal
                                }
                            }
                            throw new Error('All models failed to generate content.');
                        }

                        console.log('🤖 Sending merge request to Gemini...');
                        const responseText = await generateWithFallback(prompt);

                        // Clean up potential markdown formatting in response
                        const jsonStr = responseText.replace(/^```json/, '').replace(/```$/, '').trim();
                        mergedData = JSON.parse(jsonStr);
                    } else {
                        throw new Error("Missing GEMINI_API_KEY");
                    }
                }

                // 4. Create the NEW Merged Issue
                // MERGE TARGET: We create the merged issue in the ORIGINAL repository (origDetails)
                const createdIssue = await context.octokit.issues.create({
                    owner: origDetails.owner,
                    repo: origDetails.repo,
                    title: `[MERGED] ${mergedData.title}`,
                    body: `${mergedData.body}\n\n---\n*This issue was automatically synthesized by EchoFinder AI from ${pairToken.origRepo}#${issueA.number} and ${pairToken.newRepo}#${issueB.number}.*`,
                    labels: ['merged', 'substantiated']
                });

                console.log(`✨ Created NEW Merged Issue #${createdIssue.data.number} in ${origDetails.owner}/${origDetails.repo}`);

                // 5. Update DB State
                await Promise.all([
                    setMergeState(pairToken.origNum, pairToken.origRepo, 'merged'),
                    setMergeState(pairToken.newNum, pairToken.newRepo, 'merged')
                ]).catch(e => console.error('Error updating DB merge state:', e));


                // 6. Close OLD Issues and Link
                const closeComment = `✅ **Merged into ${origDetails.owner}/${origDetails.repo}#${createdIssue.data.number}**\n\n` +
                    `This issue has been closed. A new, comprehensive issue has been created by merging this with another duplicate.\n` +
                    `👉 **Go to ${origDetails.owner}/${origDetails.repo}#${createdIssue.data.number}** for the consolidated discussion.`;

                await Promise.all([
                    // Close Original
                    context.octokit.issues.update({
                        owner: origDetails.owner, repo: origDetails.repo,
                        issue_number: pairToken.origNum,
                        state: 'closed', state_reason: 'not_planned'
                    }),
                    // Close New
                    context.octokit.issues.update({
                        owner: newDetails.owner, repo: newDetails.repo,
                        issue_number: pairToken.newNum,
                        state: 'closed', state_reason: 'not_planned'
                    }),
                    // Comment Original
                    context.octokit.issues.createComment({
                        owner: origDetails.owner, repo: origDetails.repo,
                        issue_number: pairToken.origNum, body: closeComment
                    }),
                    // Comment New
                    context.octokit.issues.createComment({
                        owner: newDetails.owner, repo: newDetails.repo,
                        issue_number: pairToken.newNum, body: closeComment
                    })
                ]);

                console.log('✅ Closed old issues and posted links.');

            } catch (error) {
                console.error('❌ Error during Gemini Merge:', error);
                await context.octokit.issues.createComment({
                    owner: origDetails.owner, repo: origDetails.repo,
                    issue_number: pairToken.origNum,
                    body: `❌ **Merge Failed**: An error occurred while processing the AI merge. Check logs.`
                });
            }
        }

    } catch (err) {
        console.error('❌ Error in merge handler:', err.message || err);
    }
}
