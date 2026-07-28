// ------------Tester ------------//
function triggerTester() {
  // Delete existing triggers for MCFReporter to avoid duplicates (optional)
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'MCFReporter') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Get current time and add 1 minute
  var now = new Date();
  var oneMinuteLater = new Date(now.getTime() + 60 * 1000); // add 60,000 ms

  // Create the time-based trigger for MCFReporter
  ScriptApp.newTrigger('MCFReporter')
    .timeBased()
    .at(oneMinuteLater)
    .create();

  Logger.log("Trigger set for: " + oneMinuteLater);
}


// ------------ Hourly 429 Retry Trigger (col R backfill) ----------------------------------------//
// Run once from the Apps Script editor to activate. Safe to re-run — removes any existing
// trigger for retryR429Errors first, so it never duplicates.
function installHourlyRetry429Trigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'retryR429Errors') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('retryR429Errors')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Hourly trigger installed for retryR429Errors().');
}
