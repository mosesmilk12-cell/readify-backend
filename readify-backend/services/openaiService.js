require("dotenv").config();

const OpenAI = require("openai");
const { schemaForQuestionType } = require("../utils/schema");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function buildPrompt({ questionType, questionCount, difficulty, sourceText }) {
  if (questionType === "TRUE_FALSE") {
    return `
You are generating a True/False quiz pack for a study app.

Use ONLY the provided study material.
Create exactly ${questionCount} True/False statements.
Difficulty: ${difficulty}.
Each question's "options" must be exactly ["True", "False"], in that order.
correctAnswerIndex must be 0 if the statement is true, or 1 if it is false.
Roughly half the statements should be true and half should be false.
Return short, clear explanations.
Do not invent facts not found in the material.

Study material:
${sourceText}
`;
  }

  if (questionType === "SHORT_ANSWER") {
    return `
You are generating a Short Answer quiz pack for a study app.

Use ONLY the provided study material.
Create exactly ${questionCount} short-answer questions.
Difficulty: ${difficulty}.
Each question needs a concise "modelAnswer" (1-2 sentences) that a student
could compare their own answer against.
Return short, clear explanations.
Do not invent facts not found in the material.

Study material:
${sourceText}
`;
  }

  return `
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
}

async function generateQuizPack({ title, sourceText, questionCount, difficulty, includeExplanations, questionType }) {
  const resolvedType = questionType || "MULTIPLE_CHOICE";
  const prompt = buildPrompt({ questionType: resolvedType, questionCount, difficulty, sourceText });

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
      json_schema: schemaForQuestionType(resolvedType)
    }
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  return JSON.parse(content);
}

module.exports = { generateQuizPack };
