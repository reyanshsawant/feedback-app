import { D1Database, Ai } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  AI: Ai;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // --- FEATURE 1: HANDLE NEW FEEDBACK (POST) ---
    if (request.method === 'POST') {
      const formData = await request.formData();
      const text = formData.get('feedback') as string;

      if (text) {
        try {
          // 1. Run AI - We ask for a specific format with a pipe "|" separator
          const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
              { role: 'system', content: 'Analyze the sentiment of the user text. Reply with ONLY "Positive", "Negative", or "Neutral", followed by a pipe character "|", followed by a 5-word summary. Example: "Positive | User loved the login flow"' },
              { role: 'user', content: text }
            ]
          });

          // 2. Parse the response safely
          // The AI response comes in a property called 'response'
          const rawText = (aiResponse as any).response || "";
          
          // Split by the pipe character "|"
          const parts = rawText.split('|');
          
          // Fallbacks in case AI formats it weirdly
          const sentiment = parts[0] ? parts[0].trim() : "Neutral"; 
          const summary = parts[1] ? parts[1].trim() : rawText; 

          // 3. Save to Database
          await env.DB.prepare(
            "INSERT INTO feedback (customer_text, sentiment, summary) VALUES (?, ?, ?)"
          ).bind(text, sentiment, summary).run();

        } catch (err) {
          // If anything fails, save it as an error so the app doesn't crash (1101)
          await env.DB.prepare(
            "INSERT INTO feedback (customer_text, sentiment, summary) VALUES (?, ?, ?)"
          ).bind(text, "Error", "AI analysis failed").run();
        }
      }

      // Refresh the page
      return Response.redirect(url.toString(), 303);
    }

    // --- FEATURE 2: FETCH & VISUALIZE (GET) ---
    // Get all past feedback from the database
    const { results } = await env.DB.prepare("SELECT * FROM feedback ORDER BY id DESC").all();

    // Calculate stats for the chart
    const positive = results.filter((r: any) => (r.sentiment || '').includes('Positive')).length;
    const negative = results.filter((r: any) => (r.sentiment || '').includes('Negative')).length;
    const neutral = results.filter((r: any) => (r.sentiment || '').includes('Neutral')).length;

    // Serve the Dashboard HTML
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Feedback Intelligence</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        
        header { text-align: center; margin-bottom: 40px; }
        h1 { font-size: 2.5rem; color: #f6821f; margin-bottom: 10px; }
        p.subtitle { color: #64748b; font-size: 1.1rem; }

        .grid { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }

        .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; }
        h2 { margin-top: 0; font-size: 1.25rem; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px; margin-bottom: 20px; color: #334155; }

        textarea { width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; margin-bottom: 15px; font-family: inherit; resize: vertical; min-height: 100px; box-sizing: border-box; transition: border-color 0.2s; }
        textarea:focus { border-color: #f6821f; outline: none; }
        
        button { background: #f6821f; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%; transition: background 0.2s; box-shadow: 0 2px 4px rgba(246, 130, 31, 0.3); }
        button:hover { background: #ea580c; }

        .table-container { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { text-align: left; padding: 12px; background: #f8fafc; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
        td { padding: 16px 12px; border-bottom: 1px solid #e2e8f0; }
        tr:last-child td { border-bottom: none; }
        
        .badge { padding: 4px 10px; border-radius: 99px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; display: inline-block; }
        .bg-Positive { background: #dcfce7; color: #166534; }
        .bg-Negative { background: #fee2e2; color: #991b1b; }
        .bg-Neutral { background: #f1f5f9; color: #475569; }
        .bg-Error { background: #fee2e2; color: #991b1b; }
        
        .summary { font-style: italic; color: #475569; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>🚀 Vibe-Coded Feedback Center</h1>
          <p class="subtitle">Real-time AI Analysis powered by Llama-3 & Cloudflare D1</p>
        </header>

        <div class="grid">
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div class="card">
              <h2>💬 Simulate User</h2>
              <form method="POST">
                <textarea name="feedback" placeholder="Type a fake review here (e.g. 'The app is too slow')..." required></textarea>
                <button type="submit">Analyze with AI ✨</button>
              </form>
            </div>

            <div class="card">
              <h2>📊 Sentiment Ratio</h2>
              <canvas id="sentimentChart"></canvas>
            </div>
          </div>

          <div class="card">
            <h2>📝 Recent Analysis</h2>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th width="45%">Feedback</th>
                    <th>Sentiment</th>
                    <th>AI Summary</th>
                  </tr>
                </thead>
                <tbody>
                  ${results.map((row: any) => {
                    // Cleaner sentiment matching for the badge class
                    let badgeClass = 'bg-Neutral';
                    const sent = row.sentiment || '';
                    if (sent.includes('Positive')) badgeClass = 'bg-Positive';
                    if (sent.includes('Negative')) badgeClass = 'bg-Negative';
                    if (sent.includes('Error')) badgeClass = 'bg-Error';

                    return `
                    <tr>
                      <td>${row.customer_text}</td>
                      <td><span class="badge ${badgeClass}">${row.sentiment || 'Pending'}</span></td>
                      <td class="summary">"${row.summary || '...'}"</td>
                    </tr>
                  `}).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <script>
        const ctx = document.getElementById('sentimentChart');
        new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['Positive', 'Negative', 'Neutral'],
            datasets: [{
              data: [${positive}, ${negative}, ${neutral}],
              backgroundColor: ['#22c55e', '#ef4444', '#94a3b8'],
              borderWidth: 0,
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } } },
            cutout: '70%'
          }
        });
      </script>
    </body>
    </html>
    `;

    return new Response(html, {
      headers: { 'content-type': 'text/html' },
    });
  },
};