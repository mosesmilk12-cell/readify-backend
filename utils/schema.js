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

const trueFalseQuizSchema = {
  name: "true_false_quiz_pack",
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
              minItems: 2,
              maxItems: 2
            },
            correctAnswerIndex: {
              type: "integer",
              minimum: 0,
              maximum: 1
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

const shortAnswerQuizSchema = {
  name: "short_answer_quiz_pack",
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
            modelAnswer: { type: "string" },
            explanation: { type: "string" }
          },
          required: ["question", "modelAnswer", "explanation"]
        }
      }
    },
    required: ["title", "questions"]
  }
};

function schemaForQuestionType(questionType) {
  if (questionType === "TRUE_FALSE") return trueFalseQuizSchema;
  if (questionType === "SHORT_ANSWER") return shortAnswerQuizSchema;
  return quizSchema;
}

module.exports = { quizSchema, trueFalseQuizSchema, shortAnswerQuizSchema, schemaForQuestionType };
