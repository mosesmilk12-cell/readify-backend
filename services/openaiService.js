require("dotenv").config();

const OpenAI = require("openai");
const { quizSchema } = require("../utils/schema");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateQuizPack({ title, sourceText, questionCount, difficulty, includeExplanations }) {
  const prompt = `
You are generating a quiz pack for a study app.

Use ONLY the provided study material.
Create exactly ${questionCount} multiple-choice questions.
Difficulty: ${difficulty}.
Each question must have exactly 4 options.
Only one option is correct.
Return short, clear explanations.
Do not invent facts not found in the material.

Study material:
${sourceText}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "developer",
        content: "Return only valid JSON matching the provided schema."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: quizSchema
    }
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  return JSON.parse(content);
}

module.exports = { generateQuizPack };