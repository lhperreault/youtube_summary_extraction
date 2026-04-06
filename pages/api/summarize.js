import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { videoId, transcript, userMessage } = req.body;

  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

  try {
    const prompt = userMessage
      ? `The user wants you to focus on: "${userMessage}"\n\nHere is the YouTube transcript:\n\n${transcript}\n\nPlease provide:\n1. A concise title for this video's content\n2. A clear summary tailored to the user's focus above`
      : `Here is a YouTube transcript:\n\n${transcript}\n\nPlease provide:\n1. A concise title for this video's content\n2. A clear summary of the key points`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    const titleMatch = responseText.match(/1\.\s*(.+?)(?:\n|2\.)/s);
    const summaryMatch = responseText.match(/2\.\s*([\s\S]+)/s);

    const title = titleMatch ? titleMatch[1].trim().replace(/^["*]+|["*]+$/g, '') : 'YouTube Summary';
    const summary = summaryMatch ? summaryMatch[1].trim() : responseText;

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
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: summary } }],
          },
        },
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
