import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

export const config = {
  maxDuration: 60,
};

function chunkText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [''];
}

// Parse inline markdown (**bold**, *italic*, `code`) into Notion rich_text array
function parseInline(text) {
  const parts = [];
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', text: { content: text.slice(lastIndex, m.index) } });
    }
    if (m[2]) {
      parts.push({ type: 'text', text: { content: m[2] }, annotations: { bold: true } });
    } else if (m[3]) {
      parts.push({ type: 'text', text: { content: m[3] }, annotations: { italic: true } });
    } else if (m[4]) {
      parts.push({ type: 'text', text: { content: m[4] }, annotations: { code: true } });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: { content: text.slice(lastIndex) } });
  }
  return parts.length ? parts : [{ type: 'text', text: { content: text } }];
}

// Convert markdown text into an array of Notion blocks
function markdownToBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match;
    if ((match = trimmed.match(/^###\s+(.*)/))) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: parseInline(match[1]) } });
    } else if ((match = trimmed.match(/^##\s+(.*)/))) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: parseInline(match[1]) } });
    } else if ((match = trimmed.match(/^#\s+(.*)/))) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: parseInline(match[1]) } });
    } else if ((match = trimmed.match(/^[-*]\s+(.*)/))) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseInline(match[1]) } });
    } else if ((match = trimmed.match(/^\d+\.\s+(.*)/))) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: parseInline(match[1]) } });
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseInline(trimmed) } });
    }
  }
  return blocks;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { videoId, userMessage } = req.body;

  if (!videoId) return res.status(400).json({ error: 'No videoId provided' });

  try {
    // 1. Fetch transcript via Supadata
    const supadataRes = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&text=true`,
      { headers: { 'x-api-key': process.env.SUPADATA_API_KEY } }
    );
    if (!supadataRes.ok) {
      const errText = await supadataRes.text();
      return res.status(supadataRes.status).json({ error: `Supadata: ${errText}` });
    }
    const supadataData = await supadataRes.json();
    const transcript = supadataData.content || supadataData.text || '';

    if (!transcript) {
      return res.status(404).json({ error: 'No transcript available for this video.' });
    }

    // 2. Summarize with Claude Haiku
    const focusLine = userMessage
      ? `The user wants you to focus on: "${userMessage}"\n\n`
      : '';
    const prompt = `${focusLine}Here is a YouTube transcript:\n\n${transcript}\n\nRespond in EXACTLY this format and nothing else:\n\n<title>A concise title for this video's content</title>\n<summary>\nA clear, well-structured summary using markdown (## headings, **bold**, bullet lists). Do NOT wrap the summary in quotes or code blocks.\n</summary>`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    const titleMatch = responseText.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = responseText.match(/<summary>([\s\S]*?)<\/summary>/);

    const title = titleMatch ? titleMatch[1].trim().replace(/^["*]+|["*]+$/g, '') : 'YouTube Summary';
    const summary = summaryMatch ? summaryMatch[1].trim() : responseText.trim();

    // 3. Save to Notion
    const notionPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        title: {
          title: [{ text: { content: title } }],
        },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: `Video ID: ${videoId}` } }],
          },
        },
        userMessage && {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ text: { content: `Focus: ${userMessage}` } }],
            icon: { emoji: '🎯' },
          },
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ text: { content: 'Summary' } }],
          },
        },
        ...markdownToBlocks(summary),
      ].filter(Boolean),
    });

    res.status(200).json({
      title,
      summary,
      notionUrl: `https://notion.so/${notionPage.id.replace(/-/g, '')}`,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
