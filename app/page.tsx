"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

type Recurrence = 'once' | 'daily' | 'weekly';

type Task = {
  id: string;
  title: string;
  dueAt?: string; // ISO string
  recurrence: Recurrence;
  completed: boolean;
  lastRemindedAt?: string;
};

function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}

function requestPermissions() {
  if (typeof window === 'undefined') return;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}

function speak(text: string) {
  if (typeof window === 'undefined') return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.02;
    window.speechSynthesis.speak(utter);
  } catch {}
}

function notify(title: string, body?: string) {
  if (typeof window === 'undefined') return;
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {}
}

export default function Home() {
  const [tasks, setTasks] = useLocalStorage<Task[]>('agentic.tasks', []);
  const [input, setInput] = useState('');
  const [dueAt, setDueAt] = useState<string>('');
  const [recurrence, setRecurrence] = useState<Recurrence>('once');
  const [chat, setChat] = useLocalStorage<{ role: 'user' | 'assistant'; content: string; ts: number }[]>(
    'agentic.chat',
    []
  );
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    requestPermissions();
    registerServiceWorker();
  }, []);

  useEffect(() => {
    // schedule repeating reminders via SW
    navigator.serviceWorker?.ready.then((reg) => {
      tasks.forEach((t) => {
        if (t.completed) return;
        const nextDueMs = nextDueTimestamp(t) - Date.now();
        const intervalMs = Math.max(60_000, isFinite(nextDueMs) ? nextDueMs : 300_000);
        reg.active?.postMessage({
          type: 'SCHEDULE_REMINDER',
          payload: { id: t.id, title: t.title, intervalMs },
        });
      });
    });
  }, [tasks]);

  function addTask() {
    if (!input.trim()) return;
    const id = uuidv4();
    const newTask: Task = {
      id,
      title: input.trim(),
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      recurrence,
      completed: false,
    };
    setTasks([newTask, ...tasks]);
    setInput('');
    setDueAt('');
    setRecurrence('once');
    speak(`Added task: ${newTask.title}`);
  }

  function toggleTask(id: string) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
    const t = tasks.find((x) => x.id === id);
    if (t && !t.completed) {
      speak(`Great job! Marked ${t.title} as done.`);
      navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage({ type: 'CANCEL_REMINDER', payload: { id } }));
    }
  }

  function snooze(id: string, minutes = 10) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const next = new Date(Date.now() + minutes * 60_000).toISOString();
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, dueAt: next } : x)));
    speak(`Snoozed ${t.title} for ${minutes} minutes.`);
  }

  function nextDueTimestamp(t: Task): number {
    if (!t.dueAt) return Number.POSITIVE_INFINITY;
    const due = new Date(t.dueAt).getTime();
    if (!t.completed) return due;
    if (t.recurrence === 'daily') return due + 24 * 3600_000;
    if (t.recurrence === 'weekly') return due + 7 * 24 * 3600_000;
    return Number.POSITIVE_INFINITY;
  }

  async function askAgent(prompt: string) {
    setChat((c) => [...c, { role: 'user', content: prompt, ts: Date.now() }]);
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tasks }),
      });
      if (!res.ok) throw new Error('Agent error');
      const data = await res.json();
      const reply = data.reply as string;
      setChat((c) => [...c, { role: 'assistant', content: reply, ts: Date.now() }]);
      speak(reply);
    } catch (e) {
      const fallback = "I couldn't reach the AI right now. I'll keep reminding you.";
      setChat((c) => [...c, { role: 'assistant', content: fallback, ts: Date.now() }]);
      speak(fallback);
    }
  }

  function startListening() {
    if (typeof window === 'undefined') return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      setInput(text);
      askAgent(text);
    };
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    setIsListening(true);
    rec.start();
  }

  function stopListening() {
    recognitionRef.current?.stop?.();
    setIsListening(false);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      const overdue = tasks.filter((t) => !t.completed && nextDueTimestamp(t) <= Date.now());
      if (overdue.length) {
        const msg = `You have ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}: ${overdue
          .slice(0, 3)
          .map((t) => t.title)
          .join(', ')}`;
        notify('Reminder', msg);
        speak(msg);
      }
    }, 120_000);
    return () => clearInterval(interval);
  }, [tasks]);

  return (
    <div className="container vstack">
      <div className="header">
        <h1>Agentic Assistant</h1>
        <span className="badge">Minimal ? Voice ? Reminders</span>
      </div>

      <div className="row">
        <section className="card vstack">
          <h2>Tasks</h2>
          <div className="hstack">
            <input className="input" placeholder="Add a task..." value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
          <div className="hstack">
            <input className="input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <select className="select" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <button className="btn" onClick={addTask}>Add</button>
          </div>

          <div className="vstack">
            {tasks.length === 0 && <p className="small">No tasks yet. Add one above.</p>}
            {tasks.map((t) => (
              <div key={t.id} className="card hstack" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="vstack" style={{ flex: 1 }}>
                  <label className="hstack">
                    <input type="checkbox" checked={t.completed} onChange={() => toggleTask(t.id)} />
                    <span style={{ textDecoration: t.completed ? 'line-through' : 'none' }}>{t.title}</span>
                  </label>
                  <span className="small">
                    {t.dueAt ? `Due ${new Date(t.dueAt).toLocaleString()}` : 'No due date'} ? {t.recurrence}
                  </span>
                </div>
                <div className="hstack">
                  <button className="btn secondary" onClick={() => snooze(t.id, 10)}>Snooze 10m</button>
                  <button className="btn secondary" onClick={() => setTasks((prev) => prev.filter((x) => x.id !== t.id))}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card vstack">
          <h2>Assistant</h2>
          <div className="hstack">
            <input
              className="input"
              placeholder="Ask the assistant to plan your day..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') askAgent(input);
              }}
            />
            <button className="btn" onClick={() => askAgent(input)}>Ask</button>
            {!isListening ? (
              <button className="btn secondary" onClick={startListening}>?? Speak</button>
            ) : (
              <button className="btn secondary" onClick={stopListening}>? Stop</button>
            )}
          </div>

          <div className="vstack" style={{ maxHeight: 420, overflow: 'auto' }}>
            {chat.map((m, i) => (
              <div key={i} className="card" style={{ background: m.role === 'assistant' ? 'rgba(91,192,190,0.12)' : 'rgba(255,255,255,0.06)' }}>
                <div className="small" style={{ opacity: 0.8 }}>{new Date(m.ts).toLocaleTimeString()} ? {m.role}</div>
                <div>{m.content}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="small">Tip: Allow notifications and keep this tab open for repeating reminders.</p>
    </div>
  );
}
