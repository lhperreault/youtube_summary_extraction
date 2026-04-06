import { useState } from 'react';
import Head from 'next/head';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMd(md) {
  const lines = md.split('\n');
  let html = '';
  let inList = null;
  const closeList = () => { if (inList) { html += `</${inList}>`; inList = null; } };
  const inline = (t) =>
    escapeHtml(t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (let line of lines) {
    const t = line.trim();
    if (!t) { closeList(); continue; }
    let m;
    if ((m = t.match(/^###\s+(.*)/))) { closeList(); html += `<h3 style="margin-top:12px;color:#f1f1f1">${inline(m[1])}</h3>`; }
    else if ((m = t.match(/^##\s+(.*)/))) { closeList(); html += `<h2 style="margin-top:14px;color:#f1f1f1">${inline(m[1])}</h2>`; }
    else if ((m = t.match(/^#\s+(.*)/))) { closeList(); html += `<h1 style="margin-top:16px;color:#f1f1f1">${inline(m[1])}</h1>`; }
    else if ((m = t.match(/^[-*]\s+(.*)/))) { if (inList !== 'ul') { closeList(); html += '<ul style="padding-left:20px">'; inList = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = t.match(/^\d+\.\s+(.*)/))) { if (inList !== 'ol') { closeList(); html += '<ol style="padding-left:20px">'; inList = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else { closeList(); html += `<p style="margin:6px 0">${inline(t)}</p>`; }
  }
  closeList();
  return html;
}

function extractVideoId(input) {
  input = input.trim();
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  return null;
}

export default function Home() {
  const [videoInput, setVideoInput] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const setMsg = (msg, type = '') => { setStatus(msg); setStatusType(type); };

  async function handleSubmit() {
    const videoId = extractVideoId(videoInput);
    if (!videoId) {
      setMsg("⚠️ Couldn't find a valid video ID. Try pasting the full URL.", 'error');
      return;
    }

    setLoading(true);
    setResult(null);
    setMsg('Fetching transcript & summarizing…');

    try {
      const apiRes = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, userMessage }),
      });

      const data = await apiRes.json();
      if (!apiRes.ok) throw new Error(data.error || 'API error');

      setResult(data);
      setMsg('✅ Done! Saved to Notion.', 'success');

    } catch (err) {
      setMsg('❌ ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>YT Transcript Summarizer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="YT Summary" />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #0f0f0f; color: #f1f1f1;
          min-height: 100dvh;
          padding: max(env(safe-area-inset-top), 24px) 20px max(env(safe-area-inset-bottom), 24px);
        }
      `}</style>

      <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#ff4444' }}>▶ YT Summarizer</h1>
          <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Transcript → Haiku → Notion</p>
        </div>

        <input
          type="text"
          placeholder="YouTube URL or video ID"
          value={videoInput}
          onChange={e => setVideoInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          style={inputStyle}
          autoCorrect="off" autoCapitalize="none" spellCheck="false"
        />

        <textarea
          placeholder="Optional: What should Haiku focus on? e.g. 'summarize the key marketing tips'"
          value={userMessage}
          onChange={e => setUserMessage(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={btnStyle(loading)}
        >
          {loading ? 'Working…' : 'Get Summary → Notion'}
        </button>

        {status && (
          <p style={{
            textAlign: 'center', fontSize: 14,
            color: statusType === 'error' ? '#ff6b6b' : statusType === 'success' ? '#4caf7d' : '#888'
          }}>
            {status}
          </p>
        )}

        {result && (
          <div style={{ background: '#1a1a1a', borderRadius: 14, border: '1.5px solid #2a2a2a', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f1f1f1' }}>{result.title}</h2>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: '#ccc' }} dangerouslySetInnerHTML={{ __html: renderMd(result.summary) }} />
            <a
              href={result.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', textAlign: 'center', padding: '12px', borderRadius: 10, background: '#2a2a2a', color: '#aaa', fontSize: 14, textDecoration: 'none' }}
            >
              Open in Notion →
            </a>
          </div>
        )}
      </div>
    </>
  );
}

const inputStyle = {
  width: '100%', padding: '14px 16px', borderRadius: 12,
  border: '1.5px solid #333', background: '#1a1a1a',
  color: '#f1f1f1', fontSize: 15, outline: 'none',
  fontFamily: 'inherit',
};

const btnStyle = (disabled) => ({
  width: '100%', padding: 15, borderRadius: 12, border: 'none',
  background: disabled ? '#555' : '#ff4444',
  color: 'white', fontSize: 16, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
