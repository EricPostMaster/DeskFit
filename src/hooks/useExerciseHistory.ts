import { useState, useEffect } from 'react';
// import { getToday, getWeekday } from '../utils/date';

export function useExerciseHistory(
  repsKey: string,
  tasksKey: string,
  dailyGoal: Record<string, number>,
  days: number = 30
) {
  const [repsHistory, setRepsHistory] = useState<Record<string, Record<string, number>>>({});
  const [tasksHistory, setTasksHistory] = useState<Record<string, number>>({});

  useEffect(() => {
    const reps = localStorage.getItem(repsKey);
    const tasks = localStorage.getItem(tasksKey);
    setRepsHistory(reps ? JSON.parse(reps) : {});
    setTasksHistory(tasks ? JSON.parse(tasks) : {});
  }, [repsKey, tasksKey]);

  // Heatmap data
  const todayDate = new Date();
  const heatmapData: { date: string; percent: number; day: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const weekdayIdx = d.getDay();
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

  return {
    repsHistory,
    setRepsHistory,
    tasksHistory,
    setTasksHistory,
    weeks,
    heatmapData,
  };
}
