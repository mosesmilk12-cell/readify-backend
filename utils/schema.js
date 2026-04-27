const quizSchema = {
  name: "quiz_pack",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              items: { type: "string" },
              minItems: 4,
              maxItems: 4
            },
            correctAnswerIndex: {
              type: "integer",
              minimum: 0,
              maximum: 3
            },
            explanation: { type: "string" }
          },
          required: ["question", "options", "correctAnswerIndex", "explanation"]
        }
      }
    },
    required: ["title", "questions"]
  }
};

module.exports = { quizSchema };