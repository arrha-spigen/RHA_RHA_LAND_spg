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

