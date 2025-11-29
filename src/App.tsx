import React, { useState, useEffect, useRef } from 'react';

// Utility to request notification permission
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then(() => {
      /* noop - caller can check Notification.permission */
    });
  }
}

// Utility to show a notification and focus window on click
function showExerciseNotification() {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notification = new Notification("DeskFit: Time for your exercise!", {
        body: "Click to return to DeskFit and start your exercise.",
        icon: "/nerd_flex.png",
        requireInteraction: true
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (e) {
      // Some browsers may throw when options are unsupported
      try {
        new Notification("DeskFit: Time for your exercise!");
      } catch {}
    }
  }
}

// Play a short alarm via WebAudio (works better than relying solely on notifications)
function playAlarm(durationMs = 350, frequency = 1200) {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }

    // Gentle two-part ding: short high tone then a slightly lower short tone
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.connect(ctx.destination);

    const makeTone = (freq: number, startOffset: number, durMs: number) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, now + startOffset);
      o.connect(gain);
      const s = now + startOffset;
      const e = s + durMs / 1000;
      // soft envelope
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.linearRampToValueAtTime(0.06, s + 0.01);
      gain.gain.linearRampToValueAtTime(0.0001, e - 0.02);
      o.start(s);
      o.stop(e + 0.01);
      return o;
    };

    // First ding: short
    makeTone(frequency, 0, Math.min(220, durationMs));
    // Second ding: lower and softer
    makeTone(Math.max(600, Math.round(frequency * 0.75)), 0.12, Math.min(180, durationMs - 120));

    // Close context shortly after tones finish
    setTimeout(() => {
      try { ctx.close(); } catch {}
    }, durationMs + 300);
  } catch (e) {
    // ignore
  }
}
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import './App.css';
import TimerControls from './components/TimerControls';
import ExercisePrompt from './components/ExercisePrompt';
import HistoryModal from './components/HistoryModal';
import PreferencesModal from './components/PreferencesModal';

// --- Local Storage Keys ---
const LS_KEYS = {
  timer: 'deskfit-default-timer',
  reps: 'deskfit-default-reps',
  goal: 'deskfit-daily-goal',
  repsHistory: 'deskfit-reps-history',
  tasksHistory: 'deskfit-tasks-history',
};

// --- Default Values ---
const DEFAULT_TIMER = 60;
const DEFAULT_REPS = { squats: 10, jumping_jacks: 15, shoulder_presses: 12, lateral_raise: 12, knee_raises: 12, bicep_curls: 12, band_pull_aparts: 12, low_to_high_chest_flies: 12, svend_chest_press: 12 };
const DEFAULT_GOAL = { Mon: 5, Tue: 5, Wed: 5, Thu: 5, Fri: 5, Sat: 2, Sun: 2 };

// --- Helper Functions ---
function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function getWeekday(): keyof typeof DEFAULT_GOAL {
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()] as keyof typeof DEFAULT_GOAL;
}
function loadLS<T>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) as T : fallback;
  } catch {
    return fallback;
  }
}
function saveLS<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Helper: Proper Case ---
function toProperCase(str: string) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
// --- Helper: Populate Sample Data ---
function populateSampleHistory() {
  const repsHistoryKey = LS_KEYS.repsHistory;
  const tasksHistoryKey = LS_KEYS.tasksHistory;
  if (!localStorage.getItem(repsHistoryKey) || !localStorage.getItem(tasksHistoryKey)) {
    const today = new Date();
    const repsHistory: Record<string, Record<string, number>> = {};
    const tasksHistory: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      repsHistory[dateStr] = {
        squats: Math.floor(Math.random() * 30),
        jumping_jacks: Math.floor(Math.random() * 30),
        shoulder_presses: Math.floor(Math.random() * 30),
        lateral_raise: Math.floor(Math.random() * 30),
        knee_raises: Math.floor(Math.random() * 30),
      };
      tasksHistory[dateStr] = Math.floor(Math.random() * 7);
    }
    localStorage.setItem(repsHistoryKey, JSON.stringify(repsHistory));
    localStorage.setItem(tasksHistoryKey, JSON.stringify(tasksHistory));
  }
}

