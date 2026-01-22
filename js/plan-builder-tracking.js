/**
 * Plan Builder Step Tracking
 *
 * Tracks step progression without altering wizard logic.
 * Does NOT capture plan content or personal data.
 *
 * Captures:
 * - Session ID (anonymous UUID)
 * - Steps visited (by name, not content)
 * - Max step reached
 * - Completion status
 * - Entry referrer
 */

(function() {
  'use strict';

  const SUPABASE_URL = 'https://dwncravjhkbclbuzijra.supabase.co';
  const SESSION_KEY = 'clearly_pb_session';

  // Generate anonymous session ID
  function generateSessionId() {
    return 'pb_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // Get or create session
  function getSession() {
    let session = sessionStorage.getItem(SESSION_KEY);
    if (session) {
      return JSON.parse(session);
    }

    session = {
      id: generateSessionId(),
      started_at: new Date().toISOString(),
      referrer: document.referrer || null,
      entry_url: window.location.href,
      steps_visited: [],
      max_step_index: 0,
      max_step_name: 'welcome',
      completed: false,
      sent: false
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  // Update session
  function updateSession(updates) {
    const session = getSession();
    Object.assign(session, updates);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  // Track step change (called when screen changes)
  function trackStep(stepName, stepIndex) {
    const session = getSession();

    // Add to visited steps if not already there
    if (!session.steps_visited.includes(stepName)) {
      session.steps_visited.push(stepName);
    }

    // Update max step if this is further
    if (stepIndex > session.max_step_index) {
      session.max_step_index = stepIndex;
      session.max_step_name = stepName;
    }

    // Check for completion
    if (stepName === 'complete') {
      session.completed = true;
    }

    updateSession(session);
  }

  // Send session data to Supabase
  async function sendSessionData(isFinal = false) {
    const session = getSession();

    // Don't send if already sent or no steps tracked
    if (session.sent || session.steps_visited.length === 0) {
      return;
    }

    const data = {
      session_id: session.id,
      started_at: session.started_at,
      ended_at: new Date().toISOString(),
      referrer: session.referrer,
      steps_visited: session.steps_visited,
      max_step_index: session.max_step_index,
      max_step_name: session.max_step_name,
      completed: session.completed,
      abandoned: isFinal && !session.completed
    };

    try {
      // Use sendBeacon for reliability on page unload
      if (isFinal && navigator.sendBeacon) {
        navigator.sendBeacon(
          `${SUPABASE_URL}/functions/v1/plan-builder-session`,
          JSON.stringify(data)
        );
        updateSession({ sent: true });
      } else {
        await fetch(`${SUPABASE_URL}/functions/v1/plan-builder-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        updateSession({ sent: true });
      }
    } catch (error) {
      // Silent fail - tracking should never break the app
      console.debug('Session tracking error:', error);
    }
  }

  // Hook into the existing wizard
  function initTracking() {
    // Initialize session
    getSession();

    // Monitor for step changes by watching the step counter
    const stepCounter = document.getElementById('stepCounter');
    if (!stepCounter) return;

    // Get screens array from global scope (defined in plan-builder)
    const screens = window.screens || [
      'welcome', 'children', 'schedule', 'configure',
      'holidays', 'summer', 'review', 'email', 'complete'
    ];

    // Track initial step
    trackStep('welcome', 0);

    // Create a MutationObserver to watch step changes
    const observer = new MutationObserver(() => {
      const text = stepCounter.textContent;
      const match = text.match(/Step (\d+)/);
      if (match) {
        const stepIndex = parseInt(match[1], 10) - 1;
        const stepName = screens[stepIndex] || `step_${stepIndex}`;
        trackStep(stepName, stepIndex);
      }
    });

    observer.observe(stepCounter, {
      childList: true,
      characterData: true,
      subtree: true
    });

    // Also hook into complete screen visibility
    const completeScreen = document.getElementById('screen-complete');
    if (completeScreen) {
      const completeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.target.classList.contains('active')) {
            trackStep('complete', screens.indexOf('complete'));
            // Send immediately on completion
            sendSessionData(true);
          }
        });
      });
      completeObserver.observe(completeScreen, { attributes: true, attributeFilter: ['class'] });
    }

    // Send data on page unload
    window.addEventListener('beforeunload', () => {
      sendSessionData(true);
    });

    // Also send on visibility change (mobile tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        sendSessionData(true);
      }
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTracking);
  } else {
    initTracking();
  }
})();
