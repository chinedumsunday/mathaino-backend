const Anthropic = require('@anthropic-ai/sdk');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function systemPrompt(role) {
  if (role === 'LECTURER' || role === 'FACULTY' || role === 'SUPER_ADMIN') {
    return `You are iLearn Lecture Assistant, an AI tool for university lecturers.
Your job is to help lecturers:
- Generate quiz questions and assessment ideas from topics
- Suggest clear explanations and analogies for complex concepts
- Recommend ways to structure lesson content
- Provide references and key points to cover in lectures
- Suggest YouTube search queries they can use to find supplementary videos

Keep responses concise, structured with bullet points or numbered steps where helpful.
When the lecturer asks about a topic, always offer to generate quiz questions or suggest YouTube search terms they can use.`;
  }
  return `You are iLearn Study Assistant, an AI tutor for university students.
Your job is to help students:
- Understand course material and difficult concepts
- Summarize notes and key points clearly
- Work through practice problems step by step
- Suggest YouTube search terms to find helpful explanation videos
- Stay motivated and focused

Be friendly, encouraging, and concise. Use simple language.
When explaining concepts, give a short real-world analogy.
If the student seems stuck, break the explanation into smaller steps.
Do NOT do assignments or exams for the student — guide them to the answer instead.`;
}

// POST /api/ai/chat
const chat = asyncHandler(async (req, res) => {
  const { message, history = [], courseTitle, role } = req.body;

  if (!message?.trim()) throw ApiError.badRequest('Message is required');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your-anthropic-api-key') {
    throw ApiError.internal('AI service is not configured (missing ANTHROPIC_API_KEY in .env)');
  }

  const userRole = role || req.user?.role || 'STUDENT';
  let system = systemPrompt(userRole);
  if (courseTitle) {
    system += `\n\nThe user is currently working on the course: "${courseTitle}". Keep this context in mind.`;
  }

  const messages = [
    ...history.slice(-8).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message.trim() },
  ];

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system,
    messages,
  });

  const reply = response.content?.[0]?.text?.trim() ||
    "Sorry, I couldn't generate a response. Please try again.";

  res.json({ success: true, data: { reply } });
});

// POST /api/ai/youtube-suggest — returns YouTube search query suggestions for a topic
const youtubeSuggest = asyncHandler(async (req, res) => {
  const { topic } = req.body;
  if (!topic?.trim()) throw ApiError.badRequest('Topic is required');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your-anthropic-api-key') {
    return res.json({ success: true, data: { queries: [topic] } });
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: 'You generate YouTube search query suggestions. Respond with ONLY a JSON array of 3 short YouTube search strings, nothing else.',
    messages: [{ role: 'user', content: `Generate 3 YouTube search queries to find educational videos about: "${topic}"` }],
  });

  let queries = [topic];
  try {
    const text = response.content?.[0]?.text?.trim() || '[]';
    const parsed = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
    if (Array.isArray(parsed) && parsed.length) queries = parsed;
  } catch (_) {}

  res.json({ success: true, data: { queries } });
});

module.exports = { chat, youtubeSuggest };
