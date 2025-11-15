import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { prompt, tasks } = await req.json();
    const key = process.env.OPENAI_API_KEY;

    const system = `You are a concise, proactive daily routine assistant. 
- You analyze tasks with due times and recurrence.
- You propose a compact plan with prioritized steps.
- You gently but firmly remind the user about overdue tasks.
- You avoid long paragraphs. Use short bullet points.
- If the user gives a vague request, produce a clear next action.`;

    if (key) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Tasks JSON: ${JSON.stringify(tasks)}\nUser: ${prompt}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const reply = data.choices?.[0]?.message?.content ?? 'Done.';
      return NextResponse.json({ reply });
    }

    // Fallback simple heuristic
    const overdue = (tasks || []).filter((t: any) => !t.completed && t.dueAt && new Date(t.dueAt).getTime() <= Date.now());
    const reply = [
      overdue.length ? `Overdue (${overdue.length}): ${overdue.map((t: any) => t.title).slice(0, 3).join(', ')}` : undefined,
      prompt ? `Next: ${prompt.split(/[,.;]/)[0].trim()}` : undefined,
      'Action: pick one task and start a 25m focus block.'
    ].filter(Boolean).join('\n- ');

    return NextResponse.json({ reply: reply ? `- ${reply}` : 'Stay focused. What is the next single action?' });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
  }
}
