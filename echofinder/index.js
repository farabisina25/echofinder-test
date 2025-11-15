import axios from 'axios';

const EMBEDDING_SERVER = process.env.EMBEDDING_SERVER || 'http://localhost:8001';
const SIMILARITY_THRESHOLD = 0.70;

async function compareIssues(newText, oldTexts) {
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

export default (app) => {
  console.log('🤖 EchoFinder Bot initialized');

  app.on('issues.opened', async (context) => {
    const issue = context.payload.issue;
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📋 NEW ISSUE DETECTED`);
    console.log(`Repository: ${owner}/${repo}`);
    console.log(`Issue #${issue.number}: ${issue.title}`);
    console.log(`${'='.repeat(50)}\n`);

    try {
      // Get all open issues
      console.log('📡 Fetching all open issues from repository...');
      const issuesResponse = await context.octokit.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: 100
      });

      const openIssues = issuesResponse.data.filter(
        i => i.number !== issue.number && !i.pull_request
      );

      console.log(`✓ Found ${openIssues.length} other open issues`);

      if (openIssues.length === 0) {
        console.log('ℹ️ No other open issues to compare. Skipping...');
        return;
      }

      // Prepare texts
      const newText = `${issue.title}\n${issue.body || ''}`;
      const oldTexts = openIssues.map(i => `${i.title}\n${i.body || ''}`);

      console.log(`\n🔍 Starting similarity comparison...`);
      console.log(`New issue text length: ${newText.length} chars`);
      console.log(`Comparing against ${oldTexts.length} issues\n`);

      // Get similarity scores
      const result = await compareIssues(newText, oldTexts);

      if (result.error) {
        console.error('❌ Error from embedding service:', result.error);
        return;
      }

      const bestScore = result.best_score;
      const bestMatchIndex = result.best_match_index;
      const bestMatchIssue = openIssues[bestMatchIndex];

      console.log(`\n🎯 RESULTS:`);
      console.log(`Best match: Issue #${bestMatchIssue.number}`);
      console.log(`Title: "${bestMatchIssue.title}"`);
      console.log(`Score: ${(bestScore * 100).toFixed(1)}%`);
      console.log(`Threshold: ${(SIMILARITY_THRESHOLD * 100).toFixed(1)}%`);

      // ...existing code...
        // ...existing code...
        if (bestScore > SIMILARITY_THRESHOLD) {
          console.log(`\n✅ SCORE ABOVE THRESHOLD - Posting comment...\n`);

          // create a hidden pairing token so comment events can find the linked issues
          const pairToken = `<!-- ECHOFINDER_PAIR:orig=${bestMatchIssue.number};new=${issue.number} -->`;

          const newIssueComment = `🔍 **Potential Duplicate Found**\n\n` +
            `This issue is very similar to **#${bestMatchIssue.number}**: "${bestMatchIssue.title}"\n\n` +
            `📊 **Similarity Score:** ${(bestScore * 100).toFixed(1)}%\n\n` +
            `Please review if this is a duplicate. If confirmed, you can close this issue.\n\n` +
            `To mock-merge these two issues, BOTH issue authors must comment on *their own issue* with one of the commands: \`/merge\` (accept) or \`/reject\` (decline). Once both confirmations are present the bot will post a mock-merge notification.` +
            `\n\n` + pairToken;

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
            issue_number: bestMatchIssue.number,
            body: originalIssueNotice
          });

          console.log('✅ Comments posted to both issues');

          // Add label to NEW issue (the one just created)
          try {
            await context.octokit.issues.addLabels({
              owner,
              repo,
              issue_number: issue.number,
              labels: ['duplicate?']
            });
            console.log('🏷️ Label "duplicate?" added to new issue #' + issue.number);
          } catch (labelError) {
            console.log('ℹ️ Could not add label to new issue (label may not exist in repo)');
          }

          // Add label to ORIGINAL issue (the most similar one)
          try {
            await context.octokit.issues.addLabels({
              owner,
              repo,
              issue_number: bestMatchIssue.number,
              labels: ['has-duplicates']
            });
            console.log('🏷️ Label "has-duplicates" added to original issue #' + bestMatchIssue.number);
          } catch (labelError) {
            console.log('ℹ️ Could not add label to original issue (label may not exist in repo)');
          }          

        } else {
          console.log(`\n⏭️ Score below threshold (${(bestScore * 100).toFixed(1)}% < ${(SIMILARITY_THRESHOLD * 100).toFixed(1)}%)`);
          console.log('No comment posted.');
        }
// ...existing code...
      console.log(`\n${'='.repeat(50)}\n`);

    } catch (error) {
      console.error('❌ ERROR processing issue:', error.message);
      console.error(error);
    }
    
  });
// ...existing code...
  app.on('issue_comment.created', async (context) => {
    try {
      const raw = (context.payload.comment.body || '').trim();
      const commentBody = raw.toLowerCase();
      const cmdMatch = commentBody.match(/^\/?(merge|accept|reject|cancel)\b/i);
      if (!cmdMatch) return; // require explicit command (/merge, /accept, /reject, /cancel)

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
        const rejectNote = `🚫 merge cancelled: @${commenter} declined merging these issues by commenting "/${command}".\n\n` +
          `If you want to reopen merging later, comment "/merge" on your issue.`;
        await Promise.all([
          context.octokit.issues.createComment({ owner, repo, issue_number: pairToken.orig, body: rejectNote }),
          context.octokit.issues.createComment({ owner, repo, issue_number: pairToken.new, body: rejectNote }),
          context.octokit.issues.addLabels({ owner, repo, issue_number: pairToken.orig, labels: ['merge-rejected'] }).catch(()=>{}),
          context.octokit.issues.addLabels({ owner, repo, issue_number: pairToken.new, labels: ['merge-rejected'] }).catch(()=>{})
        ]);
        return;
      }

      // For approve commands: check both confirmations
      const [origConfirmed, newConfirmed] = await Promise.all([
        authorConfirmed(pairToken.orig, origAuthor),
        authorConfirmed(pairToken.new, newAuthor)
      ]);

      // If one confirmed and the other not, remind the other author
      if ((pairToken.orig === currentIssueNumber && !newConfirmed) || (pairToken.new === currentIssueNumber && !origConfirmed)) {
        const otherAuthor = (pairToken.orig === currentIssueNumber) ? newAuthor : origAuthor;
        const remindNote = `🔔 @${otherAuthor}, @${commenter} confirmed by commenting "/merge". Please confirm on your own issue by commenting "/merge" or "/reject" to complete the merge.`;
        await context.octokit.issues.createComment({ owner, repo, issue_number: otherIssueNumber, body: remindNote });
        return;
      }

      // If both confirmed -> perform mock-merge steps
      if (origConfirmed && newConfirmed) {
        const mergedNote = `✅ merge completed: Both issue authors confirmed with "/merge" or "/reject".\n\n`;
        await Promise.all([
          context.octokit.issues.createComment({ owner, repo, issue_number: pairToken.orig, body: mergedNote }),
          context.octokit.issues.createComment({ owner, repo, issue_number: pairToken.new, body: mergedNote }),
          context.octokit.issues.addLabels({ owner, repo, issue_number: pairToken.orig, labels: ['merged'] }).catch(()=>{}),
          context.octokit.issues.addLabels({ owner, repo, issue_number: pairToken.new, labels: ['merged'] }).catch(()=>{})
        ]);
      }

    } catch (err) {
      console.error('❌ Error in merge handler:', err.message || err);
    }
  });
// ...existing code...

};