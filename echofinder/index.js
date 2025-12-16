import { handleIssueOpened } from './handlers/handleIssueOpened.js';
import { handleIssueComment } from './handlers/handleIssueComment.js';
import { syncIssues } from "./services/sync.js";

export default (app) => {
  app.log.info("🤖 EchoFinder Bot initialized");

  // Sync issues on startup
  syncIssues(app);

  // Log all events (diagnostic)
  app.webhooks.onAny(async (event) => {
    console.log(`📨 Webhook received: ${event.name}.${event.payload.action || 'default'}`);
  });

  app.on('issues.opened', handleIssueOpened);
  app.on('issue_comment.created', handleIssueComment);
};