// --- Helper: Heatmap Colors ---
const HEATMAP_COLORS = [
  '#edf7ed', // 0% (lightest)
  '#cfeecd', // 1-24%
  '#a8e2a3', // 25-49%
  '#6fc96a', // 50-74%
  '#38b24a', // 75-99%
  '#1b5e20', // 100%+ (darkest)
];
function getHeatmapColor(percent: number) {
  if (percent >= 100) return HEATMAP_COLORS[5];
  if (percent >= 75) return HEATMAP_COLORS[4];
  if (percent >= 50) return HEATMAP_COLORS[3];
  if (percent >= 25) return HEATMAP_COLORS[2];
  if (percent > 0) return HEATMAP_COLORS[1];
  return HEATMAP_COLORS[0];
}

function App() {
  // Debug: manually trigger notification
  const handleDebugNotification = () => {
    // play sound + notification
    playAlarm();
    showExerciseNotification();
  };

  // Urgent alert fallback when notifications are blocked
  const [urgentAlert, setUrgentAlert] = useState(false);
  const urgentIntervalRef = useRef<number | null>(null);

  const startUrgentAlert = () => {
    setUrgentAlert(true);
    // play immediately and then every 2s
    try { playAlarm(1200, 880); } catch {}
    try { if (navigator && 'vibrate' in navigator) (navigator as any).vibrate?.([200,100,200]); } catch {}
    urgentIntervalRef.current = window.setInterval(() => {
      try { playAlarm(1200, 880); } catch {}
      try { if (navigator && 'vibrate' in navigator) (navigator as any).vibrate?.([200,100,200]); } catch {}
    }, 2000) as unknown as number;
  };

  const stopUrgentAlert = () => {
    setUrgentAlert(false);
    if (urgentIntervalRef.current) {
      clearInterval(urgentIntervalRef.current as number);
      urgentIntervalRef.current = null;
    }
  };

  // Notification permission state for UI
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    (typeof Notification !== 'undefined' && Notification.permission) ? Notification.permission : 'default'
  );
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof Notification !== 'undefined') setNotifPermission(Notification.permission);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRequestPermission = () => {
    if (typeof Notification !== 'undefined') {
      Notification.requestPermission().then(p => setNotifPermission(p));
    }
  };
  // Ask for notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);
  // --- UI for editing daily goal and default reps ---
  const weekday = getWeekday();
  // --- State with localStorage persistence ---
  const [timer, setTimer] = useState<number>(() => loadLS<number>(LS_KEYS.timer, DEFAULT_TIMER));
  const [repsTarget, setRepsTarget] = useState<number>(() => {
    const reps = loadLS<Record<string, number>>(LS_KEYS.reps, DEFAULT_REPS);
    return reps['squats'] || 10;
  });
  const [defaultReps, setDefaultReps] = useState<Record<string, number>>(() => loadLS<Record<string, number>>(LS_KEYS.reps, DEFAULT_REPS));
  const [dailyGoal, setDailyGoal] = useState<Record<string, number>>(() => loadLS<Record<string, number>>(LS_KEYS.goal, DEFAULT_GOAL));
  const [repsHistory, setRepsHistory] = useState<Record<string, Record<string, number>>>(() => loadLS<Record<string, Record<string, number>>>(LS_KEYS.repsHistory, {}));
  const [tasksHistory, setTasksHistory] = useState<Record<string, number>>(() => loadLS<Record<string, number>>(LS_KEYS.tasksHistory, {}));

  // --- Other state ---
  const [timeLeft, setTimeLeft] = useState(timer);
  const [isRunning, setIsRunning] = useState(false);
  const [repsCount, setRepsCount] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState('squats');
  const [showPrefs, setShowPrefs] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const prefsRef = useRef<HTMLDivElement>(null);
  // Shared video ref for webcam so App can stop tracks when prompt closes
  const sharedVideoRef = useRef<HTMLVideoElement>(null);
  // Timer refs for robust background timing
  const timerIntervalRef = useRef<number | null>(null);
  const endTimeRef = useRef<number | null>(null);

  // --- Preferences form state ---
  const [prefsTimer, setPrefsTimer] = useState(timer);
  const [prefsReps, setPrefsReps] = useState({ ...defaultReps });
  const [prefsGoal, setPrefsGoal] = useState({ ...dailyGoal });

  // Open preferences and sync form state
  const openPrefs = () => {
    setPrefsTimer(timer);
    setPrefsReps({ ...defaultReps });
    setPrefsGoal({ ...dailyGoal });
    setShowPrefs(true);
  };
  // Save preferences
  const savePrefs = () => {
    setTimer(prefsTimer);
    setDefaultReps(prefsReps);
    setDailyGoal(prefsGoal);
    setShowPrefs(false);
  };
  // Close modal on background click
  const handleModalBgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === prefsRef.current) setShowPrefs(false);
  };

  // --- Sync timer and repsTarget with localStorage ---
  useEffect(() => { saveLS(LS_KEYS.timer, timer); }, [timer]);
  useEffect(() => {
    setDefaultReps((prev: Record<string, number>) => {
      const updated = { ...prev, [selectedExercise]: repsTarget };
      saveLS(LS_KEYS.reps, updated);
      return updated;
    });
  }, [repsTarget, selectedExercise]);
  useEffect(() => { saveLS(LS_KEYS.goal, dailyGoal); }, [dailyGoal]);
  useEffect(() => {
    populateSampleHistory();
  }, []);

  // --- Ensure backend is set and ready before pose detection ---
  useEffect(() => {
    async function setupBackend() {
      await tf.setBackend('webgl');
      await tf.ready();
      setBackendReady(true);
    }
    setupBackend();
  }, []);

  // --- Timer countdown logic (time-based to survive background throttling) ---
  // We compute remaining seconds from an end timestamp rather than relying on
  // setInterval ticks alone. This keeps the timer accurate if the browser
  // throttles timers when the tab is hidden.
  useEffect(() => {
    // clear any existing interval
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current as number);
      timerIntervalRef.current = null;
    }

    // If timer was started and prompt is not showing, compute an end time and
    // start a short interval to update visible remaining seconds from system time.
    if (isRunning && !showPrompt) {
      // Establish an end time based on current timeLeft (this covers both
      // fresh start and resume).
      endTimeRef.current = Date.now() + timeLeft * 1000;

      const tick = () => {
        if (!endTimeRef.current) return;
        const now = Date.now();
        const remaining = Math.max(0, Math.round((endTimeRef.current - now) / 1000));
        setTimeLeft((prev) => {
          if (remaining <= 0) {
            // complete
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current as number);
              timerIntervalRef.current = null;
            }
            endTimeRef.current = null;
            setShowPrompt(true);
            setIsRunning(false);
            try { playAlarm(); } catch {}
            try { if (navigator && 'vibrate' in navigator) (navigator as any).vibrate?.([200,100,200]); } catch {}
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              showExerciseNotification();
            } else {
              startUrgentAlert();
            }
            return 0;
          }
          return remaining;
        });
      };

      // Run immediately then on short interval. Use 500ms to keep UI responsive
      // but it's safe if the browser throttles the timer since remaining is
      // computed from Date.now().
      tick();
      timerIntervalRef.current = window.setInterval(tick, 500) as unknown as number;
    } else {
      // Not running (paused or prompt). Clear endTime and ensure timeLeft is
      // accurate relative to any previously-set endTime.
      if (endTimeRef.current) {
        const remaining = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000));
        setTimeLeft(remaining);
        endTimeRef.current = null;
      } else if (!isRunning) {
        // If we're not running and there was no endTime, ensure timeLeft matches
        // the configured timer value.
        setTimeLeft(timer);
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current as number);
        timerIntervalRef.current = null;
      }
    };
  }, [isRunning, timer, showPrompt, timeLeft]);

  // Keep timeLeft in sync when the configured timer changes while not running
  useEffect(() => {
    if (!isRunning && !showPrompt) setTimeLeft(timer);
  }, [timer, isRunning, showPrompt]);

  // --- Progress Visual ---
  const today = getToday();
  const percent = Math.min(100, Math.round(100 * (tasksHistory[today] || 0) / (dailyGoal[weekday] || 1)));

  // --- Progress Bar Animation State ---
  const [showProgressBar, setShowProgressBar] = useState(false);
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const [pulse, setPulse] = useState(false);
  const prevPercentRef = useRef(percent);

  // Show progress bar only after exercise is completed (after handleDone)
  useEffect(() => {
    if (showProgressBar && percent !== prevPercentRef.current) {
      // Animate fill
      let start = prevPercentRef.current;
      let end = percent;
      let startTime: number | null = null;
      const duration = 600;
      function animateFill(ts: number) {
        if (!startTime) startTime = ts;
        const elapsed = ts - startTime;
        const progress = Math.min(1, elapsed / duration);
        setAnimatedPercent(Math.round(start + (end - start) * progress));
        if (progress < 1) {
          requestAnimationFrame(animateFill);
        } else {
          setAnimatedPercent(end);
          setPulse(true);
          setTimeout(() => setPulse(false), 700);
        }
      }
      requestAnimationFrame(animateFill);
      prevPercentRef.current = percent;
    } else if (!showProgressBar) {
      setAnimatedPercent(percent);
    }
  }, [percent, showProgressBar]);

  // --- Save reps and tasks history when exercise is completed ---
  const handleDone = () => {
    setShowPrompt(false);
    setRepsCount(0);
    setTimeLeft(timer);
    // stop any urgent alert overlay/alarm
    try { stopUrgentAlert(); } catch {}
    // stop camera tracks if any
    try { stopCamera(); } catch {}
    const today = getToday();
    setRepsHistory((prev: Record<string, Record<string, number>>) => {
      const updated = { ...prev };
      updated[today] = updated[today] || {};
      updated[today][selectedExercise] = (updated[today][selectedExercise] || 0) + repsTarget;
      saveLS(LS_KEYS.repsHistory, updated);
      return updated;
    });
    setTasksHistory((prev: Record<string, number>) => {
      const updated = { ...prev };
      updated[today] = (updated[today] || 0) + 1;
      saveLS(LS_KEYS.tasksHistory, updated);
      return updated;
    });
    setShowProgressBar(true); // Show progress bar after completion
    if (autoRestart) {
      setIsRunning(true);
    }
  };

  // Stop camera helper
  const stopCamera = () => {
    try {
      // stop tracks on the shared video ref if present
      const vid = sharedVideoRef.current;
      if (vid && (vid as HTMLVideoElement).srcObject) {
        const tracks = ((vid as HTMLVideoElement).srcObject as MediaStream).getTracks();
        tracks.forEach(t => { try { t.stop(); } catch {} });
        (vid as HTMLVideoElement).srcObject = null;
      }
      // also defensively stop any other video elements that may have a stream
      const vids = Array.from(document.getElementsByTagName('video')) as HTMLVideoElement[];
      vids.forEach(v => {
        try {
          if (v && v.srcObject) {
            const tracks = (v.srcObject as MediaStream).getTracks();
            tracks.forEach(t => { try { t.stop(); } catch {} });
            v.srcObject = null;
          }
        } catch (e) {}
      });
    } catch (e) {}
  };

  // Reusable cancel / return-to-home handler (same behavior as the Cancel button)
  const handleCancel = () => {
    setShowPrompt(false);
    setRepsCount(0);
    setTimeLeft(timer);
    try { stopCamera(); } catch {}
  };

  // Ensure camera stops when prompt is closed
  useEffect(() => {
    if (!showPrompt) {
      try { stopCamera(); } catch {}
    }
  }, [showPrompt]);

  // Hide progress bar when returning to prompt screen
  useEffect(() => {
    if (showPrompt) setShowProgressBar(false);
  }, [showPrompt]);

  // --- Heatmap Data ---
  const heatmapDays = 30;
  const todayDate = new Date();
  const heatmapData: { date: string; percent: number; day: number }[] = [];
  for (let i = heatmapDays - 1; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const weekdayIdx = d.getDay(); // 0=Sun, 6=Sat
    const weekDayStr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekdayIdx];
    const goal = dailyGoal[weekDayStr] || 1;
    const completed = tasksHistory[dateStr] || 0;
    const percent = Math.min(100, Math.round(100 * completed / goal));
    heatmapData.push({ date: dateStr, percent, day: weekdayIdx });
  }
  // Arrange into columns (weeks)
  const weeks: { date: string; percent: number; day: number }[][] = [];
  let week: typeof heatmapData = [];
  for (let i = 0; i < heatmapData.length; i++) {
    week.push(heatmapData[i]);
    if (week.length === 7 || i === heatmapData.length - 1) {
      weeks.push(week);
      week = [];
    }
  }

  return (
    <div className="app-container">
      {urgentAlert && (
        <div style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 2000}} onClick={stopUrgentAlert}>
          <h1 style={{fontSize: 36, margin: 0}}>Time for your exercise!</h1>
          <p style={{fontSize: 18, marginTop: 12}}>Click anywhere to dismiss and return to DeskFit.</p>
          <button style={{marginTop: 24, padding: '0.8em 1.6em', fontSize: 16}} onClick={stopUrgentAlert}>Dismiss</button>
        </div>
      )}
      {/* ...existing code... */}
      {/* Top Navigation Bar */}
      <nav className="top-nav">
        <div
          className="nav-title"
          role="button"
          tabIndex={0}
          onClick={handleCancel}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCancel(); } }}
          style={{ cursor: 'pointer' }}
        >
          DeskFit
        </div>
        <div className="nav-actions">
          {/* ...existing nav actions... */}
          <button
            aria-label="History"
            className="nav-btn"
            onClick={() => setShowHistory(true)}
          >
            <span role="img" aria-label="history">📊</span>
          </button>
          <button
            aria-label="Preferences"
            className="nav-btn"
            onClick={openPrefs}
          >
            <span role="img" aria-label="gear">⚙️</span>
          </button>
        </div>
      </nav>
      {/* Exercise and Reps Row */}
      {!showPrompt && (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 24, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="exercise-select" style={{ display: 'block', marginBottom: 4 }}>Exercise</label>
              <select
                id="exercise-select"
                value={selectedExercise}
                onChange={e => {
                  setSelectedExercise(e.target.value);
                  setRepsTarget(defaultReps[e.target.value] || 10);
                }}
                style={{ width: '100%', minWidth: 120, padding: 4 }}
              >
                <option value="squats">Squats</option>
                <option value="jumping_jacks">Jumping Jacks</option>
                <option value="shoulder_presses">Shoulder Presses</option>
                <option value="lateral_raise">Lateral Raise</option>
                <option value="knee_raises">Knee Raises</option>
                <option value="bicep_curls">Bicep Curls</option>
                <option value="band_pull_aparts">Band Pull-aparts</option>
                <option value="low_to_high_chest_flies">Low-to-High Chest Flies</option>
                <option value="svend_chest_press">Svend Chest Press</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="reps-input" style={{ display: 'block', marginBottom: 4 }}>Repetitions</label>
              <input
                id="reps-input"
                type="number"
                min={1}
                max={50}
                value={repsTarget}
                onChange={e => {
                  let val = Number(e.target.value);
                  if (val < 1) val = 1;
                  if (val > 50) val = 50;
                  setRepsTarget(val);
                }}
                style={{ width: '100%', minWidth: 60, padding: 4 }}
              />
            </div>
          </div>
          {selectedExercise === 'svend_chest_press' && (
            <div style={{
              background: '#e3f2fd',
              color: '#1976d2',
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '0.9rem',
              marginTop: '8px',
              border: '1px solid #bbdefb',
              marginBottom: '24px',
              textAlign: 'center'
            }}>
              💡 Turn 45-90 degrees left or right to accurately track this exercise
            </div>
          )}
        </>
      )}
      {/* Timer Controls */}
      {!showPrompt && (
        <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', justifyContent: 'center' }}>
            <label htmlFor="timer-input" style={{ margin: 0 }}>
              Time until next exercise reminder (seconds):
            </label>
            <div style={{ minWidth: 160 }}>
              <TimerControls
                timer={timer}
                setTimer={setTimer}
                isRunning={isRunning}
                onStartPause={() => setIsRunning(!isRunning)}
                autoRestart={autoRestart}
                setAutoRestart={setAutoRestart}
                startLabel="Start Timer"
                hideStartButton={true}
                hideAutoRestart={true}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="button-nowrap" onClick={() => setIsRunning(!isRunning)}>{isRunning ? 'Pause Timer' : 'Start Timer'}</button>
            <button className="button-nowrap" style={{ background: '#2196f3', padding: '0.7em 1.2em' }} onClick={() => setShowPrompt(true)}>Exercise Now</button>
          </div>
          <div style={{ marginTop: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Auto-restart timer after exercise
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoRestart}
                  onChange={e => setAutoRestart(e.target.checked)}
                />
                <span className="toggle-slider" />
              </span>
            </label>
          </div>
        </div>
      )}
      {/* History Modal */}
      <HistoryModal
        open={showHistory}
        onClose={() => setShowHistory(false)}
        weeks={weeks}
        dailyGoal={dailyGoal}
        tasksHistory={tasksHistory}
        getHeatmapColor={getHeatmapColor}
        // Add new props for tooltip data
        showTooltip={true}
      />
      {/* Preferences Modal */}
      <PreferencesModal
        open={showPrefs}
        onClose={() => setShowPrefs(false)}
        prefsTimer={prefsTimer}
        setPrefsTimer={setPrefsTimer}
        prefsReps={prefsReps}
        setPrefsReps={setPrefsReps}
        prefsGoal={prefsGoal}
        setPrefsGoal={setPrefsGoal}
        savePrefs={savePrefs}
        toProperCase={toProperCase}
        DEFAULT_REPS={DEFAULT_REPS}
      />
      {/* Exercise prompt and waiting section remain unchanged */}
      {showPrompt ? (
        backendReady ? (
          <ExercisePrompt
            repsTarget={repsTarget}
            repsCount={repsCount}
            setRepsCount={setRepsCount}
            onDone={handleDone}
            exercise={selectedExercise}
            videoRef={sharedVideoRef}
            onCancel={() => {
              setShowPrompt(false);
              setRepsCount(0);
              setTimeLeft(timer);
              try { stopCamera(); } catch {}
            }}
          />
        ) : (
          <div className="waiting-section">
            <p>Loading pose detection model...</p>
          </div>
        )
      ) : (
        <>
          {/* Show progress bar after task completion, above timer */}
          {showProgressBar && (
            <div style={{ margin: '32px auto 24px auto', width: 340, maxWidth: '100%' }}>
              <div style={{ fontSize: 14, marginBottom: 4 }}>Today's Progress</div>
              <div style={{ background: '#eee', borderRadius: 8, height: 22, width: '100%', overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  width: animatedPercent + '%',
                  background: animatedPercent >= 100 ? 'linear-gradient(90deg, #4caf50, #81c784)' : 'linear-gradient(90deg, #2196f3, #90caf9)',
                  height: '100%',
                  transition: 'width 0.6s cubic-bezier(.4,2,.6,1)',
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: animatedPercent < 15 ? 'flex-end' : 'center', color: animatedPercent < 15 ? '#333' : '#fff', fontWeight: 600,
                  animation: pulse ? 'deskfit-pulse 0.7s' : undefined
                }}>{animatedPercent}%</div>
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2, textAlign: 'right' }}>
                {tasksHistory[today] || 0} / {dailyGoal[weekday] || 1} tasks
              </div>
            </div>
          )}
          <div className="waiting-section">
            <p>Next exercise prompt in: <b>{timeLeft}</b> seconds</p>
          </div>
        </>
      )}
      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes deskfit-pulse {
          0% { box-shadow: 0 0 0 0 rgba(76,175,80,0.5); }
          70% { box-shadow: 0 0 0 10px rgba(76,175,80,0); }
          100% { box-shadow: 0 0 0 0 rgba(76,175,80,0); }
        }
      `}</style>
    </div>
  );
}

export default App;
