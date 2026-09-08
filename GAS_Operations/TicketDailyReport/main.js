const webhookUrl = 'https://chat.googleapis.com/v1/spaces/AAQAdqYt1ro/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=FAP-OGDvupbed1cL0xFWP9Bq6aXqOxlJvBhH4vfF-b4'; // Ticket T2 Chatroom 
// const webhookUrl = 'https://chat.googleapis.com/v1/spaces/AAQAc9NQmJQ/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=b4zApCmKNq1pPBDmemgVv1Y8xoXm4h_w_eKccjtqCiI'; //Private Chatroom (for testing)

// https://hcti.io/v1/image  --> API Pic uploading site (Check Available Tokens Left)

/**
 * Daily Zendesk report.
 *
 * Every step runs through runResumableJob_() (see retryRunner.js):
 *   - a step that throws (e.g. the intermittent "Address unavailable" from the
 *     Zendesk API) is retried up to 3x with backoff inside this execution;
 *   - if the execution still dies, the steps that already finished are recorded
 *     for TODAY, so the next run resumes at the step that crashed instead of
 *     redoing everything (no re-posting to Chat, no double graph row);
 *   - appendZendeskDailyStatus() additionally refuses to add a second
 *     'All_Graph' row for the same calendar day, so a resumed / re-run job can
 *     never double-count.
 * After retries are exhausted a catch-up run is auto-scheduled a few minutes
 * later (up to 3 per day) - see ENABLE_AUTO_RESCHEDULE in retryRunner.js.
 */
function runZendeskDailyJob() {
  runResumableJob_([
    { name: 'fetchZendeskViewToSheet',    fn: fetchZendeskViewToSheet },    // Step 1   -> 'Zendesk_Daily'
    { name: 'fetchZendeskViewToKsheet_A', fn: fetchZendeskViewToKsheet },   // Step 1.5 -> 'K_시트' B5:Gn table
    { name: 'appendZendeskDailyStatus',   fn: appendZendeskDailyStatus },   // Step 2   -> 'All_Graph' (1 row/day, idempotent) + clear 'Zendesk_Daily'
    { name: 'all_GraphChartToGoogleChat', fn: all_GraphChartToGoogleChat }, // Step 3   -> chart image to Google Chat
    { name: 'collapseOldRowsIfNeeded',    fn: collapseOldRowsIfNeeded, critical: false }, // Step 3.5 -> collapse rows past 4 weeks (cosmetic, never fails the job)
    { name: 'fetchZendeskViewToKsheet_B', fn: fetchZendeskViewToKsheet },   // Step 4   -> rebuild 'K_시트' table for 'P_시트'
    { name: 'kSheetToChat',               fn: kSheetToChat },               // Step 5   -> 'K_시트' image to Google Chat
  ]);
}

/** Manual helper: forget today's saved progress + catch-up triggers, run fresh. */
function runZendeskDailyJob_forceFresh() {
  clearProgress_();
  cleanupCatchupTriggers_();
  runZendeskDailyJob();
}
