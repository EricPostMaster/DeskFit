import React, { useState, useEffect, useRef } from 'react';
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
const DEFAULT_REPS = { squats: 10, jumping_jacks: 15, shoulder_presses: 12 };
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
      };
      tasksHistory[dateStr] = Math.floor(Math.random() * 7);
    }
    localStorage.setItem(repsHistoryKey, JSON.stringify(repsHistory));
    localStorage.setItem(tasksHistoryKey, JSON.stringify(tasksHistory));
  }
}

// --- Helper: Heatmap Colors ---
const HEATMAP_COLORS = [
  '#e0e7ef', // 0% (lightest)
  '#b2d6f6', // 1-24%
  '#7fc6ee', // 25-49%
  '#4fa3e3', // 50-74%
  '#2286c3', // 75-99%
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

  // --- Timer countdown logic ---
  useEffect(() => {
    let timerInterval: ReturnType<typeof setInterval> | null = null;
    if (isRunning && !showPrompt) {
      setTimeLeft(timer);
      timerInterval = setInterval(() => {
        setTimeLeft((prev: number) => {
          if (prev <= 1) {
            if (timerInterval) clearInterval(timerInterval);
            setShowPrompt(true);
            setIsRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [isRunning, timer, showPrompt]);

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
      {/* Top Navigation Bar */}
      <nav className="top-nav">
        <div className="nav-title">DeskFit</div>
        <div className="nav-actions">
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
      )}
      {/* Timer Controls */}
      {!showPrompt && (
        <div style={{ marginBottom: 24, display: 'flex', gap: 16, alignItems: 'center' }}>
          <label htmlFor="timer-input" style={{ display: 'block', marginBottom: 4 }}>
            Time until next exercise reminder (seconds):
          </label>
          <TimerControls
            timer={timer}
            setTimer={setTimer}
            isRunning={isRunning}
            onStartPause={() => setIsRunning(!isRunning)}
            autoRestart={autoRestart}
            setAutoRestart={setAutoRestart}
            startLabel="Start Timer"
          />
          <button
            style={{ marginLeft: 8, background: '#2196f3', color: '#fff', fontWeight: 600, padding: '0.7em 1.6em', borderRadius: 8, border: 'none', cursor: 'pointer' }}
            onClick={() => setShowPrompt(true)}
          >
            Exercise Now
          </button>
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
            onCancel={() => {
              setShowPrompt(false);
              setRepsCount(0);
              setTimeLeft(timer);
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
