/****************************************************************************
 * Resilient runner for runZendeskDailyJob()  --  see main.js
 *
 *  - Per-step retry: a step that throws is retried up to MAX_STEP_ATTEMPTS
 *    times with backoff, inside the same execution.
 *  - Resume-from-crash: every step that finishes is recorded (Script
 *    Properties, keyed by KST date). If the execution dies, the next run
 *    skips the finished steps and resumes at the step that crashed.
 *  - Auto catch-up: after retries are exhausted, schedule up to
 *    MAX_RESCHEDULES one-off re-runs a few minutes apart. Set
 *    ENABLE_AUTO_RESCHEDULE = false to disable and rely on the normal daily
 *    trigger / a manual re-run instead.
 *  - The saved progress + appendZendeskDailyStatus()'s same-day guard together
 *    guarantee a resumed / re-run job never posts to Chat twice and never adds
 *    a second 'All_Graph' row for the same day.
 ****************************************************************************/

const MAX_STEP_ATTEMPTS      = 3;
const STEP_BACKOFF_MS        = [0, 5000, 15000];   // wait before attempt 1 / 2 / 3
const ENABLE_AUTO_RESCHEDULE = true;
const MAX_RESCHEDULES        = 3;                  // catch-up runs per KST day
const RESCHEDULE_DELAY_MS    = 5 * 60 * 1000;

const PROGRESS_PROP_PREFIX    = 'dailyJobProgress:';
const CATCHUP_TRIGGER_IDS_KEY = 'dailyJobCatchupTriggerIds';

function jobDateKey_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

function loadProgress_() {
  const props = PropertiesService.getScriptProperties();
  const key = PROGRESS_PROP_PREFIX + jobDateKey_();
  // drop progress rows left over from earlier days
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf(PROGRESS_PROP_PREFIX) === 0 && k !== key) props.deleteProperty(k);
  });
  const raw = props.getProperty(key);
  return raw ? JSON.parse(raw) : { done: [], reschedules: 0 };
}

function saveProgress_(progress) {
  PropertiesService.getScriptProperties()
    .setProperty(PROGRESS_PROP_PREFIX + jobDateKey_(), JSON.stringify(progress));
}

function clearProgress_() {
  PropertiesService.getScriptProperties()
    .deleteProperty(PROGRESS_PROP_PREFIX + jobDateKey_());
}

/**
 * Run an ordered list of { name, fn, critical } steps with per-step retry and
 * cross-execution resume. A non-critical step that keeps failing is logged and
 * skipped; a critical step that keeps failing stops the job (progress is kept
 * so the next run resumes there).
 */
function runResumableJob_(steps) {
  const progress = loadProgress_();
  cleanupCatchupTriggers_();          // clear spent catch-up triggers from earlier today

  let failedStep = null, lastError = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const name = step.name;
    const fn = step.fn;
    const critical = step.critical !== false;

    if (progress.done.indexOf(name) !== -1) {
      Logger.log("skip '" + name + "' - already done today");
      continue;
    }

    let ok = false;
    for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
      const wait = STEP_BACKOFF_MS[Math.min(attempt - 1, STEP_BACKOFF_MS.length - 1)];
      if (wait) Utilities.sleep(wait);
      try {
        Logger.log("run '" + name + "' attempt " + attempt + "/" + MAX_STEP_ATTEMPTS);
        fn();
        ok = true;
        break;
      } catch (e) {
        lastError = e;
        Logger.log("WARN '" + name + "' attempt " + attempt + " failed: " + ((e && e.message) || e));
      }
    }

    if (ok || !critical) {
      if (!ok) {
        Logger.log("WARN non-critical step '" + name + "' gave up after " + MAX_STEP_ATTEMPTS + " attempts - continuing");
      }
      progress.done.push(name);
      saveProgress_(progress);
    } else {
      failedStep = name;
      break;
    }
  }

  if (failedStep) {
    if (ENABLE_AUTO_RESCHEDULE) maybeRescheduleCatchup_(progress);
    throw new Error(
      "runZendeskDailyJob stopped at '" + failedStep + "' after " + MAX_STEP_ATTEMPTS +
      " attempts. Done today: [" + progress.done.join(', ') + "]. Last error: " +
      ((lastError && lastError.message) || lastError)
    );
  }

  clearProgress_();
  cleanupCatchupTriggers_();
  Logger.log("runZendeskDailyJob completed all steps");
}

function maybeRescheduleCatchup_(progress) {
  if ((progress.reschedules || 0) >= MAX_RESCHEDULES) {
    Logger.log("catch-up limit (" + MAX_RESCHEDULES + "/day) reached - not rescheduling");
    return;
  }
  try {
    const t = ScriptApp.newTrigger('runZendeskDailyJob').timeBased()
      .after(RESCHEDULE_DELAY_MS).create();
    progress.reschedules = (progress.reschedules || 0) + 1;
    saveProgress_(progress);

    const props = PropertiesService.getScriptProperties();
    const ids = JSON.parse(props.getProperty(CATCHUP_TRIGGER_IDS_KEY) || '[]');
    ids.push(t.getUniqueId());
    props.setProperty(CATCHUP_TRIGGER_IDS_KEY, JSON.stringify(ids));

    Logger.log("scheduled catch-up run #" + progress.reschedules + " in " + (RESCHEDULE_DELAY_MS / 60000) + " min");
  } catch (e) {
    Logger.log("ERROR could not schedule catch-up run: " + ((e && e.message) || e));
  }
}

/** Delete the one-off catch-up triggers this runner created (tracked by id). */
function cleanupCatchupTriggers_() {
  const props = PropertiesService.getScriptProperties();
  const ids = JSON.parse(props.getProperty(CATCHUP_TRIGGER_IDS_KEY) || '[]');
  if (!ids.length) return;
  const wanted = {};
  ids.forEach(function (id) { wanted[id] = true; });
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (wanted[tr.getUniqueId()]) {
      try { ScriptApp.deleteTrigger(tr); } catch (e) { /* already gone */ }
    }
  });
  props.deleteProperty(CATCHUP_TRIGGER_IDS_KEY);
}
